'use client'

import { useState } from 'react'
import { createOrganization } from './actions'
import Logo from '@/components/Logo'

export default function OnboardingPage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    setError(null)
    const result = await createOrganization(formData)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-md">

        <div className="flex items-center justify-center gap-3 mb-10">
          <Logo size={36} />
          <span className="text-xl font-semibold text-white">Kinvox</span>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
          <div className="mb-6">
            <h1 className="text-xl font-bold text-white">Set up your organization</h1>
            <p className="text-sm text-gray-400 mt-1">
              This is your workspace. You can invite teammates after setup.
            </p>
          </div>

          <form action={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                Organization name
              </label>
              <input
                name="name"
                type="text"
                required
                placeholder="Acme Corp"
                className="w-full rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">
                A URL-safe slug will be generated automatically.
              </p>
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
              {loading ? 'Creating workspace…' : 'Continue to dashboard →'}
            </button>
          </form>
        </div>

      </div>
    </div>
  )
}
