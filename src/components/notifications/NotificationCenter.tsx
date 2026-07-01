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
  ArrowSquareOut,
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
import type { UseOpsNotificationsResult } from '@/hooks/use-ops-notifications'
import { useNavigation } from '@/hooks/use-navigation'
import type { NavigationRoute } from '@/types/navigation'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'

interface NotificationCenterProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  localNotifications: ReturnType<typeof useNotifications>
  opsNotifications: UseOpsNotificationsResult
}

const priorityOrder: Record<NotificationPriority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

function sortNotifications(notifications: Notification[]) {
  return [...notifications].sort((a, b) => {
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority]
    }
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  })
}

function isHotelOpsNotification(notification: Notification) {
  return notification.metadata?.source === 'hotel-ops'
}

function routeFromActionUrl(actionUrl?: string): NavigationRoute | null {
  if (!actionUrl || typeof window === 'undefined') return null

  try {
    const parsed = new URL(actionUrl, window.location.origin)
    if (parsed.origin !== window.location.origin) return null
    const path = parsed.pathname.replace(/^\/+|\/+$/g, '')
    const routeMap: Record<string, NavigationRoute> = {
      'ops/chat': 'ops-chat',
      'ops/approvals': 'ops-approvals',
      'ops/tasks': 'ops-tasks',
      'ops/intelligence': 'ops-intelligence',
      'ops/settings': 'ops-settings',
      'booking-inbox': 'booking-inbox',
    }
    return routeMap[path] || null
  } catch {
    return null
  }
}

export function NotificationCenter({
  open,
  onOpenChange,
  localNotifications,
  opsNotifications,
}: NotificationCenterProps) {
  const { navigate } = useNavigation()
  const {
    activeNotifications,
    unreadNotifications,
    soundEnabled,
    markAsRead,
    markAllAsRead,
    dismissNotification,
    clearAll,
    toggleSound,
  } = localNotifications

  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  const combinedActiveNotifications = sortNotifications([...activeNotifications, ...opsNotifications.activeNotifications])
  const combinedUnreadNotifications = sortNotifications([...unreadNotifications, ...opsNotifications.unreadNotifications])
  const displayedNotifications = filter === 'unread' ? combinedUnreadNotifications : combinedActiveNotifications

  const handleMarkAsRead = (notification: Notification) => {
    if (isHotelOpsNotification(notification)) {
      opsNotifications.markAsRead(notification.id)
    } else {
      markAsRead(notification.id)
    }
  }

  const handleDismiss = (notification: Notification) => {
    if (isHotelOpsNotification(notification)) {
      opsNotifications.dismissNotification(notification.id)
    } else {
      dismissNotification(notification.id)
    }
  }

  const handleMarkAllAsRead = () => {
    markAllAsRead()
    opsNotifications.markAllAsRead()
  }

  const handleClearAll = () => {
    clearAll()
    opsNotifications.clearAll()
  }

  const openNotificationAction = (actionUrl: string) => {
    const route = routeFromActionUrl(actionUrl)
    if (route) {
      navigate(route)
      onOpenChange(false)
      return
    }
    window.location.assign(actionUrl)
  }

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
                  {combinedUnreadNotifications.length > 0
                    ? `${combinedUnreadNotifications.length} unread alert${combinedUnreadNotifications.length > 1 ? 's' : ''}`
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
              All ({combinedActiveNotifications.length})
            </Button>
            <Button
              variant={filter === 'unread' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('unread')}
              className="flex-1"
            >
              Unread ({combinedUnreadNotifications.length})
            </Button>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1 px-6">
          {opsNotifications.loadError && (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Hotel Ops notifications could not load: {opsNotifications.loadError}
            </div>
          )}

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
                  onMarkAsRead={() => handleMarkAsRead(notification)}
                  onDismiss={() => handleDismiss(notification)}
                  onOpenAction={notification.actionUrl ? () => openNotificationAction(notification.actionUrl!) : undefined}
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
            {combinedUnreadNotifications.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleMarkAllAsRead}
                className="flex-1"
              >
                <Check size={16} className="mr-2" />
                Mark All Read
              </Button>
            )}
            {combinedActiveNotifications.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearAll}
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
  onOpenAction?: () => void
}

function NotificationCard({ notification, onMarkAsRead, onDismiss, onOpenAction }: NotificationCardProps) {
  const Icon = getNotificationIcon(notification.type)
  const priorityConfig = getPriorityConfig(notification.priority)
  const isOps = isHotelOpsNotification(notification)

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
              {isOps && (
                <Badge variant="outline" className="text-xs">
                  Hotel Ops
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
              {onOpenAction && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onOpenAction}
                  className="h-7 px-2 text-xs"
                >
                  <ArrowSquareOut size={14} className="mr-1" />
                  {notification.actionLabel || 'Open'}
                </Button>
              )}
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
    HOTEL_OPS: BellRinging,
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
