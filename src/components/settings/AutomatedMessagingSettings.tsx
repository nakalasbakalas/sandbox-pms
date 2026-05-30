import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Robot,
  CheckCircle,
  SignOut,
  ClockCounterClockwise,
  Wrench,
  Crown,
  XCircle,
  CalendarPlus,
  List,
  Play,
  Pause,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import type { HousekeepingAutomationConfig, AutomatedMessageLog } from '@/hooks/use-automatic-housekeeping-messaging'
import { format, formatDistanceToNow } from 'date-fns'

interface AutomatedMessagingSettingsProps {
  config: HousekeepingAutomationConfig
  onConfigChange: (config: HousekeepingAutomationConfig) => void
  messageLog: AutomatedMessageLog[]
}

const AUTOMATION_RULES = [
  {
    key: 'checkOutNotifications' as const,
    icon: SignOut,
    label: 'Check-out Notifications',
    description: 'Automatically notify housekeeping when guests check out',
    color: 'text-blue-500',
  },
  {
    key: 'earlyCheckInNotifications' as const,
    icon: ClockCounterClockwise,
    label: 'Early Check-in Alerts',
    description: 'Priority notifications for same-day arrivals needing clean rooms',
    color: 'text-orange-500',
  },
  {
    key: 'maintenanceRequestNotifications' as const,
    icon: Wrench,
    label: 'Maintenance Alerts',
    description: 'Notify housekeeping of maintenance issues in rooms',
    color: 'text-red-500',
  },
  {
    key: 'priorityRoomNotifications' as const,
    icon: Crown,
    label: 'VIP Room Alerts',
    description: 'Special attention notifications for VIP guest rooms',
    color: 'text-purple-500',
  },
  {
    key: 'noShowNotifications' as const,
    icon: XCircle,
    label: 'No-show Checks',
    description: 'Alert housekeeping of potential no-shows after check-in time',
    color: 'text-gray-500',
  },
  {
    key: 'extendedStayNotifications' as const,
    icon: CalendarPlus,
    label: 'Extended Stay Updates',
    description: 'Notify staff when guests extend their stay',
    color: 'text-green-500',
  },
]

export function AutomatedMessagingSettings({
  config,
  onConfigChange,
  messageLog,
}: AutomatedMessagingSettingsProps) {
  const [showLog, setShowLog] = useState(false)

  const handleToggleRule = (key: keyof Omit<HousekeepingAutomationConfig, 'enabled'>) => {
    onConfigChange({
      ...config,
      [key]: !config[key],
    })
    toast.success(`${AUTOMATION_RULES.find(r => r.key === key)?.label} ${!config[key] ? 'enabled' : 'disabled'}`)
  }

  const handleToggleSystem = () => {
    onConfigChange({
      ...config,
      enabled: !config.enabled,
    })
    toast.success(`Automated messaging ${!config.enabled ? 'enabled' : 'disabled'}`)
  }

  const activeRulesCount = Object.entries(config).filter(
    ([key, value]) => key !== 'enabled' && value === true
  ).length

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${config.enabled ? 'bg-green-500/10' : 'bg-gray-500/10'}`}>
              <Robot className={`h-5 w-5 ${config.enabled ? 'text-green-600' : 'text-gray-500'}`} />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Automated Housekeeping Messaging</h3>
              <p className="text-xs text-muted-foreground">
                System automatically notifies housekeeping staff based on room events
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Dialog open={showLog} onOpenChange={setShowLog}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <List className="h-4 w-4 mr-2" />
                  Message Log
                  {messageLog.length > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {messageLog.length}
                    </Badge>
                  )}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Automated Message Log</DialogTitle>
                  <DialogDescription>
                    History of all automated messages sent to housekeeping staff
                  </DialogDescription>
                </DialogHeader>
                <ScrollArea className="h-96">
                  {messageLog.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      No automated messages sent yet
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {messageLog.map((log) => (
                        <Card key={log.id} className="p-3">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                Room {log.roomNumber}
                              </Badge>
                              <Badge variant="secondary" className="text-xs">
                                {log.trigger.replace(/_/g, ' ')}
                              </Badge>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(log.sentAt, { addSuffix: true })}
                            </span>
                          </div>
                          {log.guestName && (
                            <p className="text-xs text-muted-foreground mb-1">
                              Guest: {log.guestName}
                            </p>
                          )}
                          <p className="text-xs whitespace-pre-wrap">{log.message}</p>
                        </Card>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </DialogContent>
            </Dialog>
            <Switch
              checked={config.enabled}
              onCheckedChange={handleToggleSystem}
            />
          </div>
        </div>

        {config.enabled && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-green-500/10 border border-green-500/20">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <span className="text-xs text-green-700">
              System active · {activeRulesCount} of {AUTOMATION_RULES.length} rules enabled
            </span>
          </div>
        )}

        {!config.enabled && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-gray-500/10 border border-gray-500/20">
            <Pause className="h-4 w-4 text-gray-600" />
            <span className="text-xs text-gray-700">
              System paused · No automated messages will be sent
            </span>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-sm font-semibold">Automation Rules</h4>
            <p className="text-xs text-muted-foreground">
              Configure which events trigger automatic messages
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {AUTOMATION_RULES.map((rule) => {
            const Icon = rule.icon
            const isEnabled = config[rule.key]

            return (
              <div key={rule.key}>
                <div className="flex items-start justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                  <div className="flex items-start gap-3 flex-1">
                    <div className={`mt-0.5 ${rule.color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Label className="text-sm font-medium cursor-pointer">
                          {rule.label}
                        </Label>
                        {isEnabled && (
                          <Badge variant="secondary" className="text-xs">
                            Active
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {rule.description}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={isEnabled}
                    onCheckedChange={() => handleToggleRule(rule.key)}
                    disabled={!config.enabled}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      <Card className="p-4 bg-blue-500/5 border-blue-500/20">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-blue-500/10">
            <Robot className="h-4 w-4 text-blue-600" />
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-semibold mb-1">How Automated Messaging Works</h4>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>• System monitors room status changes every minute</li>
              <li>• Messages are sent to the housekeeping channel automatically</li>
              <li>• Each message is logged and can be reviewed in the message log</li>
              <li>• VIP rooms and urgent situations get high-priority notifications</li>
              <li>• Prevents duplicate messages for the same event on the same day</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  )
}
