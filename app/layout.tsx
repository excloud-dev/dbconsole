import type React from "react"
import type { Metadata, Viewport } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import { Analytics } from "@vercel/analytics/next"
import { Toaster } from "@/components/ui/toaster"
import "./globals.css"

export const metadata: Metadata = {
  title: "dbconsole - Database Query Tool",
  description: "Lightweight read-only database console for excloud",
}

export const viewport: Viewport = {
  themeColor: "#f5f5f4",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full overflow-hidden`}>
      <body className={`font-sans antialiased h-full overflow-hidden bg-stone-50`}>
        {children}
        <Toaster />
        <Analytics />
      </body>
    </html>
  )
}
