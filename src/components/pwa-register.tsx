'use client'

import { useEffect } from 'react'

/** Registers the service worker that caches chat media for offline viewing. */
export function PWARegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
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
