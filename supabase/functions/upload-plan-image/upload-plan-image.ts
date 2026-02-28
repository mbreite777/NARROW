// supabase/functions/upload-plan-image/index.ts
// Deploy with: supabase functions deploy upload-plan-image
//
// Required secrets (set via Supabase dashboard or CLI):
//   supabase secrets set R2_ACCOUNT_ID=your_cloudflare_account_id
//   supabase secrets set R2_MEDIA_ACCESS_KEY_ID=your_r2_access_key
//   supabase secrets set R2_MEDIA_SECRET_ACCESS_KEY=your_r2_secret_key
//   supabase secrets set R2_BUCKET_NAME=narrow-plans-media
//   supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx
//   supabase secrets set NOTIFY_EMAIL=info@buildnarrow.com

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── AWS Signature V4 for R2 (S3-compatible) ──────────────────────────────────
async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key instanceof Uint8Array ? key : new Uint8Array(key),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
}

async function sha256hex(data: string | Uint8Array): Promise<string> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function signR2Request(
  method: string,
  bucket: string,
  key: string,
  body: Uint8Array,
  contentType: string,
  accountId: string,
  accessKeyId: string,
  secretAccessKey: string
): Promise<{ url: string; headers: Record<string, string> }> {
  const region = 'auto';
  const service = 's3';
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${bucket}/${key}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = await sha256hex(body);

  const headers: Record<string, string> = {
    'host': host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    'content-type': contentType,
  };

  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort()
    .map(k => `${k}:${headers[k]}\n`).join('');

  const canonicalRequest = [
    method, `/${bucket}/${key}`, '',
    canonicalHeaders, signedHeaders, payloadHash
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope,
    await sha256hex(canonicalRequest)].join('\n');

  const kDate    = await hmac(new TextEncoder().encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion  = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = toHex(await hmac(kSigning, stringToSign));

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url,
    headers: { ...headers, 'Authorization': authorization }
  };
}

// ── Main handler ─────────────────────────────────────────────────────────────
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

    // ── Role check — must be architect ──
    const role = user.user_metadata?.role || 'homebuilder';
    if (role !== 'architect') {
      return new Response(JSON.stringify({ error: 'Only architects can upload plans.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Parse multipart form data ──
    const formData = await req.formData();
    const file       = formData.get('file') as File;
    const planName   = formData.get('plan_name')?.toString() || 'Unnamed Plan';
    const imageLabel = formData.get('image_label')?.toString() || 'Image';
    const planSlug   = formData.get('plan_slug')?.toString() || 'plan';
    const archSlug   = formData.get('arch_slug')?.toString() || user.id;

    if (!file) {
      return new Response(JSON.stringify({ error: 'No file provided.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Validate file type ──
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      return new Response(JSON.stringify({ error: 'Only JPG, PNG, or WebP images are allowed.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Validate file size (max 10MB) ──
    if (file.size > 10 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'File too large. Maximum size is 10MB.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Build R2 key — goes to pending folder ──
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const safeLabel = imageLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const r2Key = `plans/pending/${archSlug}/${planSlug}/${safeLabel}.${ext}`;

    // ── Upload to R2 ──
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const accountId       = Deno.env.get('R2_ACCOUNT_ID') ?? '';
    const accessKeyId     = Deno.env.get('R2_MEDIA_ACCESS_KEY_ID') ?? '';
    const secretAccessKey = Deno.env.get('R2_MEDIA_SECRET_ACCESS_KEY') ?? '';
    const bucketName      = Deno.env.get('R2_BUCKET_NAME') ?? 'narrow-plans-media';

    const { url: r2Url, headers: r2Headers } = await signR2Request(
      'PUT', bucketName, r2Key, fileBytes, file.type,
      accountId, accessKeyId, secretAccessKey
    );

    const r2Res = await fetch(r2Url, {
      method: 'PUT',
      headers: r2Headers,
      body: fileBytes,
    });

    if (!r2Res.ok) {
      const errText = await r2Res.text();
      console.error('R2 upload error:', errText);
      return new Response(JSON.stringify({ error: 'R2 upload failed.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Save pending record to Supabase ──
    const architectProfile = await supabase
      .from('architect_profiles')
      .select('company_name')
      .eq('user_id', user.id)
      .single();

    const companyName = architectProfile.data?.company_name || user.email;

    await supabase.from('pending_plan_images').insert({
      user_id:      user.id,
      arch_slug:    archSlug,
      plan_slug:    planSlug,
      plan_name:    planName,
      image_label:  imageLabel,
      r2_key:       r2Key,
      file_type:    file.type,
      status:       'pending',
      submitted_at: new Date().toISOString(),
    });

    // ── Send email notification to Narrow ──
    const resendKey   = Deno.env.get('RESEND_API_KEY') ?? '';
    const notifyEmail = Deno.env.get('NOTIFY_EMAIL') ?? 'info@buildnarrow.com';

    const reviewUrl = `https://pub-placeholder.r2.dev/${r2Key}`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Narrow Platform <noreply@buildnarrow.com>',
        to: notifyEmail,
        subject: `🖼️ New Plan Image Pending Review — ${planName}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
            <h2 style="color:#1B3A6B">New Plan Image Submitted for Review</h2>
            <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
              <tr><td style="padding:8px;font-weight:bold;color:#6B7280;width:140px">Architect</td><td style="padding:8px">${companyName}</td></tr>
              <tr style="background:#f9fafb"><td style="padding:8px;font-weight:bold;color:#6B7280">Plan Name</td><td style="padding:8px">${planName}</td></tr>
              <tr><td style="padding:8px;font-weight:bold;color:#6B7280">Image Label</td><td style="padding:8px">${imageLabel}</td></tr>
              <tr style="background:#f9fafb"><td style="padding:8px;font-weight:bold;color:#6B7280">File Type</td><td style="padding:8px">${file.type}</td></tr>
              <tr><td style="padding:8px;font-weight:bold;color:#6B7280">R2 Path</td><td style="padding:8px;font-size:0.85em;color:#6B7280">${r2Key}</td></tr>
            </table>
            <p style="margin-bottom:16px">To approve this image, move the file in your Cloudflare R2 dashboard from:</p>
            <code style="display:block;background:#f3f4f6;padding:12px;border-radius:6px;font-size:0.85em;margin-bottom:8px">plans/pending/${archSlug}/${planSlug}/${safeLabel}.${ext}</code>
            <p>to:</p>
            <code style="display:block;background:#dcfce7;padding:12px;border-radius:6px;font-size:0.85em;margin-bottom:24px">plans/${archSlug}/${planSlug}/${safeLabel}.${ext}</code>
            <p style="color:#6B7280;font-size:0.85em">Then update the plan card in marketplace.html with the approved public URL.</p>
          </div>
        `,
      }),
    });

    return new Response(
      JSON.stringify({ success: true, r2_key: r2Key, message: 'Image submitted for review. You\'ll be notified once approved.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('upload-plan-image error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
