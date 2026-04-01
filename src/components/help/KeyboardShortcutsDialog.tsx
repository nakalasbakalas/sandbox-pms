import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Command, MagnifyingGlass } from '@phosphor-icons/react'
import { KeyboardShortcut, getShortcutDisplay } from '@/hooks/use-keyboard-shortcuts'
import { cn } from '@/lib/utils'

interface KeyboardShortcutsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  shortcuts: KeyboardShortcut[]
}

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
  shortcuts,
}: KeyboardShortcutsDialogProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const groupedShortcuts = shortcuts.reduce((acc, shortcut) => {
    const section = shortcut.section || 'Other'
    if (!acc[section]) {
      acc[section] = []
    }
    acc[section].push(shortcut)
    return acc
  }, {} as Record<string, KeyboardShortcut[]>)

  const filteredSections = Object.entries(groupedShortcuts).reduce((acc, [section, items]) => {
    const filteredItems = items.filter(
      item =>
        item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.key.toLowerCase().includes(searchQuery.toLowerCase())
    )
    if (filteredItems.length > 0) {
      acc[section] = filteredItems
    }
    return acc
  }, {} as Record<string, KeyboardShortcut[]>)

  const sectionOrder = ['Global', 'Navigation', 'Actions', 'Board', 'Reservations', 'Other']

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Command size={24} weight="duotone" className="text-primary" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>
            Master these shortcuts to work faster and more efficiently
          </DialogDescription>
        </DialogHeader>

        <div className="relative mb-4">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
          <Input
            placeholder="Search shortcuts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-6">
            {sectionOrder.map(sectionName => {
              const sectionShortcuts = filteredSections[sectionName]
              if (!sectionShortcuts) return null

              return (
                <div key={sectionName}>
                  <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                    {sectionName}
                  </h3>
                  <div className="space-y-2">
                    {sectionShortcuts.map((shortcut, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <span className="text-sm">{shortcut.description}</span>
                        <KeyboardBadge shortcut={shortcut} />
                      </div>
                    ))}
                  </div>
                  {sectionName !== sectionOrder[sectionOrder.length - 1] && (
                    <Separator className="mt-4" />
                  )}
                </div>
              )
            })}

            {Object.keys(filteredSections).length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No shortcuts found matching "{searchQuery}"
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="mt-4 p-4 rounded-lg bg-muted/30 border border-border">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold">Tip:</span> Press{' '}
            <kbd className="px-1.5 py-0.5 text-xs font-semibold bg-background border border-border rounded">
              ?
            </kbd>{' '}
            from anywhere to open this dialog
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function KeyboardBadge({ shortcut }: { shortcut: KeyboardShortcut }) {
  const parts: Array<{ key: string; symbol?: string }> = []

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0

  if (shortcut.ctrl) {
    parts.push({ key: isMac ? '⌘' : 'Ctrl', symbol: isMac ? '⌘' : undefined })
  }
  if (shortcut.shift) {
    parts.push({ key: '⇧', symbol: '⇧' })
  }
  if (shortcut.alt) {
    parts.push({ key: isMac ? '⌥' : 'Alt', symbol: isMac ? '⌥' : undefined })
  }

  const keyDisplay = shortcut.key === ' ' ? 'Space' : shortcut.key.toUpperCase()
  parts.push({ key: keyDisplay })

  return (
    <div className="flex items-center gap-1">
      {parts.map((part, index) => (
        <kbd
          key={index}
          className={cn(
            'inline-flex items-center justify-center min-w-[28px] h-7 px-2',
            'text-xs font-semibold',
            'bg-background border border-border rounded',
            'shadow-sm'
          )}
        >
          {part.symbol || part.key}
        </kbd>
      ))}
    </div>
  )
}
