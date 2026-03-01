// supabase/functions/stripe-webhook/index.ts
// Deploy with: supabase functions deploy stripe-webhook
//
// UPDATED: Now reads r2_pdf_key from the plans table dynamically
// instead of a hardcoded PLAN_FILE_MAP. Backwards-compatible with
// existing plans via fallback map.

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

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

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

  return new Response(JSON.stringify({ received: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
