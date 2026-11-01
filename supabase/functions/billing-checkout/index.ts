// Starts a Polar checkout for a business's yearly subscription.
import { cors, json, polar, requireAdmin, sameOrigin } from '../_shared/polar.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (!Deno.env.get('POLAR_ACCESS_TOKEN') || !Deno.env.get('POLAR_PRODUCT_ID')) {
      return json({ error: 'Payments are not set up yet. Please try again later.' }, 503);
    }
    const { business_id, return_url } = await req.json();
    if (!business_id || !sameOrigin(req, return_url)) return json({ error: 'Bad request' }, 400);
    const auth = await requireAdmin(req, business_id);
    if (auth.error) return auth.error;

    const checkout = await polar('/checkouts/', {
      products: [Deno.env.get('POLAR_PRODUCT_ID')],
      customer_email: auth.user.email,
      external_customer_id: business_id,
      metadata: { business_id },
      success_url: return_url
    });
    return json({ url: checkout.url });
  } catch (err) {
    console.error(err);
    return json({ error: 'Could not start the checkout. Please try again.' }, 502);
  }
});
