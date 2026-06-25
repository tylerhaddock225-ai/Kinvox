/**
 * Kinvox proxy (Next.js 16 — formerly `middleware.ts`).
 *
 * Multi-domain routing + auth gating:
 *   - `kinvoxtech.com` / `www.kinvoxtech.com` / `localhost`    → marketing
 *   - `app.kinvoxtech.com` / `sandbox.kinvoxtech.com`          → app
 *   - `app.localhost`                                           → app (dev)
 *
 * Two-stage pipeline per request:
 *   1. Hostname gate (here). Marketing requests for non-marketing paths
 *      307 to the app subdomain; app requests pass straight through to
 *      the auth stage.
 *   2. Auth / sorting-hat (see `@/lib/supabase/session#updateSession`).
 *      Decides where a signed-in user belongs based on their role and
 *      org state, and bounces unsigned-in requests to /login.
 *
 * Invariant: the `(marketing)` route tree is unreachable on an app host.
 * A post-hoc assertion below forces a /login redirect if a marketing
 * path ever slips through updateSession — it shouldn't, but we shout
 * loudly if it does.
 *
 * Shared paths (`/api/*`, `/_next/*`, static assets) bypass the host
 * rewrite so webhooks keep working on whichever host receives them.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/session'

const PROD_APP_HOSTS = new Set(['app.kinvoxtech.com', 'sandbox.kinvoxtech.com'])

function splitHost(host: string): { name: string; port: string } {
  const [name, port] = host.toLowerCase().split(':')
  return { name, port: port ? `:${port}` : '' }
}

function isAppHost(host: string): boolean {
  const { name } = splitHost(host)
  if (PROD_APP_HOSTS.has(name)) return true
  return name === 'app.localhost' || name.endsWith('.app.localhost')
}

function isSharedPath(pathname: string): boolean {
  return pathname.startsWith('/api/')
    || pathname.startsWith('/_next/')
    || pathname === '/favicon.ico'
    || pathname === '/icon.svg'
    || pathname === '/robots.txt'
    || pathname === '/sitemap.xml'
}

function isMarketingPath(pathname: string): boolean {
  return pathname === '/' || pathname === '/apply' || pathname.startsWith('/apply/')
}

function buildUrlOnHost(request: NextRequest, newName: string): string {
  const { port } = splitHost(request.headers.get('host') ?? '')
  const protocol = request.nextUrl.protocol || 'http:'
  const pathAndQuery = `${request.nextUrl.pathname}${request.nextUrl.search}`
  return `${protocol}//${newName}${port}${pathAndQuery}`
}

function hostRedirect(targetUrl: string): NextResponse {
  return new NextResponse(null, {
    status: 307,
    headers: { Location: targetUrl },
  })
}

function appHostFor(request: NextRequest): string {
  const { name } = splitHost(request.headers.get('host') ?? '')
  if (name === 'localhost' || name === '127.0.0.1') return 'app.localhost'
  return 'app.kinvoxtech.com'
}

export async function proxy(request: NextRequest) {
  const host = request.headers.get('host') ?? ''
  const pathname = request.nextUrl.pathname
  const appHost = isAppHost(host)

  if (isSharedPath(pathname)) {
    return appHost ? updateSession(request) : NextResponse.next()
  }

  if (appHost) {
    const response = await updateSession(request)
    // Assertion: updateSession's sorting hat always redirects `/`,
    // `/onboarding`, `/pending-invite`. If a marketing path ever
    // returns a non-redirect response, force /login instead of
    // rendering the (marketing) tree on an app host.
    const isRedirect = response.status >= 300 && response.status < 400
    if (!isRedirect && isMarketingPath(pathname)) {
      return new NextResponse(null, { status: 307, headers: { Location: '/login' } })
    }
    return response
  }

  // Marketing host. Anything that isn't `/` or `/apply*` is an app
  // route that landed on the wrong subdomain — bounce to the app host
  // (preserving path + query so invite/?token=… links survive).
  if (!isMarketingPath(pathname)) {
    return hostRedirect(buildUrlOnHost(request, appHostFor(request)))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
