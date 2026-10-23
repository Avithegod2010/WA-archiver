'use client'

import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  CheckCircle2,
  CloudUpload,
  FileArchive,
  FileText,
  GitMerge,
  Loader2,
  RotateCcw,
  XCircle,
} from 'lucide-react'
import {
  commitDeviceImport,
  LocalImportError,
  type ImportPreviewData,
  type ImportSelection,
  type LocalImportProgress,
} from '@/lib/data'
// W1 — device-mode preview parsing runs in a Web Worker (with a transparent
// fallback to the previous main-thread path inside parseExportFile itself).
import { parseExportFile } from '@/lib/parse-worker-client'
import { guessTitleFromFilename } from '@/lib/whatsapp-parser'
import {
  findMergeCandidates,
  type ImportMergeCandidate,
} from '@/lib/import-dedup'
import { useData } from './data-provider'
import { ImportPreviewStep } from './ImportPreviewStep'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { colorForName, initialsForName } from './types'

export interface ImportPanelProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  onImported?: (chatIds: string[]) => void
}

type Phase = 'idle' | 'choice' | 'preview' | 'running' | 'success' | 'error'

interface NdjsonEvent {
  type?: string
  name?: string
  chats?: number
  messages?: number
  parsed?: number
  chat?: string
  sender?: string | null
  time?: string
  body?: string
  kind?: string
  chatIds?: string[]
  count?: number
  message?: string
}

interface PreviewRow {
  key: number
  sender: string
  time: string
  body: string
  kind: string
}

const KIND_LABEL: Record<string, string> = {
  image: 'Photo',
  video: 'Video',
  audio: 'Voice',
  sticker: 'Sticker',
  gif: 'GIF',
  document: 'Doc',
  contact: 'Contact',
  media: 'Media',
  poll: 'Poll',
  location: 'Location',
  call: 'Call',
  deleted: 'Deleted',
  system: 'System',
}

const MAX_PREVIEW_ROWS = 60

/** LocalImportProgress phase → human label (device import status line). */
const PHASE_LABEL: Record<LocalImportProgress['phase'], string> = {
  reading: 'Reading archive…',
  parsing: 'Parsing transcript…',
  media: 'Storing media on this device…',
  inserting: 'Writing to the device database…',
  done: 'Finishing…',
}

/** NDJSON stream consumer for /api/import/stream. */
async function consumeImportStream(
  res: Response,
  handlers: {
    onStart: (e: NdjsonEvent) => void
    onProgress: (e: NdjsonEvent) => void
    onMessage: (e: NdjsonEvent) => void
    onDone: (e: NdjsonEvent) => void
    onError: (message: string) => void
  }
): Promise<void> {
  if (!res.body) {
    handlers.onError('Streaming is not supported by this browser.')
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let sawDone = false
  let sawError = false

  const dispatch = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let evt: NdjsonEvent
    try {
      evt = JSON.parse(trimmed) as NdjsonEvent
    } catch {
      return // defensive: skip malformed lines
    }
    switch (evt.type) {
      case 'start':
        handlers.onStart(evt)
        break
      case 'progress':
        handlers.onProgress(evt)
        break
      case 'message':
        handlers.onMessage(evt)
        break
      case 'done':
        sawDone = true
        handlers.onDone(evt)
        break
      case 'error':
        sawError = true
        handlers.onError(evt.message || 'Import failed. Please try again.')
        break
    }
  }

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) dispatch(line)
    }
    if (buffer) dispatch(buffer)
  } catch {
    // Reader aborted (cancel) — treated as user cancellation upstream.
    return
  }

  if (!sawDone && !sawError) {
    handlers.onError(
      res.ok
        ? 'The connection ended before the import finished. Partial data may have been saved.'
        : `Import failed (server responded ${res.status}).`
    )
  }
}

export function ImportPanel({
  open,
  onOpenChange,
  onImported,
}: ImportPanelProps) {
  // Device transport imports run fully in this tab (importFileToDevice);
  // server transport keeps the streaming /api/import/stream NDJSON flow.
  // (dataClient is the transport; local `data` shadows it inside import
  // closures as the parsed preview result — keep the two apart.)
  const { mode, data: dataClient } = useData()
  const [phase, setPhase] = useState<Phase>('idle')
  const [fileName, setFileName] = useState('')
  const [chatTitle, setChatTitle] = useState('')
  const [total, setTotal] = useState<number | null>(null)
  const [parsed, setParsed] = useState(0)
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [chatIds, setChatIds] = useState<string[]>([])
  const [importedCount, setImportedCount] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [dragOver, setDragOver] = useState(false)
  // Device import phase (null while using the server NDJSON stream).
  const [stage, setStage] = useState<LocalImportProgress['phase'] | null>(null)
  // Idea #13 — parsed-but-not-committed export awaiting a selection.
  const [previewData, setPreviewData] = useState<ImportPreviewData | null>(null)
  // B1 — existing chats matching the parsed export (device preview only).
  const [mergeCandidates, setMergeCandidates] = useState<
    ImportMergeCandidate[]
  >([])
  // B1 — merge stats of the finished run (success screen + toast).
  const [mergeStats, setMergeStats] = useState<{
    added: number
    duplicatesSkipped: number
  } | null>(null)
  // "Include audio files" — sent as the `includeAudio` form field ('0' skips
  // voice-note files on the server; '1'/absent keeps the default behavior).
  // Deliberately NOT reset between imports so a retry keeps the choice.
  const [includeAudio, setIncludeAudio] = useState(true)

  // B1 parity — server transport: candidates detected BEFORE upload (the
  // device path finds them during parsing). The user picks merge-vs-new in
  // the 'choice' phase; merging goes through the JSON route which supports
  // mergeIntoChatId and returns per-message dedup stats.
  const [serverCandidates, setServerCandidates] = useState<
    ImportMergeCandidate[]
  >([])
  const [serverFile, setServerFile] = useState<File | null>(null)
  const [choiceTargetId, setChoiceTargetId] = useState<string>('__new__')

  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const keyRef = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  // Bumped by reset() — device-import callbacks capture the value at start
  // and drop their results when it changed (cancel/close mid-import).
  const runIdRef = useRef(0)

  const reset = useCallback(() => {
    setPhase('idle')
    setFileName('')
    setChatTitle('')
    setTotal(null)
    setParsed(0)
    setRows([])
    setChatIds([])
    setImportedCount(0)
    setErrorMsg('')
    setDragOver(false)
    setStage(null)
    setPreviewData(null)
    setMergeCandidates([])
    setMergeStats(null)
    setServerCandidates([])
    setServerFile(null)
    setChoiceTargetId('__new__')
    stickRef.current = true
    runIdRef.current += 1
  }, [])

  const handleOpenChange = useCallback(
    (v: boolean) => {
      if (!v) {
        if (phase === 'running') {
          abortRef.current?.abort()
          toast.info('Import cancelled — partial data may have been saved.')
        }
        reset()
      }
      onOpenChange(v)
    },
    [phase, reset, onOpenChange]
  )

  /**
   * Server transport, streaming upload (new-chat path; also used after
     * the user picks "Import as new chat" in the choice phase).
     */
    const runServerImport = (file: File) => {
      const controller = new AbortController()
      abortRef.current = controller
      const fd = new FormData()
      fd.append('file', file)
      fd.append('includeAudio', includeAudio ? '1' : '0')

      void (async () => {
        try {
          const res = await fetch('/api/import/stream', {
            method: 'POST',
            body: fd,
            signal: controller.signal,
          })
          await consumeImportStream(res, {
            onStart: (e) => {
              setTotal(e.messages ?? e.chats ?? null)
              setParsed(0)
            },
            onProgress: (e) => setParsed(e.parsed ?? 0),
            onMessage: (e) => {
              if (e.chat) setChatTitle(e.chat)
              keyRef.current += 1
              const row: PreviewRow = {
                key: keyRef.current,
                sender: e.sender || 'System',
                time: e.time ?? '',
                body: e.body ?? '',
                kind: e.kind ?? 'text',
              }
              setRows((prev) => {
                const next = [...prev, row]
                return next.length > MAX_PREVIEW_ROWS
                  ? next.slice(next.length - MAX_PREVIEW_ROWS)
                  : next
              })
            },
            onDone: (e) => {
              const ids = e.chatIds ?? []
              const count = e.count ?? 0
              setChatIds(ids)
              setImportedCount(count)
              setPhase('success')
              toast.success(`Imported ${count.toLocaleString()} messages`)
            },
            onError: (message) => {
              setErrorMsg(message)
              setPhase('error')
            },
          })
        } catch {
          if (controller.signal.aborted) return // user cancelled — ignore
          setErrorMsg(
            'Could not reach the import service. Check your connection and try again.'
          )
          setPhase('error')
        }
      })()
  }

  /**
   * Server transport, merge commit — JSON route with mergeIntoChatId
     * (it dedups per message and reports added/skipped, which the stream
     * route does not carry). No progress events: the dialog shows an
     * indeterminate bar for the (usually small) merge delta.
     */
    const commitServerMerge = (file: File, target: ImportMergeCandidate) => {
      const runId = runIdRef.current
      setPhase('running')
      setStage(null)
      setTotal(null)
      setParsed(0)
      void (async () => {
        try {
          const fd = new FormData()
          fd.append('file', file)
          fd.append('includeAudio', includeAudio ? '1' : '0')
          fd.append('mergeIntoChatId', target.id)
          const res = await fetch('/api/import', {
            method: 'POST',
            body: fd,
          })
          const json = (await res.json().catch(() => null)) as {
            ok?: boolean
            error?: string
            chatId?: string
            messages?: number
            added?: number
            duplicatesSkipped?: number
          } | null
          if (runIdRef.current !== runId) return
          if (!res.ok || !json?.ok) {
            setErrorMsg(
              json?.error ??
                'Import failed. Please check the file and try again.'
            )
            setPhase('error')
            return
          }
          const added = json.added ?? json.messages ?? 0
          const skipped = json.duplicatesSkipped ?? 0
          setChatIds(json.chatId ? [json.chatId] : [])
          setImportedCount(added)
          setChatTitle(target.title)
          setMergeStats({ added, duplicatesSkipped: skipped })
          setStage('done')
          setPhase('success')
          toast.success(
            `Merged: ${added.toLocaleString()} new, ${skipped.toLocaleString()} duplicates skipped`
          )
        } catch {
          if (runIdRef.current !== runId) return
          setErrorMsg(
            'Could not reach the import service. Check your connection and try again.'
          )
          setPhase('error')
        }
      })()
  }

  /** Choice phase → dispatch merge (JSON route) or plain stream. */
    const commitServerChoice = () => {
      const file = serverFile
      const target =
        choiceTargetId === '__new__'
          ? null
          : serverCandidates.find((c) => c.id === choiceTargetId) ?? null
      setServerFile(null)
      setServerCandidates([])
      if (!file) {
        reset()
        return
      }
      if (target) commitServerMerge(file, target)
      else runServerImport(file)
  }

  const startImport = (file: File) => {
      const isZip = /\.zip$/i.test(file.name)
      const isTxt = /\.txt$/i.test(file.name)
      if (!isZip && !isTxt) {
        toast.error('Unsupported file type. Upload a WhatsApp export (.zip or .txt).')
        return
      }
      if (file.size > 400 * 1024 * 1024) {
        toast.error('File too large — the maximum size is 400 MB.')
        return
      }

      reset()
      setPhase('running')
      setFileName(file.name)

      if (mode !== 'device') {
        // B1 parity — surface existing chats this export could merge into
        // BEFORE uploading. Title guess mirrors the server's
        // guessTitleFromFilename; zip transcripts match by file basename
        // only (the inner .txt name is unknown without a client unzip).
        // A failed listChats just means no merge option.
        const runId = runIdRef.current
        void (async () => {
          let candidates: ImportMergeCandidate[] = []
          try {
            const chats = await dataClient.listChats()
            candidates = findMergeCandidates({
              title: isTxt ? guessTitleFromFilename(file.name) : '',
              sourceFile: file.name,
              chats,
            })
          } catch {
            candidates = []
          }
          if (runIdRef.current !== runId) return
          if (candidates.length > 0) {
            setServerCandidates(candidates)
            setServerFile(file)
            setChoiceTargetId('__new__')
            setPhase('choice')
            setStage(null)
            setTotal(null)
            setParsed(0)
          } else {
            runServerImport(file)
          }
        })()
        return
      }

      if (mode === 'device') {
        // ---- device transport: parse now, preview, then commit ----------
        // Idea #13: nothing is written until the user confirms the
        // selection in the preview step (or imports everything).
        const runId = runIdRef.current
        void (async () => {
          try {
            // W1 — the CPU-bound parse now runs in a Web Worker via
            // parseExportFile (falls back to previewDeviceImport on the main
            // thread whenever the worker is unavailable). Media extraction
            // stays on the main thread in commitDeviceImport below.
            const data = await parseExportFile(file, {
              onProgress: (p) => {
                if (runIdRef.current !== runId) return
                setStage(p.phase)
                if (p.phase === 'media') {
                  setTotal(p.total)
                  setParsed(p.processed)
                } else {
                  setTotal(null)
                  setParsed(0)
                }
              },
            })
            if (runIdRef.current !== runId) return
            // B1 — surface existing chats this export could merge into.
            // Matching is best-effort: a failed listChats just means no
            // merge option (plain import keeps working).
            let candidates: ImportMergeCandidate[] = []
            try {
              const chats = await dataClient.listChats()
              candidates = findMergeCandidates({
                title: data.summary.title,
                sourceFile: file.name,
                chats,
              })
            } catch {
              candidates = []
            }
            if (runIdRef.current !== runId) return
            setMergeCandidates(candidates)
            setPreviewData(data)
            setPhase('preview')
            setStage(null)
          } catch (err) {
            if (runIdRef.current !== runId) return
            setErrorMsg(
              err instanceof LocalImportError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : 'Import to this device failed. Please check the file and try again.'
            )
            setPhase('error')
          }
        })()
        return
      }

      runServerImport(file)
  }


  /**
   * Idea #13 — commit the previewed import with the chosen selection.
   * B1 — `mergeIntoChatId` folds the filtered transcript into an existing
   * chat (dedup by message key) instead of creating a new one.
   */
  const commitImport = useCallback(
    (selection: ImportSelection, mergeIntoChatId?: string) => {
      if (!previewData || phase === 'running') return
      setPhase('running')
      setStage('media')
      const runId = runIdRef.current
      void (async () => {
        try {
          const result = await commitDeviceImport(previewData, selection, {
            includeAudio,
            mergeIntoChatId,
            onProgress: (p) => {
              if (runIdRef.current !== runId) return
              setStage(p.phase)
              if (p.phase === 'media') {
                setTotal(p.total)
                setParsed(p.processed)
              } else {
                setTotal(null)
                setParsed(0)
              }
            },
          })
          if (runIdRef.current !== runId) return
          setChatIds([result.chatId])
          setImportedCount(result.messages)
          setChatTitle(result.title)
          setStage('done')
          setPhase('success')
          setPreviewData(null)
          if (result.merged) {
            setMergeStats({
              added: result.added,
              duplicatesSkipped: result.duplicatesSkipped,
            })
            toast.success(
              `Merged: ${result.added.toLocaleString()} new, ${result.duplicatesSkipped.toLocaleString()} duplicates skipped`
            )
          } else {
            setMergeStats(null)
            toast.success(
              `Imported ${result.messages.toLocaleString()} messages`
            )
          }
        } catch (err) {
          if (runIdRef.current !== runId) return
          setErrorMsg(
            err instanceof LocalImportError
              ? err.message
              : err instanceof Error
                ? err.message
                : 'Import to this device failed. Please check the file and try again.'
          )
          setPhase('error')
        }
      })()
    },
    [previewData, phase, includeAudio]
  )

  const onPickFile = () => {
    if (phase === 'running') return
    inputRef.current?.click()
  }

  const cancelImport = () => {
    abortRef.current?.abort()
    toast.info('Import cancelled — partial data may have been saved.')
    reset()
  }

  const finish = (ids: string[]) => {
    onImported?.(ids)
    reset()
    onOpenChange(false)
  }

  // Keep the preview pinned to the newest row unless the user scrolled up.
  const maybeScrollToListEnd = () => {
    const el = listRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }

  const onListScroll = () => {
    const el = listRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32
  }

  const onDragEnter = (e: React.DragEvent) => {
    if (phase !== 'idle' || !e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    setDragOver(true)
  }
  const onDragOver = (e: React.DragEvent) => {
    if (phase !== 'idle') return
    e.preventDefault()
  }
  const onDragLeave = (e: React.DragEvent) => {
    if (phase !== 'idle') return
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
  }
  const onDrop = (e: React.DragEvent) => {
    if (phase !== 'idle') return
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) startImport(file)
  }

  const pct =
    total && total > 0 ? Math.min(100, (parsed / total) * 100) : null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto p-4 sm:max-w-xl sm:p-6"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <DialogHeader>
          <DialogTitle className="text-(--wa-text)">Import WhatsApp export</DialogTitle>
          <DialogDescription className="text-(--wa-text-2)">
            Add a chat you exported from WhatsApp — .zip with media, or a plain
            .txt transcript.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          accept=".zip,.txt"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) startImport(file)
          }}
        />

        {phase === 'idle' && (
          <div
            role="button"
            tabIndex={0}
            aria-label="Drop your WhatsApp export here or browse files"
            onClick={onPickFile}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onPickFile()
              }
            }}
            className={`flex min-h-[140px] w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-4 py-8 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-(--wa-accent) ${
              dragOver
                ? 'border-(--wa-accent) bg-(--wa-accent)/10'
                : 'border-(--wa-line) bg-(--wa-panel-2) hover:border-(--wa-accent)/60'
            }`}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-(--wa-accent)/15 text-(--wa-accent)">
              <CloudUpload className="h-6 w-6" aria-hidden />
            </span>
            <span className="text-sm font-medium text-(--wa-text)">
              Drop your WhatsApp export here
            </span>
            <span className="text-xs text-(--wa-text-2)">
              {dragOver ? 'Release to import' : 'or browse files'}
            </span>
            <Button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation()
                onPickFile()
              }}
              className="mt-1 h-11 gap-2 bg-(--wa-accent) px-5 text-white hover:bg-(--wa-accent-strong)"
            >
              <FileText className="h-4 w-4" aria-hidden />
              or browse files
            </Button>
            <span className="mt-1 flex items-center gap-1.5 text-[11px] text-(--wa-text-2)">
              <FileArchive className="h-3.5 w-3.5" aria-hidden />
              .zip or .txt · up to 400 MB
            </span>
          </div>
        )}

        {phase === 'idle' && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-(--wa-line) bg-(--wa-panel-2) px-3 py-2.5">
            <label
              htmlFor="import-include-audio"
              className="min-w-0 cursor-pointer select-none"
            >
              <span className="block text-[12.5px] font-medium text-(--wa-text)">
                Include audio files
              </span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-(--wa-text-2)">
                {includeAudio
                  ? 'Voice notes (.mp3, .m4a, .ogg…) are saved with the chat.'
                  : 'Voice notes are skipped — the transcript stays complete.'}
              </span>
            </label>
            <Switch
              id="import-include-audio"
              checked={includeAudio}
              onCheckedChange={setIncludeAudio}
              aria-label="Include audio files"
            />
          </div>
        )}

        {phase === 'choice' && (
          <>
          <RadioGroup
            value={choiceTargetId}
            onValueChange={setChoiceTargetId}
            aria-label="Import target"
            className="flex flex-col gap-3"
          >
            <div className="flex items-center gap-2">
              <GitMerge
                className="h-4 w-4 shrink-0 text-(--wa-accent)"
                aria-hidden
              />
              <p className="text-sm font-semibold text-(--wa-text)">
                Existing chat{serverCandidates.length > 1 ? 's' : ''} found
              </p>
            </div>
            <p className="text-[12.5px] leading-snug text-(--wa-text-2)">
              {serverCandidates.length === 1
                ? `“${serverCandidates[0].title}” (${serverCandidates[0].messageCount.toLocaleString()} messages) looks like the same chat as this export. Merge into it — exact duplicates are skipped — or import as a new chat.`
                : 'Several existing chats look like this export. Pick one to merge into, or import as a new chat.'}
            </p>
            <div className="flex flex-col gap-1.5">
              {serverCandidates.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-(--wa-line) bg-(--wa-panel-2) px-3 py-2.5 text-[13px] text-(--wa-text) has-[[data-state=checked]]:border-(--wa-accent)"
                >
                  <RadioGroupItem value={c.id} aria-label={`Merge into ${c.title}`} />
                  <span className="min-w-0 flex-1 truncate">
                    Merge into “{c.title}”
                  </span>
                  <span className="shrink-0 text-[11px] text-(--wa-text-2)">
                    {c.matchedBy.includes('title') ? 'title' : 'file'} match
                  </span>
                </label>
              ))}
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-(--wa-line) bg-(--wa-panel-2) px-3 py-2.5 text-[13px] text-(--wa-text) has-[[data-state=checked]]:border-(--wa-accent)">
                <RadioGroupItem value="__new__" aria-label="Import as a new chat" />
                <span className="min-w-0 flex-1">Import as a new chat</span>
              </label>
            </div>
          </RadioGroup>
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" className="h-10" onClick={reset}>
              Back
            </Button>
              <Button
                size="sm"
                className="h-10 gap-2 bg-(--wa-accent) px-4 text-white hover:bg-(--wa-accent-strong)"
                onClick={commitServerChoice}
              >
                {choiceTargetId === '__new__' ? (
                  <>
                    <FileText className="h-4 w-4" aria-hidden />
                    Continue
                  </>
                ) : (
                  <>
                    <GitMerge className="h-4 w-4" aria-hidden />
                    Merge into “
                    {serverCandidates.find((c) => c.id === choiceTargetId)?.title ??
                      ''}
                    ”
                  </>
                )}
              </Button>
          </div>
          </>
        )}

        {phase === 'preview' && previewData && (
          <ImportPreviewStep
            data={previewData}
            busy={false}
            mergeCandidates={mergeCandidates}
            onCommit={commitImport}
            onCancel={reset}
          />
        )}

        {phase === 'running' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-(--wa-accent)" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-(--wa-text)">
                {fileName || 'Importing…'}
              </span>
              <span aria-live="polite" className="shrink-0 text-xs text-(--wa-text-2)">
                {parsed.toLocaleString()}
                {total ? ` / ${total.toLocaleString()}` : ''}{' '}
                {stage === 'media' ? 'media files…' : 'messages…'}
              </span>
            </div>
            <Progress
              value={pct ?? 100}
              aria-label="Import progress"
              className={`h-2 bg-(--wa-line) [&_[data-slot=progress-indicator]]:bg-(--wa-accent) ${
                pct === null ? '[&_[data-slot=progress-indicator]]:animate-pulse' : ''
              }`}
            />
            <div
              ref={listRef}
              onScroll={onListScroll}
              onAnimationEnd={maybeScrollToListEnd}
              className="max-h-56 overflow-y-auto rounded-xl border border-(--wa-line) bg-(--wa-panel-2)"
              aria-label="Live message preview"
            >
              {rows.length === 0 ? (
                <div className="flex h-20 items-center justify-center px-3 text-center text-xs text-(--wa-text-2)">
                  {stage ? PHASE_LABEL[stage] : 'Waiting for the first messages…'}
                </div>
              ) : (
                <div className="divide-y divide-(--wa-line)">
                  {rows.map((row) => (
                    <div key={row.key} className="flex items-start gap-2.5 px-3 py-2">
                      <span
                        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                        style={{ backgroundColor: colorForName(row.sender) }}
                        aria-hidden
                      >
                        {initialsForName(row.sender)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span
                            className="truncate text-[13px] font-medium"
                            style={{ color: colorForName(row.sender) }}
                          >
                            {row.sender}
                          </span>
                          <span className="ml-auto shrink-0 text-[11px] text-(--wa-text-2)">
                            {row.time}
                          </span>
                        </div>
                        <p className="truncate text-[13px] text-(--wa-text)">
                          {row.body ||
                            KIND_LABEL[row.kind] ||
                            (row.kind === 'text' ? '—' : 'Message')}
                        </p>
                      </div>
                      {row.kind !== 'text' && (
                        <span className="shrink-0 rounded-full border border-(--wa-line) px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-(--wa-text-2)">
                          {KIND_LABEL[row.kind] ?? row.kind}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] leading-snug text-(--wa-text-2)">
                Cancel any time — messages already saved will stay.
              </span>
              <Button
                type="button"
                variant="outline"
                onClick={cancelImport}
                className="h-11 shrink-0 border-(--wa-line) text-(--wa-text) hover:bg-(--wa-row-hover)"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {phase === 'success' && (
          <div className="flex flex-col items-center gap-4 py-2 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-(--wa-accent)/15 text-(--wa-accent)">
              {mergeStats ? (
                <GitMerge className="h-8 w-8" aria-hidden />
              ) : (
                <CheckCircle2 className="h-8 w-8" aria-hidden />
              )}
            </span>
            <div>
              <p className="text-base font-semibold text-(--wa-text)">
                {mergeStats
                  ? `Merged ${mergeStats.added.toLocaleString()} new messages`
                  : `Imported ${importedCount.toLocaleString()} messages`}
              </p>
              {mergeStats && (
                <p className="mt-0.5 text-sm text-(--wa-text-2)">
                  {mergeStats.duplicatesSkipped.toLocaleString()} duplicates
                  skipped
                </p>
              )}
              <p className="mt-1 text-sm text-(--wa-text-2)">
                {fileName}
                {chatTitle ? ` → ${chatTitle}` : ''}
              </p>
            </div>
            <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => finish(chatIds)}
                className="h-11 border-(--wa-line) text-(--wa-text) hover:bg-(--wa-row-hover)"
              >
                Done
              </Button>
              {chatIds.length === 1 && (
                <Button
                  type="button"
                  onClick={() => finish(chatIds)}
                  className="h-11 bg-(--wa-accent) px-6 text-white hover:bg-(--wa-accent-strong)"
                >
                  Open chat
                </Button>
              )}
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="flex flex-col items-center gap-4 py-2 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/15 text-destructive">
              <XCircle className="h-8 w-8" aria-hidden />
            </span>
            <div>
              <p className="text-base font-semibold text-(--wa-text)">
                Import failed
              </p>
              <p className="mt-1 max-w-sm text-sm text-(--wa-text-2)">
                {errorMsg}
              </p>
            </div>
            <Button
              type="button"
              onClick={() => {
                reset()
                inputRef.current?.click()
              }}
              className="h-11 gap-2 bg-(--wa-accent) px-6 text-white hover:bg-(--wa-accent-strong)"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              Try again
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Support both named and default imports (mounted by WhatsAppApp).
export default ImportPanel
