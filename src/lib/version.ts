/**
 * Single source of truth for the displayed app version. The Android gradle
 * versionName mirrors this (android/app/build.gradle); package.json carries
 * the same number. Bump all three together on release.
 */

export const APP_VERSION = '1.6.0'

/** GitHub Releases page — wired into the guide/about dialog. */
export const RELEASES_URL = 'https://github.com/Avithegod2010/WA-archiver/releases'

/** Short marketing line for the current release (shown next to the version). */
export const RELEASE_TAGLINE = 'Share cards, starred export & five languages'
