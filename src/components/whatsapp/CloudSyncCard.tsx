'use client'

/**
 * Cloud sync card — storage-adapter layer (Settings section).
 *
 * Cloud-ready persistence on top of the encrypted sync envelope: the SAME
 * AES-GCM `.wasync` payload is pushed to / pulled from any supported
 * provider — WebDAV (Nextcloud, Fastmail, InfiniCloud…), Google Drive
 * (OAuth access token) or any S3-compatible bucket (SigV4, incl. R2 / B2 /
 * Minio). End-to-end encrypted — the provider stores ciphertext only.
 *
 * Extras:
 *   • Auto-push — optional "sync automatically after every import/export"
 *     toggle. Keeps the cloud copy never-stale. The sync passphrase is then
 *     stored device-local (localStorage) so the background push can run.
 *   • History — optional timestamped snapshots (wa-archiver-<stamp>.wasync),
 *     pruned to the last N after every push; older snapshots can be restored.
 *
 * Works in the web build via /api/cloud-sync proxy and directly from the
 * Android webview in the APK build.
 */

import { useMemo, useState } from 'react'
import {
  CloudDownload,
  CloudUpload,
  Eye,
  EyeOff,
  History,
  KeyRound,
  Link2,
  Loader2,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useData } from './data-provider'
import {
  cloudFileUrl,
  getCloudSyncConfig,
  listSnapshots,
  proxyAvailable,
  pullFromCloud,
  pushToCloud,
  saveCloudSyncConfig,
  testCloudConnection,
  type CloudProvider,
  type CloudSyncConfig,
} from '@/lib/cloud-sync'
import { writeLastBackupAt, formatRelativeTime } from './backup-reminder'

const HISTORY_OPTIONS = ['0', '3', '5', '10'] as const

export function CloudSyncCard({
  onRefreshChats,
}: {
  /** Re-fetch the chat list after a successful restore (SettingsDialog prop). */
  onRefreshChats?: () => void | Promise<void>
}) {
  const { data, mode } = useData()
  const saved = useMemo(() => getCloudSyncConfig(), [])

  const [provider, setProvider] = useState<CloudProvider>(
    saved?.provider ?? 'webdav'
  )
  const [url, setUrl] = useState(saved?.url ?? '')
  const [username, setUsername] = useState(saved?.username ?? '')
  const [password, setPassword] = useState(saved?.password ?? '')
  const [filename, setFilename] = useState(saved?.filename ?? 'wa-archiver.wasync')
  // s3
  const [s3Region, setS3Region] = useState(saved?.s3Region ?? '')
  const [s3Bucket, setS3Bucket] = useState(saved?.s3Bucket ?? '')
  const [s3AccessKey, setS3AccessKey] = useState(saved?.s3AccessKey ?? '')
  const [s3SecretKey, setS3SecretKey] = useState(saved?.s3SecretKey ?? '')
  const [s3Endpoint, setS3Endpoint] = useState(saved?.s3Endpoint ?? '')
  const [s3Prefix, setS3Prefix] = useState(saved?.s3Prefix ?? 'wa-archiver/')
  // gdrive
  const [gdriveToken, setGdriveToken] = useState(saved?.gdriveToken ?? '')
  const [gdriveFolderId, setGdriveFolderId] = useState(
    saved?.gdriveFolderId ?? ''
  )

  const [passphrase, setPassphrase] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState<
    'test' | 'push' | 'pull' | 'snapshots' | null
  >(null)
  const [lastPush, setLastPush] = useState<number | undefined>(saved?.lastPushAt)
  const [lastPull, setLastPull] = useState<number | undefined>(saved?.lastPullAt)

  const [autoPush, setAutoPush] = useState(saved?.autoPush ?? false)
  const [historyKeep, setHistoryKeep] = useState<number>(saved?.historyKeep ?? 0)

  const [snapshots, setSnapshots] = useState<string[]>([])
  const [snapPick, setSnapPick] = useState('')

  const pwOk = passphrase.length >= 8
  const proxy = proxyAvailable()

  const fieldsOk = useMemo(() => {
    if (provider === 'webdav')
      return url.trim().length > 8 && filename.trim().length > 0
    if (provider === 's3')
      return (
        s3Bucket.trim().length > 0 &&
        s3Region.trim().length > 0 &&
        s3AccessKey.trim().length > 0 &&
        s3SecretKey.trim().length > 0 &&
        filename.trim().length > 0
      )
    return gdriveToken.trim().length > 10 && filename.trim().length > 0
  }, [provider, url, s3Bucket, s3Region, s3AccessKey, s3SecretKey, filename, gdriveToken])

  const currentConfig = (): CloudSyncConfig => ({
    provider,
    // url keys the whole config store — keep a truthy anchor for every provider
    url:
      provider === 'webdav'
        ? url.trim()
        : provider === 's3'
          ? s3Bucket.trim() || 's3://'
          : 'https://drive.google.com',
    username: username.trim(),
    password,
    filename: filename.trim() || 'wa-archiver.wasync',
    s3Region: s3Region.trim(),
    s3Bucket: s3Bucket.trim(),
    s3AccessKey: s3AccessKey.trim(),
    s3SecretKey: s3SecretKey.trim(),
    s3Endpoint: s3Endpoint.trim(),
    s3Prefix: s3Prefix.trim() || 'wa-archiver/',
    gdriveToken: gdriveToken.trim(),
    gdriveFolderId: gdriveFolderId.trim(),
    historyKeep,
    autoPush,
    // passphrase persists only while auto-push is on (device-local)
    syncPassphrase: autoPush && pwOk ? passphrase : saved?.syncPassphrase ?? '',
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

  const persist = (cfg: CloudSyncConfig) => {
    saveCloudSyncConfig(cfg)
    setSavedCfg(cfg)
  }

  // Keep the local "saved" mirror fresh without re-reading storage on render.
  const [savedCfg, setSavedCfg] = useState<CloudSyncConfig | null>(saved)

  const doTest = async () => {
    if (busy || !fieldsOk) return
    setBusy('test')
    try {
      const r = await testCloudConnection(currentConfig())
      if (r.ok) toast.success(r.message)
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
      const at = await pushToCloud(cfg, json, passphrase, { history: true })
      persist({ ...cfg, lastPushAt: at })
      setLastPush(at)
      writeLastBackupAt()
      toast.success(
        historyKeep > 0
          ? 'Encrypted backup pushed — snapshot stored on the server'
          : 'Encrypted backup pushed to your cloud'
      )
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
      persist({ ...cfg, lastPullAt: at })
      setLastPull(at)
      writeLastBackupAt()
      setPassphrase('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Pull failed')
    } finally {
      setBusy(null)
    }
  }

  const loadSnapshots = async () => {
    if (busy || !fieldsOk) return
    setBusy('snapshots')
    try {
      const list = await listSnapshots(currentConfig())
      setSnapshots(list)
      setSnapPick(list[0] ?? '')
      toast.success(
        list.length > 0
          ? `${list.length} snapshot${list.length === 1 ? '' : 's'} on the server`
          : 'No snapshots stored yet'
      )
    } finally {
      setBusy(null)
    }
  }

  const doPullSnapshot = async () => {
    if (busy || !fieldsOk || !pwOk || !snapPick) return
    setBusy('pull')
    try {
      const cfg = currentConfig()
      const json = await pullFromCloud(cfg, passphrase, snapPick)
      await restoreJson(json)
      setPassphrase('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Snapshot restore failed')
    } finally {
      setBusy(null)
    }
  }

  const providerLabel =
    provider === 'gdrive'
      ? 'Google Drive'
      : provider === 's3'
        ? 'S3 bucket'
        : 'WebDAV'

  return (
    <section
      aria-label="Cloud sync"
      className="flex flex-col gap-2 rounded-lg border border-black/[0.06] p-3 dark:border-white/10"
    >
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-(--wa-text)">
        <CloudUpload className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
        Cloud sync
        <span className="inline-flex items-center gap-0.5 rounded-full bg-(--wa-accent)/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-(--wa-accent-strong) dark:text-(--wa-accent)">
          <ShieldCheck className="h-2.5 w-2.5" aria-hidden />
          E2EE
        </span>
      </h3>
      <p className="text-[11.5px] leading-snug text-(--wa-text-2)">
        Push the encrypted backup to {providerLabel} and pull it back on
        another device. The provider only ever stores ciphertext — your
        passphrase never leaves this device.
        {!proxy && ' Device build: connects directly from the app.'}
      </p>

      {/* Provider picker */}
      <div
        role="radiogroup"
        aria-label="Cloud provider"
        className="grid grid-cols-3 gap-1.5"
      >
        {(
          [
            ['webdav', 'WebDAV'],
            ['gdrive', 'Google Drive'],
            ['s3', 'S3 / R2 / B2'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={provider === value}
            onClick={() => setProvider(value)}
            className={`rounded-md border px-2 py-1.5 text-[11.5px] font-medium transition-colors ${
              provider === value
                ? 'border-(--wa-accent) bg-(--wa-accent)/10 text-(--wa-accent-strong) dark:text-(--wa-accent)'
                : 'border-black/10 text-(--wa-text-2) hover:bg-black/[0.03] dark:border-white/15 dark:hover:bg-white/5'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {provider === 'webdav' && (
          <>
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
          </>
        )}

        {provider === 's3' && (
          <>
            <Input
              value={s3Bucket}
              onChange={(e) => setS3Bucket(e.target.value)}
              placeholder="Bucket name"
              spellCheck={false}
              className="h-9 text-[13px]"
              aria-label="S3 bucket name"
            />
            <Input
              value={s3Region}
              onChange={(e) => setS3Region(e.target.value)}
              placeholder="Region (us-east-1, auto for R2…)"
              spellCheck={false}
              className="h-9 text-[13px]"
              aria-label="S3 region"
            />
            <Input
              value={s3AccessKey}
              onChange={(e) => setS3AccessKey(e.target.value)}
              placeholder="Access key ID"
              autoComplete="off"
              spellCheck={false}
              className="h-9 text-[13px]"
              aria-label="S3 access key id"
            />
            <Input
              type="password"
              value={s3SecretKey}
              onChange={(e) => setS3SecretKey(e.target.value)}
              placeholder="Secret access key"
              autoComplete="off"
              className="h-9 text-[13px]"
              aria-label="S3 secret access key"
            />
            <Input
              value={s3Endpoint}
              onChange={(e) => setS3Endpoint(e.target.value)}
              placeholder="Custom endpoint (R2/B2/Minio — optional)"
              spellCheck={false}
              className="h-9 text-[13px]"
              aria-label="S3 custom endpoint"
            />
            <Input
              value={s3Prefix}
              onChange={(e) => setS3Prefix(e.target.value)}
              placeholder="Key prefix (wa-archiver/)"
              spellCheck={false}
              className="h-9 text-[13px]"
              aria-label="S3 key prefix"
            />
          </>
        )}

        {provider === 'gdrive' && (
          <>
            <label className="relative col-span-full">
              <KeyRound
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--wa-text-2)"
                aria-hidden
              />
              <Input
                type="password"
                value={gdriveToken}
                onChange={(e) => setGdriveToken(e.target.value)}
                placeholder="OAuth access token (drive.file scope — device-local)"
                autoComplete="off"
                className="h-9 pl-8 text-[12px]"
                aria-label="Google Drive OAuth access token"
              />
            </label>
            <Input
              value={gdriveFolderId}
              onChange={(e) => setGdriveFolderId(e.target.value)}
              placeholder="Folder ID (optional — empty = My Drive root)"
              spellCheck={false}
              className="col-span-full h-9 text-[13px]"
              aria-label="Google Drive folder id"
            />
            <p className="col-span-full text-[10.5px] leading-snug text-(--wa-text-2)">
              Tip: paste a short-lived token from{' '}
              <a
                href="https://developers.google.com/oauthplayground"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                OAuth Playground
              </a>{' '}
              (scope: drive.file). Tokens expire — re-paste when pushes fail
              with 401.
            </p>
          </>
        )}

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

      {/* Auto-push + history */}
      <div className="flex flex-col gap-1.5 rounded-md bg-black/[0.02] p-2 dark:bg-white/[0.04]">
        <div className="flex items-center justify-between gap-3">
          <Label
            htmlFor="cloud-autopush"
            className="flex items-center gap-1.5 text-[12px] font-medium"
          >
            <Zap className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
            Sync automatically after every import / export
          </Label>
          <Switch
            id="cloud-autopush"
            checked={autoPush}
            onCheckedChange={(v) => {
              if (v && !pwOk && (saved?.syncPassphrase ?? '').length < 8) {
                toast.error(
                  'Enter the encryption passphrase first — auto-push reuses it'
                )
                return
              }
              setAutoPush(v)
              if (v && pwOk) {
                persist({ ...currentConfig(), autoPush: true, syncPassphrase: passphrase })
                toast.success(
                  'Auto-push on — the cloud copy now updates after every import / export'
                )
              }
            }}
          />
        </div>
        <p className="text-[10.5px] leading-snug text-(--wa-text-2)">
          {autoPush
            ? 'On. The sync passphrase is kept on this device only so background pushes can run.'
            : 'Off. Turn on to never have a stale cloud copy (passphrase stays device-local).'}
        </p>
        <div className="flex items-center justify-between gap-3">
          <Label
            htmlFor="cloud-history"
            className="flex items-center gap-1.5 text-[12px] font-medium"
          >
            <History className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
            Keep timestamped snapshots (last)
          </Label>
          <Select
            value={String(historyKeep)}
            onValueChange={(v) => setHistoryKeep(Number(v))}
          >
            <SelectTrigger
              id="cloud-history"
              className="h-8 w-[70px] text-[12px]"
              aria-label="Number of history snapshots to keep"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HISTORY_OPTIONS.map((n) => (
                <SelectItem key={n} value={n}>
                  {n === '0' ? 'Off' : n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-[10.5px] leading-snug text-(--wa-text-2)">
          {historyKeep > 0
            ? `Every push also stores wa-archiver-<date>.wasync; the oldest ${historyKeep > 1 ? `${historyKeep} are kept` : 'snapshot is kept'}. Restore any snapshot below.`
            : 'Off. Only the live file is kept on the server.'}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void doTest()}
          disabled={busy !== null || !fieldsOk}
          className="gap-1.5"
          title="Check the provider connection"
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
          title="Encrypt + upload all chats to the cloud file"
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
          title="Download + decrypt + restore the cloud file"
        >
          {busy === 'pull' ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <CloudDownload className="h-4 w-4" aria-hidden />
          )}
          Pull &amp; restore
        </Button>
        {historyKeep > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void loadSnapshots()}
            disabled={busy !== null || !fieldsOk}
            className="gap-1.5"
            title="List the timestamped snapshots stored on the server"
          >
            {busy === 'snapshots' ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden />
            )}
            Snapshots
          </Button>
        )}
      </div>

      {/* Snapshot restore row */}
      {historyKeep > 0 && snapshots.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-black/[0.06] p-2 dark:border-white/10">
          <History className="h-3.5 w-3.5 text-(--wa-text-2)" aria-hidden />
          <Select value={snapPick} onValueChange={setSnapPick}>
            <SelectTrigger
              className="h-8 min-w-0 flex-1 text-[11.5px]"
              aria-label="Snapshot to restore"
            >
              <SelectValue placeholder="Pick a snapshot…" />
            </SelectTrigger>
            <SelectContent className="max-h-56">
              {snapshots.map((s) => (
                <SelectItem key={s} value={s} className="text-[11.5px]">
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void doPullSnapshot()}
            disabled={busy !== null || !pwOk || !snapPick}
            className="gap-1.5"
          >
            {busy === 'pull' ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <CloudDownload className="h-4 w-4" aria-hidden />
            )}
            Restore
          </Button>
        </div>
      )}

      {(lastPush != null || lastPull != null) && (
        <p className="text-[11px] text-(--wa-text-2)">
          {lastPush != null && (
            <>
              Last push: {formatRelativeTime(lastPush)}{' '}
              {proxy && provider === 'webdav' && `· ${cloudFileUrl({ ...(savedCfg ?? ({} as CloudSyncConfig)), url, filename: filename || 'wa-archiver.wasync' })}`}
              .{' '}
            </>
          )}
          {lastPull != null && <>Last restore: {formatRelativeTime(lastPull)}.</>}
        </p>
      )}
    </section>
  )
}

export default CloudSyncCard
