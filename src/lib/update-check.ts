/**
 * Auto-update checker (#15) — reads the GitHub Releases API once a day and,
 * when a release newer than the running build exists, surfaces a one-time
 * "new version available" toast. Designed for both transports:
 *   • web (GH Pages / standalone) — direct fetch
 *   • Capacitor APK — the WebView can fetch api.github.com whenever online
 *
 * Design notes:
 *   • Comparison is plain semver (major.minor.patch) against APP_VERSION —
 *     no dependency added.
 *   • localStorage gates: `wa-viewer:update-last-check` (throttle to 1/day)
 *     and `wa-viewer:update-seen-tag` (never re-toast the same release).
 *   • Every failure path is silent — a checker must never annoy the user
 *     (offline, rate limit, offline APK: all no-ops).
 */

import { APP_VERSION, RELEASES_URL } from '@/lib/version'

const LAST_CHECK_KEY = 'wa-viewer:update-last-check'
const SEEN_TAG_KEY = 'wa-viewer:update-seen-tag'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const REPO_API = 'https://api.github.com/repos/Avithegod2010/WA-archiver/releases/latest'

export interface UpdateInfo {
  /** Release tag, e.g. "v1.7.0". */
  tag: string
  version: string
  url: string
  notes: string
}

function parseSemver(v: string): [number, number, number] {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
  if (!m) return [0, 0, 0]
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** True when `candidate` is strictly newer than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const [cMaj, cMin, cPatch] = parseSemver(candidate)
  const [uMaj, uMin, uPatch] = parseSemver(current)
  if (cMaj !== uMaj) return cMaj > uMaj
  if (cMin !== uMin) return cMin > uMin
  return cPatch > uPatch
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode — the checker just runs more often, harmless */
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * Query the latest published (non-prerelease) GitHub release. Returns null
 * when: throttled, offline, rate-limited, same version, or already seen.
 */
export async function checkForUpdate(force = false): Promise<UpdateInfo | null> {
  if (typeof window === 'undefined') return null
  if (!force) {
    const last = Number(read(LAST_CHECK_KEY) ?? 0)
    if (last && Date.now() - last < CHECK_INTERVAL_MS) return null
  }
  store(LAST_CHECK_KEY, String(Date.now()))
  if (!navigator.onLine) return null

  const res = await fetch(REPO_API, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const rel = (await res.json()) as {
    tag_name?: string
    html_url?: string
    body?: string
    draft?: boolean
    prerelease?: boolean
  }
  const tag = rel.tag_name ?? ''
  if (!tag || rel.draft || rel.prerelease) return null
  if (!isNewerVersion(tag, APP_VERSION)) return null
  if (read(SEEN_TAG_KEY) === tag) return null

  return {
    tag,
    version: tag.replace(/^v/, ''),
    url: rel.html_url ?? RELEASES_URL,
    // First content line of the release notes as a teaser — skip markdown
    // headers (### Added) and link definitions, strip bullet markers,
    // truncate to be toast-safe.
    notes:
      (rel.body ?? '')
        .split('\n')
        .filter((l) => !/^\s*#/.test(l) && !/^\s*\[[^\]]+\]:/.test(l))
        .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
        .find((l) => l.length > 0)
        ?.slice(0, 120) ?? '',
  }
}

/** Record that the user saw (or dismissed) the toast for this tag. */
export function markUpdateSeen(tag: string) {
  store(SEEN_TAG_KEY, tag)
}

export interface ApkDownload {
  /** browser_download_url of the universal APK asset. */
  url: string
  /** Asset size in bytes (0 when GitHub omits it). */
  size: number
}

/**
 * Resolve the *universal* APK asset of the latest release (Task 2-c): hits the
 * same releases/latest endpoint as checkForUpdate and returns the
 * browser-download URL of the asset named `*-universal-release.apk` plus its
 * byte size. Returns null on every failure path — offline, rate-limited, or a
 * release without a universal APK — never throws (a checker must not annoy).
 */
export async function fetchApkDownloadUrl(): Promise<ApkDownload | null> {
  if (typeof window === 'undefined') return null
  try {
    if (!navigator.onLine) return null
    const res = await fetch(REPO_API, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    const rel = (await res.json()) as {
      assets?: Array<{ name?: string; browser_download_url?: string; size?: number }>
    }
    const apk = (rel.assets ?? []).find(
      (a) => typeof a.name === 'string' && a.name.endsWith('-universal-release.apk')
    )
    if (!apk?.browser_download_url) return null
    return { url: apk.browser_download_url, size: apk.size ?? 0 }
  } catch {
    /* offline / rate-limited / malformed payload — silent */
    return null
  }
}
