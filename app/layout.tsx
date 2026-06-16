import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Nano Market ATX — Operations',
  description: 'Live sales dashboard for Nano Market ATX locations',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="scanlines min-h-screen bg-[#0a0e1a]">
        {children}
      </body>
    </html>
  )
}
