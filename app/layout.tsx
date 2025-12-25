import type React from "react"
import type { Metadata, Viewport } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import { Analytics } from "@vercel/analytics/next"
import { Toaster } from "@/components/ui/toaster"
import { WebUpdateNotification } from "@/components/web-update-notification"
import { ServiceWorkerProvider } from "@/components/service-worker-provider"
import { ThemeProvider } from "@/components/theme-provider"
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
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full overflow-hidden`} suppressHydrationWarning>
      <body className={`font-sans antialiased h-full overflow-hidden bg-background`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem={true}
          storageKey="theme"
          disableTransitionOnChange={false}
          enableColorScheme={false}
        >
          <ServiceWorkerProvider>
            {children}
            <WebUpdateNotification />
            <Toaster />
            <Analytics />
          </ServiceWorkerProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
