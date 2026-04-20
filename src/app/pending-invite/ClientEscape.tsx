'use client'

import { useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'

// Final safety net. The server-side guard in page.tsx already redirects
// HQ admins to /admin-hq before this component ever renders — but if the
// user somehow lands here with a valid session (stale CDN snapshot,
// BFCache replay despite no-store, router replacement from a client
// navigation), this re-runs the same check in the browser against the
// same cookies the middleware uses, then hard-navigates via window.location
// to bypass any Next.js soft-router cache.
export default function ClientEscape() {
  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )

    let cancelled = false

    ;(async () => {
      // Force refresh the locally-cached session so getUser below runs
      // against the freshest access token, not whatever the in-memory
      // GoTrueClient was holding from the prior page.
      await supabase.auth.refreshSession().catch(() => null)

      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled || !user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('system_role')
        .eq('id', user.id)
        .single<{ system_role: string | null }>()

      if (cancelled) return

      if (profile?.system_role) {
        // Hard navigation — bypasses the Next.js router cache so the
        // new page is a real server render, not a client-side prefetch.
        window.location.href = '/admin-hq'
      }
    })().catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
