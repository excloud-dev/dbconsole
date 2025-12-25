import { DbConsole } from "@/components/db-console"
import { notFound } from "next/navigation"
import { WebShortcutsRoot } from "@/components/shortcuts/WebShortcutsRoot"

export default function Home() {
  if ((process.env.DBCONSOLE_SYNC_SERVER_ONLY ?? "").trim() === "1") {
    notFound()
  }

  return (
    <main className="h-full w-full bg-background">
      <WebShortcutsRoot>
        <DbConsole />
      </WebShortcutsRoot>
    </main>
  )
}
