// supabase/functions/create-checkout/index.ts
// Deploy with: supabase functions deploy create-checkout
// Set secret: supabase secrets set STRIPE_SECRET_KEY=sk_test_...

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { planId, planName, planPrice, architectName, buyerEmail } = await req.json();

    if (!planId || !planName || !planPrice) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: planId, planName, planPrice' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2023-10-16',
    });

    // Convert price string like "$1,850" → cents integer 185000
    const priceInCents = Math.round(
      parseFloat(planPrice.replace(/[^0-9.]/g, '')) * 100
    );

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: buyerEmail || undefined,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: priceInCents,
            product_data: {
              name: planName,
              description: `Architectural home plan by ${architectName} — licensed through Narrow. Includes full plan set PDF.`,
              metadata: {
                plan_id: planId,
                architect: architectName,
              },
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        plan_id: planId,
        plan_name: planName,
        architect_name: architectName,
      },
      // After payment, redirect to success page with session ID
      success_url: `https://www.buildnarrow.com/purchase-success.html?session_id={CHECKOUT_SESSION_ID}&plan_id=${encodeURIComponent(planId)}`,
      cancel_url: `https://www.buildnarrow.com/marketplace.html?cancelled=1`,
      // Display terms notice on Stripe checkout page
      custom_text: {
        submit: {
          message: 'By completing this purchase you agree to the Narrow Terms of Service (buildnarrow.com/terms.html). All plan sales are final once downloaded.',
        },
      },
    });

    return new Response(
      JSON.stringify({ url: session.url, sessionId: session.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Stripe checkout error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
