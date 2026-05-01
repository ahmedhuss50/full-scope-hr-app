import { type NextRequest, NextResponse } from 'next/server'
import { updateSupabaseSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  const response = await updateSupabaseSession(request)

  // Protect the authenticated app area.
  const { pathname } = request.nextUrl
  if (pathname.startsWith('/app')) {
    // Session cookie will be refreshed by updateSupabaseSession above.
    // In the layout we'll re-check and redirect if not signed in.
  }
  return response
}

export const config = {
  matcher: [
    // Run on everything except static assets and Supabase callbacks
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
