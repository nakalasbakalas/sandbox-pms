import { useState, useEffect } from 'react'
import type { Command } from '@/types/command-palette'
import { filterCommands, groupCommandsByCategory } from '@/hooks/use-command-palette'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Badge } from '@/components/ui/badge'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  commands: Command[]
}

export function CommandPalette({ open, onOpenChange, commands }: CommandPaletteProps) {
  const [search, setSearch] = useState('')
  
  const filteredCommands = filterCommands(commands, search)
  const commandGroups = groupCommandsByCategory(filteredCommands)

  useEffect(() => {
    if (!open) {
      setSearch('')
    }
  }, [open])

  const handleCommandSelect = (command: Command) => {
    if (!command.disabled) {
      command.action()
      onOpenChange(false)
    }
  }

  const formatShortcut = (shortcut: string): string[] => {
    return shortcut.split('+').map(key => {
      const keyMap: Record<string, string> = {
        cmd: 'Cmd',
        ctrl: 'Ctrl',
        shift: 'Shift',
        alt: 'Alt',
        option: 'Alt',
        enter: 'Enter',
        return: 'Enter',
        backspace: 'Backspace',
        delete: 'Del',
        escape: 'Esc',
        esc: 'Esc',
        tab: 'Tab',
        space: 'Space',
        up: 'Up',
        down: 'Down',
        left: 'Left',
        right: 'Right',
      }
      return keyMap[key.toLowerCase()] || key.toUpperCase()
    })
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput 
        placeholder="Type a command or search..." 
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No commands found.</CommandEmpty>
        
        {commandGroups.map((group, groupIndex) => (
          <div key={group.category}>
            {groupIndex > 0 && <CommandSeparator />}
            <CommandGroup heading={group.label}>
              {group.commands.map((command) => {
                const Icon = command.icon
                
                return (
                  <CommandItem
                    key={command.id}
                    value={`${command.label} ${command.description || ''} ${command.keywords?.join(' ') || ''}`}
                    onSelect={() => handleCommandSelect(command)}
                    disabled={command.disabled}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {Icon && (
                        <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="flex flex-col gap-1 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{command.label}</span>
                          {command.disabled && (
                            <Badge variant="secondary" className="text-xs">Unavailable</Badge>
                          )}
                        </div>
                        {command.description && (
                          <span className="text-xs text-muted-foreground truncate">
                            {command.description}
                          </span>
                        )}
                      </div>
                      {command.shortcut && (
                        <div className="flex items-center gap-1 shrink-0">
                          {formatShortcut(command.shortcut).map((key, index) => (
                            <kbd
                              key={index}
                              className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground"
                            >
                              {key}
                            </kbd>
                          ))}
                        </div>
                      )}
                    </div>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </div>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
