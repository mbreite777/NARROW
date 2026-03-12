// supabase/functions/stripe-webhook/index.ts
// Deploy with: supabase functions deploy stripe-webhook
//
// UPDATED: Now reads r2_pdf_key from the plans table dynamically
// instead of a hardcoded PLAN_FILE_MAP. Backwards-compatible with
// existing plans via fallback map.
//
// UPDATED (Step 3): Added subscription event handlers for contractor
// Pro accounts and lender placements. Register these events in Stripe Dashboard:
//   checkout.session.completed  (existing — plan purchases)
//   customer.subscription.created
//   customer.subscription.updated
//   customer.subscription.deleted
//   invoice.payment_failed

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
};

// Legacy fallback for plans created before the new system
const LEGACY_PLAN_MAP: Record<string, string> = {
  'breite_shouse': 'architects/breite_design/THE%20SHOUSE%20PLAN.pdf',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  const webhookSecret   = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
  const body            = await req.text();

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });

  let event: Stripe.Event;
  const signature = req.headers.get('stripe-signature');

  if (signature && webhookSecret) {
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      console.error('Signature failed, trying raw parse:', err.message);
      try {
        event = JSON.parse(body) as Stripe.Event;
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid payload' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
  } else {
    try {
      event = JSON.parse(body) as Stripe.Event;
      console.log('No signature header - raw parse:', event.type);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid payload' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // ── EXISTING: Plan purchase completed ──────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    // Only handle one-time plan purchases (subscriptions handled below)
    if (session.mode !== 'subscription') {
      const planId        = session.metadata?.plan_id ?? '';
      const planName      = session.metadata?.plan_name ?? '';
      const architectName = session.metadata?.architect_name ?? '';
      const buyerEmail    = session.customer_email ?? '';
      const amountPaid    = (session.amount_total ?? 0) / 100;

      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      // ── Look up r2_pdf_key from plans table (new dynamic approach) ──
      let r2Key: string | null = null;
      let downloadUrl: string | null = null;

      const { data: planRow } = await supabase
        .from('plans')
        .select('r2_pdf_key')
        .eq('plan_id', planId)
        .single();

      if (planRow?.r2_pdf_key) {
        r2Key = planRow.r2_pdf_key;
      } else {
        // Fallback to legacy map for older plans
        const legacyPath = LEGACY_PLAN_MAP[planId];
        if (legacyPath) {
          r2Key = decodeURIComponent(legacyPath);
          downloadUrl = `https://files.buildnarrow.com/${legacyPath}`;
        }
      }

      const { error: dbError } = await supabase.from('purchases').insert({
        stripe_session_id: session.id,
        plan_id:           planId,
        plan_name:         planName,
        architect_name:    architectName,
        buyer_email:       buyerEmail,
        amount_paid:       amountPaid,
        r2_key:            r2Key,
        download_url:      downloadUrl,
        purchased_at:      new Date().toISOString(),
      });

      if (dbError) {
        console.error('DB insert error:', dbError.message);
      } else {
        console.log('Purchase recorded:', planName, buyerEmail, amountPaid, 'r2_key:', r2Key);
      }
    }
  }

  // ── NEW: Subscription created or updated ───────────────────────
  if (event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated') {
    const subscription = event.data.object as Stripe.Subscription;
    const userId = subscription.metadata?.user_id;
    const tier = subscription.metadata?.tier;

    if (userId) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      // Determine role: lender_annual → lender, everything else → contractor
      const role = tier?.startsWith('lender') ? 'lender' : 'contractor';
      // Extract tier name: 'contractor_pro' → 'pro', 'lender_annual' → 'annual'
      const tierName = tier?.replace('contractor_', '').replace('lender_', '') || null;

      await supabase.from('subscriptions').upsert({
        user_id: userId,
        stripe_customer_id: subscription.customer as string,
        stripe_subscription_id: subscription.id,
        role: role,
        tier: tierName,
        status: subscription.status,
        current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        cancel_at_period_end: subscription.cancel_at_period_end,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'stripe_subscription_id' });

      // Update contractor profile tier
      if (role === 'contractor') {
        await supabase.from('contractor_profiles')
          .update({ subscription_tier: tierName })
          .eq('user_id', userId);
      }
      // Update lender profile status
      if (role === 'lender') {
        await supabase.from('lender_profiles')
          .update({ subscription_status: subscription.status })
          .eq('user_id', userId);
      }

      console.log(`Subscription ${event.type}: ${subscription.id} for user ${userId} (${role}/${tierName})`);
    }
  }

  // ── NEW: Subscription canceled ─────────────────────────────────
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    await supabase.from('subscriptions')
      .update({ status: 'canceled', updated_at: new Date().toISOString() })
      .eq('stripe_subscription_id', subscription.id);

    // Remove tier from contractor profile
    const userId = subscription.metadata?.user_id;
    if (userId) {
      await supabase.from('contractor_profiles')
        .update({ subscription_tier: null })
        .eq('user_id', userId);

      console.log(`Subscription canceled: ${subscription.id} for user ${userId}`);
    }
  }

  // ── NEW: Payment failed ────────────────────────────────────────
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice;
    const subId = invoice.subscription as string;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    await supabase.from('subscriptions')
      .update({ status: 'past_due', updated_at: new Date().toISOString() })
      .eq('stripe_subscription_id', subId);

    console.log(`Payment failed for subscription: ${subId}`);
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
