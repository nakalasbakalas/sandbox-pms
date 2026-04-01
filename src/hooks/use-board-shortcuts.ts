import { KeyboardShortcut } from './use-keyboard-shortcuts'

export function getBoardShortcuts(actions: {
  openNewReservation: () => void
  toggleUnassigned: () => void
  cycleViewMode: () => void
  focusSearch: () => void
  clearFilters: () => void
}): KeyboardShortcut[] {
  return [
    {
      key: 'n',
      ctrl: true,
      description: 'New reservation',
      action: actions.openNewReservation,
      section: 'Board'
    },
    {
      key: 'u',
      ctrl: true,
      description: 'Toggle unassigned panel',
      action: actions.toggleUnassigned,
      section: 'Board'
    },
    {
      key: 'v',
      ctrl: true,
      description: 'Cycle view mode (7/14/30 days)',
      action: actions.cycleViewMode,
      section: 'Board'
    },
    {
      key: 'f',
      ctrl: true,
      description: 'Focus search',
      action: actions.focusSearch,
      section: 'Board'
    },
    {
      key: 'x',
      ctrl: true,
      description: 'Clear all filters',
      action: actions.clearFilters,
      section: 'Board'
    }
  ]
}
