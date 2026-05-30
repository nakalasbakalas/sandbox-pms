export type CommandCategory = 
  | 'navigation'
  | 'operations'
  | 'reservations'
  | 'housekeeping'
  | 'guests'
  | 'reports'
  | 'settings'

export interface Command {
  id: string
  label: string
  description?: string
  category: CommandCategory
  keywords?: string[]
  shortcut?: string
  icon?: React.ComponentType<{ className?: string }>
  action: () => void
  disabled?: boolean
}

export interface CommandGroup {
  category: CommandCategory
  label: string
  commands: Command[]
}
