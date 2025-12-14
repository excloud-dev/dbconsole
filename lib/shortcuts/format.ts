import type { KeyBinding, Runtime } from './types'

export function formatBinding(binding: KeyBinding, runtime: Runtime, opts?: { isMac?: boolean }): string {
  const isMac =
    opts?.isMac ??
    (typeof navigator !== 'undefined'
      ? /mac/i.test(navigator.platform)
      : runtime === 'desktop' && typeof process !== 'undefined' && process.platform === 'darwin')

  const parts: string[] = []
  const add = (label: string) => parts.push(label)

  const useSymbols = isMac

  if (binding.mod) add(useSymbols ? '⌘' : 'Mod')
  if (binding.meta) add(useSymbols ? '⌘' : 'Cmd')
  if (binding.ctrl) add(useSymbols ? '⌃' : 'Ctrl')
  if (binding.alt) add(useSymbols ? '⌥' : 'Alt')
  if (binding.shift) add(useSymbols ? '⇧' : 'Shift')

  if (binding.key && binding.key !== 'Mod') {
    const keyLabel = binding.key.length === 1 ? binding.key.toUpperCase() : binding.key
    add(keyLabel)
  }

  return parts.join(useSymbols ? '' : '+')
}

