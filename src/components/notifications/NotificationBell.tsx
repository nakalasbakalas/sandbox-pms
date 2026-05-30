import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Bell, BellRinging } from '@phosphor-icons/react'
import { useNotifications } from '@/hooks/use-notifications'
import { NotificationCenter } from './NotificationCenter'
import { motion, AnimatePresence } from 'framer-motion'

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const { unreadCount } = useNotifications()

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        className="relative"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <AnimatePresence mode="wait">
          {unreadCount > 0 ? (
            <motion.div
              key="ringing"
              initial={{ rotate: 0 }}
              animate={{ 
                rotate: [0, -15, 15, -15, 15, 0],
                transition: { 
                  duration: 0.5,
                  repeat: Infinity,
                  repeatDelay: 3
                }
              }}
              exit={{ opacity: 0 }}
            >
              <BellRinging size={20} weight="bold" />
            </motion.div>
          ) : (
            <motion.div
              key="bell"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Bell size={20} />
            </motion.div>
          )}
        </AnimatePresence>

        {unreadCount > 0 && (
          <Badge 
            className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 px-1 text-xs bg-red-600 border-2 border-background"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </Badge>
        )}
      </Button>

      <NotificationCenter open={open} onOpenChange={setOpen} />
    </>
  )
}
