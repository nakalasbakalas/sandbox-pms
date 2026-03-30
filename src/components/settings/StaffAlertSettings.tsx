import { useState } from 'react'
import { useKV } from '@github/spark/hooks'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Bell,
  BellRinging,
  Plus,
  UserCircle,
  Trash,
  Info,
  CheckCircle,
  Clock,
  Users,
  ChatCircle,
  EnvelopeSimple,
  DeviceMobile,
} from '@phosphor-icons/react'
import {
  StaffMember,
  AlertRoutingRule,
  AlertRecipient,
  StaffRole,
  AlertType,
  ALERT_TYPE_METADATA,
  DEFAULT_ALERT_ROUTING_RULES,
} from '@/types/staff-alerts'
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

export function StaffAlertSettings() {
  const [staffMembers, setStaffMembers] = useKV<StaffMember[]>('staff-members', [])
  const [routingRules, setRoutingRules] = useKV<AlertRoutingRule[]>(
    'alert-routing-rules',
    DEFAULT_ALERT_ROUTING_RULES
  )
  const [selectedRule, setSelectedRule] = useState<AlertRoutingRule | null>(null)
  const [showAddStaff, setShowAddStaff] = useState(false)

  const handleToggleRule = (ruleId: string, enabled: boolean) => {
    setRoutingRules((current) =>
      (current || []).map((rule) =>
        rule.id === ruleId ? { ...rule, enabled, updatedAt: new Date() } : rule
      )
    )
    toast.success(enabled ? 'Alert enabled' : 'Alert disabled')
  }

  const handleUpdateRule = (updatedRule: AlertRoutingRule) => {
    setRoutingRules((current) =>
      (current || []).map((rule) =>
        rule.id === updatedRule.id ? { ...updatedRule, updatedAt: new Date() } : rule
      )
    )
    toast.success('Alert configuration updated')
  }

  const activeStaff = (staffMembers || []).filter((s) => s.active && s.receiveAlerts)
  const enabledRules = (routingRules || []).filter((r) => r.enabled)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Staff Alert Configuration</h2>
        <p className="text-sm text-muted-foreground">
          Configure who receives alerts and how they are routed
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold">{activeStaff.length}</div>
                <div className="text-xs text-muted-foreground">Active Staff</div>
              </div>
              <Users size={24} className="text-blue-600 opacity-60" weight="duotone" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-green-50 border-green-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold">{enabledRules.length}</div>
                <div className="text-xs text-muted-foreground">Alert Types Enabled</div>
              </div>
              <BellRinging size={24} className="text-green-600 opacity-60" weight="duotone" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-purple-50 border-purple-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold">
                  {activeStaff.filter((s) => s.lineUserId).length}
                </div>
                <div className="text-xs text-muted-foreground">LINE Connected</div>
              </div>
              <ChatCircle size={24} className="text-purple-600 opacity-60" weight="duotone" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="alerts" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="alerts" className="gap-2">
            <Bell size={18} weight="duotone" />
            Alert Routing
          </TabsTrigger>
          <TabsTrigger value="staff" className="gap-2">
            <Users size={18} weight="duotone" />
            Staff Members
          </TabsTrigger>
        </TabsList>

        <TabsContent value="alerts" className="space-y-4 mt-6">
          <Alert>
            <Info size={18} />
            <AlertDescription>
              Configure when and how staff receive alerts. Alerts can be sent via LINE, Email, or
              SMS based on your configuration.
            </AlertDescription>
          </Alert>

          <ScrollArea className="h-[600px] pr-4">
            <div className="space-y-3">
              {(routingRules || []).map((rule) => {
                const metadata = ALERT_TYPE_METADATA[rule.alertType]
                return (
                  <Card key={rule.id} className="hover:shadow-md transition-shadow">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <div className="text-2xl mt-1">{metadata.icon}</div>
                          <div>
                            <CardTitle className="text-base flex items-center gap-2">
                              {metadata.label}
                              <PriorityBadge priority={rule.priority} />
                            </CardTitle>
                            <CardDescription className="text-xs mt-1">
                              {metadata.description}
                            </CardDescription>
                            <div className="flex items-center gap-2 mt-2">
                              {rule.channels.line && (
                                <Badge variant="secondary" className="text-xs bg-green-100">
                                  <ChatCircle size={12} className="mr-1" weight="bold" />
                                  LINE
                                </Badge>
                              )}
                              {rule.channels.email && (
                                <Badge variant="secondary" className="text-xs bg-blue-100">
                                  <EnvelopeSimple size={12} className="mr-1" weight="bold" />
                                  Email
                                </Badge>
                              )}
                              {rule.channels.sms && (
                                <Badge variant="secondary" className="text-xs bg-purple-100">
                                  <DeviceMobile size={12} className="mr-1" weight="bold" />
                                  SMS
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedRule(rule)}
                          >
                            Configure
                          </Button>
                          <Switch
                            checked={rule.enabled}
                            onCheckedChange={(enabled) => handleToggleRule(rule.id, enabled)}
                          />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <Label className="text-xs text-muted-foreground">Recipients</Label>
                          <div className="font-medium">
                            {rule.recipientsByRole.length > 0
                              ? rule.recipientsByRole.join(', ')
                              : rule.recipients.length > 0
                              ? `${rule.recipients.length} staff`
                              : 'None configured'}
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Throttle</Label>
                          <div className="font-medium">
                            {rule.throttle.enabled
                              ? `${rule.throttle.maxPerHour}/hr`
                              : 'Disabled'}
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Schedule</Label>
                          <div className="font-medium">
                            {rule.schedule.enabled
                              ? rule.schedule.onlyDuringBusinessHours
                                ? 'Business hours'
                                : 'Scheduled'
                              : 'Always'}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="staff" className="space-y-4 mt-6">
          <div className="flex items-center justify-between">
            <Alert className="flex-1 mr-4">
              <Info size={18} />
              <AlertDescription>
                Manage staff members who can receive alerts. Connect their LINE accounts for instant
                notifications.
              </AlertDescription>
            </Alert>
            <Dialog open={showAddStaff} onOpenChange={setShowAddStaff}>
              <DialogTrigger asChild>
                <Button>
                  <Plus size={20} className="mr-2" weight="bold" />
                  Add Staff
                </Button>
              </DialogTrigger>
              <DialogContent>
                <AddStaffForm
                  onAdd={(staff) => {
                    setStaffMembers((current) => [...(current || []), staff])
                    setShowAddStaff(false)
                    toast.success('Staff member added')
                  }}
                  onCancel={() => setShowAddStaff(false)}
                />
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {(staffMembers || []).map((staff) => (
              <Card key={staff.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <UserCircle size={24} className="text-primary" weight="duotone" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{staff.name}</CardTitle>
                        <CardDescription className="text-xs">
                          <Badge variant="outline" className="text-xs mt-1">
                            {staff.role}
                          </Badge>
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={staff.active}
                        onCheckedChange={(active) => {
                          setStaffMembers((current) =>
                            (current || []).map((s) =>
                              s.id === staff.id ? { ...s, active } : s
                            )
                          )
                          toast.success(active ? 'Staff activated' : 'Staff deactivated')
                        }}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ChatCircle size={14} weight="bold" />
                    <span>{staff.lineUserId || 'Not connected'}</span>
                  </div>
                  {staff.email && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <EnvelopeSimple size={14} weight="bold" />
                      <span>{staff.email}</span>
                    </div>
                  )}
                  {staff.phoneNumber && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <DeviceMobile size={14} weight="bold" />
                      <span>{staff.phoneNumber}</span>
                    </div>
                  )}
                  <Separator className="my-2" />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={staff.receiveAlerts}
                        onCheckedChange={(receiveAlerts) => {
                          setStaffMembers((current) =>
                            (current || []).map((s) =>
                              s.id === staff.id ? { ...s, receiveAlerts } : s
                            )
                          )
                          toast.success(
                            receiveAlerts ? 'Alerts enabled' : 'Alerts disabled'
                          )
                        }}
                        disabled={!staff.active}
                      />
                      <span className="text-xs text-muted-foreground">Receive Alerts</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (confirm(`Remove ${staff.name} from staff list?`)) {
                          setStaffMembers((current) =>
                            (current || []).filter((s) => s.id !== staff.id)
                          )
                          toast.success('Staff member removed')
                        }
                      }}
                    >
                      <Trash size={16} className="text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {(staffMembers || []).length === 0 && (
              <div className="col-span-2 text-center py-12 text-muted-foreground">
                <Users size={48} className="mx-auto mb-3 opacity-30" />
                <p>No staff members configured yet</p>
                <p className="text-xs mt-1">Add staff to configure alert routing</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {selectedRule && (
        <Dialog open={!!selectedRule} onOpenChange={() => setSelectedRule(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <AlertRuleConfigForm
              rule={selectedRule}
              staffMembers={staffMembers || []}
              onSave={(updatedRule) => {
                handleUpdateRule(updatedRule)
                setSelectedRule(null)
              }}
              onCancel={() => setSelectedRule(null)}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

interface AddStaffFormProps {
  onAdd: (staff: StaffMember) => void
  onCancel: () => void
}

function AddStaffForm({ onAdd, onCancel }: AddStaffFormProps) {
  const [name, setName] = useState('')
  const [role, setRole] = useState<StaffRole>('FRONT_DESK')
  const [lineUserId, setLineUserId] = useState('')
  const [email, setEmail] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')

  const handleSubmit = () => {
    if (!name) {
      toast.error('Please enter staff name')
      return
    }

    const staff: StaffMember = {
      id: `staff-${Date.now()}`,
      name,
      role,
      lineUserId: lineUserId || undefined,
      email: email || undefined,
      phoneNumber: phoneNumber || undefined,
      active: true,
      receiveAlerts: true,
      createdAt: new Date(),
    }

    onAdd(staff)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add Staff Member</DialogTitle>
        <DialogDescription>
          Add a new staff member to receive alerts
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <div>
          <Label>Name *</Label>
          <Input
            placeholder="Staff member name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <Label>Role *</Label>
          <Select value={role} onValueChange={(v) => setRole(v as StaffRole)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ADMIN">Admin</SelectItem>
              <SelectItem value="MANAGER">Manager</SelectItem>
              <SelectItem value="FRONT_DESK">Front Desk</SelectItem>
              <SelectItem value="HOUSEKEEPING">Housekeeping</SelectItem>
              <SelectItem value="CASHIER">Cashier</SelectItem>
              <SelectItem value="MAINTENANCE">Maintenance</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <div>
          <Label>LINE User ID</Label>
          <Input
            placeholder="U1234567890abcdef"
            value={lineUserId}
            onChange={(e) => setLineUserId(e.target.value)}
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Get from LINE Developers Console or webhook events
          </p>
        </div>

        <div>
          <Label>Email</Label>
          <Input
            type="email"
            placeholder="staff@sandboxhotel.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div>
          <Label>Phone Number</Label>
          <Input
            placeholder="+66 XX XXX XXXX"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSubmit}>Add Staff Member</Button>
      </DialogFooter>
    </>
  )
}

interface AlertRuleConfigFormProps {
  rule: AlertRoutingRule
  staffMembers: StaffMember[]
  onSave: (rule: AlertRoutingRule) => void
  onCancel: () => void
}

function AlertRuleConfigForm({ rule, staffMembers, onSave, onCancel }: AlertRuleConfigFormProps) {
  const [editedRule, setEditedRule] = useState<AlertRoutingRule>(rule)
  const metadata = ALERT_TYPE_METADATA[rule.alertType]

  const handleToggleRole = (role: StaffRole) => {
    setEditedRule((current) => ({
      ...current,
      recipientsByRole: current.recipientsByRole.includes(role)
        ? current.recipientsByRole.filter((r) => r !== role)
        : [...current.recipientsByRole, role],
    }))
  }

  const handleToggleDay = (day: number) => {
    setEditedRule((current) => ({
      ...current,
      schedule: {
        ...current.schedule,
        daysOfWeek: current.schedule.daysOfWeek.includes(day)
          ? current.schedule.daysOfWeek.filter((d) => d !== day)
          : [...current.schedule.daysOfWeek, day],
      },
    }))
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <span className="text-2xl">{metadata.icon}</span>
          {metadata.label} Configuration
        </DialogTitle>
        <DialogDescription>{metadata.description}</DialogDescription>
      </DialogHeader>

      <div className="space-y-6 py-4">
        <div>
          <Label className="text-base font-semibold">Delivery Channels</Label>
          <div className="space-y-2 mt-3">
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-2">
                <ChatCircle size={20} weight="duotone" />
                <span className="font-medium">LINE</span>
              </div>
              <Switch
                checked={editedRule.channels.line}
                onCheckedChange={(line) =>
                  setEditedRule((c) => ({ ...c, channels: { ...c.channels, line } }))
                }
              />
            </div>
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-2">
                <EnvelopeSimple size={20} weight="duotone" />
                <span className="font-medium">Email</span>
              </div>
              <Switch
                checked={editedRule.channels.email}
                onCheckedChange={(email) =>
                  setEditedRule((c) => ({ ...c, channels: { ...c.channels, email } }))
                }
              />
            </div>
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-2">
                <DeviceMobile size={20} weight="duotone" />
                <span className="font-medium">SMS</span>
              </div>
              <Switch
                checked={editedRule.channels.sms}
                onCheckedChange={(sms) =>
                  setEditedRule((c) => ({ ...c, channels: { ...c.channels, sms } }))
                }
              />
            </div>
          </div>
        </div>

        <Separator />

        <div>
          <Label className="text-base font-semibold">Recipients by Role</Label>
          <p className="text-xs text-muted-foreground mt-1 mb-3">
            All active staff with these roles will receive alerts
          </p>
          <div className="flex flex-wrap gap-2">
            {(['ADMIN', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPING', 'CASHIER', 'MAINTENANCE'] as StaffRole[]).map(
              (role) => (
                <Badge
                  key={role}
                  variant={editedRule.recipientsByRole.includes(role) ? 'default' : 'outline'}
                  className="cursor-pointer px-3 py-1.5"
                  onClick={() => handleToggleRole(role)}
                >
                  {editedRule.recipientsByRole.includes(role) && (
                    <CheckCircle size={14} className="mr-1" weight="bold" />
                  )}
                  {role.replace('_', ' ')}
                </Badge>
              )
            )}
          </div>
        </div>

        <Separator />

        <div>
          <div className="flex items-center justify-between mb-3">
            <Label className="text-base font-semibold">Throttling</Label>
            <Switch
              checked={editedRule.throttle.enabled}
              onCheckedChange={(enabled) =>
                setEditedRule((c) => ({
                  ...c,
                  throttle: { ...c.throttle, enabled },
                }))
              }
            />
          </div>
          {editedRule.throttle.enabled && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Max per Hour</Label>
                <Input
                  type="number"
                  value={editedRule.throttle.maxPerHour}
                  onChange={(e) =>
                    setEditedRule((c) => ({
                      ...c,
                      throttle: { ...c.throttle, maxPerHour: parseInt(e.target.value) || 0 },
                    }))
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Max per Day</Label>
                <Input
                  type="number"
                  value={editedRule.throttle.maxPerDay}
                  onChange={(e) =>
                    setEditedRule((c) => ({
                      ...c,
                      throttle: { ...c.throttle, maxPerDay: parseInt(e.target.value) || 0 },
                    }))
                  }
                />
              </div>
            </div>
          )}
        </div>

        <Separator />

        <div>
          <div className="flex items-center justify-between mb-3">
            <Label className="text-base font-semibold">Schedule</Label>
            <Switch
              checked={editedRule.schedule.enabled}
              onCheckedChange={(enabled) =>
                setEditedRule((c) => ({
                  ...c,
                  schedule: { ...c.schedule, enabled },
                }))
              }
            />
          </div>
          {editedRule.schedule.enabled && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <span className="text-sm">Only during business hours</span>
                <Switch
                  checked={editedRule.schedule.onlyDuringBusinessHours}
                  onCheckedChange={(onlyDuringBusinessHours) =>
                    setEditedRule((c) => ({
                      ...c,
                      schedule: { ...c.schedule, onlyDuringBusinessHours },
                    }))
                  }
                />
              </div>
              {editedRule.schedule.onlyDuringBusinessHours && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">Start Time</Label>
                    <Input
                      type="time"
                      value={editedRule.schedule.businessHoursStart}
                      onChange={(e) =>
                        setEditedRule((c) => ({
                          ...c,
                          schedule: { ...c.schedule, businessHoursStart: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-xs">End Time</Label>
                    <Input
                      type="time"
                      value={editedRule.schedule.businessHoursEnd}
                      onChange={(e) =>
                        setEditedRule((c) => ({
                          ...c,
                          schedule: { ...c.schedule, businessHoursEnd: e.target.value },
                        }))
                      }
                    />
                  </div>
                </div>
              )}
              <div>
                <Label className="text-xs mb-2 block">Days of Week</Label>
                <div className="flex gap-2">
                  {DAYS_OF_WEEK.map((day) => (
                    <Badge
                      key={day.value}
                      variant={
                        editedRule.schedule.daysOfWeek.includes(day.value) ? 'default' : 'outline'
                      }
                      className="cursor-pointer px-3 py-1.5"
                      onClick={() => handleToggleDay(day.value)}
                    >
                      {day.label}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <Separator />

        <div>
          <div className="flex items-center justify-between mb-3">
            <Label className="text-base font-semibold">Test Mode</Label>
            <Switch
              checked={editedRule.testMode}
              onCheckedChange={(testMode) =>
                setEditedRule((c) => ({ ...c, testMode }))
              }
            />
          </div>
          {editedRule.testMode && (
            <Alert>
              <Info size={18} />
              <AlertDescription>
                Test mode is enabled. Alerts will be suppressed for all recipients except those
                configured in LINE Settings test mode.
              </AlertDescription>
            </Alert>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => onSave(editedRule)}>Save Configuration</Button>
      </DialogFooter>
    </>
  )
}

interface PriorityBadgeProps {
  priority: AlertRoutingRule['priority']
}

function PriorityBadge({ priority }: PriorityBadgeProps) {
  const config = {
    LOW: { label: 'Low', className: 'bg-gray-100 text-gray-700' },
    MEDIUM: { label: 'Medium', className: 'bg-blue-100 text-blue-700' },
    HIGH: { label: 'High', className: 'bg-orange-100 text-orange-700' },
    CRITICAL: { label: 'Critical', className: 'bg-red-100 text-red-700' },
  }

  const { label, className } = config[priority]

  return (
    <Badge variant="secondary" className={`${className} text-xs`}>
      {label}
    </Badge>
  )
}
