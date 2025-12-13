import React from 'react'
import ReactDOM from 'react-dom/client'
import '@/app/globals.css'
import { DbConsole } from '@/components/db-console'
import { Toaster } from '@/components/ui/toaster'

// Mirror the Next.js layout assumptions (full-height root + overflow clipping).
document.documentElement.classList.add('h-full', 'overflow-hidden')
document.body.classList.add('h-full', 'overflow-hidden', 'bg-stone-50', 'font-sans', 'antialiased')
document.getElementById('root')?.classList.add('h-full', 'overflow-hidden')

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <main className="h-full w-full bg-white">
            <DbConsole />
        </main>
        <Toaster />
    </React.StrictMode>,
)
