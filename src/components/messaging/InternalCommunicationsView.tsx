import { useState, useMemo } from 'react'
import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { 
  ChatCenteredDots,
  PaperPlaneTilt,
  Hash,
  Bell,
  BellSlash,
  Users,
  DotsThreeVertical,
  PushPin,
  Warning,
  Check,
  CheckCircle,
  Circle,
  CircleDashed,
  Plus,
  MagnifyingGlass,
  Paperclip,
  X,
  BookOpen,
} from '@phosphor-icons/react'
import type { InternalMessage, InternalChannel, StaffMember, StaffDepartment, InternalMessagePriority } from '@/types/messaging'
import { MessageTemplatesDialog } from './MessageTemplatesDialog'
import { toast } from 'sonner'
import { format, formatDistanceToNow } from 'date-fns'

const DEPARTMENTS = [
  { value: 'FRONT_DESK', label: 'Front Desk', color: 'bg-blue-500' },
  { value: 'HOUSEKEEPING', label: 'Housekeeping', color: 'bg-green-500' },
  { value: 'MAINTENANCE', label: 'Maintenance', color: 'bg-orange-500' },
  { value: 'MANAGEMENT', label: 'Management', color: 'bg-purple-500' },
  { value: 'CASHIER', label: 'Cashier', color: 'bg-pink-500' },
  { value: 'ALL', label: 'All Staff', color: 'bg-gray-500' },
] as const

export function InternalCommunicationsView() {
  const [messages, setMessages] = useKV<InternalMessage[]>('internal-messages', [])
  const [channels, setChannels] = useKV<InternalChannel[]>('internal-channels', [
    {
      id: 'general',
      name: 'general',
      description: 'General hotel updates and announcements',
      type: 'ANNOUNCEMENT',
      members: [],
      admins: [],
      isPinned: true,
      isArchived: false,
      unreadCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'front-desk',
      name: 'front-desk',
      description: 'Front desk coordination and guest issues',
      type: 'DEPARTMENT',
      department: 'FRONT_DESK',
      members: [],
      admins: [],
      isPinned: true,
      isArchived: false,
      unreadCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'housekeeping',
      name: 'housekeeping',
      description: 'Room status and cleaning coordination',
      type: 'DEPARTMENT',
      department: 'HOUSEKEEPING',
      members: [],
      admins: [],
      isPinned: true,
      isArchived: false,
      unreadCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ])
  const [staff] = useKV<StaffMember[]>('staff-members', [
    {
      id: 'staff-1',
      name: 'Sarah Chen',
      department: 'FRONT_DESK',
      role: 'Front Desk Manager',
      isOnline: true,
    },
    {
      id: 'staff-2',
      name: 'Michael Rodriguez',
      department: 'HOUSEKEEPING',
      role: 'Housekeeping Supervisor',
      isOnline: true,
    },
    {
      id: 'staff-3',
      name: 'Emma Thompson',
      department: 'MANAGEMENT',
      role: 'General Manager',
      isOnline: false,
      lastSeen: new Date(Date.now() - 3600000),
    },
    {
      id: 'staff-4',
      name: 'David Kim',
      department: 'MAINTENANCE',
      role: 'Maintenance Lead',
      isOnline: true,
    },
  ])

  const [selectedChannel, setSelectedChannel] = useState<InternalChannel | null>(channels?.[0] || null)
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null)
  const [messageInput, setMessageInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showNewChannel, setShowNewChannel] = useState(false)
  const [showNewMessage, setShowNewMessage] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)

  const currentUserId = 'current-user'
  const currentUserName = 'You'
  const currentUserDept: StaffDepartment = 'FRONT_DESK'

  const channelMessages = useMemo(() => {
    if (!selectedChannel) return []
    return (messages || [])
      .filter(m => m.channelId === selectedChannel.id)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [messages, selectedChannel])

  const directMessages = useMemo(() => {
    if (!selectedStaff) return []
    return (messages || [])
      .filter(m => 
        (m.senderId === currentUserId && m.recipientId === selectedStaff.id) ||
        (m.senderId === selectedStaff.id && m.recipientId === currentUserId)
      )
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [messages, selectedStaff])

  const unreadCount = useMemo(() => {
    return (messages || []).filter(m => 
      !m.isRead && 
      m.senderId !== currentUserId && 
      (m.recipientId === currentUserId || m.channelId)
    ).length
  }, [messages])

  const urgentMessages = useMemo(() => {
    return (messages || []).filter(m => m.isUrgent && !m.isRead && m.senderId !== currentUserId)
  }, [messages])

  const handleSendMessage = (priority: InternalMessagePriority = 'NORMAL') => {
    if (!messageInput.trim()) return

    const newMessage: InternalMessage = {
      id: `msg-${Date.now()}`,
      type: selectedChannel ? 'CHANNEL' : 'DIRECT',
      priority,
      senderId: currentUserId,
      senderName: currentUserName,
      senderDepartment: currentUserDept,
      recipientId: selectedStaff?.id,
      recipientName: selectedStaff?.name,
      channelId: selectedChannel?.id,
      channelName: selectedChannel?.name,
      body: messageInput,
      isRead: false,
      readBy: [],
      isPinned: false,
      isUrgent: priority === 'URGENT',
      requiresAcknowledgment: priority === 'URGENT',
      acknowledgedBy: [],
      mentions: [],
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    setMessages((current) => [...(current || []), newMessage])
    setMessageInput('')
    
    if (priority === 'URGENT') {
      toast.success('Urgent message sent!', {
        description: 'All recipients will be notified immediately.',
      })
    } else {
      toast.success('Message sent')
    }
  }

  const handleMarkAsRead = (messageId: string) => {
    setMessages((current) =>
      (current || []).map(m =>
        m.id === messageId
          ? {
              ...m,
              isRead: true,
              readBy: [...m.readBy, currentUserId],
              readAt: { ...m.readAt, [currentUserId]: new Date() },
            }
          : m
      )
    )
  }

  const handlePinMessage = (messageId: string) => {
    setMessages((current) =>
      (current || []).map(m =>
        m.id === messageId ? { ...m, isPinned: !m.isPinned } : m
      )
    )
    toast.success('Message pinned')
  }

  const handleAcknowledge = (messageId: string) => {
    setMessages((current) =>
      (current || []).map(m =>
        m.id === messageId
          ? { ...m, acknowledgedBy: [...m.acknowledgedBy, currentUserId] }
          : m
      )
    )
    toast.success('Message acknowledged')
  }

  const displayMessages = selectedChannel ? channelMessages : directMessages

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="border-b bg-card px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <ChatCenteredDots size={24} weight="bold" className="text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Staff Communications</h1>
            <p className="text-sm text-muted-foreground">Internal messaging and coordination</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Badge variant="destructive" className="h-8 px-3">
              {unreadCount} unread
            </Badge>
          )}
          {urgentMessages.length > 0 && (
            <Button variant="destructive" size="sm">
              <Warning size={16} weight="bold" className="mr-2" />
              {urgentMessages.length} urgent
            </Button>
          )}
          <Button variant="outline" onClick={() => setShowTemplates(true)}>
            <BookOpen size={16} weight="bold" className="mr-2" />
            Templates
          </Button>
          <Button variant="outline" onClick={() => setShowNewChannel(true)}>
            <Hash size={16} weight="bold" className="mr-2" />
            New Channel
          </Button>
          <Button onClick={() => setShowNewMessage(true)}>
            <Plus size={16} weight="bold" className="mr-2" />
            New Message
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-80 border-r bg-muted/30 flex flex-col">
          <div className="p-4 border-b">
            <div className="relative">
              <MagnifyingGlass 
                size={16} 
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                placeholder="Search messages..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-3 space-y-1">
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">
                Channels
              </div>
              {(channels || []).filter(c => !c.isArchived).map(channel => (
                <button
                  key={channel.id}
                  onClick={() => {
                    setSelectedChannel(channel)
                    setSelectedStaff(null)
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                    selectedChannel?.id === channel.id
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'hover:bg-muted text-foreground'
                  }`}
                >
                  <Hash size={18} weight="bold" />
                  <span className="flex-1 text-left">{channel.name}</span>
                  {channel.unreadCount > 0 && (
                    <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                      {channel.unreadCount}
                    </Badge>
                  )}
                  {channel.isPinned && (
                    <PushPin size={14} weight="fill" className="text-muted-foreground" />
                  )}
                </button>
              ))}

              <Separator className="my-4" />

              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">
                Direct Messages
              </div>
              {(staff || []).map(member => {
                const dmCount = (messages || []).filter(
                  m => m.senderId === member.id && m.recipientId === currentUserId && !m.isRead
                ).length
                return (
                  <button
                    key={member.id}
                    onClick={() => {
                      setSelectedStaff(member)
                      setSelectedChannel(null)
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedStaff?.id === member.id
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'hover:bg-muted text-foreground'
                    }`}
                  >
                    <div className="relative">
                      <Avatar className="w-7 h-7">
                        <AvatarFallback className="text-xs">
                          {member.name.split(' ').map(n => n[0]).join('')}
                        </AvatarFallback>
                      </Avatar>
                      <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background ${
                        member.isOnline ? 'bg-green-500' : 'bg-gray-400'
                      }`} />
                    </div>
                    <div className="flex-1 text-left">
                      <div className="font-medium">{member.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {member.isOnline ? 'Online' : member.lastSeen ? formatDistanceToNow(new Date(member.lastSeen), { addSuffix: true }) : 'Offline'}
                      </div>
                    </div>
                    {dmCount > 0 && (
                      <Badge variant="destructive" className="h-5 px-1.5 text-xs">
                        {dmCount}
                      </Badge>
                    )}
                  </button>
                )
              })}
            </div>
          </ScrollArea>
        </div>

        <div className="flex-1 flex flex-col">
          <div className="border-b bg-card px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {selectedChannel ? (
                <>
                  <Hash size={24} weight="bold" className="text-muted-foreground" />
                  <div>
                    <h2 className="font-semibold">{selectedChannel.name}</h2>
                    <p className="text-xs text-muted-foreground">{selectedChannel.description}</p>
                  </div>
                </>
              ) : selectedStaff ? (
                <>
                  <Avatar className="w-8 h-8">
                    <AvatarFallback>
                      {selectedStaff.name.split(' ').map(n => n[0]).join('')}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h2 className="font-semibold">{selectedStaff.name}</h2>
                    <p className="text-xs text-muted-foreground">
                      {selectedStaff.role} • {selectedStaff.isOnline ? 'Online' : 'Offline'}
                    </p>
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground">Select a channel or staff member</div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon">
                <Bell size={20} />
              </Button>
              <Button variant="ghost" size="icon">
                <Users size={20} />
              </Button>
              <Button variant="ghost" size="icon">
                <DotsThreeVertical size={20} weight="bold" />
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1 px-6 py-4">
            <div className="space-y-4 max-w-4xl">
              {displayMessages.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <ChatCenteredDots size={48} className="mx-auto mb-3 opacity-30" />
                  <p>No messages yet. Start the conversation!</p>
                </div>
              ) : (
                displayMessages.map((message) => (
                  <MessageItem
                    key={message.id}
                    message={message}
                    isCurrentUser={message.senderId === currentUserId}
                    onMarkRead={() => handleMarkAsRead(message.id)}
                    onPin={() => handlePinMessage(message.id)}
                    onAcknowledge={() => handleAcknowledge(message.id)}
                  />
                ))
              )}
            </div>
          </ScrollArea>

          {(selectedChannel || selectedStaff) && (
            <div className="border-t bg-card p-4">
              <div className="max-w-4xl flex gap-2">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="shrink-0"
                  onClick={() => setShowTemplates(true)}
                  title="Use template"
                >
                  <BookOpen size={20} />
                </Button>
                <Button variant="ghost" size="icon" className="shrink-0">
                  <Paperclip size={20} />
                </Button>
                <Input
                  placeholder={`Message ${selectedChannel ? `#${selectedChannel.name}` : selectedStaff?.name}...`}
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSendMessage()
                    }
                  }}
                  className="flex-1"
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="shrink-0">
                      <DotsThreeVertical size={20} weight="bold" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleSendMessage('NORMAL')}>
                      Send Normal
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleSendMessage('HIGH')}>
                      <Warning size={16} weight="bold" className="mr-2 text-orange-500" />
                      Send High Priority
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleSendMessage('URGENT')}>
                      <Warning size={16} weight="bold" className="mr-2 text-red-500" />
                      Send Urgent
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button onClick={() => handleSendMessage()} className="shrink-0">
                  <PaperPlaneTilt size={20} weight="bold" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <NewChannelDialog
        open={showNewChannel}
        onOpenChange={setShowNewChannel}
        onCreateChannel={(channel) => {
          setChannels((current) => [...(current || []), channel])
          toast.success(`Channel #${channel.name} created`)
        }}
      />

      <NewMessageDialog
        open={showNewMessage}
        onOpenChange={setShowNewMessage}
        staff={staff || []}
        channels={channels || []}
        onSendMessage={(message) => {
          setMessages((current) => [...(current || []), message])
          toast.success('Message sent')
        }}
      />

      <MessageTemplatesDialog
        open={showTemplates}
        onOpenChange={setShowTemplates}
        staff={staff || []}
        channels={channels || []}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        currentUserDept={currentUserDept}
        onSendMessage={(message) => {
          setMessages((current) => [...(current || []), message])
        }}
      />
    </div>
  )
}

interface MessageItemProps {
  message: InternalMessage
  isCurrentUser: boolean
  onMarkRead: () => void
  onPin: () => void
  onAcknowledge: () => void
}

function MessageItem({ message, isCurrentUser, onMarkRead, onPin, onAcknowledge }: MessageItemProps) {
  return (
    <div className={`flex gap-3 group ${message.isPinned ? 'bg-amber-50 dark:bg-amber-950/20 -mx-4 px-4 py-2 rounded-lg' : ''}`}>
      <Avatar className="w-9 h-9 shrink-0">
        <AvatarFallback className="text-xs">
          {message.senderName.split(' ').map(n => n[0]).join('')}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-sm">{message.senderName}</span>
          <DepartmentBadge department={message.senderDepartment} />
          <span className="text-xs text-muted-foreground">
            {format(new Date(message.createdAt), 'h:mm a')}
          </span>
          {message.isUrgent && (
            <Badge variant="destructive" className="h-5">
              <Warning size={12} weight="bold" className="mr-1" />
              URGENT
            </Badge>
          )}
          {message.priority === 'HIGH' && (
            <Badge variant="secondary" className="h-5 bg-orange-100 text-orange-700">
              HIGH
            </Badge>
          )}
          {message.isPinned && (
            <PushPin size={14} weight="fill" className="text-amber-600" />
          )}
        </div>
        <div className="text-sm whitespace-pre-wrap break-words">{message.body}</div>
        
        {message.requiresAcknowledgment && (
          <div className="mt-2 flex items-center gap-2">
            {message.acknowledgedBy.includes('current-user') ? (
              <Badge variant="secondary" className="h-6 bg-green-100 text-green-700">
                <CheckCircle size={14} weight="bold" className="mr-1" />
                Acknowledged
              </Badge>
            ) : (
              <Button size="sm" variant="outline" onClick={onAcknowledge}>
                <Check size={16} className="mr-1" />
                Acknowledge
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {message.acknowledgedBy.length} acknowledged
            </span>
          </div>
        )}

        <div className="mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button size="sm" variant="ghost" className="h-7 px-2">
            <ChatCenteredDots size={14} />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onPin}>
            <PushPin size={14} />
          </Button>
          {!message.isRead && !isCurrentUser && (
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onMarkRead}>
              <CheckCircle size={14} />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

interface DepartmentBadgeProps {
  department: StaffDepartment
}

function DepartmentBadge({ department }: DepartmentBadgeProps) {
  const dept = DEPARTMENTS.find(d => d.value === department)
  if (!dept) return null

  return (
    <Badge variant="secondary" className="h-5 text-xs">
      {dept.label}
    </Badge>
  )
}

interface NewChannelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreateChannel: (channel: InternalChannel) => void
}

function NewChannelDialog({ open, onOpenChange, onCreateChannel }: NewChannelDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<'DEPARTMENT' | 'TEAM' | 'ANNOUNCEMENT'>('TEAM')

  const handleCreate = () => {
    if (!name.trim()) {
      toast.error('Please enter a channel name')
      return
    }

    const channel: InternalChannel = {
      id: `channel-${Date.now()}`,
      name: name.toLowerCase().replace(/\s+/g, '-'),
      description,
      type,
      members: [],
      admins: [],
      isPinned: false,
      isArchived: false,
      unreadCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    onCreateChannel(channel)
    onOpenChange(false)
    setName('')
    setDescription('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Channel</DialogTitle>
          <DialogDescription>
            Create a new channel for team communication
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <Label>Channel Name</Label>
            <Input
              placeholder="e.g. maintenance-alerts"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <Label>Description</Label>
            <Textarea
              placeholder="What is this channel for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={(v: any) => setType(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TEAM">Team Channel</SelectItem>
                <SelectItem value="DEPARTMENT">Department Channel</SelectItem>
                <SelectItem value="ANNOUNCEMENT">Announcement Channel</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate}>Create Channel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface NewMessageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  staff: StaffMember[]
  channels: InternalChannel[]
  onSendMessage: (message: InternalMessage) => void
}

function NewMessageDialog({ open, onOpenChange, staff, channels, onSendMessage }: NewMessageDialogProps) {
  const [type, setType] = useState<'DIRECT' | 'CHANNEL' | 'BROADCAST'>('DIRECT')
  const [recipientId, setRecipientId] = useState('')
  const [channelId, setChannelId] = useState('')
  const [department, setDepartment] = useState<StaffDepartment>('ALL')
  const [priority, setPriority] = useState<InternalMessagePriority>('NORMAL')
  const [body, setBody] = useState('')

  const handleSend = () => {
    if (!body.trim()) {
      toast.error('Please enter a message')
      return
    }

    const recipient = staff.find(s => s.id === recipientId)
    const channel = channels.find(c => c.id === channelId)

    const message: InternalMessage = {
      id: `msg-${Date.now()}`,
      type,
      priority,
      senderId: 'current-user',
      senderName: 'You',
      senderDepartment: 'FRONT_DESK',
      recipientId: type === 'DIRECT' ? recipientId : undefined,
      recipientName: recipient?.name,
      channelId: type === 'CHANNEL' ? channelId : undefined,
      channelName: channel?.name,
      department: type === 'BROADCAST' ? department : undefined,
      body,
      isRead: false,
      readBy: [],
      isPinned: false,
      isUrgent: priority === 'URGENT',
      requiresAcknowledgment: priority === 'URGENT',
      acknowledgedBy: [],
      mentions: [],
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    onSendMessage(message)
    onOpenChange(false)
    setBody('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Message</DialogTitle>
          <DialogDescription>
            Send a message to staff members or channels
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <Label>Message Type</Label>
            <Select value={type} onValueChange={(v: any) => setType(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DIRECT">Direct Message</SelectItem>
                <SelectItem value="CHANNEL">Channel Message</SelectItem>
                <SelectItem value="BROADCAST">Broadcast to Department</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {type === 'DIRECT' && (
            <div>
              <Label>Recipient</Label>
              <Select value={recipientId} onValueChange={setRecipientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a staff member" />
                </SelectTrigger>
                <SelectContent>
                  {staff.map(member => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name} - {member.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {type === 'CHANNEL' && (
            <div>
              <Label>Channel</Label>
              <Select value={channelId} onValueChange={setChannelId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a channel" />
                </SelectTrigger>
                <SelectContent>
                  {channels.map(channel => (
                    <SelectItem key={channel.id} value={channel.id}>
                      #{channel.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {type === 'BROADCAST' && (
            <div>
              <Label>Department</Label>
              <Select value={department} onValueChange={(v: any) => setDepartment(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEPARTMENTS.map(dept => (
                    <SelectItem key={dept.value} value={dept.value}>
                      {dept.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label>Priority</Label>
            <Select value={priority} onValueChange={(v: any) => setPriority(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NORMAL">Normal</SelectItem>
                <SelectItem value="HIGH">
                  <div className="flex items-center gap-2">
                    <Warning size={16} weight="bold" className="text-orange-500" />
                    High Priority
                  </div>
                </SelectItem>
                <SelectItem value="URGENT">
                  <div className="flex items-center gap-2">
                    <Warning size={16} weight="bold" className="text-red-500" />
                    Urgent (Requires Acknowledgment)
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Message</Label>
            <Textarea
              placeholder="Type your message..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSend}>
            <PaperPlaneTilt size={20} className="mr-2" weight="bold" />
            Send Message
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
