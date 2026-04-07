// Postgres type OID → semantic kind, plus a couple of helpers used by the
// data grid's rich cell renderers.
//
// We deliberately do NOT pull `pg-types` at runtime — it's a heavy package
// and the few OIDs we care about are stable across pg versions. The numbers
// here come from `select oid, typname from pg_type` and have been used since
// pg 7.x. They are part of the Postgres ABI and won't change.
//
// Array OIDs in pg are typically the element OID + 1, but the safer
// approach is to maintain an explicit element→array map for the types we
// actually render. Anything not in here falls through to the plain
// scalar/array handling in the grid.

export type PgTypeKind =
    | 'jsonb'
    | 'json'
    | 'uuid'
    | 'bytea'
    | 'inet'
    | 'cidr'
    | 'interval'
    | 'int4range'
    | 'int8range'
    | 'numrange'
    | 'tsrange'
    | 'tstzrange'
    | 'daterange'
    | 'array'
    | 'scalar'

export const PG_OID = {
    JSON: 114,
    JSONB: 3802,
    UUID: 2950,
    BYTEA: 17,
    INET: 869,
    CIDR: 650,
    INTERVAL: 1186,
    INT4RANGE: 3904,
    NUMRANGE: 3906,
    TSRANGE: 3908,
    TSTZRANGE: 3910,
    DATERANGE: 3912,
    INT8RANGE: 3926,
} as const

// pg array OIDs (typarray for the corresponding element types).
const ARRAY_OIDS = new Set<number>([
    1000, // boolean[]
    1001, // bytea[]
    1002, // char[]
    1003, // name[]
    1005, // int2[]
    1006, // int2vector[]
    1007, // int4[]
    1008, // regproc[]
    1009, // text[]
    1010, // tid[]
    1011, // xid[]
    1012, // cid[]
    1013, // oidvector[]
    1014, // bpchar[]
    1015, // varchar[]
    1016, // int8[]
    1017, // point[]
    1018, // lseg[]
    1019, // path[]
    1020, // box[]
    1021, // float4[]
    1022, // float8[]
    1023, // abstime[]
    1024, // reltime[]
    1025, // tinterval[]
    1027, // polygon[]
    1028, // oid[]
    1040, // macaddr[]
    1041, // inet[]
    651,  // cidr[]
    1115, // timestamp[]
    1182, // date[]
    1183, // time[]
    1185, // timestamptz[]
    1187, // interval[]
    1231, // numeric[]
    1270, // timetz[]
    2951, // uuid[]
    3807, // jsonb[]
    199,  // json[]
])

export function isArrayOid(oid: number): boolean {
    return ARRAY_OIDS.has(oid)
}

export function pgTypeKind(oid: number | undefined): PgTypeKind {
    if (oid === undefined || oid === 0) return 'scalar'
    switch (oid) {
        case PG_OID.JSONB:
            return 'jsonb'
        case PG_OID.JSON:
            return 'json'
        case PG_OID.UUID:
            return 'uuid'
        case PG_OID.BYTEA:
            return 'bytea'
        case PG_OID.INET:
            return 'inet'
        case PG_OID.CIDR:
            return 'cidr'
        case PG_OID.INTERVAL:
            return 'interval'
        case PG_OID.INT4RANGE:
            return 'int4range'
        case PG_OID.INT8RANGE:
            return 'int8range'
        case PG_OID.NUMRANGE:
            return 'numrange'
        case PG_OID.TSRANGE:
            return 'tsrange'
        case PG_OID.TSTZRANGE:
            return 'tstzrange'
        case PG_OID.DATERANGE:
            return 'daterange'
    }
    if (isArrayOid(oid)) return 'array'
    return 'scalar'
}

/**
 * Humanize a Postgres `interval` value. The pg driver returns intervals as
 * objects like `{ years, months, days, hours, minutes, seconds, milliseconds }`.
 * We render the non-zero pieces compactly: `1y 2mo 3d`, `4h 5m`, etc.
 */
export function humanizeInterval(value: unknown): string {
    if (value == null) return ''
    if (typeof value === 'string') return value
    if (typeof value !== 'object') return String(value)

    const v = value as Record<string, number | undefined>
    const parts: string[] = []
    if (v.years) parts.push(`${v.years}y`)
    if (v.months) parts.push(`${v.months}mo`)
    if (v.days) parts.push(`${v.days}d`)
    if (v.hours) parts.push(`${v.hours}h`)
    if (v.minutes) parts.push(`${v.minutes}m`)
    if (v.seconds) {
        const ms = v.milliseconds ?? 0
        parts.push(ms ? `${v.seconds}.${String(ms).padStart(3, '0')}s` : `${v.seconds}s`)
    } else if (v.milliseconds) {
        parts.push(`${v.milliseconds}ms`)
    }
    if (parts.length === 0) return '0s'
    return parts.join(' ')
}

/**
 * Format a Postgres range value. The pg driver returns ranges as strings like
 * `[1,10)`, `[2024-01-01,2024-12-31)`. We just clean up the bracket spacing
 * for readability.
 */
export function formatRange(value: unknown): string {
    if (value == null) return ''
    const s = String(value)
    return s
        .replace(/^\[/, '[ ')
        .replace(/\)$/, ' )')
        .replace(/\]$/, ' ]')
        .replace(/\($/, '( ')
        .replace(/,/g, ', ')
}

/**
 * Convert a Buffer / Uint8Array bytea value to a hex string. Other shapes
 * fall back to their string representation. Used by the bytea cell renderer.
 */
export function bytesToHex(value: unknown): string {
    if (value == null) return ''
    if (typeof value === 'string') {
        // pg may already return bytea as a `\x...` hex literal.
        if (value.startsWith('\\x')) return value.slice(2)
        return value
    }
    const u8 =
        value instanceof Uint8Array
            ? value
            : Array.isArray(value)
                ? Uint8Array.from(value as number[])
                : null
    if (!u8) return String(value)
    let hex = ''
    for (let i = 0; i < u8.length; i++) hex += u8[i].toString(16).padStart(2, '0')
    return hex
}

export function bytesToBase64(value: unknown): string {
    if (value == null) return ''
    if (value instanceof Uint8Array) {
        if (typeof Buffer !== 'undefined') return Buffer.from(value).toString('base64')
        let bin = ''
        for (let i = 0; i < value.length; i++) bin += String.fromCharCode(value[i])
        return btoa(bin)
    }
    if (typeof value === 'string') {
        if (value.startsWith('\\x')) {
            // Convert hex literal → base64.
            const hex = value.slice(2)
            const bytes = new Uint8Array(hex.length / 2)
            for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
            return bytesToBase64(bytes)
        }
        return value
    }
    return String(value)
}
