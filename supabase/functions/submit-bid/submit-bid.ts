// supabase/functions/submit-bid/index.ts
// Deploy with: supabase functions deploy submit-bid
// Secrets needed: STRIPE_SECRET_KEY (none new — uses existing Supabase secrets)

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
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify user
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { project_id, estimated_cost, estimated_timeline, notes } = await req.json();

    if (!project_id) {
      return new Response(JSON.stringify({ error: 'project_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Verify contractor has active Pro subscription
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('tier, status')
      .eq('user_id', user.id)
      .eq('role', 'contractor')
      .single();

    if (!sub || sub.status !== 'active' || sub.tier !== 'pro') {
      return new Response(JSON.stringify({ error: 'Pro subscription required to submit bids' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Verify invitation exists
    const { data: invitation } = await supabase
      .from('project_invitations')
      .select('*')
      .eq('project_id', project_id)
      .eq('contractor_id', user.id)
      .single();

    if (!invitation) {
      return new Response(JSON.stringify({ error: 'Not invited to this project' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Get project details + builder_id
    const { data: project } = await supabase
      .from('builder_projects')
      .select('builder_id, project_name')
      .eq('id', project_id)
      .single();

    if (!project) {
      return new Response(JSON.stringify({ error: 'Project not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Insert bid
    const { data: bid, error: bidError } = await supabase
      .from('contractor_bids')
      .insert({
        project_id,
        contractor_id: user.id,
        builder_id: project.builder_id,
        estimated_cost: estimated_cost || null,
        estimated_timeline: estimated_timeline || null,
        notes: notes || null,
      })
      .select()
      .single();

    if (bidError) {
      // Unique constraint = already submitted
      if (bidError.code === '23505') {
        return new Response(JSON.stringify({ error: 'You have already submitted a bid for this project' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      throw bidError;
    }

    // Update invitation status
    await supabase
      .from('project_invitations')
      .update({ status: 'bid_submitted' })
      .eq('id', invitation.id);

    // Update pipeline
    await supabase
      .from('contractor_pipeline')
      .upsert({
        contractor_id: user.id,
        project_id,
        pipeline_status: 'bid_submitted',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'contractor_id,project_id' });

    // Get contractor company name for the notification
    const { data: contProfile } = await supabase
      .from('contractor_profiles')
      .select('company_name')
      .eq('user_id', user.id)
      .single();

    const companyName = contProfile?.company_name || 'A contractor';

    // Notify builder (in-app)
    await supabase.from('notifications').insert({
      user_id: project.builder_id,
      type: 'bid_received',
      title: 'New Bid Received',
      message: `${companyName} submitted a bid for ${project.project_name}`,
      link: `dashboard.html?view=bids&project=${project_id}`,
    });

    // Send email via Resend
    const resendKey = Deno.env.get('RESEND_API_KEY');
    const notifyEmail = Deno.env.get('NOTIFY_EMAIL') ?? 'info@buildnarrow.com';
    if (resendKey) {
      // Get builder email
      const { data: builderAuth } = await supabase.auth.admin.getUserById(project.builder_id);
      const builderEmail = builderAuth?.user?.email;

      if (builderEmail) {
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${resendKey}`,
            },
            body: JSON.stringify({
              from: `Narrow <${notifyEmail}>`,
              to: builderEmail,
              subject: `New Bid Received — ${project.project_name}`,
              html: `<p>Hi,</p>
                <p><strong>${companyName}</strong> just submitted a bid for your project <strong>${project.project_name}</strong>.</p>
                ${estimated_cost ? `<p>Estimated cost: $${Number(estimated_cost).toLocaleString()}</p>` : ''}
                ${estimated_timeline ? `<p>Timeline: ${estimated_timeline}</p>` : ''}
                ${notes ? `<p>Notes: ${notes}</p>` : ''}
                <p><a href="https://www.buildnarrow.com/dashboard.html?view=bids&project=${project_id}">View all bids on your dashboard →</a></p>
                <p>— Narrow</p>`,
            }),
          });
        } catch (emailErr) {
          console.error('Email send error:', emailErr);
          // Don't fail the bid submission if email fails
        }
      }
    }

    console.log(`Bid submitted: ${user.id} → project ${project_id} (${companyName})`);

    return new Response(
      JSON.stringify({ bid, message: 'Bid submitted successfully' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Submit bid error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
