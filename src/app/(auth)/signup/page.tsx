'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'
import { signup } from '../actions'

const INPUT = "w-full rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent pr-10"

function validatePassword(password: string): string | null {
  if (password.length < 8)            return 'Password must be at least 8 characters.'
  if (!/[A-Z]/.test(password))        return 'Password must contain at least 1 uppercase letter.'
  if (!/[a-z]/.test(password))        return 'Password must contain at least 1 lowercase letter.'
  if (!/[0-9]/.test(password))        return 'Password must contain at least 1 number.'
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least 1 symbol (e.g. !@#$).'
  return null
}

function PasswordInput({ name, placeholder }: { name: string; placeholder: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        name={name}
        type={show ? 'text' : 'password'}
        required
        placeholder={placeholder}
        className={INPUT}
      />
      <button
        type="button"
        onClick={() => setShow(v => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  )
}

export default function SignupPage() {
  const [error, setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const formData = new FormData(e.currentTarget)
    const password        = formData.get('password') as string
    const confirmPassword = formData.get('confirm_password') as string

    const complexityError = validatePassword(password)
    if (complexityError) return setError(complexityError)
    if (password !== confirmPassword) return setError('Passwords do not match.')

    setLoading(true)
    const result = await signup(formData)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-white">Create your account</h1>
        <p className="text-sm text-gray-400 mt-1">Get started with Kinvox for free</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Full name</label>
          <input
            name="full_name"
            type="text"
            required
            placeholder="Alex Johnson"
            className={INPUT}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Email</label>
          <input
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            className={INPUT}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Password</label>
          <PasswordInput name="password" placeholder="Min. 8 chars, uppercase, number, symbol" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Confirm password</label>
          <PasswordInput name="confirm_password" placeholder="Re-enter your password" />
        </div>

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
            <span className="mt-0.5 shrink-0">⚠</span>
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
        >
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="text-center text-sm text-gray-500 mt-6">
        Already have an account?{' '}
        <Link href="/login" className="text-emerald-400 hover:text-emerald-300 font-medium">
          Sign in
        </Link>
      </p>
    </div>
  )
}
