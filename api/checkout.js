// /api/checkout.js
// Vercel Edge function. Creates a Stripe Checkout Session and returns its URL.
// Required env: STRIPE_SECRET_KEY
//
// Auto-switches between test and live Price IDs based on the Stripe key prefix.
// This means you can keep testing in the Sandbox forever; just swap STRIPE_SECRET_KEY
// from sk_test_... to sk_live_... at launch and the live IDs activate automatically.

export const config = {
  runtime: 'edge'
};

// ---------------------------------------------------------------------------
// PRICE IDS — separate sets for test (Sandbox) and live mode
// ---------------------------------------------------------------------------
const PRICES_TEST = {
  lvl2:   'price_1TQ4NsIC7qSWxSMT2fNtzdvc', // Sandbox: Level 2 Separation — $29
  lvl3:   'price_1TQ4PJIC7qSWxSMTnhnF1oLm', // Sandbox: Level 3 Mastery — $39
  bundle: 'price_1TQ4QTIC7qSWxSMTLiLBo53y'  // Sandbox: Levels 2 + 3 Bundle — $49
};

const PRICES_LIVE = {
  lvl2:   'price_1TQ3BcIC7qSWxSMT3WY8iRaH', // Live: Level 2 Separation — $29
  lvl3:   'price_1TQ3DQIC7qSWxSMTOdat5OrZ', // Live: Level 3 Mastery — $39
  bundle: 'price_1TQ3EtIC7qSWxSMTyYle2eVY'  // Live: Levels 2 + 3 Bundle — $49
};

// What each tier unlocks. Passed as Stripe metadata so /api/access knows what to grant.
const UNLOCKS = {
  lvl2:   'level2',
  lvl3:   'level3',
  bundle: 'level2,level3'
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return jsonError(405, 'Method not allowed');
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return jsonError(500, 'Server not configured');
  }

  // Pick the right price set based on which key is loaded
  const PRICES = stripeKey.startsWith('sk_live_') ? PRICES_LIVE : PRICES_TEST;

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  const { tier, lang } = body || {};
  const priceId = PRICES[tier];
  if (!priceId) {
    return jsonError(400, 'Unknown tier');
  }

  // Build the origin (e.g. https://getreadyhoops.com) from the incoming request
  const url = new URL(req.url);
  const origin = `${url.protocol}//${url.host}`;

  // Stripe expects form-encoded params, not JSON
  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('line_items[0][price]', priceId);
  params.append('line_items[0][quantity]', '1');
  params.append('success_url', `${origin}/access.html?session_id={CHECKOUT_SESSION_ID}`);
  params.append('cancel_url', `${origin}/unlock.html`);
  params.append('automatic_tax[enabled]', 'false');
  params.append('billing_address_collection', 'auto');
  params.append('allow_promotion_codes', 'true');
  params.append('locale', lang === 'es' ? 'es' : 'en');
  params.append('metadata[tier]', tier);
  params.append('metadata[unlocks]', UNLOCKS[tier]);

  let stripeRes;
  try {
    stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });
  } catch {
    return jsonError(502, 'Stripe connection failed');
  }

  if (!stripeRes.ok) {
    const errText = await stripeRes.text();
    console.error('Stripe error:', stripeRes.status, errText);
    return jsonError(502, 'Stripe error');
  }

  const session = await stripeRes.json();

  if (!session.url) {
    return jsonError(502, 'No session URL');
  }

  return new Response(JSON.stringify({ url: session.url }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
