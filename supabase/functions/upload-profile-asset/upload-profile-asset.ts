// supabase/functions/upload-profile-asset/index.ts
// Handles uploads for: logos, portfolio images, review images
// Stores in R2 narrow-plans-media bucket under profiles/ prefix
// Deploy via: Supabase Dashboard → Edge Functions → upload-profile-asset → paste & deploy
//
// Required secrets (already set from upload-plan-image):
//   R2_ACCOUNT_ID, R2_MEDIA_ACCESS_KEY_ID, R2_MEDIA_SECRET_ACCESS_KEY
//   R2_BUCKET_NAME=narrow-plans-media
//   R2_MEDIA_PUBLIC_URL=https://media.buildnarrow.com

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

  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope,
    await sha256hex(canonicalRequest)].join('\n');

  const kDate    = await hmac(new TextEncoder().encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion  = await hmac(kDate, 'auto');
  const kService = await hmac(kRegion, 's3');
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = toHex(await hmac(kSigning, stringToSign));

  return {
    url,
    headers: { ...headers, 'Authorization': `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}` }
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

    // ── Role check — must be architect or contractor ──
    const role = user.user_metadata?.role || 'homebuilder';
    const isArchitect = role === 'architect';
    const isContractor = role === 'contractor';
    // Homebuilders can upload review images
    const isHomebuilder = role === 'homebuilder';

    // ── Parse multipart form data ──
    const formData = await req.formData();
    const assetType = formData.get('asset_type')?.toString() || '';
    // asset_type: 'logo' | 'portfolio' | 'review-image'

    const validTypes = ['logo', 'portfolio', 'review-image'];
    if (!validTypes.includes(assetType)) {
      return new Response(JSON.stringify({ error: `Invalid asset_type. Must be one of: ${validTypes.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Only professionals can upload logos and portfolio images
    if ((assetType === 'logo' || assetType === 'portfolio') && !isArchitect && !isContractor) {
      return new Response(JSON.stringify({ error: 'Only architects and contractors can upload profile assets.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Collect files ──
    // For logo: single file named 'file'
    // For portfolio: multiple files named 'file_0', 'file_1', etc. (up to 12)
    // For review-image: multiple files named 'file_0', 'file_1', etc. (up to 4)
    const files: File[] = [];
    const allowedMime = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const maxSize = 5 * 1024 * 1024; // 5MB per image

    if (assetType === 'logo') {
      const f = formData.get('file') as File | null;
      if (!f) {
        return new Response(JSON.stringify({ error: 'No file provided.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (!allowedMime.includes(f.type)) {
        return new Response(JSON.stringify({ error: 'Only JPG, PNG, or WebP images are allowed.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (f.size > maxSize) {
        return new Response(JSON.stringify({ error: 'File too large. Maximum 5MB.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      files.push(f);
    } else {
      const maxFiles = assetType === 'portfolio' ? 12 : 4;
      for (let i = 0; i < maxFiles; i++) {
        const f = formData.get(`file_${i}`) as File | null;
        if (f && f.size > 0) {
          if (!allowedMime.includes(f.type)) {
            return new Response(JSON.stringify({ error: `File ${i + 1}: Only JPG, PNG, or WebP images are allowed.` }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
          if (f.size > maxSize) {
            return new Response(JSON.stringify({ error: `File ${i + 1}: Too large. Maximum 5MB each.` }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
          files.push(f);
        }
      }
      if (files.length === 0) {
        return new Response(JSON.stringify({ error: 'No files provided.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // ── R2 credentials ──
    const accountId       = Deno.env.get('R2_ACCOUNT_ID') ?? '';
    const accessKeyId     = Deno.env.get('R2_MEDIA_ACCESS_KEY_ID') ?? '';
    const secretAccessKey = Deno.env.get('R2_MEDIA_SECRET_ACCESS_KEY') ?? '';
    const bucketName      = Deno.env.get('R2_BUCKET_NAME') ?? 'narrow-plans-media';
    const mediaPublicUrl  = Deno.env.get('R2_MEDIA_PUBLIC_URL') ?? 'https://media.buildnarrow.com';

    const rolePrefix = isArchitect ? 'architect' : isContractor ? 'contractor' : 'user';
    const uploadedUrls: string[] = [];

    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const fileBytes = new Uint8Array(await file.arrayBuffer());

      let r2Key = '';

      if (assetType === 'logo') {
        // Logo: overwrite each time (single file per user)
        r2Key = `profiles/logos/${rolePrefix}-${user.id}.${ext}`;
      } else if (assetType === 'portfolio') {
        // Portfolio: unique key per image
        const ts = Date.now();
        const rand = Math.random().toString(36).slice(2, 8);
        r2Key = `profiles/portfolio/${rolePrefix}-${user.id}/${ts}-${rand}.${ext}`;
      } else if (assetType === 'review-image') {
        // Review images: keyed by target professional's ID
        const targetId = formData.get('target_user_id')?.toString() || 'unknown';
        const ts = Date.now();
        const rand = Math.random().toString(36).slice(2, 8);
        r2Key = `profiles/review-images/${targetId}/${ts}-${rand}.${ext}`;
      }

      // ── Upload to R2 ──
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
        console.error(`R2 upload error for ${r2Key}:`, errText);
        continue; // Skip failed uploads but continue with the rest
      }

      uploadedUrls.push(`${mediaPublicUrl}/${r2Key}`);
    }

    if (uploadedUrls.length === 0) {
      return new Response(JSON.stringify({ error: 'All uploads failed.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── For logos, also update the profile table directly ──
    if (assetType === 'logo') {
      const table = isArchitect ? 'architect_profiles' : 'contractor_profiles';
      await supabase
        .from(table)
        .update({ logo_url: uploadedUrls[0], updated_at: new Date().toISOString() })
        .eq('user_id', user.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        urls: uploadedUrls,
        // Convenience: for logo, return singular url
        url: uploadedUrls[0],
        count: uploadedUrls.length,
        asset_type: assetType,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('upload-profile-asset error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
