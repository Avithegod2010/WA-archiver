import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Android app configuration for WhatsApp Viewer — STANDALONE (Phase 3).
 *
 * The APK bundles the entire built frontend (scripts/build-capacitor.mjs →
 * capacitor-web/) and runs the on-device transport exclusively: SQLite WASM
 * in the WebView (OPFS persistence), client-side import, direct Gemini AI
 * with the user's own key. No hosted URL, no server, works fully offline.
 *
 * ⚠️ NOTHING TO EDIT ANYMORE: the old `server.url` line is gone on purpose.
 * GitHub Actions builds a fresh standalone APK on every push to main.
 */
const config: CapacitorConfig = {
  appId: 'com.whatsappviewer.app',
  appName: 'WhatsApp Viewer',
  webDir: 'capacitor-web',
}

export default config
