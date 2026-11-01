// Receives Polar subscription events and records how long each business is paid up.
import { json, serviceClient } from '../_shared/polar.ts';

const GRACE_DAYS = 3;  // failed renewals get a few days while Polar retries the card
const enc = new TextEncoder();

function b64ToBytes(s: string) {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
async function hmac(key: Uint8Array, content: string) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(content)));
  return btoa(String.fromCharCode(...sig));
}

// Standard Webhooks signature. Newer Polar secrets are "whsec_<base64 key>"; older ones use the
// whole secret string as the key. Both are tried.
async function verified(req: Request, body: string) {
  const secret = Deno.env.get('POLAR_WEBHOOK_SECRET');
  const id = req.headers.get('webhook-id'), ts = req.headers.get('webhook-timestamp'), sigs = req.headers.get('webhook-signature');
  if (!secret || !id || !ts || !sigs) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const keys = [enc.encode(secret)];
  try { keys.unshift(b64ToBytes(secret.replace(/^whsec_/, ''))); } catch { /* not base64 */ }
  const given = sigs.split(' ').map(s => s.split(',')[1]).filter(Boolean);
  for (const key of keys) {
    const expected = await hmac(key, `${id}.${ts}.${body}`);
    if (given.includes(expected)) return true;
  }
  return false;
}

Deno.serve(async req => {
  const body = await req.text();
  if (!(await verified(req, body))) return json({ error: 'Invalid signature' }, 401);

  const event = JSON.parse(body);
  const type: string = event.type || '';
  if (!type.startsWith('subscription.')) return json({ ok: true, ignored: type });

  const sub = event.data || {};
  const businessId = sub.metadata?.business_id || sub.customer?.external_id;
  if (!businessId) return json({ ok: true, ignored: 'no business' });

  const ended = type === 'subscription.revoked' || ['canceled', 'revoked', 'unpaid', 'incomplete_expired'].includes(sub.status);
  let paidUntil: string | null = null;
  if (ended) paidUntil = new Date().toISOString();
  else if (sub.current_period_end && ['active', 'trialing', 'past_due'].includes(sub.status)) {
    paidUntil = new Date(new Date(sub.current_period_end).getTime() + GRACE_DAYS * 86400000).toISOString();
  }

  const row: Record<string, unknown> = {
    business_id: businessId,
    status: ended ? 'ended' : sub.cancel_at_period_end ? 'canceled' : sub.status || 'active',
    polar_subscription_id: sub.id ?? null,
    polar_customer_id: sub.customer_id ?? sub.customer?.id ?? null,
    updated_at: new Date().toISOString()
  };
  if (paidUntil) row.paid_until = paidUntil;

  const { error } = await serviceClient().from('subscriptions').upsert(row, { onConflict: 'business_id' });
  if (error) { console.error(error); return json({ error: 'Could not save' }, 500); }
  return json({ ok: true });
});
