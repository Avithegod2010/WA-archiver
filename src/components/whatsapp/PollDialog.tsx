'use client'

import { useState } from 'react'
import { Plus, Trash2, BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

/**
 * Create-a-poll dialog — question + 2..6 options, WhatsApp style.
 */
export function PollDialog({
  open,
  onOpenChange,
  onCreate,
  creating,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreate: (question: string, options: string[]) => Promise<boolean>
  creating: boolean
}) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<string[]>(['', ''])
  const [error, setError] = useState('')

  function reset() {
    setQuestion('')
    setOptions(['', ''])
    setError('')
  }

  function setOption(i: number, v: string) {
    setOptions((opts) => opts.map((o, j) => (j === i ? v : o)))
  }

  const cleanOptions = options.map((o) => o.trim()).filter(Boolean)
  const valid =
    question.trim().length > 0 &&
    new Set(cleanOptions).size >= 2 &&
    cleanOptions.length >= 2

  async function submit() {
    if (!valid) {
      setError(
        question.trim()
          ? 'Add at least two different options.'
          : 'Give the poll a question first.'
      )
      return
    }
    const ok = await onCreate(question.trim(), cleanOptions)
    if (ok) {
      reset()
      onOpenChange(false)
    } else {
      setError('Could not create the poll — try again.')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-(--wa-accent)/15 text-(--wa-accent)">
              <BarChart3 className="h-4 w-4" />
            </span>
            Create poll
          </DialogTitle>
          <DialogDescription>
            Ask a question with up to 6 options. Votes are stored on this
            device.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div>
            <label
              htmlFor="poll-question"
              className="mb-1 block text-[12.5px] font-medium text-(--wa-text)"
            >
              Question
            </label>
            <Input
              suppressHydrationWarning
              id="poll-question"
              autoFocus
              value={question}
              maxLength={200}
              placeholder="Ask a question…"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              }}
            />
          </div>

          <div>
            <label className="mb-1 block text-[12.5px] font-medium text-(--wa-text)">
              Options
            </label>
            <div className="flex flex-col gap-2">
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Input
                    suppressHydrationWarning
                    value={opt}
                    maxLength={100}
                    placeholder={`Option ${i + 1}`}
                    onChange={(e) => setOption(i, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        submit()
                      }
                    }}
                  />
                  {options.length > 2 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-(--wa-text-2) hover:text-rose-500"
                      aria-label={`Remove option ${i + 1}`}
                      onClick={() =>
                        setOptions((opts) => opts.filter((_, j) => j !== i))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {options.length < 6 && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1.5 h-8 gap-1.5 rounded-full text-[12.5px] font-medium text-(--wa-accent-strong) hover:bg-(--wa-accent)/10"
                onClick={() => setOptions((opts) => [...opts, ''])}
              >
                <Plus className="h-3.5 w-3.5" /> Add option
              </Button>
            )}
          </div>

          {error && (
            <p className="text-[12.5px] font-medium text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="rounded-full bg-(--wa-accent) text-white hover:bg-(--wa-accent-strong)"
            disabled={creating || !valid}
            onClick={submit}
          >
            {creating ? 'Creating…' : 'Create poll'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
