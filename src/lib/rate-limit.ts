/**
 * Minimal in-memory sliding rate limiter shared by expensive API routes
 * (AI, transcription). Buckets are keyed by caller-supplied id (client IP)
 * and pruned lazily whenever the map grows past MAX_BUCKETS so a spoofed
 * IP storm cannot grow memory unbounded.
 */
const MAX_BUCKETS = 500

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

export function isRateLimited(
  clientId: string,
  limit: number,
  windowMs: number
): boolean {
  const now = Date.now()
  const bucket = buckets.get(clientId)
  if (!bucket || now >= bucket.resetAt) {
    if (buckets.size > MAX_BUCKETS) {
      for (const [key, b] of buckets) {
        if (now >= b.resetAt) buckets.delete(key)
      }
    }
    buckets.set(clientId, { count: 1, resetAt: now + windowMs })
    return false
  }
  bucket.count += 1
  return bucket.count > limit
}

/** Best-effort client id for rate limiting (proxy-aware, local fallback). */
export function clientIpOf(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  )
}
