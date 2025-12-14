declare module './sql-file-open.cjs' {
  import type { App, Dialog } from 'electron'

  export function setupSqlFileOpen(args: {
    app: App
    dialog: Dialog
    getMainWindow: () => Electron.BrowserWindow | null
  }): {
    handleArgv: (argv: string[]) => void
    markRendererReady: () => void
    openDialogAndSend: () => Promise<{ name: string; sql: string } | null>
  }

  export function readSqlFileOrThrow(filePath: string): string
  export function extractSqlPathsFromArgv(app: App, argv: string[]): string[]
  export function getMaxBytes(): number
}

