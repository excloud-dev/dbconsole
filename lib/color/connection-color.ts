// Stable color derivation for connection identity.
//
// Each connection gets a deterministic HSL color derived from a hash of its
// id. Same connection → same color across sessions and devices, with no
// configuration. Used as:
//   - a 2px left border on tab buttons (so you can tell prod vs staging at a
//     glance without reading the title)
//   - a colored dot in the connection picker, slow query panel, and the
//     forthcoming ⌘P tab switcher
//
// We pick HSL because we can fix S/L for visual consistency (60% saturation,
// 50% lightness — readable on both light and dark themes) and only vary the
// hue across the spectrum.

const HASH_PRIME = 2654435761 // Knuth multiplicative hash constant

function hashString(s: string): number {
    let h = 0
    for (let i = 0; i < s.length; i++) {
        h = Math.imul(h ^ s.charCodeAt(i), HASH_PRIME) >>> 0
    }
    return h >>> 0
}

/**
 * Returns a deterministic CSS color (`hsl(...)`) for a given connection id.
 * The output is stable across runs — the same id always yields the same hue.
 */
export function connectionColor(connectionId: string | null | undefined): string {
    if (!connectionId) return 'hsl(0, 0%, 50%)'
    const hue = hashString(connectionId) % 360
    return `hsl(${hue}, 60%, 50%)`
}

/**
 * Same as {@link connectionColor} but returns the raw hue 0–360. Useful for
 * callers that want to mix in their own saturation/lightness (e.g. faded
 * background variants for tab groups built from a connection palette).
 */
export function connectionHue(connectionId: string | null | undefined): number {
    if (!connectionId) return 0
    return hashString(connectionId) % 360
}
