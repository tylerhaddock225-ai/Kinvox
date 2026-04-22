'use client'

import { useMemo, useState, type MouseEvent } from 'react'
import { Copy, Check, ExternalLink, AlertCircle } from 'lucide-react'
import { updateLeadMagnet } from '@/app/(app)/(admin)/admin-hq/actions/lead-magnet'

type LeadMagnetSettings = {
  enabled?:  boolean
  headline?: string
  features?: string[]
}

type Props = {
  orgId:        string
  slug:         string | null
  settings:     LeadMagnetSettings | null
  websiteUrl:   string | null
  landingBase:  string   // e.g. https://sandbox.kinvoxtech.com
  errorMessage: string | null
}

export default function OrgLeadCaptureForm({
  orgId,
  slug,
  settings,
  websiteUrl,
  landingBase,
  errorMessage,
}: Props) {
  const [currentSlug, setCurrentSlug] = useState<string>(slug ?? '')

  // The preview/embed snippets update live as the user types the slug —
  // gives them immediate feedback on what the merchant will copy. We never
  // trust this for persistence; the server action re-validates.
  const normalizedSlug = currentSlug.trim().toLowerCase()
  const isSlugEmpty    = normalizedSlug === ''
  const previewUrl = useMemo(
    () => (isSlugEmpty ? null : `${landingBase}/l/${normalizedSlug}`),
    [landingBase, normalizedSlug, isSlugEmpty],
  )
  const embedCode = useMemo(
    () =>
      isSlugEmpty
        ? null
        : `<script src="${landingBase}/widgets/lead-capture.js" data-slug="${normalizedSlug}" async></script>`,
    [landingBase, normalizedSlug, isSlugEmpty],
  )

  const featuresText = (settings?.features ?? []).join('\n')
  const enabledInDb  = !!settings?.enabled && !!slug
  const disabledBadge = !slug
    ? { label: 'Disabled — no slug', tone: 'gray' as const }
    : settings?.enabled
      ? { label: 'Enabled', tone: 'emerald' as const }
      : { label: 'Hidden — toggle off', tone: 'amber' as const }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
            disabledBadge.tone === 'emerald'
              ? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300'
              : disabledBadge.tone === 'amber'
                ? 'border-amber-800/60 bg-amber-950/40 text-amber-300'
                : 'border-pvx-border bg-pvx-surface text-gray-400'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              disabledBadge.tone === 'emerald'
                ? 'bg-emerald-400'
                : disabledBadge.tone === 'amber'
                  ? 'bg-amber-400'
                  : 'bg-gray-500'
            }`}
          />
          {disabledBadge.label}
        </span>
      </div>

      {errorMessage && (
        <div className="flex items-start gap-2 rounded-md border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <form action={updateLeadMagnet} className="space-y-5">
        <input type="hidden" name="org_id" value={orgId} />

        <Field
          label="Slug"
          hint="Lowercase letters, numbers, hyphens. Leave blank to disable the landing page."
        >
          <div className="flex items-stretch rounded-md bg-pvx-surface border border-pvx-border overflow-hidden focus-within:border-violet-500/60 focus-within:ring-1 focus-within:ring-violet-500/40">
            <span className="inline-flex items-center px-3 text-xs text-gray-500 font-mono border-r border-pvx-border bg-pvx-bg/40">
              {landingBase}/l/
            </span>
            <input
              name="slug"
              value={currentSlug}
              onChange={(e) => setCurrentSlug(e.target.value)}
              placeholder="storm-shelters-ok"
              pattern="^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$"
              className="w-full bg-transparent px-3 py-2 text-sm text-gray-100 font-mono focus:outline-none"
            />
          </div>
        </Field>

        <Field label="Landing page enabled">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={enabledInDb}
              className="h-4 w-4 rounded border-pvx-border bg-pvx-bg text-violet-500 focus:ring-violet-500/40"
            />
            <span className="text-sm text-gray-200">
              Show the page at the slug above
            </span>
          </label>
          <p className="mt-1 text-[11px] text-gray-500">
            Auto-falls-back to disabled if the slug is blank.
          </p>
        </Field>

        <Field label="Headline">
          <input
            name="headline"
            defaultValue={settings?.headline ?? 'Check your eligibility'}
            className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
          />
        </Field>

        <Field
          label="Features"
          hint="One per line. These render as bullet points on the lead-magnet page."
        >
          <textarea
            name="features"
            defaultValue={featuresText}
            rows={4}
            placeholder={'Free eligibility check\nSame-day installer match\n...'}
            className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 font-mono focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
          />
        </Field>

        <Field
          label="Website URL"
          hint="Used as the organization's 'Learn more' link on the landing page."
        >
          <input
            name="website_url"
            type="url"
            defaultValue={websiteUrl ?? ''}
            placeholder="https://example.com"
            className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
          />
        </Field>

        <div className="pt-1">
          <button
            type="submit"
            className="inline-flex items-center rounded-md bg-violet-600 hover:bg-violet-500 px-4 py-2 text-sm font-medium text-white transition-colors"
          >
            Save lead capture
          </button>
        </div>
      </form>

      {/* Preview + embed live under the form. They read the same state
          the user is editing, so typing a new slug updates both before the
          save even hits the server. */}
      <section className="rounded-lg border border-pvx-border bg-pvx-surface/60 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
          Preview link
        </h3>
        {previewUrl ? (
          <div className="mt-2 flex items-center gap-2">
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-mono text-violet-300 hover:text-violet-200"
            >
              {previewUrl}
              <ExternalLink className="w-3 h-3" />
            </a>
            <CopyButton text={previewUrl} label="Copy link" />
          </div>
        ) : (
          <p className="mt-2 text-xs text-gray-500">
            Set a slug above to get a preview link.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-pvx-border bg-pvx-surface/60 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
          Embed snippet
        </h3>
        {embedCode ? (
          <>
            <p className="mt-1 text-[11px] text-gray-500">
              Drop this into the organization's website to embed the capture widget.
            </p>
            <div className="mt-2 flex items-start gap-2">
              <pre className="flex-1 overflow-auto rounded-md border border-pvx-border bg-pvx-bg p-3 text-[11px] leading-relaxed text-gray-200 font-mono whitespace-pre-wrap break-all">
{embedCode}
              </pre>
              <CopyButton text={embedCode} label="Copy snippet" />
            </div>
          </>
        ) : (
          <p className="mt-2 text-xs text-gray-500">
            Set a slug to generate an embed snippet.
          </p>
        )}
      </section>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label:     string
  hint?:     string
  children:  React.ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium uppercase tracking-wider text-gray-400 mb-1.5">
        {label}
      </span>
      {children}
      {hint && <p className="mt-1 text-[11px] text-gray-500">{hint}</p>}
    </label>
  )
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  async function handleClick(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard API unavailable — silently ignore
    }
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      className="shrink-0 inline-flex items-center gap-1 rounded-md border border-pvx-border bg-pvx-surface px-2 py-1 text-[11px] font-medium text-gray-300 hover:text-white hover:bg-pvx-border transition-colors"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : label}
    </button>
  )
}
