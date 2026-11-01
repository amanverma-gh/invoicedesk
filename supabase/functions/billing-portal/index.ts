// Opens Polar's customer portal: invoices, card details, cancel or renew.
import { cors, json, polar, requireAdmin, sameOrigin } from '../_shared/polar.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (!Deno.env.get('POLAR_ACCESS_TOKEN')) return json({ error: 'Payments are not set up yet.' }, 503);
    const { business_id, return_url } = await req.json();
    if (!business_id || !sameOrigin(req, return_url)) return json({ error: 'Bad request' }, 400);
    const auth = await requireAdmin(req, business_id);
    if (auth.error) return auth.error;

    const session = await polar('/customer-sessions/', { external_customer_id: business_id, return_url });
    return json({ url: session.customer_portal_url });
  } catch (err) {
    console.error(err);
    return json({ error: 'No subscription found for this business yet.' }, 404);
  }
});
