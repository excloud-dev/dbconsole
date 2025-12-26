import { beforeEach, describe, expect, it } from 'vitest'
import { getSetting, getMetaDb, setSetting } from '@/lib/meta-db'
import {
    getShortcutsKeymap,
    resetAllShortcutsOverrides,
    resetShortcutsOverride,
    setShortcutsDisabled,
    setShortcutsKeymap,
    setShortcutsOverride,
} from '@/lib/core/shortcuts-settings'

function resetMetaDb() {
    const db = getMetaDb()
    db.exec(
        'DELETE FROM dbconsole_connections; DELETE FROM dbconsole_queries; DELETE FROM dbconsole_query_runs; DELETE FROM dbconsole_query_tombstones; DELETE FROM dbconsole_settings; DELETE FROM dbconsole_sync_named_queries;',
    )
}

describe('shortcuts-settings', () => {
    beforeEach(() => {
        resetMetaDb()
    })

    it('stores and loads legacy string override values', () => {
        setShortcutsOverride('web', 'query.run', 'Ctrl+Enter')
        expect(getShortcutsKeymap('web')['query.run']).toBe('Ctrl+Enter')
    })

    it('can store object overrides and reads them back', () => {
        setShortcutsKeymap('web', {
            'query.run': { binding: 'Ctrl+Enter', disabled: true },
        })

        const keymap = getShortcutsKeymap('web')
        expect(keymap['query.run']).toEqual({ binding: 'Ctrl+Enter', disabled: true })
    })

    it('disabling preserves an existing legacy binding override', () => {
        setShortcutsOverride('web', 'query.run', 'Ctrl+Enter')
        setShortcutsDisabled('web', 'query.run', true)

        const keymap = getShortcutsKeymap('web')
        expect(keymap['query.run']).toEqual({ binding: 'Ctrl+Enter', disabled: true })

        setShortcutsDisabled('web', 'query.run', false)
        const keymap2 = getShortcutsKeymap('web')
        expect(keymap2['query.run']).toEqual({ binding: 'Ctrl+Enter', disabled: false })
    })

    it('setting an override after disabling preserves the disabled flag', () => {
        setShortcutsDisabled('web', 'query.run', true)
        setShortcutsOverride('web', 'query.run', 'Ctrl+Enter')

        const keymap = getShortcutsKeymap('web')
        expect(keymap['query.run']).toEqual({ binding: 'Ctrl+Enter', disabled: true })
    })

    it('resetShortcutsOverride removes the override entry entirely', () => {
        setShortcutsOverride('web', 'query.run', 'Ctrl+Enter')
        resetShortcutsOverride('web', 'query.run')

        const keymap = getShortcutsKeymap('web')
        expect(keymap['query.run']).toBeUndefined()
    })

    it('resetAllShortcutsOverrides clears runtime keymap', () => {
        setShortcutsOverride('web', 'query.run', 'Ctrl+Enter')
        setShortcutsOverride('web', 'ui.commandPalette', 'Ctrl+K')
        resetAllShortcutsOverrides('web')

        const keymap = getShortcutsKeymap('web')
        expect(keymap).toEqual({})
    })

    it('accepts old persisted JSON without error and keeps values', () => {
        setSetting(
            'shortcuts.keymap.v1',
            JSON.stringify({
                version: 1,
                overrides: {
                    web: {
                        'query.run': 'Ctrl+Enter',
                        'ui.commandPalette': null,
                    },
                },
            }),
        )

        const keymap = getShortcutsKeymap('web')
        expect(keymap['query.run']).toBe('Ctrl+Enter')
        expect(keymap['ui.commandPalette']).toBeNull()
    })

    it('persists with the expected schema key', () => {
        setShortcutsDisabled('web', 'query.run', true)
        const raw = getSetting('shortcuts.keymap.v1')
        expect(raw).toBeTruthy()
    })
})
