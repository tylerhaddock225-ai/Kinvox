'use client'

import { useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'

// Reusable password field with a show/hide eye toggle. Spreads arbitrary
// input props so it works in BOTH modes:
//   • controlled   — pass value + onChange (e.g. the invite accept form)
//   • uncontrolled — pass name only, read via FormData in a form action
//     (e.g. login + reset-password)
// The shell mirrors the original inline pattern in login/page.tsx so visual
// alignment is preserved. `pr-10` is always appended to the caller's
// className so the toggle button never overlaps the typed text.
type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

export default function PasswordInput({ className, ...props }: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false)

  return (
    <div className="relative">
      <input
        {...props}
        type={showPassword ? 'text' : 'password'}
        className={[className, 'pr-10'].filter(Boolean).join(' ')}
      />
      <button
        type="button"
        onClick={() => setShowPassword((v) => !v)}
        aria-label={showPassword ? 'Hide password' : 'Show password'}
        aria-pressed={showPassword}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-500 hover:text-emerald-400 focus:outline-none focus:text-emerald-400 transition-colors"
      >
        {showPassword
          ? <EyeOff className="w-4 h-4" aria-hidden="true" />
          : <Eye    className="w-4 h-4" aria-hidden="true" />
        }
      </button>
    </div>
  )
}
