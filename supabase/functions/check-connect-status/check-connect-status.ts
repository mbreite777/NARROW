// supabase/functions/check-connect-status/index.ts
// Deploy: supabase functions deploy check-connect-status
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
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: profile } = await supabaseAdmin
      .from('architect_profiles')
      .select('stripe_connect_id, stripe_connect_status')
      .eq('user_id', user.id)
      .single();

    if (!profile?.stripe_connect_id) {
      return new Response(
        JSON.stringify({ status: 'not_connected', connected: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2023-10-16',
    });

    const account = await stripe.accounts.retrieve(profile.stripe_connect_id);
    const isActive = account.charges_enabled && account.payouts_enabled;
    const newStatus = isActive ? 'active' : 'pending';

    if (newStatus !== profile.stripe_connect_status) {
      await supabaseAdmin
        .from('architect_profiles')
        .update({ stripe_connect_status: newStatus, updated_at: new Date().toISOString() })
        .eq('user_id', user.id);
    }

    return new Response(
      JSON.stringify({
        connected: isActive,
        status: newStatus,
        accountId: profile.stripe_connect_id,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Check connect status error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
