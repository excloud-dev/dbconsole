const NEEDS_QUOTING_REGEX = /[\n\r",]/g

function normalizeCell(value: unknown): string {
    if (value === null || value === undefined) return ""
    if (typeof value === "boolean") return value ? "true" : "false"
    if (typeof value === "object") {
        try {
            return JSON.stringify(value)
        } catch {
            return ""
        }
    }
    return String(value)
}

function escapeCsvValue(value: string): string {
    if (!NEEDS_QUOTING_REGEX.test(value)) return value
    return `"${value.replace(/"/g, '""')}"`
}

function buildRow(columns: string[], row: Record<string, unknown>): string {
    return columns
        .map((col) => escapeCsvValue(normalizeCell(row[col])))
        .join(",")
}

export function rowsToCsv(columns: string[], rows: Record<string, unknown>[]): string {
    const header = columns.map((col) => escapeCsvValue(col)).join(",")
    const body = rows.map((row) => buildRow(columns, row))
    return [header, ...body].join("\r\n")
}

