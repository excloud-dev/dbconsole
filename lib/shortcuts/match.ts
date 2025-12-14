import type { KeyBinding, Runtime } from './types'

function isInputTarget(target: EventTarget | null): boolean {
  if (!target || !(target as any).tagName) return false
  const el = target as HTMLElement
  const tag = el.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'option') return true
  if ((el as HTMLElement).isContentEditable) return true
  return false
}

function normalizeEventKey(key: string): string {
  if (!key) return ''
  const lower = key.toLowerCase()
  const map: Record<string, string> = {
    ' ': 'space',
  }
  return map[lower] || lower
}

export function matchesBinding(
  binding: KeyBinding,
  event: KeyboardEvent,
  runtime: Runtime,
  opts?: { isMac?: boolean },
): boolean {
  if (!binding) return false

  const isMac =
    opts?.isMac ??
    (typeof navigator !== 'undefined'
      ? /mac/i.test(navigator.platform)
      : typeof process !== 'undefined' && process.platform === 'darwin')

  const key = normalizeEventKey(event.key)
  const targetKey = normalizeEventKey(binding.key)

  const requiredCtrl = binding.ctrl || (binding.mod && !isMac)
  const requiredMeta = binding.meta || (binding.mod && isMac)

  if (requiredCtrl !== event.ctrlKey) return false
  if (requiredMeta !== event.metaKey) return false
  if (binding.alt !== event.altKey) return false
  if (binding.shift !== event.shiftKey) return false

  return key === targetKey
}

export function shouldIgnoreTarget(event: KeyboardEvent, allowInInputs?: boolean): boolean {
  if (allowInInputs) return false
  return isInputTarget(event.target)
}

