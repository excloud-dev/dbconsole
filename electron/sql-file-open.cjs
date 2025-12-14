const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024 // 5MB cap to avoid freezing the UI

function isSqlFile(filePath) {
    return path.extname(filePath || '').toLowerCase() === '.sql'
}

function getMaxBytes() {
    const raw = process.env.DBCONSOLE_SQL_OPEN_MAX_BYTES
    const parsed = raw ? Number(raw) : DEFAULT_MAX_BYTES
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BYTES
}

function readSqlFileOrThrow(filePath) {
    if (!isSqlFile(filePath)) {
        const error = new Error('Only .sql files can be opened')
        error.code = 'UNSUPPORTED_EXTENSION'
        throw error
    }

    const stat = fs.statSync(filePath)
    const maxBytes = getMaxBytes()
    if (stat.size > maxBytes) {
        const error = new Error(`SQL file is too large (>${Math.round(maxBytes / (1024 * 1024))}MB)`)
        error.code = 'FILE_TOO_LARGE'
        throw error
    }

    return fs.readFileSync(filePath, 'utf8')
}

function extractSqlPathsFromArgv(app, argv) {
    const startIndex = app.isPackaged ? 1 : 2
    return (argv || []).slice(startIndex).filter((arg) => isSqlFile(arg))
}

function setupSqlFileOpen({ app, dialog, getMainWindow }) {
    const pendingPayloads = []
    let rendererReady = false

    function enqueuePayload(payload) {
        pendingPayloads.push(payload)
        flush()
    }

    function flush() {
        if (!rendererReady) return
        const win = getMainWindow()
        if (!win || win.isDestroyed()) return
        while (pendingPayloads.length) {
            const next = pendingPayloads.shift()
            win.webContents.send('dbconsole:sqlFile:open', next)
        }
    }

    function sendFileIfValid(filePath) {
        try {
            const sql = readSqlFileOrThrow(filePath)
            enqueuePayload({ name: path.basename(filePath), sql })
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to open SQL file'
            dialog.showErrorBox('DBConsole – Failed to open file', message)
        }
    }

    function handleArgv(argv) {
        const paths = extractSqlPathsFromArgv(app, argv)
        paths.forEach(sendFileIfValid)
    }

    // macOS: Finder “Open With…” / double-click
    app.on('open-file', (event, filePath) => {
        event.preventDefault()
        sendFileIfValid(filePath)
    })

    // Initial argv (Windows/Linux)
    handleArgv(process.argv)

    return {
        handleArgv,
        markRendererReady: () => {
            rendererReady = true
            flush()
        },
        openDialogAndSend: async () => {
            const result = await dialog.showOpenDialog({
                properties: ['openFile'],
                filters: [{ name: 'SQL', extensions: ['sql'] }],
            })
            if (result.canceled || !result.filePaths?.length) return null
            const filePath = result.filePaths[0]
            try {
                const sql = readSqlFileOrThrow(filePath)
                const payload = { name: path.basename(filePath), sql }
                enqueuePayload(payload)
                return payload
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to open SQL file'
                dialog.showErrorBox('DBConsole – Failed to open file', message)
                return null
            }
        },
    }
}

module.exports = {
    setupSqlFileOpen,
    readSqlFileOrThrow,
    extractSqlPathsFromArgv,
    getMaxBytes,
}

