import { useEffect, useState } from 'react'
import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
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
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import { 
  ChatCircle, 
  PaperPlaneTilt, 
  Clock,
  CheckCircle,
  XCircle,
  Plus,
  MagnifyingGlass,
  Gear,
  ChatsCircle
} from '@phosphor-icons/react'
import type { Message, MessageTemplate, MessageChannel, MessageType, MessageStats } from '@/types/messaging'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { useNavigation } from '@/hooks/use-navigation'
import { pmsApi, SERVER_API_ENABLED } from '@/lib/pms-api-client'

function normalizeServerMessage(record: any): Message {
  const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {}
  return {
    id: String(record.id),
    templateId: record.templateId || undefined,
    channel: record.channel,
    type: record.type || metadata.type || 'CUSTOM',
    recipientType: record.recipientType || 'GUEST',
    recipientId: record.recipientId || undefined,
    recipientName: record.recipientName || metadata.recipientName || 'Guest',
    recipientContact: record.recipientContact || metadata.recipientContact || '',
    reservationId: record.reservationId || metadata.reservationId || undefined,
    roomNumber: record.roomNumber || metadata.roomNumber || undefined,
    subject: record.subject || undefined,
    body: record.body || '',
    status: record.status === 'PENDING' ? 'DRAFT' : record.status,
    sentAt: record.sentAt ? new Date(record.sentAt) : undefined,
    deliveredAt: record.deliveredAt ? new Date(record.deliveredAt) : undefined,
    failureReason: record.errorMessage || undefined,
    metadata,
    createdBy: record.createdBy || metadata.createdBy || 'PMS staff',
    createdAt: new Date(record.createdAt),
  }
}

function normalizeServerTemplate(record: any): MessageTemplate {
  return {
    id: String(record.id),
    name: record.name,
    type: record.type || 'CUSTOM',
    channel: record.channel,
    subject: record.subject || undefined,
    body: record.body,
    variables: Array.isArray(record.variables) ? record.variables : [],
    isActive: record.active !== false,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  }
}

export function CommunicationCenterView() {
  const { navigate } = useNavigation()
  const [localMessages, setLocalMessages] = useKV<Message[]>('messages', [])
  const [localTemplates] = useKV<MessageTemplate[]>('message-templates', [])
  const [serverMessages, setServerMessages] = useState<Message[]>([])
  const [serverTemplates, setServerTemplates] = useState<MessageTemplate[]>([])
  const [serverError, setServerError] = useState<string | null>(null)
  const [serverLoading, setServerLoading] = useState(SERVER_API_ENABLED)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null)
  const [showNewMessage, setShowNewMessage] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<MessageTemplate | null>(null)
  const messages = SERVER_API_ENABLED ? serverMessages : localMessages || []
  const templates = SERVER_API_ENABLED ? serverTemplates : localTemplates || []

  useEffect(() => {
    if (!SERVER_API_ENABLED) return
    let cancelled = false
    setServerLoading(true)
    setServerError(null)
    void Promise.all([
      pmsApi<{ ok: true; data: any[] }>('/api/messages', null),
      pmsApi<{ ok: true; data: any[] }>('/api/message-templates', null),
    ])
      .then(([messagePayload, templatePayload]) => {
        if (cancelled) return
        setServerMessages((messagePayload.data || []).map(normalizeServerMessage))
        setServerTemplates((templatePayload.data || []).map(normalizeServerTemplate))
      })
      .catch((error) => {
        if (!cancelled) setServerError(error instanceof Error ? error.message : 'Messaging records could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setServerLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const saveDraft = async (message: Message) => {
    if (!SERVER_API_ENABLED) {
      setLocalMessages((current) => [...(current || []), message])
      toast.success('Message draft recorded for ' + message.channel)
      setShowNewMessage(false)
      return
    }

    const payload = await pmsApi<{ ok: true; data: any }>('/api/messages', null, {
      method: 'POST',
      body: JSON.stringify({
        channel: message.channel,
        type: message.type,
        recipientType: message.recipientType,
        recipientName: message.recipientName,
        recipientContact: message.recipientContact,
        roomNumber: message.roomNumber,
        body: message.body,
        templateId: message.templateId,
        subject: message.subject,
        idempotencyKey: String(message.metadata?.idempotencyKey || ''),
      }),
    })
    setServerMessages((current) => [normalizeServerMessage(payload.data), ...current])
    toast.success('Draft saved to the PMS. No provider delivery was attempted.')
    setShowNewMessage(false)
  }

  const filteredMessages = messages.filter(msg =>
    searchQuery === '' || 
    msg.recipientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    msg.roomNumber?.includes(searchQuery) ||
    msg.body.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const sentMessages = filteredMessages.filter(m => m.status === 'SENT' || m.status === 'DELIVERED' || m.status === 'READ')
  const scheduledMessages = filteredMessages.filter(m => m.status === 'SCHEDULED')
  const failedMessages = filteredMessages.filter(m => m.status === 'FAILED')

  const stats: MessageStats = {
    totalSent: messages.filter(m => m.status === 'SENT' || m.status === 'DELIVERED' || m.status === 'READ').length,
    totalDelivered: messages.filter(m => m.status === 'DELIVERED' || m.status === 'READ').length,
    totalFailed: messages.filter(m => m.status === 'FAILED').length,
    byChannel: {
      LINE: messages.filter(m => m.channel === 'LINE').length,
      EMAIL: messages.filter(m => m.channel === 'EMAIL').length,
      SMS: messages.filter(m => m.channel === 'SMS').length,
      WHATSAPP: messages.filter(m => m.channel === 'WHATSAPP').length,
    },
    byType: {} as Record<MessageType, number>,
    deliveryRate: 0
  }

  if (stats.totalSent > 0) {
    stats.deliveryRate = (stats.totalDelivered / stats.totalSent) * 100
  }

  return (
    <div className="min-h-screen bg-background">
      {SERVER_API_ENABLED && (serverLoading || serverError) && (
        <div className="border-b bg-muted/40 px-6 py-3 text-sm text-muted-foreground">
          {serverLoading ? 'Loading persistent message drafts and templates…' : `Messaging unavailable: ${serverError}`}
        </div>
      )}
      <div className="border-b bg-card sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <ChatsCircle size={28} weight="bold" className="text-primary" />
              </div>
              <div>
                <h1 className="text-3xl font-semibold">Guest Communications</h1>
                <p className="text-sm text-muted-foreground mt-0.5">LINE-first messaging center</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="icon" onClick={() => navigate('settings')} aria-label="Communication settings">
                <Gear size={20} />
              </Button>
              <Dialog open={showNewMessage} onOpenChange={(open) => {
                setShowNewMessage(open)
                if (!open) setSelectedTemplate(null)
              }}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus size={20} className="mr-2" weight="bold" />
                    New Message
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <NewMessageForm 
                    templates={templates}
                    initialTemplate={selectedTemplate}
                    onClose={() => setShowNewMessage(false)}
                    onSend={saveDraft}
                  />
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <StatCard 
              label="Total Sent" 
              value={stats.totalSent} 
              icon={<PaperPlaneTilt size={20} weight="bold" />}
              className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800"
            />
            <StatCard 
              label="Delivered" 
              value={stats.totalDelivered} 
              icon={<CheckCircle size={20} weight="bold" />}
              className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800"
            />
            <StatCard 
              label="Failed" 
              value={stats.totalFailed} 
              icon={<XCircle size={20} weight="bold" />}
              className="bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800"
            />
            <StatCard 
              label="via LINE" 
              value={stats.byChannel.LINE} 
              icon={<ChatCircle size={20} weight="bold" />}
              className="bg-purple-50 dark:bg-purple-950 border-purple-200 dark:border-purple-800"
            />
          </div>

          <div className="relative mt-6">
            <MagnifyingGlass 
              size={20} 
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              placeholder="Search by guest name, room number, or content..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-11"
            />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        <Tabs defaultValue="sent" className="w-full">
          <TabsList>
            <TabsTrigger value="sent">
              Sent ({sentMessages.length})
            </TabsTrigger>
            <TabsTrigger value="scheduled">
              Scheduled ({scheduledMessages.length})
            </TabsTrigger>
            <TabsTrigger value="failed">
              Failed ({failedMessages.length})
            </TabsTrigger>
            <TabsTrigger value="templates">
              Templates ({templates.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sent" className="mt-6">
            <MessageList 
              messages={sentMessages} 
              onSelect={setSelectedMessage}
              emptyText="No messages sent yet"
            />
          </TabsContent>

          <TabsContent value="scheduled" className="mt-6">
            <MessageList 
              messages={scheduledMessages} 
              onSelect={setSelectedMessage}
              emptyText="No scheduled messages"
            />
          </TabsContent>

          <TabsContent value="failed" className="mt-6">
            <MessageList 
              messages={failedMessages} 
              onSelect={setSelectedMessage}
              emptyText="No failed messages"
            />
          </TabsContent>

          <TabsContent value="templates" className="mt-6">
            <TemplateList
              templates={templates}
              onCreate={() => toast.info('Template creation requires the dedicated audited template editor.')}
              onUse={(template) => {
                setSelectedTemplate(template)
                setShowNewMessage(true)
              }}
            />
          </TabsContent>
        </Tabs>
      </div>

      {selectedMessage && (
        <MessageDetailDialog 
          message={selectedMessage}
          onClose={() => setSelectedMessage(null)}
        />
      )}
    </div>
  )
}

interface StatCardProps {
  label: string
  value: number
  icon: React.ReactNode
  className?: string
}

function StatCard({ label, value, icon, className }: StatCardProps) {
  return (
    <Card className={`p-4 ${className || ''}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-2xl font-bold">{value}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
        </div>
        <div className="opacity-60">
          {icon}
        </div>
      </div>
    </Card>
  )
}

interface MessageListProps {
  messages: Message[]
  onSelect: (message: Message) => void
  emptyText: string
}

function MessageList({ messages, onSelect, emptyText }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <ChatCircle size={48} className="mx-auto mb-3 opacity-30" />
        <p>{emptyText}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {messages.map(message => (
        <Card 
          key={message.id}
          className="p-4 hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => onSelect(message)}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-medium">{message.recipientName}</span>
                {message.roomNumber && (
                  <Badge variant="secondary" className="text-xs">
                    Room {message.roomNumber}
                  </Badge>
                )}
                <ChannelBadge channel={message.channel} />
                <StatusBadge status={message.status} />
              </div>
              <div className="text-sm text-muted-foreground mb-1 line-clamp-2">
                {message.body}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock size={12} />
                <span>{format(new Date(message.createdAt), 'MMM d, h:mm a')}</span>
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

interface TemplateListProps {
  templates: MessageTemplate[]
  onCreate: () => void
  onUse: (template: MessageTemplate) => void
}

function TemplateList({ templates, onCreate, onUse }: TemplateListProps) {
  if (templates.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground mb-4">No templates created yet</p>
        <Button onClick={onCreate}>
          <Plus size={20} className="mr-2" weight="bold" />
          Compose Message
        </Button>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {templates.map(template => (
        <Card key={template.id} className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1">
              <h3 className="font-medium mb-1">{template.name}</h3>
              <div className="flex items-center gap-2">
                <ChannelBadge channel={template.channel} />
                <Badge variant="outline" className="text-xs">
                  {template.type.replace(/_/g, ' ')}
                </Badge>
              </div>
            </div>
          </div>
          <p className="text-sm text-muted-foreground line-clamp-3 mb-3">
            {template.body}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={() => onUse(template)}>
              Use
            </Button>
          </div>
        </Card>
      ))}
    </div>
  )
}

interface NewMessageFormProps {
  templates: MessageTemplate[]
  initialTemplate?: MessageTemplate | null
  onClose: () => void
  onSend: (message: Message) => Promise<void> | void
}

function NewMessageForm({ templates, initialTemplate, onClose, onSend }: NewMessageFormProps) {
  const [channel, setChannel] = useState<MessageChannel>(initialTemplate?.channel || 'LINE')
  const [recipientName, setRecipientName] = useState('')
  const [recipientContact, setRecipientContact] = useState('')
  const [roomNumber, setRoomNumber] = useState('')
  const [body, setBody] = useState(initialTemplate?.body || '')
  const [messageType, setMessageType] = useState<MessageType>(initialTemplate?.type || 'CUSTOM')
  const [templateId, setTemplateId] = useState(initialTemplate?.id || '')
  const [isSaving, setIsSaving] = useState(false)
  const [draftIdempotencyKey] = useState(() =>
    globalThis.crypto?.randomUUID?.() || `message-draft-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )

  const handleSend = async () => {
    if (!recipientName || !recipientContact || !body) {
      toast.error('Please fill all required fields')
      return
    }

    const message: Message = {
      id: `msg-${Date.now()}`,
      templateId: templateId || undefined,
      channel,
      type: messageType,
      recipientType: 'GUEST',
      recipientName,
      recipientContact,
      roomNumber: roomNumber || undefined,
      body,
      status: 'DRAFT',
      metadata: { idempotencyKey: draftIdempotencyKey },
      createdBy: 'Current User',
      createdAt: new Date()
    }

    setIsSaving(true)
    try {
      await onSend(message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The draft was not saved.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Record New Message</DialogTitle>
        <DialogDescription>
          Save a draft message. Delivery requires a configured messaging provider.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        {templates.length > 0 && (
          <div>
            <Label>Template (Optional)</Label>
            <Select value={templateId || 'none'} onValueChange={(value) => {
              setTemplateId(value === 'none' ? '' : value)
              const template = templates.find((candidate) => candidate.id === value)
              if (template) {
                setChannel(template.channel)
                setMessageType(template.type)
                setBody(template.body)
              }
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No template</SelectItem>
                {templates.filter((template) => template.isActive).map((template) => (
                  <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <Label>Channel</Label>
          <Select value={channel} onValueChange={(v) => setChannel(v as MessageChannel)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="LINE">
                <div className="flex items-center gap-2">
                  <ChatCircle size={16} weight="bold" />
                  <span>LINE (Recommended)</span>
                </div>
              </SelectItem>
              <SelectItem value="EMAIL">Email</SelectItem>
              <SelectItem value="SMS">SMS</SelectItem>
              <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Guest Name</Label>
            <Input 
              placeholder="Guest full name"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
            />
          </div>
          <div>
            <Label>Room Number (Optional)</Label>
            <Input 
              placeholder="201"
              value={roomNumber}
              onChange={(e) => setRoomNumber(e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label>
            {channel === 'LINE' ? 'LINE ID' : channel === 'EMAIL' ? 'Email Address' : channel === 'WHATSAPP' ? 'WhatsApp Number' : 'Phone Number'}
          </Label>
          <Input
            placeholder={
              channel === 'LINE' ? 'Guest LINE ID' :
              channel === 'EMAIL' ? 'Guest email address' :
              channel === 'WHATSAPP' ? 'Guest WhatsApp number' :
              'Guest phone number'
            }
            value={recipientContact}
            onChange={(e) => setRecipientContact(e.target.value)}
          />
        </div>

        <div>
          <Label>Message Type</Label>
          <Select value={messageType} onValueChange={(v) => setMessageType(v as MessageType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CUSTOM">Custom Message</SelectItem>
              <SelectItem value="BOOKING_CONFIRMATION">Booking Confirmation</SelectItem>
              <SelectItem value="PAYMENT_REMINDER">Payment Reminder</SelectItem>
              <SelectItem value="PRE_ARRIVAL">Pre-Arrival</SelectItem>
              <SelectItem value="CHECK_IN_READY">Check-in Ready</SelectItem>
              <SelectItem value="IN_STAY">In-Stay</SelectItem>
              <SelectItem value="POST_STAY">Post-Stay</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Message</Label>
          <Textarea 
            placeholder="Write your message here..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className="resize-none"
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button onClick={() => void handleSend()} disabled={isSaving}>
          <PaperPlaneTilt size={20} className="mr-2" weight="bold" />
          {isSaving ? 'Saving…' : 'Save Draft'}
        </Button>
      </DialogFooter>
    </>
  )
}

interface MessageDetailDialogProps {
  message: Message
  onClose: () => void
}

function MessageDetailDialog({ message, onClose }: MessageDetailDialogProps) {
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Message Details</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-center gap-2">
            <ChannelBadge channel={message.channel} />
            <StatusBadge status={message.status} />
            {message.roomNumber && (
              <Badge variant="secondary">Room {message.roomNumber}</Badge>
            )}
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Recipient</Label>
            <div className="font-medium">{message.recipientName}</div>
            <div className="text-sm text-muted-foreground">{message.recipientContact}</div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Message</Label>
            <div className="mt-1 p-4 bg-muted rounded-lg text-sm whitespace-pre-wrap">
              {message.body}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <Label className="text-xs text-muted-foreground">Sent At</Label>
              <div>{message.sentAt ? format(new Date(message.sentAt), 'MMM d, yyyy h:mm a') : '-'}</div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Delivered At</Label>
              <div>{message.deliveredAt ? format(new Date(message.deliveredAt), 'MMM d, yyyy h:mm a') : '-'}</div>
            </div>
          </div>

          {message.failureReason && (
            <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg">
              <Label className="text-xs text-red-700 dark:text-red-300">Failure Reason</Label>
              <div className="text-sm text-red-600 dark:text-red-400 mt-1">{message.failureReason}</div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface ChannelBadgeProps {
  channel: MessageChannel
}

function ChannelBadge({ channel }: ChannelBadgeProps) {
  const config = {
    LINE: { label: 'LINE', className: 'bg-green-500 text-white' },
    EMAIL: { label: 'Email', className: 'bg-blue-500 text-white' },
    SMS: { label: 'SMS', className: 'bg-purple-500 text-white' },
    WHATSAPP: { label: 'WhatsApp', className: 'bg-emerald-500 text-white' },
  }

  const { label, className } = config[channel]

  return (
    <Badge className={className}>
      {label}
    </Badge>
  )
}

interface StatusBadgeProps {
  status: Message['status']
}

function StatusBadge({ status }: StatusBadgeProps) {
  const config = {
    DRAFT: { label: 'Draft', className: 'bg-gray-100 text-gray-700' },
    SCHEDULED: { label: 'Scheduled', className: 'bg-blue-100 text-blue-700' },
    SENT: { label: 'Sent', className: 'bg-purple-100 text-purple-700' },
    DELIVERED: { label: 'Delivered', className: 'bg-green-100 text-green-700' },
    READ: { label: 'Read', className: 'bg-green-100 text-green-700' },
    FAILED: { label: 'Failed', className: 'bg-red-100 text-red-700' },
  }

  const { label, className } = config[status]

  return (
    <Badge variant="secondary" className={className}>
      {label}
    </Badge>
  )
}
