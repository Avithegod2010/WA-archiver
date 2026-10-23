'use client'

/**
 * Cloud sync card (WebDAV) — Settings section.
 *
 * Cloud-ready persistence on top of the encrypted sync envelope: the SAME
 * AES-GCM `.wasync` payload is pushed to / pulled from any WebDAV server
 * (Nextcloud, Fastmail, InfiniCloud, …). End-to-end encrypted — the server
 * stores ciphertext only. Works in the web build via /api/cloud-sync proxy
 * and directly from the Android webview in the APK build.
 */

import { useMemo, useState } from 'react'
import {
  CloudDownload,
  CloudUpload,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Loader2,
  PlugZap,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useData } from './data-provider'
import {
  cloudFileUrl,
  getCloudSyncConfig,
  proxyAvailable,
  pullFromCloud,
  pushToCloud,
  saveCloudSyncConfig,
  testCloudConnection,
  type CloudSyncConfig,
} from '@/lib/cloud-sync'
import { writeLastBackupAt, formatRelativeTime } from './backup-reminder'

export function CloudSyncCard({
  onRefreshChats,
}: {
  /** Re-fetch the chat list after a successful restore (SettingsDialog prop). */
  onRefreshChats?: () => void | Promise<void>
}) {
  const { data, mode } = useData()
  const saved = useMemo(() => getCloudSyncConfig(), [])

  const [url, setUrl] = useState(saved?.url ?? '')
  const [username, setUsername] = useState(saved?.username ?? '')
  const [password, setPassword] = useState(saved?.password ?? '')
  const [filename, setFilename] = useState(saved?.filename ?? 'wa-archiver.wasync')
  const [passphrase, setPassphrase] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState<'test' | 'push' | 'pull' | null>(null)
  const [lastPush, setLastPush] = useState<number | undefined>(saved?.lastPushAt)
  const [lastPull, setLastPull] = useState<number | undefined>(saved?.lastPullAt)

  const pwOk = passphrase.length >= 8
  const fieldsOk = url.trim().length > 8 && filename.trim().length > 0
  const proxy = proxyAvailable()

  const currentConfig = (): CloudSyncConfig => ({
    url: url.trim(),
    username: username.trim(),
    password,
    filename: filename.trim() || 'wa-archiver.wasync',
    lastPushAt: lastPush,
    lastPullAt: lastPull,
  })

  /** Restore pipeline — identical to SyncVaultCard's import path. */
  const restoreJson = async (json: string) => {
    const restored = new File([json], 'cloud-restore.json', {
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
      if (!res.ok) throw new Error(out?.error ?? 'Restore failed')
      created = out?.chatsCreated ?? 0
      imported = out?.messagesImported ?? 0
    }
    toast.success(
      `Restored from cloud · ${created} chats · ${imported.toLocaleString()} messages`
    )
    await onRefreshChats?.()
  }

  const doTest = async () => {
    if (busy || !fieldsOk) return
    setBusy('test')
    try {
      const r = await testCloudConnection(currentConfig())
      if (r.ok) toast.success(`Cloud connection OK · ${cloudFileUrl(currentConfig())}`)
      else toast.error(r.message)
    } finally {
      setBusy(null)
    }
  }

  const doPush = async () => {
    if (busy || !fieldsOk || !pwOk) return
    setBusy('push')
    try {
      const cfg = currentConfig()
      const blob = await data.exportBackup()
      const json = await blob.text()
      const at = await pushToCloud(cfg, json, passphrase)
      saveCloudSyncConfig({ ...cfg, lastPushAt: at })
      setLastPush(at)
      writeLastBackupAt()
      toast.success('Encrypted backup pushed to your WebDAV server')
      setPassphrase('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Push failed')
    } finally {
      setBusy(null)
    }
  }

  const doPull = async () => {
    if (busy || !fieldsOk || !pwOk) return
    setBusy('pull')
    try {
      const cfg = currentConfig()
      const json = await pullFromCloud(cfg, passphrase)
      await restoreJson(json)
      const at = Date.now()
      saveCloudSyncConfig({ ...cfg, lastPullAt: at })
      setLastPull(at)
      writeLastBackupAt()
      setPassphrase('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Pull failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section
      aria-label="Cloud sync"
      className="flex flex-col gap-2 rounded-lg border border-black/[0.06] p-3 dark:border-white/10"
    >
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-(--wa-text)">
        <CloudUpload className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
        Cloud sync (WebDAV)
        <span className="inline-flex items-center gap-0.5 rounded-full bg-(--wa-accent)/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-(--wa-accent-strong) dark:text-(--wa-accent)">
          <ShieldCheck className="h-2.5 w-2.5" aria-hidden />
          E2EE
        </span>
      </h3>
      <p className="text-[11.5px] leading-snug text-(--wa-text-2)">
        Push the encrypted backup to any WebDAV server (Nextcloud, Fastmail,
        InfiniCloud…) and pull it back on another device. The server only ever
        stores ciphertext — your passphrase never leaves this device.
        {!proxy && ' Device build: connects directly from the app.'}
      </p>

      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <label className="relative col-span-full">
          <Link2
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--wa-text-2)"
            aria-hidden
          />
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="WebDAV folder URL (https://cloud.example.com/remote.php/dav/files/me/wa/)"
            autoComplete="url"
            spellCheck={false}
            className="h-9 pl-8 text-[12px]"
            aria-label="WebDAV folder URL"
          />
        </label>
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          autoComplete="off"
          className="h-9 text-[13px]"
          aria-label="WebDAV username"
        />
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="App password"
          autoComplete="off"
          className="h-9 text-[13px]"
          aria-label="WebDAV app password"
        />
        <Input
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          placeholder="Remote file name"
          spellCheck={false}
          className="h-9 text-[13px]"
          aria-label="Remote file name"
        />
        <div className="relative">
          <KeyRound
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--wa-text-2)"
            aria-hidden
          />
          <Input
            type={showPw ? 'text' : 'password'}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Encryption passphrase (min 8)"
            autoComplete="new-password"
            className="h-9 pl-8 pr-8 text-[13px]"
            aria-label="Cloud backup encryption passphrase"
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-(--wa-text-2) hover:text-(--wa-text)"
            aria-label={showPw ? 'Hide passphrase' : 'Show passphrase'}
          >
            {showPw ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void doTest()}
          disabled={busy !== null || !fieldsOk}
          className="gap-1.5"
          title="Check the WebDAV connection"
        >
          {busy === 'test' ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <PlugZap className="h-4 w-4" aria-hidden />
          )}
          Test connection
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void doPush()}
          disabled={busy !== null || !fieldsOk || !pwOk}
          className="gap-1.5"
          title="Encrypt + upload all chats to the WebDAV file"
        >
          {busy === 'push' ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <CloudUpload className="h-4 w-4" aria-hidden />
          )}
          Push to cloud
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void doPull()}
          disabled={busy !== null || !fieldsOk || !pwOk}
          className="gap-1.5"
          title="Download + decrypt + restore the WebDAV file"
        >
          {busy === 'pull' ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <CloudDownload className="h-4 w-4" aria-hidden />
          )}
          Pull & restore
        </Button>
      </div>

      {(lastPush != null || lastPull != null) && (
        <p className="text-[11px] text-(--wa-text-2)">
          {lastPush != null && <>Last push: {formatRelativeTime(lastPush)}. </>}
          {lastPull != null && <>Last restore: {formatRelativeTime(lastPull)}.</>}
        </p>
      )}
    </section>
  )
}

export default CloudSyncCard
