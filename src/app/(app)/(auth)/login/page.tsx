'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'
import { login } from '../actions'

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    setError(null)
    const result = await login(formData)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-white">Welcome back</h1>
        <p className="text-sm text-gray-400 mt-1">Sign in to your Kinvox account</p>
      </div>

      <form action={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Email</label>
          <input
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            className="w-full rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          />
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <label className="block text-xs font-medium text-gray-400">Password</label>
            <Link href="/forgot-password" className="text-xs text-emerald-400 hover:text-emerald-300">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <input
              name="password"
              type={showPassword ? 'text' : 'password'}
              required
              placeholder="••••••••"
              className="w-full rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
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
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
