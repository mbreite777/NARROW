// supabase/functions/init-architect-folders/index.ts
// Deploy with: supabase functions deploy init-architect-folders
//
// Creates placeholder files in BOTH R2 buckets to initialize folder structure:
//   narrow-plans-media (public images):  plans/pending/{slug}/.keep  +  plans/{slug}/.keep
//   narrow-plans (private PDFs):         plans/pending/{slug}/.keep  +  plans/{slug}/.keep
//
// Required secrets:
//   R2_ACCOUNT_ID
//   R2_MEDIA_ACCESS_KEY_ID, R2_MEDIA_SECRET_ACCESS_KEY, R2_BUCKET_NAME
//   R2_PLANS_ACCESS_KEY_ID, R2_PLANS_SECRET_ACCESS_KEY, R2_PLANS_BUCKET

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

function generateSlug(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

async function uploadKeep(bucket: string, r2Key: string, accountId: string, keyId: string, secret: string): Promise<boolean> {
  const body = new TextEncoder().encode('# Narrow folder\n');
  const { url, headers } = await signR2Request('PUT', bucket, r2Key, body, 'text/plain', accountId, keyId, secret);
  return (await fetch(url, { method: 'PUT', headers, body })).ok;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    if ((user.user_metadata?.role || 'homebuilder') !== 'architect') {
      return new Response(JSON.stringify({ error: 'Only architects can initialize folders.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { company_name } = await req.json();
    if (!company_name?.trim()) return new Response(JSON.stringify({ error: 'Company name is required.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    let archSlug = generateSlug(company_name);
    if (!archSlug) return new Response(JSON.stringify({ error: 'Could not generate slug from company name.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Slug collision check
    const { data: existing } = await supabase.from('architect_profiles').select('user_id').eq('arch_slug', archSlug).neq('user_id', user.id).maybeSingle();
    if (existing) archSlug = `${archSlug}-${user.id.substring(0, 6)}`;

    const acctId = Deno.env.get('R2_ACCOUNT_ID') ?? '';
    const mKey = Deno.env.get('R2_MEDIA_ACCESS_KEY_ID') ?? '', mSec = Deno.env.get('R2_MEDIA_SECRET_ACCESS_KEY') ?? '', mBkt = Deno.env.get('R2_BUCKET_NAME') ?? 'narrow-plans-media';
    const pKey = Deno.env.get('R2_PLANS_ACCESS_KEY_ID') ?? '', pSec = Deno.env.get('R2_PLANS_SECRET_ACCESS_KEY') ?? '', pBkt = Deno.env.get('R2_PLANS_BUCKET') ?? 'narrow-plans';

    const results = await Promise.all([
      uploadKeep(mBkt, `plans/pending/${archSlug}/.keep`, acctId, mKey, mSec),
      uploadKeep(mBkt, `plans/${archSlug}/.keep`, acctId, mKey, mSec),
      uploadKeep(pBkt, `plans/pending/${archSlug}/.keep`, acctId, pKey, pSec),
      uploadKeep(pBkt, `plans/${archSlug}/.keep`, acctId, pKey, pSec),
    ]);

    if (!results.every(r => r)) {
      return new Response(JSON.stringify({ error: 'Failed to create R2 folders.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await supabase.from('architect_profiles').update({ arch_slug: archSlug, folders_initialized: true, updated_at: new Date().toISOString() }).eq('user_id', user.id);

    return new Response(JSON.stringify({ success: true, arch_slug: archSlug }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('init-architect-folders error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
