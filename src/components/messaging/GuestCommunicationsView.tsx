import { useState, useMemo } from 'react'
import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Envelope,
  ChatDots,
  DeviceMobile,
  PaperPlaneTilt,
  Plus,
  MagnifyingGlass,
  Check,
  X,
  Clock,
  CheckCircle,
  Warning,
  PencilSimple,
  Copy,
} from '@phosphor-icons/react'
import type { GuestMessage, GuestMessageTemplate, GuestMessageType, CommunicationChannel } from '@/types/guest-communications'
import type { PropertySetup } from '@/types/onboarding'
import { DEFAULT_GUEST_TEMPLATES, getTemplatesByType, replaceTemplateVariables } from '@/lib/guest-message-templates'
import { toast } from 'sonner'
import { format } from 'date-fns'

const MESSAGE_TYPES = [
  { value: 'BOOKING_CONFIRMATION', label: 'Booking Confirmation' },
  { value: 'PRE_ARRIVAL', label: 'Pre-Arrival' },
  { value: 'CHECK_IN', label: 'Check-In Welcome' },
  { value: 'IN_STAY', label: 'In-Stay' },
  { value: 'CHECK_OUT', label: 'Check-Out' },
  { value: 'POST_STAY', label: 'Post-Stay' },
  { value: 'SPECIAL_OFFER', label: 'Special Offer' },
  { value: 'CUSTOM', label: 'Custom' },
] as const

const CHANNEL_ICONS = {
  EMAIL: <Envelope weight="fill" className="w-4 h-4" />,
  SMS: <DeviceMobile weight="fill" className="w-4 h-4" />,
  LINE: <ChatDots weight="fill" className="w-4 h-4" />,
  WHATSAPP: <ChatDots weight="fill" className="w-4 h-4" />,
}

const STATUS_CONFIG = {
  DRAFT: { label: 'Draft', color: 'bg-gray-500', icon: <PencilSimple className="w-3 h-3" /> },
  SCHEDULED: { label: 'Scheduled', color: 'bg-blue-500', icon: <Clock className="w-3 h-3" /> },
  SENT: { label: 'Sent', color: 'bg-purple-500', icon: <PaperPlaneTilt className="w-3 h-3" /> },
  DELIVERED: { label: 'Delivered', color: 'bg-green-500', icon: <CheckCircle className="w-3 h-3" /> },
  READ: { label: 'Read', color: 'bg-teal-500', icon: <Check className="w-3 h-3" /> },
  FAILED: { label: 'Failed', color: 'bg-red-500', icon: <Warning className="w-3 h-3" /> },
}

export function GuestCommunicationsView() {
  const [messages, setMessages] = useKV<GuestMessage[]>('guest-messages', [])
  const [templates, setTemplates] = useKV<GuestMessageTemplate[]>('guest-message-templates', DEFAULT_GUEST_TEMPLATES)
  const [propertyData] = useKV<PropertySetup>('onboarding-property', {} as PropertySetup)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<GuestMessageType | 'ALL'>('ALL')
  const [filterStatus, setFilterStatus] = useState<string>('ALL')
  const [composerOpen, setComposerOpen] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<GuestMessageTemplate | null>(null)
  const [composeRecipient, setComposeRecipient] = useState('')
  const [composeSubject, setComposeSubject] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [composeType, setComposeType] = useState<GuestMessageType>('CUSTOM')
  const [composeChannel, setComposeChannel] = useState<CommunicationChannel>('EMAIL')

  const filteredMessages = useMemo(() => {
    return messages.filter(msg => {
      const matchesSearch = searchQuery === '' || 
        msg.recipient.toLowerCase().includes(searchQuery.toLowerCase()) ||
        msg.body.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (msg.subject && msg.subject.toLowerCase().includes(searchQuery.toLowerCase()))
      
      const matchesType = filterType === 'ALL' || msg.type === filterType
      const matchesStatus = filterStatus === 'ALL' || msg.status === filterStatus
      
      return matchesSearch && matchesType && matchesStatus
    })
  }, [messages, searchQuery, filterType, filterStatus])

  const stats = useMemo(() => {
    return {
      total: messages.length,
      sent: messages.filter(m => m.status === 'SENT' || m.status === 'DELIVERED' || m.status === 'READ').length,
      scheduled: messages.filter(m => m.status === 'SCHEDULED').length,
      failed: messages.filter(m => m.status === 'FAILED').length,
    }
  }, [messages])

  const resetComposer = () => {
    setComposeRecipient('')
    setComposeSubject('')
    setComposeBody('')
    setComposeType('CUSTOM')
    setComposeChannel('EMAIL')
  }

  const sendMessage = () => {
    if (!composeRecipient.trim() || !composeBody.trim()) {
      toast.error('Recipient and message body are required')
      return
    }

    const message: GuestMessage = {
      id: `msg-${Date.now()}`,
      guestId: `manual-${Date.now()}`,
      type: composeType,
      channel: composeChannel,
      recipient: composeRecipient.trim(),
      subject: composeSubject.trim() || undefined,
      body: composeBody.trim(),
      status: 'SENT',
      sentAt: new Date(),
      metadata: { manual: true },
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    setMessages(current => [message, ...current])
    resetComposer()
    setComposerOpen(false)
    toast.success('Message recorded')
  }

  const previewTemplate = (template: GuestMessageTemplate) => {
    setSelectedTemplate(template)
  }

  const previewBody = selectedTemplate
    ? replaceTemplateVariables(selectedTemplate.body, {
        hotelName: propertyData?.name || 'Property name',
        guestName: 'Guest Name',
        confirmationNumber: 'CONFIRMATION',
        checkInDate: 'Check-in date',
        checkInTime: 'Check-in time',
        checkOutDate: 'Check-out date',
        checkOutTime: 'Check-out time',
        roomType: 'Room type',
        roomNumber: 'Room number',
        guestCount: 'Guest count',
        totalAmount: 'Total amount',
        totalPaid: 'Total paid',
        hotelPhone: propertyData?.phone || 'Hotel phone',
        hotelAddress: propertyData?.address || 'Hotel address',
        wifiNetwork: 'WiFi network',
        wifiPassword: 'WiFi password',
        serviceTime: 'Service time',
        offerDetails: 'Offer details',
        promoCode: 'Promo code',
        expiryDate: 'Expiry date',
      })
    : ''

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="border-b border-border bg-card">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-semibold">Guest Communications</h1>
              <p className="text-sm text-muted-foreground mt-1">Automated and manual guest messaging</p>
            </div>
            <Button onClick={() => setComposerOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Compose Message
            </Button>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <Card className="p-4">
              <div className="text-xs text-muted-foreground mb-1">Total Messages</div>
              <div className="text-2xl font-bold">{stats.total}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground mb-1">Sent</div>
              <div className="text-2xl font-bold text-green-600">{stats.sent}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground mb-1">Scheduled</div>
              <div className="text-2xl font-bold text-blue-600">{stats.scheduled}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground mb-1">Failed</div>
              <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
            </Card>
          </div>
        </div>
      </div>

      <Tabs defaultValue="messages" className="flex-1 flex flex-col">
        <div className="border-b border-border px-6">
          <TabsList>
            <TabsTrigger value="messages">Messages</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="messages" className="flex-1 p-6 mt-0">
          <div className="flex gap-4 mb-6">
            <div className="relative flex-1">
              <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder="Search messages..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filterType} onValueChange={(v) => setFilterType(v as GuestMessageType | 'ALL')}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Types</SelectItem>
                {MESSAGE_TYPES.map(type => (
                  <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                  <SelectItem key={key} value={key}>{config.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Date</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMessages.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No messages found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredMessages.map(message => (
                    <TableRow key={message.id}>
                      <TableCell className="text-xs">
                        {format(new Date(message.createdAt), 'MMM dd, HH:mm')}
                      </TableCell>
                      <TableCell className="text-sm font-medium">{message.recipient}</TableCell>
                      <TableCell className="text-xs">
                        {MESSAGE_TYPES.find(t => t.value === message.type)?.label}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {CHANNEL_ICONS[message.channel]}
                          <span className="text-xs">{message.channel}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm truncate max-w-xs">{message.subject || '-'}</TableCell>
                      <TableCell>
                        <Badge className={`${STATUS_CONFIG[message.status].color} text-white`}>
                          {STATUS_CONFIG[message.status].label}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="templates" className="flex-1 p-6 mt-0">
          <div className="grid grid-cols-2 gap-4">
            {templates.map(template => (
              <Card key={template.id} className="p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold">{template.name}</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {MESSAGE_TYPES.find(t => t.value === template.type)?.label}
                    </p>
                  </div>
                  <Badge variant={template.isActive ? 'default' : 'secondary'}>
                    {template.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>

                {template.subject && (
                  <div className="mb-2">
                    <div className="text-xs text-muted-foreground">Subject:</div>
                    <div className="text-sm font-medium">{template.subject}</div>
                  </div>
                )}

                <div className="mb-3">
                  <div className="text-xs text-muted-foreground mb-1">Preview:</div>
                  <div className="text-xs bg-muted p-2 rounded max-h-24 overflow-hidden">
                    {template.body.slice(0, 150)}...
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  {template.channels.map(channel => (
                    <Badge key={channel} variant="outline" className="text-xs">
                      {channel}
                    </Badge>
                  ))}
                </div>

                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => previewTemplate(template)}>
                    <PaperPlaneTilt className="w-3 h-3 mr-1" />
                    Preview
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setSelectedTemplate(template)}>
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="settings" className="flex-1 p-6 mt-0">
          <Card className="p-6">
            <h3 className="font-semibold mb-4">Communication Settings</h3>
            <div className="space-y-4">
              <div>
                <Label>Sender Name</Label>
                <Input placeholder="Property name" className="mt-1" />
              </div>
              <div>
                <Label>Sender Email</Label>
                <Input type="email" placeholder="noreply@property.com" className="mt-1" />
              </div>
              <div>
                <Label>Reply-To Email</Label>
                <Input type="email" placeholder="info@property.com" className="mt-1" />
              </div>
              <Separator className="my-4" />
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Auto-send Booking Confirmations</div>
                  <div className="text-sm text-muted-foreground">Automatically send confirmation emails when booking is created</div>
                </div>
                <input type="checkbox" defaultChecked className="toggle" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Auto-send Pre-Arrival Messages</div>
                  <div className="text-sm text-muted-foreground">Send welcome message 24 hours before check-in</div>
                </div>
                <input type="checkbox" defaultChecked className="toggle" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Auto-send Check-out Thank You</div>
                  <div className="text-sm text-muted-foreground">Send thank you message after check-out</div>
                </div>
                <input type="checkbox" defaultChecked className="toggle" />
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={composerOpen} onOpenChange={setComposerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Compose Message</DialogTitle>
            <DialogDescription>
              Create a manual guest message and record it in the communication log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Message Type</Label>
                <Select value={composeType} onValueChange={(value) => setComposeType(value as GuestMessageType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MESSAGE_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Channel</Label>
                <Select value={composeChannel} onValueChange={(value) => setComposeChannel(value as CommunicationChannel)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EMAIL">Email</SelectItem>
                    <SelectItem value="SMS">SMS</SelectItem>
                    <SelectItem value="LINE">LINE</SelectItem>
                    <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Recipient</Label>
              <Input
                value={composeRecipient}
                onChange={(event) => setComposeRecipient(event.target.value)}
                placeholder="Email address, phone number, or channel ID"
              />
            </div>
            <div className="space-y-2">
              <Label>Subject</Label>
              <Input
                value={composeSubject}
                onChange={(event) => setComposeSubject(event.target.value)}
                placeholder="Optional subject"
              />
            </div>
            <div className="space-y-2">
              <Label>Message</Label>
              <Textarea
                value={composeBody}
                onChange={(event) => setComposeBody(event.target.value)}
                placeholder="Write the guest message"
                className="min-h-32"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComposerOpen(false)}>Cancel</Button>
            <Button onClick={sendMessage}>Record Message</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedTemplate} onOpenChange={(open) => !open && setSelectedTemplate(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedTemplate?.name}</DialogTitle>
            <DialogDescription>
              Template preview using neutral placeholder values.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {selectedTemplate?.subject && (
              <div className="space-y-1">
                <Label>Subject</Label>
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                  {selectedTemplate.subject}
                </div>
              </div>
            )}
            <div className="space-y-1">
              <Label>Message</Label>
              <div className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 px-3 py-2 text-sm">
                {previewBody}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setSelectedTemplate(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
