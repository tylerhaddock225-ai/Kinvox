'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Lock,
  CheckCircle2,
  AlertCircle,
  ListChecks,
} from 'lucide-react'
import { updateLeadQuestions } from '@/app/(app)/(dashboard)/actions/lead-support'
import {
  LOCKED_FIELDS,
  MAX_LABEL_CHARS,
  MAX_QUESTIONS,
  generateQuestionId,
  type LeadQuestion,
} from '@/lib/lead-questions'

type Props = {
  initial: LeadQuestion[]
}

const BTN           = 'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const BTN_PRIMARY   = `${BTN} bg-indigo-600 text-white hover:bg-indigo-500`
const BTN_GHOST     = `${BTN} text-gray-400 hover:text-white`
const INPUT         = 'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500'

export default function LeadQuestionManager({ initial }: Props) {
  const [questions, setQuestions] = useState<LeadQuestion[]>(initial)
  const [state, action, pending]  = useActionState(updateLeadQuestions, null)
  const formRef = useRef<HTMLFormElement>(null)

  // Mark the form dirty when the local state diverges from what the
  // server last confirmed. Prevents the Save button from being a no-op
  // on first page load and gives the user a clear "unsaved changes" cue.
  const lastSavedRef = useRef<string>(JSON.stringify(initial))
  const currentJson  = useMemo(() => JSON.stringify(questions), [questions])
  const isDirty      = currentJson !== lastSavedRef.current

  useEffect(() => {
    if (state?.status === 'success') lastSavedRef.current = currentJson
  }, [state, currentJson])

  function addQuestion() {
    if (questions.length >= MAX_QUESTIONS) return
    setQuestions([
      ...questions,
      { id: generateQuestionId(), label: '', required: false },
    ])
  }

  function removeQuestion(id: string) {
    setQuestions(questions.filter((q) => q.id !== id))
  }

  function updateLabel(id: string, label: string) {
    setQuestions(questions.map((q) => (q.id === id ? { ...q, label } : q)))
  }

  function toggleRequired(id: string) {
    setQuestions(questions.map((q) => (q.id === id ? { ...q, required: !q.required } : q)))
  }

  function move(id: string, direction: -1 | 1) {
    const idx = questions.findIndex((q) => q.id === id)
    if (idx === -1) return
    const next = idx + direction
    if (next < 0 || next >= questions.length) return
    const copy = [...questions]
    ;[copy[idx], copy[next]] = [copy[next], copy[idx]]
    setQuestions(copy)
  }

  const hasEmptyLabels = questions.some((q) => !q.label.trim())

  return (
    <div className="rounded-xl border border-pvx-border bg-pvx-surface p-5 space-y-5">
      <div className="flex items-center gap-2">
        <ListChecks className="w-4 h-4 text-violet-300" />
        <h3 className="text-sm font-semibold text-white">Lead Questionnaire</h3>
      </div>

      {/* Mandatory fields callout — per Commandment 2, this must be unambiguous. */}
      <div className="rounded-lg border border-pvx-border bg-black/25 p-4 space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-gray-300">
          <Lock className="w-3.5 h-3.5 text-violet-300" />
          <span>Required fields (always on, cannot be removed)</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {LOCKED_FIELDS.map((f) => (
            <span
              key={f}
              className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-200"
            >
              <Lock className="w-2.5 h-2.5" />
              {f}
            </span>
          ))}
        </div>
        <p className="text-[11px] text-gray-500">
          Every lead magnet form collects Name, Email, and Phone. These are mandatory by platform policy and cannot be disabled. Additional questions you define below appear underneath them on the public form.
        </p>
      </div>

      {/* Editable custom questions */}
      <form ref={formRef} action={action} className="space-y-3">
        <input type="hidden" name="questions_json" value={JSON.stringify(questions)} />

        {questions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-pvx-border bg-black/25 p-6 text-center text-xs text-gray-500">
            No custom questions yet. Add one below to qualify leads beyond the required fields.
          </div>
        ) : (
          <ul className="space-y-2">
            {questions.map((q, idx) => {
              const labelOver = q.label.length > MAX_LABEL_CHARS
              return (
                <li
                  key={q.id}
                  className="rounded-lg border border-pvx-border bg-black/25 p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-gray-500 w-5 text-center shrink-0">
                      {idx + 1}.
                    </span>
                    <input
                      type="text"
                      value={q.label}
                      placeholder="e.g. Preferred contact time?"
                      maxLength={MAX_LABEL_CHARS + 20}
                      onChange={(e) => updateLabel(q.id, e.target.value)}
                      className={INPUT}
                    />
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => move(q.id, -1)}
                        disabled={idx === 0}
                        aria-label="Move up"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(q.id, 1)}
                        disabled={idx === questions.length - 1}
                        aria-label="Move down"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeQuestion(q.id)}
                        aria-label="Remove question"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-rose-400 hover:bg-rose-400/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pl-7">
                    <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={q.required}
                        onChange={() => toggleRequired(q.id)}
                        className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-gray-900"
                      />
                      <span>Required answer</span>
                    </label>
                    {labelOver && (
                      <span className="text-[11px] text-rose-300">
                        Label is too long (&gt; {MAX_LABEL_CHARS} chars)
                      </span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={addQuestion}
            disabled={questions.length >= MAX_QUESTIONS}
            className={`${BTN_GHOST} border border-pvx-border hover:bg-white/5`}
          >
            <Plus className="w-4 h-4" />
            Add question
            <span className="text-[11px] text-gray-500 ml-1">
              {questions.length}/{MAX_QUESTIONS}
            </span>
          </button>

          <button
            type="submit"
            disabled={pending || !isDirty || hasEmptyLabels}
            className={BTN_PRIMARY}
          >
            {pending ? 'Saving…' : isDirty ? 'Save questionnaire' : 'Saved'}
          </button>
        </div>

        {state?.status === 'error' && (
          <div className="flex items-start gap-2 rounded-md border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{state.error}</span>
          </div>
        )}
        {state?.status === 'success' && !isDirty && (
          <div className="flex items-start gap-2 rounded-md border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{state.message ?? 'Saved.'}</span>
          </div>
        )}
      </form>
    </div>
  )
}
