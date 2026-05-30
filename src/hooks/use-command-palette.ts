import { useEffect, useState, useCallback } from 'react'
import type { Command, CommandGroup, CommandCategory } from '@/types/command-palette'

export function useCommandPalette(commands?: Command[]) {
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
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        e.stopPropagation()
        toggle()
        return
      }
      
      if (e.key === 'Escape' && isOpen) {
        e.stopPropagation()
        close()
        return
      }

      if (commands && !isOpen) {
        for (const command of commands) {
          if (command.shortcut && matchesShortcut(e, command.shortcut) && !command.disabled) {
            e.preventDefault()
            e.stopPropagation()
            command.action()
            return
          }
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, toggle, close, commands])

  return {
    isOpen,
    open,
    close,
    toggle,
  }
}

function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split('+')
  const key = parts[parts.length - 1]
  const modifiers = parts.slice(0, -1)

  if (e.key.toLowerCase() !== key) {
    return false
  }

  const hasCmd = modifiers.includes('cmd') || modifiers.includes('meta')
  const hasCtrl = modifiers.includes('ctrl')
  const hasShift = modifiers.includes('shift')
  const hasAlt = modifiers.includes('alt') || modifiers.includes('option')
  const commandPressed = e.metaKey || e.ctrlKey
  const expectsCommand = hasCmd || hasCtrl

  if (expectsCommand !== commandPressed) return false
  if (hasCtrl && !e.ctrlKey) return false
  if (hasShift !== e.shiftKey) return false
  if (hasAlt !== e.altKey) return false

  return true
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
