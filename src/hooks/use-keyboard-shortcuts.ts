import { useEffect, useCallback } from 'react'
import { toast } from 'sonner'

export interface KeyboardShortcut {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  description: string
  action: () => void
  section?: string
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[], enabled: boolean = true) {
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return

    const matchingShortcut = shortcuts.find(shortcut => {
      const keyMatches = event.key.toLowerCase() === shortcut.key.toLowerCase()
      const ctrlMatches = shortcut.ctrl ? (event.ctrlKey || event.metaKey) : true
      const shiftMatches = shortcut.shift ? event.shiftKey : true
      const altMatches = shortcut.alt ? event.altKey : true

      return keyMatches && ctrlMatches && shiftMatches && altMatches
    })

    if (matchingShortcut) {
      event.preventDefault()
      matchingShortcut.action()
    }
  }, [shortcuts, enabled])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return shortcuts
}

export function getShortcutDisplay(shortcut: KeyboardShortcut): string {
  const parts: string[] = []
  
  if (shortcut.ctrl) parts.push('⌘')
  if (shortcut.shift) parts.push('⇧')
  if (shortcut.alt) parts.push('⌥')
  parts.push(shortcut.key.toUpperCase())
  
  return parts.join(' ')
}

export const globalShortcuts = (
  navigate: (route: string) => void,
  openCommandPalette: () => void,
  openShortcutsDialog?: () => void,
  toggleDensity?: () => void
): KeyboardShortcut[] => [
  {
    key: 'k',
    ctrl: true,
    description: 'Open command palette',
    action: openCommandPalette,
    section: 'Global'
  },
  {
    key: '?',
    shift: true,
    description: 'Show keyboard shortcuts',
    action: () => openShortcutsDialog?.(),
    section: 'Global'
  },
  {
    key: 'd',
    ctrl: true,
    shift: true,
    description: 'Toggle visual density',
    action: () => toggleDensity?.(),
    section: 'Global'
  },
  {
    key: '/',
    description: 'Focus search',
    action: () => {
      const searchInput = document.querySelector('input[type="text"]') as HTMLInputElement
      searchInput?.focus()
    },
    section: 'Global'
  },
  {
    key: '1',
    ctrl: true,
    description: 'Go to Board',
    action: () => navigate('board'),
    section: 'Navigation'
  },
  {
    key: '2',
    ctrl: true,
    description: 'Go to Front Desk',
    action: () => navigate('front-desk'),
    section: 'Navigation'
  },
  {
    key: '3',
    ctrl: true,
    description: 'Go to Reservations',
    action: () => navigate('reservations'),
    section: 'Navigation'
  },
  {
    key: '4',
    ctrl: true,
    description: 'Go to Guests',
    action: () => navigate('guests'),
    section: 'Navigation'
  },
  {
    key: '5',
    ctrl: true,
    description: 'Go to Housekeeping',
    action: () => navigate('housekeeping'),
    section: 'Navigation'
  },
  {
    key: '6',
    ctrl: true,
    description: 'Go to Cashier',
    action: () => navigate('cashier'),
    section: 'Navigation'
  },
  {
    key: '7',
    ctrl: true,
    description: 'Go to Rates',
    action: () => navigate('rates'),
    section: 'Navigation'
  },
  {
    key: '8',
    ctrl: true,
    description: 'Go to Channels',
    action: () => navigate('channels'),
    section: 'Navigation'
  },
  {
    key: '9',
    ctrl: true,
    description: 'Go to Reports',
    action: () => navigate('reports'),
    section: 'Navigation'
  },
  {
    key: '0',
    ctrl: true,
    description: 'Go to Settings',
    action: () => navigate('settings'),
    section: 'Navigation'
  },
  {
    key: 'n',
    ctrl: true,
    description: 'New reservation (from Board)',
    action: () => toast.info('Create new reservation (available on Board)'),
    section: 'Actions'
  },
  {
    key: 'r',
    ctrl: true,
    description: 'Refresh data',
    action: () => {
      window.location.reload()
    },
    section: 'Actions'
  },
  {
    key: 'Escape',
    description: 'Close modal/dialog',
    action: () => {
      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' })
      document.dispatchEvent(escapeEvent)
    },
    section: 'Global'
  }
]
