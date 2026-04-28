'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import AuthLoading from '@/components/AuthLoading'

// Client-side gate for the /pending-invite route. The server render
// already redirects HQ admins in page.tsx; this is the belt-and-
// suspenders layer that handles the case where the server's profile
// read returned stale data.
//
// Until the client-side check resolves, render AuthLoading — never
// the "Pending invitation" copy. That eliminates the flicker where
// a just-logged-in platform_owner briefly sees the orphan screen
// before window.location swaps them over to /hq.
export default function PendingInviteGate({ children }: { children: ReactNode }) {
  const [resolved, setResolved] = useState(false)

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )

    let cancelled = false

    ;(async () => {
      await supabase.auth.refreshSession().catch(() => null)

      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled) return
      if (!user) {
        setResolved(true)
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('system_role')
        .eq('id', user.id)
        .single<{ system_role: string | null }>()

      if (cancelled) return

      if (profile?.system_role) {
        // Hard nav — bypasses the Next.js soft router so the new
        // page is a fresh server render, not a stale prefetch.
        window.location.href = '/hq'
        return
      }

      setResolved(true)
    })().catch(() => {
      if (!cancelled) setResolved(true)
    })

    return () => {
      cancelled = true
    }
  }, [])

  if (!resolved) return <AuthLoading label="Checking your account…" />

  return <>{children}</>
}
