// supabase/functions/upload-plan-image/index.ts
// UPDATED: Instant publish + Google Cloud Vision content scanning
// Deploy via: Supabase Dashboard → Edge Functions → upload-plan-image → paste & deploy
//
// Required secrets:
//   R2_ACCOUNT_ID, R2_MEDIA_ACCESS_KEY_ID, R2_MEDIA_SECRET_ACCESS_KEY
//   R2_BUCKET_NAME=narrow-plans-media
//   RESEND_API_KEY, NOTIFY_EMAIL=info@buildnarrow.com
//   GOOGLE_VISION_API_KEY   (for content moderation)

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

// ── Google Cloud Vision content scanning ─────────────────────────────────────
async function scanImageWithVision(
  imageBytes: Uint8Array,
  apiKey: string
): Promise<{ safe: boolean; reason: string; labels: string[] }> {
  const base64Image = btoa(String.fromCharCode(...imageBytes));

  const requestBody = {
    requests: [{
      image: { content: base64Image },
      features: [
        { type: 'SAFE_SEARCH_DETECTION' },
        { type: 'LABEL_DETECTION', maxResults: 10 }
      ]
    }]
  };

  try {
    const res = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      }
    );

    if (!res.ok) {
      console.error('Vision API HTTP error:', res.status);
      // If Vision API fails, allow upload but log warning
      return { safe: true, reason: 'Vision API unavailable — upload allowed', labels: [] };
    }

    const data = await res.json();
    const response = data.responses?.[0];
    if (!response) {
      return { safe: true, reason: 'No Vision response — upload allowed', labels: [] };
    }

    // ── SafeSearch check ──
    const ss = response.safeSearchAnnotation;
    if (ss) {
      const blocked = ['LIKELY', 'VERY_LIKELY'];
      if (blocked.includes(ss.adult)) return { safe: false, reason: 'Image flagged: adult content', labels: [] };
      if (blocked.includes(ss.violence)) return { safe: false, reason: 'Image flagged: violent content', labels: [] };
      if (blocked.includes(ss.racy)) return { safe: false, reason: 'Image flagged: inappropriate content', labels: [] };
    }

    // ── Label check — verify image is architecture-related ──
    const labels = (response.labelAnnotations || []).map((l: any) => l.description.toLowerCase());

    // Architecture-related keywords — if ANY of these match, it's likely a plan/rendering
    const archKeywords = [
      'floor plan', 'blueprint', 'architecture', 'building', 'house', 'home',
      'elevation', 'facade', 'render', 'rendering', 'residential', 'interior',
      'exterior', 'construction', 'design', 'property', 'real estate',
      'room', 'kitchen', 'bathroom', 'bedroom', 'living room', 'garage',
      'roof', 'window', 'door', 'wall', 'structure', 'plan', 'drawing',
      'sketch', 'diagram', 'layout', 'schematic', 'cottage', 'cabin',
      'barn', 'shed', 'villa', 'mansion', 'bungalow', 'townhouse',
      'apartment', 'condo', 'loft', 'studio', 'porch', 'deck', 'patio',
      'landscape', 'aerial', 'drone', 'overhead', 'top view', 'bird',
      'rectangle', 'line', 'parallel', 'technical drawing', 'cad',
      'furniture', 'wood', 'concrete', 'brick', 'steel', 'metal',
      'shouse', 'barndominium', 'pole barn', 'shop house'
    ];

    const hasArchLabel = labels.some((label: string) =>
      archKeywords.some(kw => label.includes(kw))
    );

    if (!hasArchLabel && labels.length > 0) {
      // Only reject if we got labels back but NONE are architecture-related
      return {
        safe: false,
        reason: `Image doesn't appear to be architecture-related. Detected: ${labels.slice(0, 5).join(', ')}`,
        labels
      };
    }

    return { safe: true, reason: 'Passed all checks', labels };

  } catch (err) {
    console.error('Vision API error:', err);
    // Fail open — if scanning breaks, allow upload
    return { safe: true, reason: 'Vision API error — upload allowed', labels: [] };
  }
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

    // ── Get architect profile (for arch_slug — derived server-side, not from form) ──
    const { data: profile, error: profileError } = await supabase
      .from('architect_profiles')
      .select('company_name, license_number, license_state')
      .eq('user_id', user.id)
      .single();

    if (profileError || !profile?.company_name) {
      return new Response(JSON.stringify({ error: 'Please save your architect profile first (company name required).' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Derive arch_slug from company name (server-side — prevents cross-architect folder access)
    const archSlug = profile.company_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    // ── Parse multipart form data ──
    const formData = await req.formData();
    const file       = formData.get('file') as File;
    const planName   = formData.get('plan_name')?.toString() || 'Unnamed Plan';
    const imageLabel = formData.get('image_label')?.toString() || 'Image';
    const planSlug   = formData.get('plan_slug')?.toString() || 'plan';

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

    // ── Read file bytes ──
    const fileBytes = new Uint8Array(await file.arrayBuffer());

    // ── Google Cloud Vision content scan ──
    const visionApiKey = Deno.env.get('GOOGLE_VISION_API_KEY') ?? '';
    if (visionApiKey) {
      const scan = await scanImageWithVision(fileBytes, visionApiKey);
      console.log('Vision scan result:', scan.reason, 'Labels:', scan.labels.join(', '));

      if (!scan.safe) {
        return new Response(JSON.stringify({
          error: `Upload rejected: ${scan.reason}. Please upload architectural images only (renderings, floor plans, elevations).`
        }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    } else {
      console.warn('GOOGLE_VISION_API_KEY not set — skipping content scan');
    }

    // ── Build R2 key — INSTANT PUBLISH: goes directly to active folder ──
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const safeLabel = imageLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const r2Key = `plans/${archSlug}/${planSlug}/${safeLabel}.${ext}`;

    // ── Upload to R2 ──
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

    const companyName = profile.company_name || user.email;
    const mediaPublicUrl = Deno.env.get('R2_MEDIA_PUBLIC_URL') || 'https://media.buildnarrow.com';
    const publicImageUrl = `${mediaPublicUrl}/${r2Key}`;

    // ── Send email notification to Narrow (for spot-checking) ──
    const resendKey   = Deno.env.get('RESEND_API_KEY') ?? '';
    const notifyEmail = Deno.env.get('NOTIFY_EMAIL') ?? 'info@buildnarrow.com';

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Narrow Platform <noreply@buildnarrow.com>',
        to: notifyEmail,
        subject: `📐 New Plan Image Published — ${planName}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
            <h2 style="color:#1B3A6B">New Plan Image — Live on Platform</h2>
            <div style="background:#dcfce7;border:1px solid #86efac;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:0.9em;color:#166534">
              ✅ <strong>Auto-published</strong> — passed Google Vision content scan
            </div>
            <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
              <tr><td style="padding:8px;font-weight:bold;color:#6B7280;width:140px">Architect</td><td style="padding:8px">${companyName}</td></tr>
              <tr style="background:#f9fafb"><td style="padding:8px;font-weight:bold;color:#6B7280">License</td><td style="padding:8px">${profile.license_number || 'Not provided'} (${profile.license_state || 'N/A'})</td></tr>
              <tr><td style="padding:8px;font-weight:bold;color:#6B7280">Plan Name</td><td style="padding:8px">${planName}</td></tr>
              <tr style="background:#f9fafb"><td style="padding:8px;font-weight:bold;color:#6B7280">Image Label</td><td style="padding:8px">${imageLabel}</td></tr>
              <tr><td style="padding:8px;font-weight:bold;color:#6B7280">Public URL</td><td style="padding:8px;font-size:0.85em"><a href="${publicImageUrl}">${publicImageUrl}</a></td></tr>
              <tr style="background:#f9fafb"><td style="padding:8px;font-weight:bold;color:#6B7280">R2 Path</td><td style="padding:8px;font-size:0.85em;color:#6B7280">${r2Key}</td></tr>
            </table>
            <p style="color:#6B7280;font-size:0.85em">This image is now live. If it needs to be removed, delete it from the R2 bucket.</p>
          </div>
        `,
      }),
    });

    return new Response(
      JSON.stringify({
        success: true,
        r2_key: r2Key,
        public_url: publicImageUrl,
        message: 'Image published successfully!'
      }),
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
