import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Android app configuration for WhatsApp Viewer.
 *
 * ⚠️ THE ONLY LINE YOU NEED TO EDIT: `server.url` below.
 * Point it at wherever you host the web app (e.g. https://your-app.vercel.app),
 * commit, push — and GitHub Actions builds a fresh APK automatically.
 */
const config: CapacitorConfig = {
  appId: 'com.whatsappviewer.app',
  appName: 'WhatsApp Viewer',
  webDir: 'capacitor-web',
  server: {
    // ⬇️ PUT YOUR HOSTED URL HERE (HTTPS required)
    url: 'https://whatsapp-viewer.vercel.app',
    cleartext: false,
  },
}

export default config
