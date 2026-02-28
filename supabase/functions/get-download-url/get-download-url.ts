// supabase/functions/get-download-url/index.ts
// Deploy with: supabase functions deploy get-download-url
//
// Verifies the user has a valid purchase then returns a presigned R2 URL
// that expires in 1 hour. The actual PDF never has a public URL.
//
// Required secrets:
//   R2_ACCOUNT_ID
//   R2_PLANS_ACCESS_KEY_ID    (from narrow-plans-upload token)
//   R2_PLANS_SECRET_ACCESS_KEY
//   R2_PLANS_BUCKET           narrow-plans

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── AWS Signature V4 helpers ──────────────────────────────────────────────────
async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key instanceof Uint8Array ? key : new Uint8Array(key),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
}

async function sha256hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate a presigned GET URL valid for `expiresIn` seconds
async function presignR2Get(
  bucket: string,
  key: string,
  accountId: string,
  accessKeyId: string,
  secretAccessKey: string,
  expiresIn: number = 3600
): Promise<string> {
  const region  = 'auto';
  const service = 's3';
  const host    = `${accountId}.r2.cloudflarestorage.com`;

  const now       = new Date();
  const amzDate   = now.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const credential      = `${accessKeyId}/${credentialScope}`;

  const queryParams = new URLSearchParams({
    'X-Amz-Algorithm':     'AWS4-HMAC-SHA256',
    'X-Amz-Credential':    credential,
    'X-Amz-Date':          amzDate,
    'X-Amz-Expires':       String(expiresIn),
    'X-Amz-SignedHeaders': 'host',
  });

  const canonicalQueryString = queryParams.toString();
  const canonicalHeaders     = `host:${host}\n`;
  const canonicalRequest     = [
    'GET',
    `/${bucket}/${key}`,
    canonicalQueryString,
    canonicalHeaders,
    'host',
    'UNSIGNED-PAYLOAD'
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256hex(canonicalRequest)
  ].join('\n');

  const kDate    = await hmac(new TextEncoder().encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion  = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = toHex(await hmac(kSigning, stringToSign));

  return `https://${host}/${bucket}/${key}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Auth check ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Get plan_id from request ──
    const { plan_id, stripe_session_id } = await req.json();

    if (!plan_id) {
      return new Response(JSON.stringify({ error: 'plan_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Verify purchase — check by user_id OR buyer_email ──
    const { data: purchase, error: purchaseError } = await supabase
      .from('purchases')
      .select('id, plan_id, plan_name, r2_key, download_url, stripe_session_id')
      .or(`user_id.eq.${user.id},buyer_email.eq.${user.email}`)
      .eq('plan_id', plan_id)
      .order('purchased_at', { ascending: false })
      .limit(1)
      .single();

    // Also allow lookup by stripe_session_id for immediate post-purchase flow
    let validPurchase = purchase;
    if (!validPurchase && stripe_session_id) {
      const { data: sessionPurchase } = await supabase
        .from('purchases')
        .select('id, plan_id, plan_name, r2_key, download_url, stripe_session_id')
        .eq('stripe_session_id', stripe_session_id)
        .single();
      validPurchase = sessionPurchase;
    }

    if (!validPurchase) {
      return new Response(JSON.stringify({ error: 'No valid purchase found for this plan.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Determine R2 key ──
    // Use r2_key if stored, otherwise derive from download_url path
    let r2Key = validPurchase.r2_key;

    if (!r2Key && validPurchase.download_url) {
      // Extract path from existing static URL e.g. https://files.buildnarrow.com/architects/breite_design/THE%20SHOUSE%20PLAN.pdf
      try {
        const urlObj = new URL(validPurchase.download_url);
        r2Key = decodeURIComponent(urlObj.pathname.replace(/^\//, ''));
      } catch(e) {
        r2Key = null;
      }
    }

    // Fallback: derive key from plan_id for known plans
    if (!r2Key) {
      const knownPaths: Record<string, string> = {
        'breite_shouse': 'architects/breite_design/THE SHOUSE PLAN.pdf',
      };
      r2Key = knownPaths[plan_id] || null;
    }

    if (!r2Key) {
      return new Response(JSON.stringify({ error: 'Plan file not found. Contact info@buildnarrow.com.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Generate presigned URL (expires in 1 hour) ──
    const accountId       = Deno.env.get('R2_ACCOUNT_ID') ?? '';
    const accessKeyId     = Deno.env.get('R2_PLANS_ACCESS_KEY_ID') ?? '';
    const secretAccessKey = Deno.env.get('R2_PLANS_SECRET_ACCESS_KEY') ?? '';
    const bucket          = Deno.env.get('R2_PLANS_BUCKET') ?? 'narrow-plans';

    const presignedUrl = await presignR2Get(
      bucket, r2Key, accountId, accessKeyId, secretAccessKey, 3600
    );

    return new Response(
      JSON.stringify({
        success: true,
        url: presignedUrl,
        expires_in: 3600,
        plan_name: validPurchase.plan_name || 'Architectural Plan',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('get-download-url error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
