// Shared helpers for the billing functions.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// POLAR_SERVER=sandbox while testing, production when live
export const polarApi = () =>
  Deno.env.get('POLAR_SERVER') === 'sandbox' ? 'https://sandbox-api.polar.sh/v1' : 'https://api.polar.sh/v1';

export async function polar(path: string, body: unknown) {
  const res = await fetch(polarApi() + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('POLAR_ACCESS_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Polar error', res.status, JSON.stringify(data));
    throw new Error('Polar request failed');
  }
  return data;
}

export const serviceClient = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

// The signed-in caller, and whether they are an admin of the business
export async function requireAdmin(req: Request, businessId: string) {
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false }
  });
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { error: json({ error: 'Please sign in again.' }, 401) };
  const { data: admin } = await client.rpc('is_admin', { b: businessId });
  if (!admin) return { error: json({ error: 'Only an admin can manage billing.' }, 403) };
  return { user };
}

// return links must point back to the site the request came from
export function sameOrigin(req: Request, url: string) {
  try { return new URL(url).origin === req.headers.get('origin'); } catch { return false; }
}
