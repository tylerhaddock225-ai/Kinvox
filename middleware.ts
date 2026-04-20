import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  // /api/auth/force-sync is excluded so middleware's session-refresh + redirect
  // logic can never interfere with the manual sorting-hat recovery route.
  // The route handler does its own refreshSession() + profile lookup.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth/force-sync).*)'],
}
