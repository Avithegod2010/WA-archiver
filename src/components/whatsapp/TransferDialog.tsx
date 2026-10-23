'use client'

/**
 * One-bundle multi-device transfer (v1.9) — "QR / zip pairing".
 *
 * SEND side: the current provider config + sync passphrase are packed into
 * a single portable pairing code (WAARCHIVER1.<base64url(json)>) and shown
 * as a QR + copyable string. The transfer bundle itself is the standard
 * encrypted .wasync envelope already sitting on the provider — the paired
 * device pulls it with one tap (or auto-pulls straight away).
 *
 * RECEIVE side: paste the code, or scan it in-app (BarcodeDetector where
 * the platform provides one — Android WebView + Chromium). Adopting fills
 * the CloudSyncCard and persists the config; a follow-up "Pull & restore"
 * brings the whole archive over.
 *
 * The pairing code CONTAINS the provider credentials and the sync
 * passphrase — show it only on your own screen / channel.
 */

import { useEffect, useRef, useState } from 'react'
import { Copy, ScanLine, Send, Smartphone } from 'lucide-react'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import type { CloudSyncConfig } from '@/lib/cloud-sync'
import {
  buildPairingCode,
  parsePairingCode,
  pairingToConfig,
} from '@/lib/transfer-pair'

/** Device-B flow mode. */
type Tab = 'send' | 'receive'

export function TransferDialog({
  open,
  onOpenChange,
  buildConfig,
  passphrase,
  onAdopted,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Current (unsaved-edits-included) cloud sync config from the card. */
  buildConfig: () => CloudSyncConfig
  /** The effective sync passphrase (input or saved for auto-push). */
  passphrase: string
  /** Adopt a parsed pairing payload on THIS device (receive side). */
  onAdopted: (cfg: CloudSyncConfig) => void
}) {
  const t = useT()
  const [tab, setTab] = useState<Tab>('send')
  const [qrData, setQrData] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [pasted, setPasted] = useState('')
  const [scanning, setScanning] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scanAbort = useRef(false)

  const canSend =
    passphrase.length >= 8 || (buildConfig().syncPassphrase ?? '').length >= 8

  const adopt = (parsed: ReturnType<typeof parsePairingCode>): void => {
    if (!parsed) {
      toast.error('That code is not a WA Archiver pairing code')
      return
    }
    if (parsed.passphrase.length < 8) {
      toast.error('The pairing code is missing its sync passphrase')
      return
    }
    onAdopted(pairingToConfig(parsed))
    toast.success(
      'Paired — config adopted. Press “Pull & restore” to bring the archive over.'
    )
    onOpenChange(false)
  }

  // Render the QR whenever the send tab is visible.
  useEffect(() => {
    if (!open || tab !== 'send' || !canSend) return
    let alive = true
    const payload = buildPairingCode(buildConfig(), passphrase)
    void QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'L',
      margin: 1,
      scale: 6,
    })
      .then((url) => {
        // state lands in promise callbacks (never synchronously in the
        // effect body) so tab flips cannot cause cascading renders
        if (alive) {
          setCode(payload)
          setQrData(url)
        }
      })
      .catch(() => {
        if (alive) setQrData(null)
      })
    return () => {
      alive = false
    }
     
  }, [open, tab, canSend, passphrase])

  // Camera scan loop (BarcodeDetector — Android WebView / Chromium).
  useEffect(() => {
    if (!scanning) return
    let stream: MediaStream | null = null
    let raf = 0
    const stop = (): void => {
      scanAbort.current = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
    const run = async (): Promise<void> => {
      const Detector = (
        window as unknown as {
          BarcodeDetector?: new (o?: {
            formats?: string[]
          }) => { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> }
        }
      ).BarcodeDetector
      if (!Detector) {
        toast.error('This browser cannot scan QR codes — paste the code instead')
        setScanning(false)
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
      } catch {
        toast.error('Camera unavailable — paste the pairing code instead')
        setScanning(false)
        return
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => undefined)
      }
      const detector = new Detector({ formats: ['qr_code'] })
      scanAbort.current = false
      const tick = async (): Promise<void> => {
        if (scanAbort.current) return
        if (videoRef.current && videoRef.current.readyState >= 2) {
          try {
            const hits = await detector.detect(videoRef.current)
            const raw = hits[0]?.rawValue
            if (raw) {
              const parsed = parsePairingCode(raw)
              if (parsed) {
                stop()
                setScanning(false)
                adopt(parsed)
                return
              }
            }
          } catch {
            /* frame not ready — keep scanning */
          }
        }
        raf = requestAnimationFrame(() => void tick())
      }
      void tick()
    }
    void run()
    return stop
     
  }, [scanning])


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Smartphone className="h-4 w-4 text-(--wa-accent)" aria-hidden />
            {t('transfer.title')}
          </DialogTitle>
          <DialogDescription>
            One encrypted bundle, two devices: pair via QR / code, then pull
            the same .wasync archive on the other side.
          </DialogDescription>
        </DialogHeader>

        <div
          role="tablist"
          aria-label="Transfer direction"
          className="grid grid-cols-2 gap-1.5"
        >
          {(
            [
              ['send', t('transfer.send'), Send],
              ['receive', t('transfer.receive'), Smartphone],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[12px] font-medium transition-colors ${
                tab === value
                  ? 'border-(--wa-accent) bg-(--wa-accent)/10 text-(--wa-accent-strong) dark:text-(--wa-accent)'
                  : 'border-black/10 text-(--wa-text-2) hover:bg-black/[0.03] dark:border-white/15 dark:hover:bg-white/5'
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>

        {tab === 'send' && (
          <div className="flex flex-col items-center gap-3">
            {!canSend && (
              <p className="rounded-md bg-amber-500/10 p-2.5 text-[12px] leading-snug text-amber-700 dark:text-amber-400">
                Set the encryption passphrase first — the pairing code embeds
                it so the other device can decrypt the bundle.
              </p>
            )}
            {canSend && qrData && (
              <img
                src={qrData}
                alt="Pairing QR code — contains the provider config and sync passphrase"
                className="h-56 w-56 rounded-lg border border-black/10 bg-white p-2 dark:border-white/15"
              />
            )}
            {canSend && !qrData && (
              <div className="flex h-56 w-56 items-center justify-center rounded-lg border border-black/10 dark:border-white/15">
                <span className="text-[12px] text-(--wa-text-2)">
                  Rendering QR…
                </span>
              </div>
            )}
            {canSend && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    if (!code) return
                    void navigator.clipboard
                      .writeText(code)
                      .then(() => toast.success('Pairing code copied'))
                      .catch(() => toast.error('Clipboard unavailable'))
                  }}
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                  {t('transfer.copy')}
                </Button>
                <p className="text-center text-[10.5px] leading-snug text-(--wa-text-2)">
                  The code contains your provider credentials and the sync
                  passphrase. Share it only over a channel you trust, and
                  don&apos;t screenshot it into chats.
                </p>
              </>
            )}
          </div>
        )}

        {tab === 'receive' && (
          <div className="flex flex-col gap-2.5">
            {scanning ? (
              <div className="overflow-hidden rounded-lg border border-black/10 dark:border-white/15">
                <video
                  ref={videoRef}
                  className="h-56 w-full bg-black object-cover"
                  muted
                  playsInline
                />
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="self-start gap-1.5"
                onClick={() => setScanning(true)}
              >
                <ScanLine className="h-3.5 w-3.5" aria-hidden />
                {t('transfer.scan')}
              </Button>
            )}
            <Textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="…or paste the pairing code here (WAARCHIVER1.…)"
              className="min-h-20 text-[12px]"
              spellCheck={false}
              aria-label="Pairing code"
            />
            <Button
              size="sm"
              disabled={pasted.trim().length < 20}
              className="gap-1.5 self-start bg-(--wa-accent) text-white hover:bg-(--wa-accent-strong)"
              onClick={() => adopt(parsePairingCode(pasted.trim()))}
            >
              <Smartphone className="h-3.5 w-3.5" aria-hidden />
              {t('transfer.adopt')}
            </Button>
            <p className="text-[10.5px] leading-snug text-(--wa-text-2)">
              Adopting replaces the cloud-sync settings on this device with
              the sender&apos;s — the archive itself arrives via “Pull &amp;
              restore”.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
