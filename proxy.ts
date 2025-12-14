import { NextResponse, type NextRequest } from 'next/server'

const SYNC_SERVER_ONLY_ENV = 'DBCONSOLE_SYNC_SERVER_ONLY'

function isSyncServerOnly(): boolean {
  return (process.env[SYNC_SERVER_ONLY_ENV] ?? '').trim() === '1'
}

function isAllowedInSyncServerOnly(req: NextRequest): boolean {
  const { pathname } = req.nextUrl
  const method = req.method.toUpperCase()

  // Only expose the named-query sync relay endpoints.
  if (pathname === '/api/sync/named-queries/pull' || pathname === '/api/sync/named-queries/push') {
    return method === 'POST' || method === 'OPTIONS'
  }

  return false
}

export function proxy(req: NextRequest) {
  if (!isSyncServerOnly()) return NextResponse.next()

  if (isAllowedInSyncServerOnly(req)) return NextResponse.next()

  // Hide all other routes/UI in sync-server-only mode.
  return new NextResponse('Not Found', { status: 404 })
}

export const config = {
  matcher: ['/:path*'],
}
