import type { KeyBinding } from './types'

const KEY_ALIASES: Record<string, string> = {
  cmd: 'Meta',
  command: 'Meta',
  meta: 'Meta',
  win: 'Meta',
  windows: 'Meta',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  option: 'Alt',
  alt: 'Alt',
  shift: 'Shift',
  mod: 'Mod',
}

function normalizeToken(token: string): string {
  return token.trim().toLowerCase()
}

export function parseBinding(raw: string): KeyBinding | null {
  if (!raw) return null
  const parts = raw.split('+').map(normalizeToken).filter(Boolean)
  if (!parts.length) return null

  let mod = false
  let ctrl = false
  let meta = false
  let alt = false
  let shift = false
  let key: string | null = null

  for (const part of parts) {
    const alias = KEY_ALIASES[part] || part
    switch (alias.toLowerCase()) {
      case 'mod':
        mod = true
        break
      case 'ctrl':
        ctrl = true
        break
      case 'meta':
        meta = true
        break
      case 'alt':
        alt = true
        break
      case 'shift':
        shift = true
        break
      default:
        key = alias.length === 1 ? alias : alias
        break
    }
  }

  if (!key) return null

  return {
    raw,
    key,
    mod,
    ctrl,
    meta,
    alt,
    shift,
  }
}

