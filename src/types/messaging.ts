export type MessageChannel = 'LINE' | 'EMAIL' | 'SMS'
export type MessageStatus = 'DRAFT' | 'SCHEDULED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'
export type MessageType = 'BOOKING_CONFIRMATION' | 'PAYMENT_REMINDER' | 'PRE_ARRIVAL' | 'CHECK_IN_READY' | 'IN_STAY' | 'POST_STAY' | 'CUSTOM'
export type RecipientType = 'GUEST' | 'STAFF' | 'GROUP'

export interface MessageTemplate {
  id: string
  name: string
  type: MessageType
  channel: MessageChannel
  subject?: string
  body: string
  variables: string[]
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface Message {
  id: string
  templateId?: string
  channel: MessageChannel
  type: MessageType
  recipientType: RecipientType
  
  recipientId?: string
  recipientName: string
  recipientContact: string
  
  reservationId?: string
  roomNumber?: string
  
  subject?: string
  body: string
  
  status: MessageStatus
  scheduledFor?: Date
  sentAt?: Date
  deliveredAt?: Date
  readAt?: Date
  failureReason?: string
  
  metadata?: Record<string, unknown>
  createdBy: string
  createdAt: Date
}

export interface MessageHistory {
  reservationId: string
  guestName: string
  messages: Message[]
  totalSent: number
  lastContact?: Date
}

export interface LINEConfig {
  channelAccessToken: string
  channelSecret: string
  webhookUrl: string
  isActive: boolean
  testMode: boolean
  lastSync?: Date
  lastError?: string
}

export interface MessageStats {
  totalSent: number
  totalDelivered: number
  totalFailed: number
  byChannel: Record<MessageChannel, number>
  byType: Record<MessageType, number>
  deliveryRate: number
}

export interface StaffAlert {
  id: string
  type: 'NEW_BOOKING' | 'DEPOSIT_PENDING' | 'ARRIVAL_TODAY' | 'NO_SHOW' | 'SYNC_FAILURE' | 'MAINTENANCE' | 'CRITICAL'
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  title: string
  message: string
  reservationId?: string
  roomId?: string
  channel: MessageChannel
  recipients: string[]
  sentAt?: Date
  acknowledged: boolean
  acknowledgedBy?: string
  acknowledgedAt?: Date
  createdAt: Date
}

export interface CommunicationPreferences {
  guestId: string
  preferredChannel: MessageChannel
  lineId?: string
  email?: string
  phone?: string
  marketingOptIn: boolean
  allowPreArrival: boolean
  allowInStay: boolean
  allowPostStay: boolean
}

export type InternalMessageType = 'DIRECT' | 'CHANNEL' | 'BROADCAST' | 'URGENT' | 'HANDOVER'
export type InternalMessagePriority = 'NORMAL' | 'HIGH' | 'URGENT'
export type StaffDepartment = 'FRONT_DESK' | 'HOUSEKEEPING' | 'MAINTENANCE' | 'MANAGEMENT' | 'CASHIER' | 'ALL'

export interface StaffMember {
  id: string
  name: string
  department: StaffDepartment
  role: string
  avatar?: string
  isOnline: boolean
  lastSeen?: Date
}

export interface InternalMessage {
  id: string
  type: InternalMessageType
  priority: InternalMessagePriority
  senderId: string
  senderName: string
  senderDepartment: StaffDepartment
  
  recipientId?: string
  recipientName?: string
  channelId?: string
  channelName?: string
  department?: StaffDepartment
  
  subject?: string
  body: string
  attachments?: MessageAttachment[]
  
  threadId?: string
  parentMessageId?: string
  
  isRead: boolean
  readBy: string[]
  readAt?: Record<string, Date>
  
  isPinned: boolean
  isUrgent: boolean
  requiresAcknowledgment: boolean
  acknowledgedBy: string[]
  
  mentions: string[]
  tags: string[]
  
  createdAt: Date
  updatedAt: Date
  expiresAt?: Date
}

export interface MessageAttachment {
  id: string
  name: string
  type: 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'VIDEO'
  url: string
  size: number
  uploadedAt: Date
}

export interface InternalChannel {
  id: string
  name: string
  description: string
  department?: StaffDepartment
  type: 'DEPARTMENT' | 'TEAM' | 'ANNOUNCEMENT'
  members: string[]
  admins: string[]
  isPinned: boolean
  isArchived: boolean
  lastMessageAt?: Date
  unreadCount: number
  createdAt: Date
  updatedAt: Date
}

export interface MessageThread {
  id: string
  originalMessageId: string
  participants: string[]
  messageCount: number
  lastMessageAt: Date
  isResolved: boolean
}

export interface InternalMessageStats {
  totalSent: number
  totalReceived: number
  unreadCount: number
  byDepartment: Record<StaffDepartment, number>
  byPriority: Record<InternalMessagePriority, number>
  averageResponseTime: number
}
