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
  previewDeviceImport,
  LocalImportError,
  type ImportPreviewData,
  type ImportSelection,
  type LocalImportProgress,
} from '@/lib/data'
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
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { colorForName, initialsForName } from './types'

export interface ImportPanelProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  onImported?: (chatIds: string[]) => void
}

type Phase = 'idle' | 'preview' | 'running' | 'success' | 'error'

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

  const startImport = useCallback(
    (file: File) => {
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

      if (mode === 'device') {
        // ---- device transport: parse now, preview, then commit ----------
        // Idea #13: nothing is written until the user confirms the
        // selection in the preview step (or imports everything).
        const runId = runIdRef.current
        void (async () => {
          try {
            const data = await previewDeviceImport(file, {
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
    },
    [reset, includeAudio, mode, dataClient]
  )

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
