'use client'

import { useEffect } from 'react'
import { assetUrl } from '@/lib/asset-base'

/** Registers the service worker that caches chat media for offline viewing. */
export function PWARegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }
    const register = () => {
      // assetUrl keeps this correct on sub-path hosts (GitHub Pages) too.
      navigator.serviceWorker.register(assetUrl('/sw.js')).catch(() => {
        /* SW is a progressive enhancement — ignore failures */
      })
    }
    if (document.readyState === 'complete') {
      register()
    } else {
      window.addEventListener('load', register, { once: true })
      return () => window.removeEventListener('load', register)
    }
  }, [])
  return null
}
