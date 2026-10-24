/**
 * Single source of truth for the displayed app version. The Android gradle
 * versionName mirrors this (android/app/build.gradle); package.json carries
 * the same number. Bump all three together on release.
 */

export const APP_VERSION = '1.9.1'

/** GitHub Releases page — wired into the guide/about dialog. */
export const RELEASES_URL = 'https://github.com/Avithegod2010/WA-archiver/releases'

/**
 * Google Play listing URL — null until the Play listing is live. When set,
 * the about/guide surfaces and the landing page show a "Get it on Google
 * Play" button (v1.9 prep; flip this single constant when the listing is up).
 */
export const PLAY_LISTING_URL: string | null = null

/** Short marketing line for the current release (shown next to the version). */
export const RELEASE_TAGLINE = 'Cloud sync (Drive/S3), auto-push, change log & export self-test'
