'use client'

import { useState, type MouseEvent } from 'react'
import { Copy, Check } from 'lucide-react'

type Props = {
  text:   string
  label?: string
}

export function CopyButton({ text, label = 'Copy' }: Props) {
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
      aria-label={copied ? 'Copied' : label}
      className="shrink-0 inline-flex items-center gap-1 rounded-md border border-pvx-border bg-pvx-surface px-2 py-1 text-[11px] font-medium text-gray-300 hover:text-white hover:bg-pvx-border transition-colors"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : label}
    </button>
  )
}
