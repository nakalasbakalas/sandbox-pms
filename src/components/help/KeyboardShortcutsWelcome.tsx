import { useEffect } from 'react'
import { useKV } from '@github/spark/hooks'
import { toast } from 'sonner'
import { Command } from '@phosphor-icons/react'

export function KeyboardShortcutsWelcome() {
  const [hasSeenWelcome, setHasSeenWelcome] = useKV('keyboard-shortcuts-welcome-shown', false)

  useEffect(() => {
    if (!hasSeenWelcome) {
      const timer = setTimeout(() => {
        toast(
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Command size={20} weight="duotone" className="text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm">Keyboard Shortcuts Available</p>
              <p className="text-xs text-muted-foreground mt-1">
                Press{' '}
                <kbd className="px-1.5 py-0.5 text-xs font-semibold bg-muted border border-border rounded">
                  ?
                </kbd>{' '}
                to view all available shortcuts and work faster
              </p>
            </div>
          </div>,
          {
            duration: 6000,
            position: 'bottom-right',
          }
        )
        setHasSeenWelcome(true)
      }, 2000)

      return () => clearTimeout(timer)
    }
  }, [hasSeenWelcome, setHasSeenWelcome])

  return null
}
