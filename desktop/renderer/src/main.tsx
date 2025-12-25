import React from 'react'
import ReactDOM from 'react-dom/client'
import '@/app/globals.css'
import { DbConsole } from '@/components/db-console'
import { Toaster } from '@/components/ui/toaster'
import { ShortcutsProvider } from '@/components/shortcuts/ShortcutsProvider'
import { ThemeProvider } from '@/components/theme-provider'

// Mirror the Next.js layout assumptions (full-height root + overflow clipping).
document.documentElement.classList.add('h-full', 'overflow-hidden')
document.body.classList.add('h-full', 'overflow-hidden', 'bg-background', 'font-sans', 'antialiased')
document.getElementById('root')?.classList.add('h-full', 'overflow-hidden')

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem={true}
            storageKey="theme"
            disableTransitionOnChange={false}
            enableColorScheme={false}
        >
            <ShortcutsProvider runtime="desktop">
                <main className="h-full w-full bg-background">
                    <DbConsole />
                </main>
            </ShortcutsProvider>
            <Toaster />
        </ThemeProvider>
    </React.StrictMode>,
)
