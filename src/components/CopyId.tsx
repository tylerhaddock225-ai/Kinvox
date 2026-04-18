'use client'

import { useState, type MouseEvent } from 'react'
import { Check } from 'lucide-react'

interface Props {
  id:         string | null | undefined
  className?: string
}

export default function CopyId({ id, className = '' }: Props) {
  const [copied, setCopied] = useState(false)

  if (!id) {
    return <span className={`font-mono text-gray-600 ${className}`}>—</span>
  }

  async function handleClick(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    e.preventDefault()
    try {
      await navigator.clipboard.writeText(id!)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard API unavailable — silently ignore
    }
  }

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={handleClick}
        title="Copy ID"
        className={`cursor-copy font-mono text-gray-500 hover:text-violet-400 underline decoration-dotted underline-offset-4 transition-colors ${className}`}
      >
        {id}
      </button>
      {copied && (
        <>
          <Check className="w-3 h-3 ml-1 text-emerald-400" />
          <span className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded border border-pvx-border bg-pvx-surface px-2 py-0.5 text-[10px] font-sans text-gray-200 shadow-lg">
            Copied!
          </span>
        </>
      )}
    </span>
  )
}
