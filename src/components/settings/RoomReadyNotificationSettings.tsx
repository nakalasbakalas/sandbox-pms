import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import {
  CheckCircle,
  ChatCircle,
  EnvelopeSimple,
  Info,
  BellRinging,
  ClockClockwise,
  Calendar,
  Users,
} from '@phosphor-icons/react'
import { useRoomReadyNotifications } from '@/hooks/use-room-ready-notifications'
import { useKV } from '@github/spark/hooks'
import type { StaffMember, StaffRole } from '@/types/staff-alerts'
import { toast } from 'sonner'

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
]

export function RoomReadyNotificationSettings() {
  const { settings, setSettings, notificationLogs, getRecipients } = useRoomReadyNotifications()
  const [staffMembers] = useKV<StaffMember[]>('staff-members', [])

  const handleToggleRole = (role: StaffRole) => {
    if (!settings) return
    
    setSettings((current) => {
      if (!current) return current
      
      const hasRole = current.recipients.roles.includes(role)
      return {
        ...current,
        recipients: {
          ...current.recipients,
          roles: hasRole
            ? current.recipients.roles.filter(r => r !== role)
            : [...current.recipients.roles, role]
        }
      }
    })
  }

  const handleToggleDay = (day: number) => {
    if (!settings) return
    
    setSettings((current) => {
      if (!current) return current
      
      const hasDay = current.schedule.daysOfWeek.includes(day)
      return {
        ...current,
        schedule: {
          ...current.schedule,
          daysOfWeek: hasDay
            ? current.schedule.daysOfWeek.filter(d => d !== day)
            : [...current.schedule.daysOfWeek, day]
        }
      }
    })
  }

  if (!settings) return null

  const recipients = getRecipients()
  const recentLogs = notificationLogs.slice(0, 10)
  const sentCount = notificationLogs.filter(log => log.notificationSent).length
  const suppressedCount = notificationLogs.filter(log => !log.notificationSent).length

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Room Ready Notifications</h2>
        <p className="text-sm text-muted-foreground">
          Automatically notify staff when rooms are ready for the next guest
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-green-50 border-green-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold">{sentCount}</div>
                <div className="text-xs text-muted-foreground">Sent</div>
              </div>
              <BellRinging size={24} className="text-green-600 opacity-60" weight="duotone" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold">{recipients.length}</div>
                <div className="text-xs text-muted-foreground">Recipients</div>
              </div>
              <Users size={24} className="text-blue-600 opacity-60" weight="duotone" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-orange-50 border-orange-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold">{suppressedCount}</div>
                <div className="text-xs text-muted-foreground">Suppressed</div>
              </div>
              <ClockClockwise size={24} className="text-orange-600 opacity-60" weight="duotone" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Enable Notifications</CardTitle>
              <CardDescription>
                Send alerts when rooms are cleaned and ready for arrivals
              </CardDescription>
            </div>
            <Switch
              checked={settings.enabled}
              onCheckedChange={(enabled) => {
                setSettings((current) => current ? { ...current, enabled } : current)
                toast.success(enabled ? 'Notifications enabled' : 'Notifications disabled')
              }}
            />
          </div>
        </CardHeader>
      </Card>

      {settings.enabled && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Notification Triggers</CardTitle>
              <CardDescription>Choose which room status changes trigger notifications</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-2">
                  <CheckCircle size={20} weight="duotone" className="text-green-600" />
                  <div>
                    <div className="font-medium">Notify when Clean</div>
                    <div className="text-xs text-muted-foreground">
                      Room marked as clean after housekeeping
                    </div>
                  </div>
                </div>
                <Switch
                  checked={settings.notifyOnClean}
                  onCheckedChange={(notifyOnClean) => {
                    setSettings((current) => current ? { ...current, notifyOnClean } : current)
                  }}
                />
              </div>

              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-2">
                  <CheckCircle size={20} weight="duotone" className="text-blue-600" />
                  <div>
                    <div className="font-medium">Notify when Inspected</div>
                    <div className="text-xs text-muted-foreground">
                      Room marked as inspected (supervisor approval)
                    </div>
                  </div>
                </div>
                <Switch
                  checked={settings.notifyOnInspected}
                  onCheckedChange={(notifyOnInspected) => {
                    setSettings((current) => current ? { ...current, notifyOnInspected } : current)
                  }}
                />
              </div>

              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-2">
                  <Calendar size={20} weight="duotone" className="text-orange-600" />
                  <div>
                    <div className="font-medium">Only for Today's Arrivals</div>
                    <div className="text-xs text-muted-foreground">
                      Only notify for rooms with arriving guests today
                    </div>
                  </div>
                </div>
                <Switch
                  checked={settings.onlyForArrivals}
                  onCheckedChange={(onlyForArrivals) => {
                    setSettings((current) => current ? { ...current, onlyForArrivals } : current)
                  }}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Delivery Channels</CardTitle>
              <CardDescription>Choose how notifications are sent</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-2">
                  <ChatCircle size={20} weight="duotone" />
                  <span className="font-medium">LINE</span>
                </div>
                <Switch
                  checked={settings.channels.line}
                  onCheckedChange={(line) => {
                    setSettings((current) => 
                      current ? { ...current, channels: { ...current.channels, line } } : current
                    )
                  }}
                />
              </div>
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-2">
                  <EnvelopeSimple size={20} weight="duotone" />
                  <span className="font-medium">Email</span>
                </div>
                <Switch
                  checked={settings.channels.email}
                  onCheckedChange={(email) => {
                    setSettings((current) => 
                      current ? { ...current, channels: { ...current.channels, email } } : current
                    )
                  }}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recipients by Role</CardTitle>
              <CardDescription>
                All active staff with these roles will receive room-ready notifications
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {(['ADMIN', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPING', 'CASHIER', 'MAINTENANCE'] as StaffRole[]).map(
                  (role) => (
                    <Badge
                      key={role}
                      variant={settings.recipients.roles.includes(role) ? 'default' : 'outline'}
                      className="cursor-pointer px-3 py-1.5"
                      onClick={() => handleToggleRole(role)}
                    >
                      {settings.recipients.roles.includes(role) && (
                        <CheckCircle size={14} className="mr-1" weight="bold" />
                      )}
                      {role.replace('_', ' ')}
                    </Badge>
                  )
                )}
              </div>
              {recipients.length > 0 && (
                <Alert className="mt-4">
                  <Info size={18} />
                  <AlertDescription>
                    {recipients.length} active staff member{recipients.length !== 1 ? 's' : ''} will receive
                    notifications
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Message Template</CardTitle>
              <CardDescription>
                Customize the notification message (use {'{{roomNumber}}'}, {'{{status}}'}, {'{{arrivalInfo}}'})
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="title-template">Title</Label>
                <Input
                  id="title-template"
                  value={settings.messageTemplate.title}
                  onChange={(e) => {
                    setSettings((current) => 
                      current ? {
                        ...current,
                        messageTemplate: { ...current.messageTemplate, title: e.target.value }
                      } : current
                    )
                  }}
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="body-template">Body</Label>
                <Textarea
                  id="body-template"
                  value={settings.messageTemplate.body}
                  onChange={(e) => {
                    setSettings((current) => 
                      current ? {
                        ...current,
                        messageTemplate: { ...current.messageTemplate, body: e.target.value }
                      } : current
                    )
                  }}
                  className="mt-2"
                  rows={3}
                />
              </div>
              <Alert>
                <Info size={18} />
                <AlertDescription>
                  <strong>Preview:</strong> "✅ Room 305 Ready" / "Room 305 is now clean and ready for the
                  next guest (Arrival at 14:00 - guest name)."
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Throttling</CardTitle>
                  <CardDescription>
                    Prevent duplicate notifications for the same room
                  </CardDescription>
                </div>
                <Switch
                  checked={settings.throttle.enabled}
                  onCheckedChange={(enabled) => {
                    setSettings((current) => 
                      current ? {
                        ...current,
                        throttle: { ...current.throttle, enabled }
                      } : current
                    )
                  }}
                />
              </div>
            </CardHeader>
            {settings.throttle.enabled && (
              <CardContent>
                <div>
                  <Label htmlFor="throttle-minutes">Minimum Minutes Between Notifications</Label>
                  <Input
                    id="throttle-minutes"
                    type="number"
                    value={settings.throttle.minMinutesBetweenNotifications}
                    onChange={(e) => {
                      setSettings((current) => 
                        current ? {
                          ...current,
                          throttle: {
                            ...current.throttle,
                            minMinutesBetweenNotifications: parseInt(e.target.value) || 0
                          }
                        } : current
                      )
                    }}
                    className="mt-2"
                    min="1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Same room won't trigger another notification within this time window
                  </p>
                </div>
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Schedule</CardTitle>
                  <CardDescription>
                    Limit notifications to specific times and days
                  </CardDescription>
                </div>
                <Switch
                  checked={settings.schedule.enabled}
                  onCheckedChange={(enabled) => {
                    setSettings((current) => 
                      current ? {
                        ...current,
                        schedule: { ...current.schedule, enabled }
                      } : current
                    )
                  }}
                />
              </div>
            </CardHeader>
            {settings.schedule.enabled && (
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="start-time">Start Time</Label>
                    <Input
                      id="start-time"
                      type="time"
                      value={settings.schedule.startTime}
                      onChange={(e) => {
                        setSettings((current) => 
                          current ? {
                            ...current,
                            schedule: { ...current.schedule, startTime: e.target.value }
                          } : current
                        )
                      }}
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label htmlFor="end-time">End Time</Label>
                    <Input
                      id="end-time"
                      type="time"
                      value={settings.schedule.endTime}
                      onChange={(e) => {
                        setSettings((current) => 
                          current ? {
                            ...current,
                            schedule: { ...current.schedule, endTime: e.target.value }
                          } : current
                        )
                      }}
                      className="mt-2"
                    />
                  </div>
                </div>
                <div>
                  <Label className="mb-2 block">Days of Week</Label>
                  <div className="flex gap-2">
                    {DAYS_OF_WEEK.map((day) => (
                      <Badge
                        key={day.value}
                        variant={
                          settings.schedule.daysOfWeek.includes(day.value) ? 'default' : 'outline'
                        }
                        className="cursor-pointer px-3 py-1.5"
                        onClick={() => handleToggleDay(day.value)}
                      >
                        {day.label}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Notifications</CardTitle>
              <CardDescription>Last 10 room-ready notification attempts</CardDescription>
            </CardHeader>
            <CardContent>
              {recentLogs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <BellRinging size={48} className="mx-auto mb-3 opacity-30" />
                  <p>No notifications yet</p>
                </div>
              ) : (
                <ScrollArea className="h-80">
                  <div className="space-y-3">
                    {recentLogs.map((log) => (
                      <div key={log.id} className="flex items-start gap-3 p-3 border rounded-lg">
                        <div className="flex-shrink-0 mt-1">
                          {log.notificationSent ? (
                            <CheckCircle size={20} className="text-green-600" weight="bold" />
                          ) : (
                            <ClockClockwise size={20} className="text-orange-600" weight="bold" />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium">
                            Room {log.roomNumber} - {log.status}
                          </div>
                          {log.hasArrivalToday && (
                            <div className="text-xs text-muted-foreground">
                              Arrival: {log.arrivalTime}
                              {log.guestName && ` - ${log.guestName}`}
                            </div>
                          )}
                          {log.notificationSent ? (
                            <div className="text-xs text-green-600 mt-1">
                              ✓ Sent via {log.sentVia.join(', ').toUpperCase()} to {log.recipientCount}{' '}
                              recipient{log.recipientCount !== 1 ? 's' : ''}
                            </div>
                          ) : (
                            <div className="text-xs text-orange-600 mt-1">
                              ⊘ Suppressed: {log.suppressedReason}
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground mt-1">
                            {new Date(log.createdAt).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
