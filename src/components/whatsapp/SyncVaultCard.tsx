'use client'

/**
 * Encrypted sync file card (backlog idea #11 🛡) — Settings section.
 *
 * Opt-in END-TO-END ENCRYPTED export/import of all chats & messages:
 *   • Export: the existing JSON backup → AES-GCM-256 with a
 *     passphrase-derived key (PBKDF2-SHA256, 310k iterations) → a single
 *     `.wasync` file download. No server, no upload — WebCrypto only.
 *   • Import: pick a `.wasync` file + passphrase → decrypt in the browser
 *     → restore through the exact same pipeline as a JSON backup.
 *
 * A wrong passphrase simply fails decryption ("Wrong passphrase — or the
 * file was modified"); nothing is written until it succeeds.
 */

import { useMemo, useRef, useState } from 'react'
import {
  Eye,
  EyeOff,
  FileLock2,
  KeyRound,
  Loader2,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useData } from './data-provider'
import { autoPushIfEnabled } from '@/lib/cloud-sync'
import {
  decryptFromSyncFile,
  encryptToSyncFile,
  looksLikeSyncFile,
  syncFileName,
  SYNC_FILE_ACCEPT,
} from '@/lib/sync-crypto'
import { writeLastBackupAt, readLastBackupAt, formatRelativeTime } from './backup-reminder'

export function SyncVaultCard({
  onRefreshChats,
}: {
  /** Re-fetch the chat list after a successful restore (SettingsDialog prop). */
  onRefreshChats?: () => void | Promise<void>
}) {
  const { data, mode } = useData()
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const [lastAt, setLastAt] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useMemo(() => setLastAt(readLastBackupAt()), [])

  const pwOk = passphrase.length >= 8
  const confirmOk = !confirm || confirm === passphrase

  const downloadEncrypted = async () => {
    if (busy || !pwOk || !confirmOk) return
    if (passphrase !== confirm) {
      toast.error('Passphrases do not match')
      return
    }
    setBusy('export')
    try {
      const blob = await data.exportBackup()
      const json = await blob.text()
      const envelope = await encryptToSyncFile(json, passphrase)
      const out = new Blob([envelope], { type: 'application/json' })
      const url = URL.createObjectURL(out)
      const a = document.createElement('a')
      a.href = url
      a.download = syncFileName()
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      writeLastBackupAt()
      setLastAt(Date.now())
      // Auto-push (v1.8.1): keep the cloud copy fresh after every export.
      void autoPushIfEnabled(data).then((r) => {
        if (r.pushed) toast.success('Cloud copy updated automatically')
      })
      toast.success('Encrypted sync file downloaded — keep it + the passphrase safe')
      setPassphrase('')
      setConfirm('')
    } catch {
      toast.error('Could not create the encrypted file')
    } finally {
      setBusy(null)
    }
  }

  const importEncrypted = async (file: File) => {
    if (busy) return
    if (!pwOk) {
      toast.error('Enter the passphrase first')
      return
    }
    setBusy('import')
    try {
      const text = await file.text()
      if (!looksLikeSyncFile(text)) {
        toast.error('That is not an encrypted sync file (.wasync)')
        return
      }
      const json = await decryptFromSyncFile(text, passphrase)
      const restored = new File([json], 'sync-restore.json', {
        type: 'application/json',
      })
      let created = 0
      let imported = 0
      if (mode === 'device') {
        const res = await data.importBackup(restored)
        created = res.chats
        imported = res.messages
      } else {
        const res = await fetch('/api/backup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: json,
        })
        const out = (await res.json().catch(() => null)) as {
          chatsCreated?: number
          messagesImported?: number
          error?: string
        } | null
        if (!res.ok) {
          toast.error(out?.error ?? 'Restore failed')
          return
        }
        created = out?.chatsCreated ?? 0
        imported = out?.messagesImported ?? 0
      }
      toast.success(
        `Decrypted + restored · ${created} chats · ${imported.toLocaleString()} messages`
      )
      writeLastBackupAt()
      setLastAt(Date.now())
      setPassphrase('')
      setConfirm('')
      await onRefreshChats?.()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not restore the sync file'
      )
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <section
      aria-label="Encrypted sync file"
      className="flex flex-col gap-2 rounded-lg border border-black/[0.06] p-3 dark:border-white/10"
    >
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-(--wa-text)">
        <FileLock2 className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
        Encrypted sync file
        <span className="inline-flex items-center gap-0.5 rounded-full bg-(--wa-accent)/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-(--wa-accent-strong) dark:text-(--wa-accent)">
          <ShieldCheck className="h-2.5 w-2.5" aria-hidden />
          E2E
        </span>
      </h3>
      <p className="text-[11.5px] leading-snug text-(--wa-text-2)">
        One portable file, encrypted on this device with your passphrase
        (AES-GCM). Move it to another browser or phone and decrypt it there —
        no server ever sees your chats.
      </p>

      <div className="flex flex-col gap-1.5">
        <div className="relative">
          <KeyRound
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--wa-text-2)"
            aria-hidden
          />
          <Input
            type={showPw ? 'text' : 'password'}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Passphrase (min 8 characters)"
            autoComplete="new-password"
            className="h-9 pl-8 pr-8 text-[13px]"
            aria-label="Sync file passphrase"
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-(--wa-text-2) hover:text-(--wa-text)"
            aria-label={showPw ? 'Hide passphrase' : 'Show passphrase'}
          >
            {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
        <Input
          type={showPw ? 'text' : 'password'}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Repeat passphrase (for export)"
          autoComplete="new-password"
          className="h-9 text-[13px]"
          aria-label="Repeat sync file passphrase"
        />
        {passphrase.length > 0 && !pwOk && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            Use at least 8 characters — there is no recovery without this
            passphrase.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void downloadEncrypted()}
          disabled={busy !== null || !pwOk || !confirmOk || confirm === ''}
          className="gap-1.5"
          title="Export all chats as an encrypted .wasync file"
        >
          {busy === 'export' ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <FileLock2 className="h-4 w-4" aria-hidden />
          )}
          Export encrypted (.wasync)
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (!pwOk) {
              toast.error('Enter the passphrase first')
              return
            }
            fileRef.current?.click()
          }}
          disabled={busy !== null || !pwOk}
          className="gap-1.5"
          title="Decrypt and restore a .wasync file"
        >
          {busy === 'import' ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="h-4 w-4" aria-hidden />
          )}
          Restore from sync file
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept={SYNC_FILE_ACCEPT}
          className="hidden"
          aria-label="Choose an encrypted sync file"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void importEncrypted(file)
          }}
        />
      </div>

      {lastAt != null && (
        <p className="text-[11px] text-(--wa-text-2)">
          Last export/restore: {formatRelativeTime(lastAt)}
        </p>
      )}
    </section>
  )
}

export default SyncVaultCard
