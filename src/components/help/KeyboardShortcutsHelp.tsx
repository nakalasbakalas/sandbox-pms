import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Keyboard, X } from '@phosphor-icons/react'
import type { KeyboardShortcut } from '@/hooks/use-keyboard-shortcuts'
import { getShortcutDisplay } from '@/hooks/use-keyboard-shortcuts'

interface KeyboardShortcutsHelpProps {
  shortcuts: KeyboardShortcut[]
  open: boolean
  onClose: () => void
}

export function KeyboardShortcutsHelp({ shortcuts, open, onClose }: KeyboardShortcutsHelpProps) {
  const shortcutsBySection = shortcuts.reduce((acc, shortcut) => {
    const section = shortcut.section || 'Other'
    if (!acc[section]) acc[section] = []
    acc[section].push(shortcut)
    return acc
  }, {} as Record<string, KeyboardShortcut[]>)

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard size={24} />
            Keyboard Shortcuts
          </DialogTitle>
        </DialogHeader>
        
        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-6 py-4">
            {Object.entries(shortcutsBySection).map(([section, sectionShortcuts]) => (
              <div key={section}>
                <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                  {section}
                </h3>
                <div className="space-y-2">
                  {sectionShortcuts.map((shortcut, idx) => (
                    <div key={idx} className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted transition-colors">
                      <span className="text-sm text-foreground">{shortcut.description}</span>
                      <Badge variant="outline" className="font-mono text-xs">
                        {getShortcutDisplay(shortcut)}
                      </Badge>
                    </div>
                  ))}
                </div>
                {Object.keys(shortcutsBySection).indexOf(section) < Object.keys(shortcutsBySection).length - 1 && (
                  <Separator className="mt-4" />
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
        
        <div className="flex justify-end pt-4 border-t border-border">
          <Button variant="outline" onClick={onClose} className="gap-2">
            <X size={16} />
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function useKeyboardShortcutsHelp() {
  const [isOpen, setIsOpen] = useState(false)
  
  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen(prev => !prev)
  }
}
