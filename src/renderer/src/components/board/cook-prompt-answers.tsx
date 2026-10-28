import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import type { CookPrompt } from './cook-claude-cards'

/** Keystrokes into the cook's Claude terminal, through Orca's card answer path. */
export type ClaudeKeys = {
  answer: (prompt: Extract<CookPrompt, { kind: 'question' }>, index: number | string) => void
  raw: (keys: string) => void
  message: (text: string) => void
}

export function QuestionOptions({
  prompt,
  keys
}: {
  prompt: Extract<CookPrompt, { kind: 'question' }>
  keys: ClaudeKeys | null
}): React.ReactNode {
  const [sent, setSent] = useState(false)
  const [otherOpen, setOtherOpen] = useState(false)
  const [other, setOther] = useState('')
  const pick = (choice: number | string): void => {
    setSent(true)
    keys?.answer(prompt, choice)
  }
  return (
    <div className="flex flex-col gap-2">
      {prompt.options.map((option, i) => (
        <button
          key={i}
          type="button"
          data-testid="cook-option"
          data-index={i + 1}
          disabled={sent || !keys}
          onClick={() => pick(i)}
          className="flex items-start gap-3 rounded-lg border border-status-warning-border bg-card px-3 py-2.5 text-left hover:bg-accent disabled:opacity-60"
        >
          <span className="grid size-6 flex-none place-items-center rounded-md bg-muted font-mono text-xs font-semibold">
            {i + 1}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {option.label}
              {option.recommended ? (
                <span
                  data-testid="cook-recommended"
                  className="rounded border border-status-success-border bg-status-success-background px-1.5 text-2xs text-status-success"
                >
                  {translate('boards.cook.recommended', 'Recommended')}
                </span>
              ) : null}
            </span>
            {option.description ? (
              <small className="text-[12.5px] text-muted-foreground">{option.description}</small>
            ) : null}
          </span>
        </button>
      ))}
      {otherOpen ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (other.trim()) {
              pick(other.trim())
            }
          }}
        >
          <Input
            data-testid="cook-other-input"
            autoFocus
            value={other}
            onChange={(event) => setOther(event.target.value)}
            placeholder={translate('boards.cook.otherAnswer', 'Type your own answer…')}
          />
          <Button
            data-testid="cook-other-send"
            size="sm"
            variant="outline"
            type="submit"
            disabled={sent || !other.trim()}
          >
            {translate('boards.cook.send', 'Send')}
          </Button>
        </form>
      ) : (
        <button
          type="button"
          data-testid="cook-other"
          disabled={sent || !keys}
          onClick={() => setOtherOpen(true)}
          className="self-start text-[13px] text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          {translate('boards.cook.otherAnswer', 'Type your own answer…')}
        </button>
      )}
    </div>
  )
}

export function ApprovalButtons({
  prompt,
  keys
}: {
  prompt: Extract<CookPrompt, { kind: 'approval' }>
  keys: ClaudeKeys | null
}): React.ReactNode {
  const [sent, setSent] = useState(false)
  const press = (send: string): void => {
    setSent(true)
    keys?.raw(send)
  }
  return (
    <div className="flex flex-col gap-2.5">
      {prompt.detail ? (
        <pre
          data-testid="cook-approval-command"
          className="rounded-lg border border-status-warning-border bg-background px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap"
        >
          {prompt.detail}
        </pre>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          data-testid="cook-allow"
          size="sm"
          disabled={sent || !keys}
          onClick={() => press(prompt.allow)}
        >
          {translate('boards.cook.allow', 'Allow')}
        </Button>
        {prompt.always ? (
          <Button
            data-testid="cook-always"
            size="sm"
            variant="outline"
            disabled={sent || !keys}
            onClick={() => press(prompt.always ?? prompt.allow)}
          >
            {translate('boards.cook.alwaysAllow', 'Always allow in studio-reel')}
          </Button>
        ) : null}
        <Button
          data-testid="cook-deny"
          size="sm"
          variant="ghost"
          disabled={sent || !keys}
          onClick={() => press(prompt.deny)}
        >
          {translate('boards.cook.deny', 'Deny…')}
        </Button>
      </div>
    </div>
  )
}

/** The plain-text fallback: Claude asked in words, so the answer is words plus Enter. */
export function ReplyBox({ keys }: { keys: ClaudeKeys | null }): React.ReactNode {
  const [text, setText] = useState('')
  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (text.trim()) {
          keys?.message(text.trim())
          setText('')
        }
      }}
    >
      <Input
        data-testid="cook-reply-input"
        value={text}
        disabled={!keys}
        onChange={(event) => setText(event.target.value)}
        placeholder={translate('boards.cook.replyPlaceholder', 'Your answer')}
      />
      <Button
        data-testid="cook-reply-send"
        size="sm"
        variant="outline"
        type="submit"
        disabled={!keys || !text.trim()}
      >
        {translate('boards.cook.send', 'Send')}
      </Button>
    </form>
  )
}
