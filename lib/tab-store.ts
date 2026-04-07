// Unified tab persistence model.
//
// Until Phase 4 we stored tabs as a raw JSON blob under
// `db-console-tabs-v1` and the active tab id under
// `db-console-active-tab-v1`. That worked for the v0.6 tab features but
// breaks down once we want grouping, MRU ordering, pin state, status pills,
// and rename history persisted alongside.
//
// This module owns:
//   - the TabWorkspace shape (tabs + groups + activeTabId + mruOrder)
//   - the v1 → v2 migration (so users keep their tabs after upgrading)
//   - load / save helpers that wrap localStorage with try/catch
//
// All consumers should go through `loadWorkspace()` and `saveWorkspace()`.
// We deliberately don't ship a React hook here because db-console.tsx already
// owns the tab state — the hook would force a refactor of the entire file.

import type { Tab } from '@/components/query-tabs'

export type TabGroup = {
    id: string
    name: string
    /** A user-pickable color for the group divider. */
    color: string
    collapsed?: boolean
}

export type TabWorkspace = {
    /** Schema version; bump when we change the persisted shape. */
    version: 2
    tabs: Tab[]
    groups: TabGroup[]
    activeTabId: string | null
    /** Tab ids in most-recently-focused order (head = most recent). */
    mruOrder: string[]
}

const KEY_V2 = 'db-console-workspace-v2'
const KEY_V1_TABS = 'db-console-tabs-v1'
const KEY_V1_ACTIVE = 'db-console-active-tab-v1'

export function emptyWorkspace(): TabWorkspace {
    return { version: 2, tabs: [], groups: [], activeTabId: null, mruOrder: [] }
}

/**
 * Read the persisted workspace. Falls back through:
 *   1. v2 blob (`db-console-workspace-v2`)
 *   2. v1 tabs + active tab keys, migrated to v2 shape
 *   3. an empty workspace
 *
 * Always returns a valid TabWorkspace, never throws. Returns null only when
 * `localStorage` is unavailable (SSR / private windows).
 */
export function loadWorkspace(): TabWorkspace | null {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
        return null
    }

    try {
        const v2 = window.localStorage.getItem(KEY_V2)
        if (v2) {
            const parsed = JSON.parse(v2) as TabWorkspace | null
            if (parsed && parsed.version === 2 && Array.isArray(parsed.tabs)) {
                return normalize(parsed)
            }
        }
    } catch (e) {
        console.error('Failed to read workspace v2; will try v1 fallback', e)
    }

    try {
        const v1Tabs = window.localStorage.getItem(KEY_V1_TABS)
        if (v1Tabs) {
            const tabs = JSON.parse(v1Tabs) as Tab[]
            const activeTabId = window.localStorage.getItem(KEY_V1_ACTIVE)
            const ws: TabWorkspace = {
                version: 2,
                tabs: Array.isArray(tabs) ? tabs : [],
                groups: [],
                activeTabId,
                mruOrder: activeTabId ? [activeTabId] : [],
            }
            return normalize(ws)
        }
    } catch (e) {
        console.error('Failed to migrate workspace from v1', e)
    }

    return emptyWorkspace()
}

export function saveWorkspace(ws: TabWorkspace): void {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return
    try {
        window.localStorage.setItem(KEY_V2, JSON.stringify(ws))
    } catch (e) {
        console.error('Failed to save workspace', e)
    }
}

/**
 * Move a tab id to the head of the MRU list. Returns a new array; safe to
 * call from React state setters.
 */
export function touchMru(mru: string[], tabId: string): string[] {
    const filtered = mru.filter((id) => id !== tabId)
    filtered.unshift(tabId)
    return filtered
}

/**
 * Drop a tab id from the MRU list. Returns a new array.
 */
export function dropFromMru(mru: string[], tabId: string): string[] {
    return mru.filter((id) => id !== tabId)
}

function normalize(ws: TabWorkspace): TabWorkspace {
    // Defensive: drop mru entries that don't reference an existing tab so the
    // list doesn't grow unbounded after deletes that missed the cleanup.
    const tabIds = new Set(ws.tabs.map((t) => t.id))
    const mruOrder = ws.mruOrder.filter((id) => tabIds.has(id))
    return { ...ws, mruOrder, version: 2 }
}
