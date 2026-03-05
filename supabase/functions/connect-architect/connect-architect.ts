// supabase/functions/connect-architect/index.ts
// Deploy: supabase functions deploy connect-architect
// Secrets needed: STRIPE_SECRET_KEY

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify the architect is logged in
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use anon key client to verify the user's access token
    const supabaseAnon = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseAnon.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use service role client for DB queries
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2023-10-16',
    });

    // Check if architect already has a Connect account
    const { data: profile } = await supabase
      .from('architect_profiles')
      .select('stripe_connect_id, stripe_connect_status')
      .eq('user_id', user.id)
      .single();

    let connectAccountId = profile?.stripe_connect_id;

    // Create a new Connect account if they don't have one
    if (!connectAccountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: user.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: 'individual',
        metadata: {
          supabase_user_id: user.id,
        },
      });

      connectAccountId = account.id;

      // Save the Connect account ID to Supabase
      await supabase
        .from('architect_profiles')
        .upsert({
          user_id: user.id,
          stripe_connect_id: connectAccountId,
          stripe_connect_status: 'pending',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
    }

    // Generate the onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: connectAccountId,
      refresh_url: `https://www.buildnarrow.com/dashboard.html?stripe_refresh=1`,
      return_url: `https://www.buildnarrow.com/dashboard.html?stripe_return=1`,
      type: 'account_onboarding',
    });

    return new Response(
      JSON.stringify({ url: accountLink.url, accountId: connectAccountId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Connect architect error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
