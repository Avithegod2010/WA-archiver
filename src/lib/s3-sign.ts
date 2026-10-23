/**
 * AWS Signature V4 (SigV4) signer for the S3 storage adapter.
 *
 * Implemented on the async WebCrypto primitives (globalThis.crypto.subtle)
 * so the SAME code runs in three runtimes:
 *   • the browser (direct device-mode pushes),
 *   • the Next.js server proxy (web mode, no CORS issues),
 *   • tests / scripts under Bun + Node ≥ 19 (global WebCrypto).
 *
 * Only the four verbs the adapter needs are supported: PUT (push),
 * GET (pull + list), DELETE (prune). Signing covers the canonical request
 * with the `host` header, `x-amz-content-sha256` and `x-amz-date`.
 */

const ALGO = 'AWS4-HMAC-SHA256'
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD'

function sha256Hex(data: string): Promise<string> {
  return crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(data))
    .then(hex)
}

function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  return crypto.subtle.importKey(
    'raw',
    key instanceof Uint8Array ? key.slice().buffer : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  ).then((k) => crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)))
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function amzDate(d: Date): { amz: string; short: string } {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const amz =
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  return { amz, short: amz.slice(0, 8) }
}

export interface S3Credentials {
  accessKeyId: string
  secretAccessKey: string
  /** e.g. us-east-1, eu-central-1, auto (R2/compatible) */
  region: string
  bucket: string
  /** Optional custom endpoint (Backblaze B2, Cloudflare R2, Minio…). */
  endpoint?: string
}

export interface S3RequestOptions {
  method: 'PUT' | 'GET' | 'DELETE'
  /** Bucket URL, e.g. https://bucket.s3.us-east-1.amazonaws.com */
  baseUrl: string
  /** Object key including any prefix, e.g. "wa-archiver/wa-archiver.wasync" */
  key: string
  body?: string
  /** Extra query params for list operations (?list-type=2&prefix=…). */
  query?: Record<string, string>
}

/** Build the endpoint URL for a bucket (path-style vs virtual-hosted). */
export function s3BucketUrl(creds: S3Credentials): string {
  if (creds.endpoint) return `${creds.endpoint.replace(/\/+$/, '')}/${creds.bucket}`
  return `https://${creds.bucket}.s3.${creds.region}.amazonaws.com`
}

/**
 * Signed fetch — the single entry point the S3 adapter uses.
 * Payloads are UNSIGNED-PAYLOAD (S3 accepts it for HTTPS, keeps big
 * envelopes cheap to sign and lets browsers/proxies stream the body).
 */
export async function s3SignedFetch(
  creds: S3Credentials,
  opts: S3RequestOptions
): Promise<Response> {
  const url = new URL(
    `${opts.baseUrl.replace(/\/+$/, '')}/${opts.key.split('/').map(encodeURIComponent).join('/')}`
  )
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    url.searchParams.set(k, v)
  }

  const now = amzDate(new Date())
  const host = url.host
  const payloadHash = opts.method === 'PUT' ? UNSIGNED_PAYLOAD : await sha256Hex('')

  // Canonical request
  const canonicalUri = url.pathname
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k).replace(/%20/g, '+'), encodeURIComponent(v).replace(/%20/g, '+')])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${now.amz}\n`
  const canonicalRequest = [
    opts.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  // String to sign
  const scope = `${now.short}/${creds.region}/s3/aws4_request`
  const stringToSign = [
    ALGO,
    now.amz,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n')

  // Signing key: HMAC chain kDate → kRegion → kService → kSigning
  const kDate = new Uint8Array(
    await hmac(new TextEncoder().encode(`AWS4${creds.secretAccessKey}`), now.short)
  )
  const kRegion = new Uint8Array(await hmac(kDate, creds.region))
  const kService = new Uint8Array(await hmac(kRegion, 's3'))
  const kSigning = new Uint8Array(await hmac(kService, 'aws4_request'))
  const signature = hex(await hmac(kSigning, stringToSign))

  const authorization =
    `${ALGO} Credential=${creds.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  return fetch(url.toString(), {
    method: opts.method,
    headers: {
      Authorization: authorization,
      'x-amz-date': now.amz,
      'x-amz-content-sha256': payloadHash,
      ...(opts.method === 'PUT' ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body,
    signal: AbortSignal.timeout(60_000),
  })
}
