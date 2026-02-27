// supabase/functions/stripe-webhook/index.ts

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
};

// Map plan_id → R2 download URL
const PLAN_FILE_MAP: Record<string, string> = {
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
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
  } else {
    try {
      event = JSON.parse(body) as Stripe.Event;
      console.log('No signature header - raw parse:', event.type);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

    const filePath    = PLAN_FILE_MAP[planId];
    const downloadUrl = filePath
      ? `https://files.buildnarrow.com/${filePath}`
      : null;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { error: dbError } = await supabase.from('purchases').insert({
      stripe_session_id: session.id,
      plan_id:           planId,
      plan_name:         planName,
      architect_name:    architectName,
      buyer_email:       buyerEmail,
      amount_paid:       amountPaid,
      download_url:      downloadUrl,
      purchased_at:      new Date().toISOString(),
    });

    if (dbError) {
      console.error('DB insert error:', dbError.message);
    } else {
      console.log('Purchase recorded:', planName, buyerEmail, amountPaid);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
