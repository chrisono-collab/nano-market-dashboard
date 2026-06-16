import type { Metadata } from 'next'
import './globals.css'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Nano Market ATX — Operations',
  description: 'Live sales dashboard for Nano Market ATX locations',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Never let an auth/config error crash the whole app shell — just render
  // without the signed-in bar. The middleware handles actual access control.
  let user: { email?: string | null } | null = null
  try {
    const supabase = await createClient()
    user = (await supabase.auth.getUser()).data.user
  } catch (err) {
    console.error('[auth] layout getUser failed:', err)
  }

  return (
    <html lang="en">
      <body className="scanlines min-h-screen bg-[#0a0e1a]">
        {user && (
          <div className="flex items-center justify-end gap-3 px-6 py-2 border-b border-[#1f2937]">
            <span className="mono text-xs text-gray-500">{user.email}</span>
            <form
              action={async () => {
                'use server'
                const sb = await createClient()
                await sb.auth.signOut()
                redirect('/login')
              }}
            >
              <button
                type="submit"
                className="mono text-xs text-gray-400 hover:text-green-400 border border-[#1f2937] hover:border-green-500/50 rounded px-2 py-1 transition-colors"
              >
                Sign out
              </button>
            </form>
          </div>
        )}
        {children}
      </body>
    </html>
  )
}
