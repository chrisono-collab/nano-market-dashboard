import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Refreshes the Supabase session cookie on every request AND gates access:
// unauthenticated users are redirected to /login (or get 401 on API routes).
//
// Designed to FAIL CLOSED but never crash: if Supabase is misconfigured or
// errors, we deny access to protected routes (redirect / 401-503) instead of
// throwing a MIDDLEWARE_INVOCATION_FAILED 500.
export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl
  // /api/cron/* has no user session; those routes check CRON_SECRET themselves.
  const isPublic = pathname === '/login' || pathname.startsWith('/auth') || pathname.startsWith('/api/cron/')

  const denyProtected = (status: number, message: string) => {
    if (isPublic) return NextResponse.next({ request })
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: message }, { status })
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('error', message)
    return NextResponse.redirect(url)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Missing config: don't construct the client (it would throw). Fail closed.
  if (!supabaseUrl || !supabaseKey) {
    console.error(
      '[auth] Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Set them in Vercel and REDEPLOY (NEXT_PUBLIC_* vars are inlined at build time).'
    )
    return denyProtected(503, 'Authentication is not configured')
  }

  let supabaseResponse = NextResponse.next({ request })

  try {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    })

    // getUser() validates the token with Supabase (don't trust getSession()).
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    // A "no session" auth error is normal for logged-out users — treat as no
    // user, not a failure. Only unexpected throws hit the catch below.
    if (!user && !isPublic) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      return NextResponse.redirect(url)
    }

    void error
    // Must return supabaseResponse so refreshed auth cookies reach the browser.
    return supabaseResponse
  } catch (err) {
    console.error('[auth] middleware error talking to Supabase:', err)
    return denyProtected(503, 'Authentication service error')
  }
}
