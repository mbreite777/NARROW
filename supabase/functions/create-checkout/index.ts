// supabase/functions/create-checkout/index.ts
// Deploy with: supabase functions deploy create-checkout
// Secrets needed: STRIPE_SECRET_KEY

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NARROW_COMMISSION = 0.12; // 12% to Narrow

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { planId, planName, planPrice, architectName, buyerEmail, architectUserId } = await req.json();

    if (!planId || !planName || !planPrice) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: planId, planName, planPrice' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2023-10-16',
    });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Price in cents
    const priceInCents = typeof planPrice === 'number'
      ? planPrice
      : Math.round(parseFloat(String(planPrice).replace(/[^0-9.]/g, '')) * 100);

    // Amount to transfer to architect (88%)
    const architectShare = Math.round(priceInCents * (1 - NARROW_COMMISSION));

    // Look up the architect's Stripe Connect account ID
    let connectAccountId: string | null = null;

    if (architectUserId) {
      const { data: archProfile } = await supabase
        .from('architect_profiles')
        .select('stripe_connect_id, stripe_connect_status')
        .eq('user_id', architectUserId)
        .single();

      if (archProfile?.stripe_connect_id && archProfile?.stripe_connect_status === 'active') {
        connectAccountId = archProfile.stripe_connect_id;
      }
    }

    // Build the checkout session
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
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
        architect_user_id: architectUserId || '',
        architect_share_cents: architectShare.toString(),
      },
      success_url: `https://www.buildnarrow.com/purchase-success.html?session_id={CHECKOUT_SESSION_ID}&plan_id=${encodeURIComponent(planId)}`,
      cancel_url: `https://www.buildnarrow.com/marketplace.html?cancelled=1`,
      custom_text: {
        submit: {
          message: 'By completing this purchase you agree to the Narrow Terms of Service (buildnarrow.com/terms.html). All plan sales are final once downloaded.',
        },
      },
    };

    // If architect has an active Connect account, route payment to them
    if (connectAccountId) {
      sessionParams.payment_intent_data = {
        application_fee_amount: priceInCents - architectShare, // Narrow keeps 12%
        transfer_data: {
          destination: connectAccountId,
        },
      };
    }
    // If no Connect account yet, full payment goes to Narrow — admin pays architect manually

    const session = await stripe.checkout.sessions.create(sessionParams);

    return new Response(
      JSON.stringify({
        url: session.url,
        sessionId: session.id,
        architectPaid: !!connectAccountId,
        architectShare: connectAccountId ? architectShare : 0,
      }),
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
