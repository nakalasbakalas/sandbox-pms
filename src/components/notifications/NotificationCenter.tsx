import { useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { 
  Bell, 
  BellRinging,
  X,
  Check,
  CheckCircle,
  Trash,
  SpeakerHigh,
  SpeakerSlash,
  Broom,
  Wrench,
  Clock,
  Warning,
  Info,
  House
} from '@phosphor-icons/react'
import { useNotifications, type Notification, type NotificationPriority, type NotificationType } from '@/hooks/use-notifications'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'

interface NotificationCenterProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function NotificationCenter({ open, onOpenChange }: NotificationCenterProps) {
  const {
    activeNotifications,
    unreadNotifications,
    soundEnabled,
    markAsRead,
    markAllAsRead,
    dismissNotification,
    clearDismissed,
    clearAll,
    toggleSound,
  } = useNotifications()

  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  const displayedNotifications = filter === 'unread' ? unreadNotifications : activeNotifications

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <BellRinging size={24} weight="bold" className="text-primary" />
              <div>
                <SheetTitle>Notifications</SheetTitle>
                <SheetDescription className="text-xs mt-1">
                  {unreadNotifications.length > 0 
                    ? `${unreadNotifications.length} unread alert${unreadNotifications.length > 1 ? 's' : ''}`
                    : 'All caught up'}
                </SheetDescription>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-4">
            <Button
              variant={filter === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('all')}
              className="flex-1"
            >
              All ({activeNotifications.length})
            </Button>
            <Button
              variant={filter === 'unread' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('unread')}
              className="flex-1"
            >
              Unread ({unreadNotifications.length})
            </Button>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1 px-6">
          {displayedNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle size={64} className="text-muted-foreground opacity-30 mb-4" />
              <p className="text-sm text-muted-foreground font-medium">
                {filter === 'unread' ? 'No unread notifications' : 'No notifications'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {filter === 'unread' ? "You're all caught up!" : 'Alerts will appear here'}
              </p>
            </div>
          ) : (
            <div className="space-y-3 py-4">
              {displayedNotifications.map((notification) => (
                <NotificationCard
                  key={notification.id}
                  notification={notification}
                  onMarkAsRead={() => markAsRead(notification.id)}
                  onDismiss={() => dismissNotification(notification.id)}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="border-t p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="sound-toggle" className="text-sm font-medium cursor-pointer">
              Sound Alerts
            </Label>
            <div className="flex items-center gap-2">
              {soundEnabled ? (
                <SpeakerHigh size={18} className="text-muted-foreground" />
              ) : (
                <SpeakerSlash size={18} className="text-muted-foreground" />
              )}
              <Switch
                id="sound-toggle"
                checked={soundEnabled}
                onCheckedChange={toggleSound}
              />
            </div>
          </div>

          <Separator />

          <div className="flex gap-2">
            {unreadNotifications.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={markAllAsRead}
                className="flex-1"
              >
                <Check size={16} className="mr-2" />
                Mark All Read
              </Button>
            )}
            {activeNotifications.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearAll}
                className="flex-1"
              >
                <Trash size={16} className="mr-2" />
                Clear All
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

interface NotificationCardProps {
  notification: Notification
  onMarkAsRead: () => void
  onDismiss: () => void
}

function NotificationCard({ notification, onMarkAsRead, onDismiss }: NotificationCardProps) {
  const Icon = getNotificationIcon(notification.type)
  const priorityConfig = getPriorityConfig(notification.priority)

  return (
    <div
      className={cn(
        'relative p-4 rounded-lg border transition-all',
        !notification.read && 'bg-accent/30 border-accent',
        notification.read && 'bg-card border-border',
        priorityConfig.borderClass
      )}
    >
      <div className="flex gap-3">
        <div className={cn('p-2 rounded-full flex-shrink-0 h-fit', priorityConfig.iconBgClass)}>
          <Icon size={20} weight="bold" className={priorityConfig.iconColorClass} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-semibold text-sm">{notification.title}</h4>
              {notification.roomNumber && (
                <Badge variant="secondary" className="text-xs">
                  <House size={12} className="mr-1" />
                  {notification.roomNumber}
                </Badge>
              )}
            </div>
            {!notification.read && (
              <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1" />
            )}
          </div>

          <p className="text-sm text-muted-foreground mb-2">{notification.message}</p>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock size={12} />
              <span>{formatDistanceToNow(new Date(notification.timestamp), { addSuffix: true })}</span>
            </div>

            <div className="flex items-center gap-1">
              {!notification.read && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onMarkAsRead}
                  className="h-7 px-2 text-xs"
                >
                  <Check size={14} className="mr-1" />
                  Mark Read
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={onDismiss}
                className="h-7 px-2 text-xs"
              >
                <X size={14} />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function getNotificationIcon(type: NotificationType) {
  const iconMap = {
    HOUSEKEEPING_URGENT: Broom,
    MAINTENANCE_URGENT: Wrench,
    ARRIVAL_IMMINENT: Clock,
    CHECKOUT_DELAYED: Warning,
    ROOM_BLOCKED: Warning,
    GUEST_REQUEST: Info,
    SYSTEM_ALERT: Bell,
  }
  return iconMap[type] || Bell
}

function getPriorityConfig(priority: NotificationPriority) {
  const configs = {
    URGENT: {
      iconBgClass: 'bg-red-100 dark:bg-red-950',
      iconColorClass: 'text-red-600 dark:text-red-400',
      borderClass: 'border-l-4 border-l-red-500',
    },
    HIGH: {
      iconBgClass: 'bg-orange-100 dark:bg-orange-950',
      iconColorClass: 'text-orange-600 dark:text-orange-400',
      borderClass: 'border-l-4 border-l-orange-500',
    },
    MEDIUM: {
      iconBgClass: 'bg-blue-100 dark:bg-blue-950',
      iconColorClass: 'text-blue-600 dark:text-blue-400',
      borderClass: 'border-l-2 border-l-blue-400',
    },
    LOW: {
      iconBgClass: 'bg-gray-100 dark:bg-gray-800',
      iconColorClass: 'text-gray-600 dark:text-gray-400',
      borderClass: '',
    },
  }
  return configs[priority]
}
