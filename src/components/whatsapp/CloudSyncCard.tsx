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

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  CloudDownload,
  CloudUpload,
  Download,
  Eye,
  EyeOff,
  FileUp,
  GitCompare,
  History,
  KeyRound,
  Link2,
  ListChecks,
  Loader2,
  PlugZap,
  QrCode,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useData } from './data-provider'
import { useT, type TParams } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/locales/en'
import {
  RestorePickerDialog,
  filterBackupJsonByIds,
  parseBackupChats,
  type BackupChatMeta,
} from './RestorePickerDialog'
import {
  cloudFileUrl,
  filterBackupJson,
  getCloudSyncConfig,
  listSnapshots,
  proxyAvailable,
  pullEnvelopeText,
  pullFromCloud,
  pushToCloud,
  saveCloudSyncConfig,
  testCloudConnection,
  type CloudProvider,
  type CloudSyncConfig,
} from '@/lib/cloud-sync'
import {
  SYNC_FILE_ACCEPT,
  decryptFromSyncFile,
  looksLikeSyncFile,
} from '@/lib/sync-crypto'
import { isDeltaEnvelope } from '@/lib/sync-delta'
import {
  buildConsentUrl,
  defaultRedirectUri,
  exchangeAuthCode,
  ensureFreshGdriveToken,
  readOAuthRedirectCode,
} from '@/lib/gdrive-oauth'
import { TransferDialog } from './TransferDialog'
import type { ChatSummary } from './types'
import { writeLastBackupAt, formatRelativeTime } from './backup-reminder'

const HISTORY_OPTIONS = ['0', '3', '5', '10'] as const

/** v1.9.1 — result of comparing a cloud snapshot with the live cloud copy. */
interface SnapshotDiff {
  snapName: string
  snapChats: number
  snapMessages: number
  liveChats: number
  liveMessages: number
  /** Chat titles present in the snapshot but not in the live copy. */
  newInSnapshot: string[]
  /** Chat titles added to the live copy since the snapshot. */
  newSince: string[]
  /** Biggest per-chat message-count deltas (snapshot vs live). */
  changes: Array<{ title: string; delta: number }>
}

export function CloudSyncCard({
  onRefreshChats,
}: {
  /** Re-fetch the chat list after a successful restore (SettingsDialog prop). */
  onRefreshChats?: () => void | Promise<void>
}) {
  const { data, mode } = useData()
  const t = useT()
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
  const [gdriveClientId, setGdriveClientId] = useState(
    saved?.gdriveClientId ?? ''
  )
  const [gdriveClientSecret, setGdriveClientSecret] = useState(
    saved?.gdriveClientSecret ?? ''
  )
  const [gdriveRedirect, setGdriveRedirect] = useState('')
  const [gdriveConnecting, setGdriveConnecting] = useState(false)
  const [gdriveRefreshToken, setGdriveRefreshToken] = useState(
    saved?.gdriveRefreshToken ?? ''
  )

  // selective sync (v1.9)
  const [syncSelectedOnly, setSyncSelectedOnly] = useState(
    saved?.syncSelectedOnly ?? false
  )
  const [syncChatIds, setSyncChatIds] = useState<string[]>(
    saved?.syncChatIds ?? []
  )
  const [selectOpen, setSelectOpen] = useState(false)
  const [chats, setChats] = useState<ChatSummary[] | null>(null)

  // incremental snapshots (v1.9)
  const [incremental, setIncremental] = useState(saved?.incremental ?? false)

  // one-bundle transfer (v1.9)
  const [transferOpen, setTransferOpen] = useState(false)

  // v1.9.1 — snapshot file import + compare (diff) viewer
  const snapFileRef = useRef<HTMLInputElement>(null)
  const [diff, setDiff] = useState<SnapshotDiff | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)

  // v1.9.2 — selective restore: decrypt first, then pick chats in a dialog
  const [restOpen, setRestOpen] = useState(false)
  const [restJson, setRestJson] = useState<string | null>(null)
  const [restChats, setRestChats] = useState<BackupChatMeta[]>([])
  const [restSource, setRestSource] = useState('')
  /** Live pulls update lastPullAt bookkeeping once the restore completes. */
  const [restFromLive, setRestFromLive] = useState(false)
  /** Bumped per presented backup — remounts the picker with a fresh state. */
  const [restNonce, setRestNonce] = useState(0)

  const [passphrase, setPassphrase] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState<
    'test' | 'push' | 'pull' | 'snapshots' | 'compare' | null
  >(null)
  const [lastPush, setLastPush] = useState<number | undefined>(saved?.lastPushAt)
  const [lastPull, setLastPull] = useState<number | undefined>(saved?.lastPullAt)

  const [autoPush, setAutoPush] = useState(saved?.autoPush ?? false)
  const [historyKeep, setHistoryKeep] = useState<number>(saved?.historyKeep ?? 0)

  const [snapshots, setSnapshots] = useState<string[]>([])
  const [snapPick, setSnapPick] = useState('')

  const pwOk = passphrase.length >= 8
  const proxy = proxyAvailable()

  // v1.9 — finish the Google OAuth redirect: ?code=… lands back on this
  // page after consent; exchange it for a refresh token and store it.
  useEffect(() => {
    const code = readOAuthRedirectCode()
    if (!code) return
    const cfg = getCloudSyncConfig()
    const clientId = cfg?.gdriveClientId ?? gdriveClientId.trim()
    const clientSecret = cfg?.gdriveClientSecret ?? gdriveClientSecret.trim()
    if (!clientId || !clientSecret) return
    let alive = true
    setGdriveConnecting(true)
    void exchangeAuthCode({
      code,
      clientId,
      clientSecret,
      redirectUri: gdriveRedirect || defaultRedirectUri(),
    })
      .then((out) => {
        if (!alive) return
        setGdriveToken(out.accessToken)
        if (out.refreshToken) setGdriveRefreshToken(out.refreshToken)
        toast.success(
          out.refreshToken
            ? 'Google Drive connected — the token now refreshes itself'
            : 'Google Drive connected (no refresh token — re-connect later)'
        )
      })
      .catch((err: unknown) =>
        toast.error(
          err instanceof Error ? err.message : 'Google token exchange failed'
        )
      )
      .finally(() => {
        if (alive) setGdriveConnecting(false)
      })
    return () => {
      alive = false
    }
     
  }, [])

  // Chat list for the selective-sync picker (loaded lazily).
  useEffect(() => {
    if (!selectOpen || chats) return
    let alive = true
    void data
      .listChats()
      .then((list) => {
        if (alive) setChats(list)
      })
      .catch(() => {
        if (alive) setChats([])
      })
    return () => {
      alive = false
    }
  }, [selectOpen, chats, data])

  // Wrap provider requests with the refresh-token rotation (v1.9).
  const freshConfig = async (): Promise<CloudSyncConfig> =>
    ensureFreshGdriveToken(currentConfig())

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
    return (
      (gdriveToken.trim().length > 10 ||
        (gdriveRefreshToken.trim().length > 10 &&
          gdriveClientId.trim().length > 0 &&
          gdriveClientSecret.trim().length > 0)) &&
      filename.trim().length > 0
    )
  }, [
    provider,
    url,
    s3Bucket,
    s3Region,
    s3AccessKey,
    s3SecretKey,
    filename,
    gdriveToken,
    gdriveRefreshToken,
    gdriveClientId,
    gdriveClientSecret,
  ])

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
    gdriveClientId: gdriveClientId.trim(),
    gdriveClientSecret: gdriveClientSecret.trim(),
    gdriveRefreshToken: gdriveRefreshToken.trim(),
    historyKeep,
    autoPush,
    // passphrase persists only while auto-push is on (device-local)
    syncPassphrase: autoPush && pwOk ? passphrase : saved?.syncPassphrase ?? '',
    syncSelectedOnly,
    syncChatIds,
    incremental,
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
      `Restored from cloud · ${created} chat${created === 1 ? '' : 's'} · ${imported.toLocaleString()} message${imported === 1 ? '' : 's'}`
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
      const r = await testCloudConnection(await freshConfig())
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
      const cfg = await freshConfig()
      const blob = await data.exportBackup()
      const json = filterBackupJson(await blob.text(), cfg)
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
      const cfg = await freshConfig()
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
      const cfg = await freshConfig()
      const json = await pullFromCloud(cfg, passphrase, snapPick)
      await restoreJson(json)
      setPassphrase('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Snapshot restore failed')
    } finally {
      setBusy(null)
    }
  }

  // v1.9.2 — selective restore: restsel.* keys ship via agent-ctx/keys-2a.json
  // and are merged into the locale files by the locale agent; t() falls back
  // to the key until then, so translate through a string cast here.
  const tsel = (key: string, params?: TParams) =>
    t(key as TranslationKey, params)

  /** Decrypt succeeded — parse its chat list and open the picker dialog. */
  const openRestorePicker = (json: string, source: string, fromLive: boolean) => {
    const meta = parseBackupChats(json)
    if (!meta || meta.length === 0) {
      toast.error(tsel('restsel.parseError'))
      return
    }
    setRestJson(json)
    setRestSource(source)
    setRestChats(meta)
    setRestFromLive(fromLive)
    setRestNonce((n) => n + 1)
    setRestOpen(true)
  }

  /** "Choose chats…" — pull + decrypt the LIVE cloud file, then pick. */
  const doPullSelective = async () => {
    if (busy || !fieldsOk || !pwOk) return
    setBusy('pull')
    try {
      const cfg = await freshConfig()
      const json = await pullFromCloud(cfg, passphrase)
      openRestorePicker(json, tsel('restsel.sourceLive'), true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Pull failed')
    } finally {
      setBusy(null)
    }
  }

  /** Snapshot row "Choose…" — pull + decrypt the picked snapshot, then pick. */
  const doPullSnapshotSelective = async () => {
    if (busy || !fieldsOk || !pwOk || !snapPick) return
    setBusy('pull')
    try {
      const cfg = await freshConfig()
      const json = await pullFromCloud(cfg, passphrase, snapPick)
      openRestorePicker(
        json,
        tsel('restsel.sourceSnapshot', { name: snapPick }),
        false
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Snapshot restore failed')
    } finally {
      setBusy(null)
    }
  }

  /** Picker confirmed — filter the backup to the chosen chats and restore. */
  const doSelectiveRestore = async (ids: string[]) => {
    if (!restJson || busy) return
    setBusy('pull')
    try {
      await restoreJson(filterBackupJsonByIds(restJson, ids))
      setRestOpen(false)
      setRestJson(null)
      setPassphrase('')
      if (restFromLive) {
        const at = Date.now()
        persist({ ...(await freshConfig()), lastPullAt: at })
        setLastPull(at)
        writeLastBackupAt()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Restore failed')
    } finally {
      setBusy(null)
    }
  }

  const doSaveSnapshotFile = async () => {
    if (busy || !fieldsOk || !snapPick) return
    setBusy('pull')
    try {
      const cfg = await freshConfig()
      const envelope = await pullEnvelopeText(cfg, snapPick)
      const blob = new Blob([envelope], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = snapPick
      a.click()
      URL.revokeObjectURL(a.href)
      toast.success('Snapshot saved as ' + snapPick)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setBusy(null)
    }
  }

  /**
   * v1.9.1 — import a previously saved encrypted .wasync snapshot file
   * straight from disk (offline path: cloud snapshot → Save file → share →
   * import here). No provider config needed — just the sync passphrase.
   */
  const doImportSnapshotFile = async (file: File | undefined) => {
    if (!file || busy) return
    setBusy('pull')
    try {
      const text = await file.text()
      if (!looksLikeSyncFile(text)) {
        throw new Error('That file is not a WA Archiver encrypted backup')
      }
      const json = await decryptFromSyncFile(text, passphrase)
      if (isDeltaEnvelope(json)) {
        throw new Error(
          'That file is an incremental delta — restore it from the cloud so its snapshot chain can be resolved'
        )
      }
      await restoreJson(json)
      const at = Date.now()
      const cfg = await freshConfig()
      persist({ ...cfg, lastPullAt: at })
      setLastPull(at)
      writeLastBackupAt()
      setPassphrase('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusy(null)
    }
  }

  /**
   * v1.9.1 — compare the selected snapshot with the live cloud copy:
   * chat counts, message counts, chats only on one side, and the most
   * changed chats. Read-only — nothing is restored.
   */
  const doCompareSnapshot = async () => {
    if (busy || !fieldsOk || !pwOk || !snapPick) return
    setBusy('compare')
    try {
      const cfg = await freshConfig()
      const [snapJson, liveJson] = await Promise.all([
        pullFromCloud(cfg, passphrase, snapPick),
        pullFromCloud(cfg, passphrase),
      ])
      const parseChats = (
        j: string
      ): Array<{ id?: unknown; title?: unknown; messages?: unknown[] }> | null => {
        try {
          const p = JSON.parse(j) as {
            chats?: Array<{
              id?: unknown
              title?: unknown
              messages?: unknown[]
            }>
          }
          if (!Array.isArray(p.chats)) return null
          return p.chats.filter(
            (c): c is { id?: unknown; title?: unknown; messages?: unknown[] } =>
              !!c && typeof c === 'object'
          )
        } catch {
          return null
        }
      }
      const snapChats = parseChats(snapJson)
      const liveChats = parseChats(liveJson)
      if (!snapChats || !liveChats) {
        throw new Error('Could not parse the snapshot contents')
      }
      const msgCount = (c: { messages?: unknown[] }) =>
        Array.isArray(c.messages) ? c.messages.length : 0
      const snapMap = new Map(
        snapChats.map((c) => [String(c.id ?? ''), c])
      )
      const liveMap = new Map(
        liveChats.map((c) => [String(c.id ?? ''), c])
      )
      const label = (c: { id?: unknown; title?: unknown }) =>
        String(c.title ?? c.id ?? 'Untitled')
      const newInSnapshot: string[] = []
      const newSince: string[] = []
      const changes: Array<{ title: string; delta: number }> = []
      for (const [id, sc] of snapMap) {
        const lc = liveMap.get(id)
        if (!lc) {
          newInSnapshot.push(label(sc))
          continue
        }
        const delta = msgCount(sc) - msgCount(lc)
        if (delta !== 0) changes.push({ title: label(sc), delta })
      }
      for (const [id, lc] of liveMap) {
        if (!snapMap.has(id)) newSince.push(label(lc))
      }
      changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      const sum = (list: Array<{ messages?: unknown[] }>) =>
        list.reduce((s, c) => s + msgCount(c), 0)
      setDiff({
        snapName: snapPick,
        snapChats: snapMap.size,
        snapMessages: sum(snapChats),
        liveChats: liveMap.size,
        liveMessages: sum(liveChats),
        newInSnapshot: newInSnapshot.slice(0, 20),
        newSince: newSince.slice(0, 20),
        changes: changes.slice(0, 8),
      })
      setDiffOpen(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Compare failed')
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
        {t('cloud.title')}
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
            <div className="col-span-full flex flex-col gap-1.5 rounded-md bg-black/[0.03] p-2 dark:bg-white/[0.05]">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-(--wa-text)">
                <CheckCircle2
                  className={
                    'h-3.5 w-3.5 ' +
                    (gdriveRefreshToken
                      ? 'text-(--wa-accent)'
                      : 'text-(--wa-text-2)')
                  }
                  aria-hidden
                />
                {gdriveRefreshToken
                  ? 'Refresh-token flow connected — access tokens auto-rotate'
                  : 'One-time connect (recommended over paste-a-token)'}
              </p>
              <Input
                value={gdriveClientId}
                onChange={(e) => setGdriveClientId(e.target.value)}
                placeholder="Google Cloud OAuth client ID (…apps.googleusercontent.com)"
                autoComplete="off"
                spellCheck={false}
                className="h-8 text-[11.5px]"
                aria-label="Google OAuth client id"
              />
              <Input
                type="password"
                value={gdriveClientSecret}
                onChange={(e) => setGdriveClientSecret(e.target.value)}
                placeholder="Google Cloud OAuth client secret (device-local only)"
                autoComplete="off"
                className="h-8 text-[11.5px]"
                aria-label="Google OAuth client secret"
              />
              <Input
                value={gdriveRedirect}
                onChange={(e) => setGdriveRedirect(e.target.value)}
                placeholder={
                  'Redirect URI registered in Google Cloud (' +
                  defaultRedirectUri() +
                  ')'
                }
                spellCheck={false}
                className="h-8 text-[11.5px]"
                aria-label="Google OAuth redirect URI"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 self-start text-[11.5px]"
                disabled={
                  gdriveConnecting ||
                  gdriveClientId.trim().length < 10 ||
                  gdriveClientSecret.trim().length < 10
                }
                onClick={() => {
                  const redirect =
                    gdriveRedirect.trim() || defaultRedirectUri()
                  if (!redirect) {
                    toast.error('Redirect URI unavailable in this context')
                    return
                  }
                  // Persist credentials first — the redirect comes back to a
                  // FRESH page load which reads them from the config.
                  saveCloudSyncConfig({
                    ...currentConfig(),
                    gdriveClientId: gdriveClientId.trim(),
                    gdriveClientSecret: gdriveClientSecret.trim(),
                  })
                  window.location.href = buildConsentUrl({
                    clientId: gdriveClientId.trim(),
                    redirectUri: redirect,
                  })
                }}
              >
                {gdriveConnecting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <KeyRound className="h-3.5 w-3.5" aria-hidden />
                )}
                Connect Google Drive
              </Button>
              <p className="text-[10px] leading-snug text-(--wa-text-2)">
                Create the client at console.cloud.google.com (type: Web
                application, scope drive.file, redirect = this page URL). The
                secret never leaves this device. Paste-a-token below still
                works as a fallback.
              </p>
            </div>
            <p className="col-span-full text-[10.5px] leading-snug text-(--wa-text-2)">
              Fallback: paste a short-lived token from{' '}
              <a
                href="https://developers.google.com/oauthplayground"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                OAuth Playground
              </a>{' '}
              (scope: drive.file).
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
            {t('cloud.autopush')}
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
            {t('cloud.history')}
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
        <div className="flex items-center justify-between gap-3">
          <Label
            htmlFor="cloud-incremental"
            className="flex items-center gap-1.5 text-[12px] font-medium"
          >
            <Zap className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
            {t('cloud.incremental')}
          </Label>
          <Switch
            id="cloud-incremental"
            checked={incremental}
            onCheckedChange={setIncremental}
          />
        </div>
        <p className="text-[10.5px] leading-snug text-(--wa-text-2)">
          {incremental
            ? 'On. Timestamped snapshots only upload chats changed since the previous one (full snapshot every 5th push).'
            : 'Off. Every snapshot is a full copy of the archive.'}
        </p>

        {/* Selective per-chat sync (v1.9) */}
        <div className="flex items-center justify-between gap-3">
          <Label
            htmlFor="cloud-selective"
            className="flex items-center gap-1.5 text-[12px] font-medium"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
            {t('cloud.selective')}
          </Label>
          <Switch
            id="cloud-selective"
            checked={syncSelectedOnly}
            onCheckedChange={(v) => {
              setSyncSelectedOnly(v)
              if (v) setSelectOpen(true)
            }}
          />
        </div>
        {syncSelectedOnly && (
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setSelectOpen((v) => !v)}
              className="self-start text-[11.5px] font-medium text-(--wa-accent-strong) underline underline-offset-2 dark:text-(--wa-accent)"
            >
              {selectOpen ? 'Hide chat list' : `Choose chats (${syncChatIds.length} selected)`}
            </button>
            {selectOpen && (
              <div className="wa-scroll max-h-56 overflow-y-auto rounded-md border border-black/[0.06] p-1.5 dark:border-white/10">
                {chats === null && (
                  <p className="p-2 text-[11.5px] text-(--wa-text-2)">
                    Loading chats…
                  </p>
                )}
                {chats?.length === 0 && (
                  <p className="p-2 text-[11.5px] text-(--wa-text-2)">
                    No chats yet — import first, then pick what syncs.
                  </p>
                )}
                {chats?.map((c) => {
                  const checked = syncChatIds.includes(c.id)
                  return (
                    <label
                      key={c.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[12px] hover:bg-black/[0.03] dark:hover:bg-white/5"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSyncChatIds((prev) =>
                            checked
                              ? prev.filter((x) => x !== c.id)
                              : [...prev, c.id]
                          )
                        }
                        className="h-3.5 w-3.5 accent-(--wa-accent)"
                        aria-label={c.title}
                      />
                      <span className="min-w-0 flex-1 truncate text-(--wa-text)">
                        {c.title}
                      </span>
                      <span className="text-[10.5px] text-(--wa-text-2)">
                        {c.messageCount.toLocaleString()}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
            <p className="text-[10.5px] leading-snug text-(--wa-text-2)">
              {syncChatIds.length > 0
                ? `Only ${syncChatIds.length} chat${syncChatIds.length === 1 ? '' : 's'} will be encrypted into the envelope — pushes stay small.`
                : 'No chats selected yet — with an empty selection EVERYTHING syncs.'}
            </p>
          </div>
        )}
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
          {t('cloud.test')}
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
          {t('cloud.push')}
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
          {t('cloud.pull')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void doPullSelective()}
          disabled={busy !== null || !fieldsOk || !pwOk}
          className="gap-1.5"
          title={tsel('restsel.title')}
        >
          {busy === 'pull' ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <ListChecks className="h-4 w-4" aria-hidden />
          )}
          {tsel('restsel.choose')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => snapFileRef.current?.click()}
          disabled={busy !== null || !pwOk}
          className="gap-1.5"
          title="Import a saved encrypted .wasync snapshot file from this device (offline — no cloud config needed)"
        >
          {busy === 'pull' ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <FileUp className="h-4 w-4" aria-hidden />
          )}
          {t('snapshots.fromFile')}
        </Button>
        <input
          ref={snapFileRef}
          type="file"
          accept={SYNC_FILE_ACCEPT}
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            void doImportSnapshotFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
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
            {t('cloud.snapshots')}
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
            {t('snapshots.restore')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void doPullSnapshotSelective()}
            disabled={busy !== null || !pwOk || !snapPick}
            className="gap-1.5"
            title={tsel('restsel.title')}
          >
            {busy === 'pull' ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <ListChecks className="h-4 w-4" aria-hidden />
            )}
            {tsel('restsel.snapChoose')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void doSaveSnapshotFile()}
            disabled={busy !== null || !snapPick}
            className="gap-1.5"
            title="Download the encrypted .wasync file (no decryption needed)"
          >
            <Download className="h-4 w-4" aria-hidden />
            {t('snapshots.save')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void doCompareSnapshot()}
            disabled={busy !== null || !pwOk || !snapPick}
            className="gap-1.5"
            title="Compare this snapshot with the live cloud copy — nothing is restored"
          >
            {busy === 'compare' ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <GitCompare className="h-4 w-4" aria-hidden />
            )}
            {t('snapshots.compare')}
          </Button>
        </div>
      )}

      {/* One-bundle multi-device transfer (v1.9) */}
      <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-black/10 p-2 dark:border-white/15">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-(--wa-text)">
            <QrCode className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
            {t('cloud.transfer')}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2 text-[11.5px]"
            disabled={!fieldsOk}
            onClick={() => setTransferOpen(true)}
          >
            <QrCode className="h-3.5 w-3.5" aria-hidden />
            {t('cloud.pair')}
          </Button>
        </div>
        <p className="text-[10.5px] leading-snug text-(--wa-text-2)">
          Show a QR / copy a pairing code — the other device adopts this
          provider config + passphrase and pulls the same encrypted bundle.
        </p>
      </div>

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
      {/* v1.9.1 — snapshot vs live diff dialog */}
      <Dialog open={diffOpen} onOpenChange={setDiffOpen}>
        <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto wa-scroll">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <GitCompare
                className="h-4 w-4 text-(--wa-accent)"
                aria-hidden
              />
              {t('snapshots.diff.title')}
            </DialogTitle>
            <DialogDescription className="text-[12px]">
              {t('snapshots.diff.subtitle').replace('{name}', diff?.snapName ?? '')}
            </DialogDescription>
          </DialogHeader>
          {diff && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md bg-black/[0.03] p-2.5 dark:bg-white/[0.05]">
                  <p className="text-[10.5px] font-semibold uppercase tracking-wide text-(--wa-text-2)">
                    {t('snapshots.diff.snapshot')}
                  </p>
                  <p className="mt-0.5 text-[13px] font-semibold text-(--wa-text)">
                    {diff.snapChats} chats · {diff.snapMessages.toLocaleString()}{' '}
                    msgs
                  </p>
                </div>
                <div className="rounded-md bg-black/[0.03] p-2.5 dark:bg-white/[0.05]">
                  <p className="text-[10.5px] font-semibold uppercase tracking-wide text-(--wa-text-2)">
                    {t('snapshots.diff.live')}
                  </p>
                  <p className="mt-0.5 text-[13px] font-semibold text-(--wa-text)">
                    {diff.liveChats} chats · {diff.liveMessages.toLocaleString()}{' '}
                    msgs
                  </p>
                </div>
              </div>
              {diff.newInSnapshot.length > 0 && (
                <div>
                  <p className="text-[11.5px] font-semibold text-(--wa-text)">
                    {t('snapshots.diff.newInSnapshot')}
                  </p>
                  <ul className="mt-1 flex max-h-24 flex-col gap-0.5 overflow-y-auto wa-scroll">
                    {diff.newInSnapshot.map((n) => (
                      <li
                        key={n}
                        className="truncate text-[11.5px] text-(--wa-text-2)"
                      >
                        • {n}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {diff.newSince.length > 0 && (
                <div>
                  <p className="text-[11.5px] font-semibold text-(--wa-text)">
                    {t('snapshots.diff.newSince')}
                  </p>
                  <ul className="mt-1 flex max-h-24 flex-col gap-0.5 overflow-y-auto wa-scroll">
                    {diff.newSince.map((n) => (
                      <li
                        key={n}
                        className="truncate text-[11.5px] text-(--wa-text-2)"
                      >
                        • {n}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {diff.changes.length > 0 && (
                <div>
                  <p className="text-[11.5px] font-semibold text-(--wa-text)">
                    {t('snapshots.diff.changed')}
                  </p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {diff.changes.map((c) => (
                      <li
                        key={c.title}
                        className="flex items-center justify-between gap-2 text-[11.5px]"
                      >
                        <span className="min-w-0 truncate text-(--wa-text-2)">
                          {c.title}
                        </span>
                        <span
                          className={
                            c.delta > 0
                              ? 'shrink-0 font-semibold text-emerald-600 dark:text-emerald-400'
                              : 'shrink-0 font-semibold text-red-500'
                          }
                        >
                          {c.delta > 0 ? `+${c.delta}` : c.delta}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {diff.newInSnapshot.length === 0 &&
                diff.newSince.length === 0 &&
                diff.changes.length === 0 && (
                  <p className="rounded-md bg-black/[0.03] px-3 py-2.5 text-[12px] text-(--wa-text-2) dark:bg-white/[0.05]">
                    {t('snapshots.diff.none')}
                  </p>
                )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* v1.9.2 — selective restore picker (chat checkboxes per backup) */}
      <RestorePickerDialog
        key={restNonce}
        open={restOpen}
        onOpenChange={setRestOpen}
        chats={restChats}
        source={restSource}
        busy={busy === 'pull'}
        onConfirm={(ids) => void doSelectiveRestore(ids)}
      />

      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        buildConfig={() => ({
          ...currentConfig(),
          syncPassphrase:
            passphrase || saved?.syncPassphrase || '',
        })}
        passphrase={passphrase || saved?.syncPassphrase || ''}
        onAdopted={(cfg) => {
          setProvider(cfg.provider ?? 'webdav')
          setUrl(cfg.url)
          setUsername(cfg.username ?? '')
          setPassword(cfg.password ?? '')
          setFilename(cfg.filename || 'wa-archiver.wasync')
          setS3Region(cfg.s3Region ?? '')
          setS3Bucket(cfg.s3Bucket ?? '')
          setS3AccessKey(cfg.s3AccessKey ?? '')
          setS3SecretKey(cfg.s3SecretKey ?? '')
          setS3Endpoint(cfg.s3Endpoint ?? '')
          setS3Prefix(cfg.s3Prefix ?? 'wa-archiver/')
          setGdriveToken(cfg.gdriveToken ?? '')
          setGdriveRefreshToken(cfg.gdriveRefreshToken ?? '')
          setGdriveClientId(cfg.gdriveClientId ?? '')
          setGdriveClientSecret(cfg.gdriveClientSecret ?? '')
          setGdriveFolderId(cfg.gdriveFolderId ?? '')
          setHistoryKeep(cfg.historyKeep ?? 0)
          setIncremental(cfg.incremental === true)
          setSyncSelectedOnly(cfg.syncSelectedOnly === true)
          setSyncChatIds(cfg.syncChatIds ?? [])
          if (cfg.syncPassphrase) setPassphrase(cfg.syncPassphrase)
          saveCloudSyncConfig(cfg)
        }}
      />
    </section>
  )
}

export default CloudSyncCard
