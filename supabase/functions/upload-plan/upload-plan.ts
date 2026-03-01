// supabase/functions/upload-plan/index.ts
// Deploy with: supabase functions deploy upload-plan
//
// All-in-one plan upload: PDF + up to 5 preview images + plan details.
// - PDF goes to narrow-plans bucket (private): plans/pending/{arch-slug}/{plan-slug}/{name}.pdf
// - Images go to narrow-plans-media bucket (public): plans/pending/{arch-slug}/{plan-slug}/{label}.{ext}
// - Inserts row into plans table with status: 'pending'
// - Sends email notification to Narrow for review
//
// Required secrets:
//   R2_ACCOUNT_ID
//   R2_MEDIA_ACCESS_KEY_ID, R2_MEDIA_SECRET_ACCESS_KEY, R2_BUCKET_NAME
//   R2_PLANS_ACCESS_KEY_ID, R2_PLANS_SECRET_ACCESS_KEY, R2_PLANS_BUCKET
//   R2_MEDIA_PUBLIC_URL  (e.g. https://pub-xxxxx.r2.dev)
//   RESEND_API_KEY, NOTIFY_EMAIL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── AWS Signature V4 ─────────────────────────────────────────────────────────
async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', key instanceof Uint8Array ? key : new Uint8Array(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
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

async function signR2Request(method: string, bucket: string, key: string, body: Uint8Array, contentType: string, accountId: string, accessKeyId: string, secretAccessKey: string) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${bucket}/${key}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256hex(body);
  const headers: Record<string, string> = { 'host': host, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash, 'content-type': contentType };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort().map(k => `${k}:${headers[k]}\n`).join('');
  const canonicalRequest = [method, `/${bucket}/${key}`, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, await sha256hex(canonicalRequest)].join('\n');
  const kDate = await hmac(new TextEncoder().encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmac(kDate, 'auto');
  const kService = await hmac(kRegion, 's3');
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = toHex(await hmac(kSigning, stringToSign));
  return { url, headers: { ...headers, 'Authorization': `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}` } };
}

async function uploadToR2(bucket: string, r2Key: string, fileBytes: Uint8Array, contentType: string, accountId: string, keyId: string, secret: string): Promise<boolean> {
  const { url, headers } = await signR2Request('PUT', bucket, r2Key, fileBytes, contentType, accountId, keyId, secret);
  const res = await fetch(url, { method: 'PUT', headers, body: fileBytes });
  if (!res.ok) console.error(`R2 upload failed for ${r2Key}:`, await res.text());
  return res.ok;
}

// ── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // ── Auth ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    if ((user.user_metadata?.role || 'homebuilder') !== 'architect') {
      return new Response(JSON.stringify({ error: 'Only architects can upload plans.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── SECURITY: Pull arch_slug from profile ──
    const { data: profile, error: profileError } = await supabase
      .from('architect_profiles')
      .select('arch_slug, company_name, folders_initialized')
      .eq('user_id', user.id).single();

    if (profileError || !profile?.arch_slug || !profile.folders_initialized) {
      return new Response(JSON.stringify({ error: 'Please save your profile with a Firm / Company Name first to initialize your folders.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const archSlug = profile.arch_slug;
    const companyName = profile.company_name || user.email;

    // ── Parse form data ──
    const formData = await req.formData();

    const planName    = formData.get('plan_name')?.toString()?.trim() || '';
    const planSlug    = formData.get('plan_slug')?.toString()?.trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || '';
    const beds        = formData.get('beds')?.toString() || '';
    const baths       = formData.get('baths')?.toString() || '';
    const sqft        = formData.get('sqft')?.toString() || '';
    const stories     = formData.get('stories')?.toString() || '';
    const style       = formData.get('style')?.toString() || '';
    const price       = formData.get('price')?.toString() || '';
    const description = formData.get('description')?.toString() || '';
    const pdfFile     = formData.get('pdf') as File | null;

    // Validate required fields
    if (!planName) return new Response(JSON.stringify({ error: 'Plan name is required.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (!planSlug) return new Response(JSON.stringify({ error: 'Plan slug is required.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (!price) return new Response(JSON.stringify({ error: 'Price is required.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (!pdfFile) return new Response(JSON.stringify({ error: 'PDF file is required.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Validate PDF
    if (pdfFile.type !== 'application/pdf') {
      return new Response(JSON.stringify({ error: 'Plan file must be a PDF.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (pdfFile.size > 50 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'PDF too large. Maximum 50MB.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Collect images (up to 5)
    const imageFiles: { file: File; label: string }[] = [];
    const allowedImg = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    for (let i = 0; i < 5; i++) {
      const img = formData.get(`image_${i}`) as File | null;
      const label = formData.get(`image_label_${i}`)?.toString() || `image-${i + 1}`;
      if (img && img.size > 0) {
        if (!allowedImg.includes(img.type)) {
          return new Response(JSON.stringify({ error: `Image ${i + 1} must be JPG, PNG, or WebP.` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (img.size > 10 * 1024 * 1024) {
          return new Response(JSON.stringify({ error: `Image ${i + 1} too large. Maximum 10MB each.` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        imageFiles.push({ file: img, label });
      }
    }

    if (imageFiles.length === 0) {
      return new Response(JSON.stringify({ error: 'At least one preview image is required.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── R2 credentials ──
    const acctId = Deno.env.get('R2_ACCOUNT_ID') ?? '';
    const mKey = Deno.env.get('R2_MEDIA_ACCESS_KEY_ID') ?? '', mSec = Deno.env.get('R2_MEDIA_SECRET_ACCESS_KEY') ?? '', mBkt = Deno.env.get('R2_BUCKET_NAME') ?? 'narrow-plans-media';
    const pKey = Deno.env.get('R2_PLANS_ACCESS_KEY_ID') ?? '', pSec = Deno.env.get('R2_PLANS_SECRET_ACCESS_KEY') ?? '', pBkt = Deno.env.get('R2_PLANS_BUCKET') ?? 'narrow-plans';
    const mediaPublicUrl = Deno.env.get('R2_MEDIA_PUBLIC_URL') ?? 'https://pub-placeholder.r2.dev';

    // ── Upload PDF to plans bucket (pending) ──
    const pdfBytes = new Uint8Array(await pdfFile.arrayBuffer());
    const pdfR2Key = `plans/pending/${archSlug}/${planSlug}/${planSlug}.pdf`;
    const pdfOk = await uploadToR2(pBkt, pdfR2Key, pdfBytes, 'application/pdf', acctId, pKey, pSec);
    if (!pdfOk) {
      return new Response(JSON.stringify({ error: 'Failed to upload PDF.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Upload images to media bucket (pending) ──
    const imagesJson: { url: string; label: string; r2_key: string; r2_pending_key: string }[] = [];
    for (const { file, label } of imageFiles) {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const pendingKey = `plans/pending/${archSlug}/${planSlug}/${safeLabel}.${ext}`;
      const activeKey = `plans/${archSlug}/${planSlug}/${safeLabel}.${ext}`;
      const imgBytes = new Uint8Array(await file.arrayBuffer());

      const imgOk = await uploadToR2(mBkt, pendingKey, imgBytes, file.type, acctId, mKey, mSec);
      if (!imgOk) {
        console.error(`Failed to upload image: ${pendingKey}`);
        continue; // Skip failed images but continue
      }

      imagesJson.push({
        url: `${mediaPublicUrl}/${activeKey}`,  // Final public URL (works after approval/move)
        label: label,
        r2_key: activeKey,
        r2_pending_key: pendingKey,
      });
    }

    // ── Generate plan_id ──
    const planId = `${archSlug}_${planSlug}`;

    // ── Active PDF path (where it will live after approval) ──
    const activePdfKey = `plans/${archSlug}/${planSlug}/${planSlug}.pdf`;

    // ── Parse price to cents for Stripe ──
    const priceClean = price.replace(/[^0-9.]/g, '');
    const priceCents = Math.round(parseFloat(priceClean) * 100) || 0;

    // ── Insert into plans table ──
    const { error: insertError } = await supabase.from('plans').insert({
      plan_id:     planId,
      user_id:     user.id,
      arch_slug:   archSlug,
      name:        planName,
      architect:   companyName,
      beds:        beds,
      baths:       baths,
      sqft:        sqft,
      stories:     stories,
      style:       style,
      price:       price,        // Display price string e.g. "$695"
      price_cents: priceCents,   // Numeric cents for Stripe
      description: description,
      images:      imagesJson,
      r2_pdf_key:  activePdfKey, // Where the PDF will be after approval
      status:      'pending',
      featured:    false,
      stars:       '★★★★★',
      created_at:  new Date().toISOString(),
    });

    if (insertError) {
      console.error('Plans table insert error:', insertError);
      return new Response(JSON.stringify({ error: 'Failed to create plan listing: ' + insertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Send email notification to Narrow ──
    const resendKey   = Deno.env.get('RESEND_API_KEY') ?? '';
    const notifyEmail = Deno.env.get('NOTIFY_EMAIL') ?? 'info@buildnarrow.com';

    const imageRows = imagesJson.map(img =>
      `<tr><td style="padding:6px 8px;font-size:0.85em;color:#6B7280">${img.label}</td><td style="padding:6px 8px;font-size:0.8em;font-family:monospace;color:#6B7280">${img.r2_pending_key}</td></tr>`
    ).join('');

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Narrow Platform <noreply@buildnarrow.com>',
          to: notifyEmail,
          subject: `📐 New Plan Pending Review — ${planName} by ${companyName}`,
          html: `
            <div style="font-family:sans-serif;max-width:640px;margin:0 auto">
              <h2 style="color:#1B3A6B">New Plan Submitted for Review</h2>
              <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
                <tr><td style="padding:8px;font-weight:bold;color:#6B7280;width:140px">Architect</td><td style="padding:8px">${companyName}</td></tr>
                <tr style="background:#f9fafb"><td style="padding:8px;font-weight:bold;color:#6B7280">Plan Name</td><td style="padding:8px">${planName}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;color:#6B7280">Plan ID</td><td style="padding:8px;font-family:monospace">${planId}</td></tr>
                <tr style="background:#f9fafb"><td style="padding:8px;font-weight:bold;color:#6B7280">Price</td><td style="padding:8px">${price}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;color:#6B7280">Details</td><td style="padding:8px">${beds} bed · ${baths} bath · ${sqft} sq ft · ${stories}</td></tr>
                <tr style="background:#f9fafb"><td style="padding:8px;font-weight:bold;color:#6B7280">Style</td><td style="padding:8px">${style}</td></tr>
              </table>

              <h3 style="color:#1B3A6B;font-size:1em">📄 PDF</h3>
              <p style="margin-bottom:4px">Move in <strong>narrow-plans</strong> bucket from:</p>
              <code style="display:block;background:#f3f4f6;padding:10px;border-radius:6px;font-size:0.85em;margin-bottom:4px">${pdfR2Key}</code>
              <p>to:</p>
              <code style="display:block;background:#dcfce7;padding:10px;border-radius:6px;font-size:0.85em;margin-bottom:20px">${activePdfKey}</code>

              <h3 style="color:#1B3A6B;font-size:1em">🖼️ Images (${imagesJson.length})</h3>
              <p style="margin-bottom:4px">Move each in <strong>narrow-plans-media</strong> bucket from pending to active:</p>
              <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:0.9em">
                <tr style="background:#f3f4f6"><th style="padding:6px 8px;text-align:left">Label</th><th style="padding:6px 8px;text-align:left">Pending Path</th></tr>
                ${imageRows}
              </table>
              <p>Active paths: remove <code>/pending</code> from each path above.</p>

              <h3 style="color:#1B3A6B;font-size:1em">✅ To Approve</h3>
              <ol style="font-size:0.9em;color:#374151">
                <li>Move PDF in narrow-plans bucket (pending → active)</li>
                <li>Move images in narrow-plans-media bucket (pending → active)</li>
                <li>In Supabase, update the plan row: <code>status</code> → <code>'active'</code></li>
              </ol>
            </div>
          `,
        }),
      });
    } catch (emailErr) {
      console.warn('Email notification failed:', emailErr);
    }

    return new Response(JSON.stringify({
      success: true,
      plan_id: planId,
      message: 'Plan submitted for review! You\'ll be notified once approved.',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('upload-plan error:', err);
    return new Response(JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
