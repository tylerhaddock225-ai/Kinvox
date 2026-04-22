import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

const PROD_APP_HOSTS = new Set(['app.kinvoxtech.com', 'sandbox.kinvoxtech.com'])

function splitHost(host: string): { name: string; port: string } {
  const [name, port] = host.toLowerCase().split(':')
  return { name, port: port ? `:${port}` : '' }
}

function isAppHost(host: string): boolean {
  const { name } = splitHost(host)
  if (PROD_APP_HOSTS.has(name)) return true
  // Local dev: `app.localhost` (and any subdomain of it) routes to the app.
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

function rewriteHost(request: NextRequest, newName: string): string {
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

function marketingHostFor(request: NextRequest): string {
  const { name } = splitHost(request.headers.get('host') ?? '')
  if (name === 'app.localhost' || name.endsWith('.app.localhost')) return 'localhost'
  return 'kinvoxtech.com'
}

export async function proxy(request: NextRequest) {
  const host = request.headers.get('host') ?? ''
  const pathname = request.nextUrl.pathname
  const appHost = isAppHost(host)

  // /api, /_next, and static assets are served on whichever host they land on.
  // Webhook receivers depend on this — redirecting them would break integrations.
  if (isSharedPath(pathname)) {
    return appHost ? updateSession(request) : NextResponse.next()
  }

  if (appHost) {
    // /apply is marketing-only, but the page will still render on the
    // app host if someone lands here directly. We don't redirect away
    // because Next dev collapses same-root-host Location headers to
    // relative paths, which would loop. Production lives on truly
    // separate hosts so this path is effectively unreachable there.
    return updateSession(request)
  }

  // Marketing host: only the landing page and /apply render here.
  // Everything else is an app route and bounces to the app subdomain.
  if (!isMarketingPath(pathname)) {
    return hostRedirect(rewriteHost(request, appHostFor(request)))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
