import { useEffect, useState, useCallback } from 'react'
import type { Command, CommandGroup, CommandCategory } from '@/types/command-palette'

export function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false)

  const toggle = useCallback(() => {
    setIsOpen((prev) => !prev)
  }, [])

  const open = useCallback(() => {
    setIsOpen(true)
  }, [])

  const close = useCallback(() => {
    setIsOpen(false)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        toggle()
      }
      
      if (e.key === 'Escape' && isOpen) {
        close()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, toggle, close])

  return {
    isOpen,
    open,
    close,
    toggle,
  }
}

export function groupCommandsByCategory(commands: Command[]): CommandGroup[] {
  const categoryLabels: Record<CommandCategory, string> = {
    navigation: 'Navigation',
    operations: 'Operations',
    reservations: 'Reservations',
    housekeeping: 'Housekeeping',
    guests: 'Guests',
    reports: 'Reports',
    settings: 'Settings',
  }

  const grouped = commands.reduce((acc, command) => {
    if (!acc[command.category]) {
      acc[command.category] = []
    }
    acc[command.category].push(command)
    return acc
  }, {} as Record<CommandCategory, Command[]>)

  return Object.entries(grouped).map(([category, commands]) => ({
    category: category as CommandCategory,
    label: categoryLabels[category as CommandCategory],
    commands,
  }))
}

export function filterCommands(commands: Command[], query: string): Command[] {
  if (!query.trim()) return commands

  const lowerQuery = query.toLowerCase()
  
  return commands.filter((command) => {
    const matchLabel = command.label.toLowerCase().includes(lowerQuery)
    const matchDescription = command.description?.toLowerCase().includes(lowerQuery)
    const matchKeywords = command.keywords?.some(keyword => 
      keyword.toLowerCase().includes(lowerQuery)
    )
    
    return matchLabel || matchDescription || matchKeywords
  })
}
