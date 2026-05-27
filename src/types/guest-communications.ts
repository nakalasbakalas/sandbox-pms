export type GuestMessageType = 
  | 'BOOKING_CONFIRMATION'
  | 'PRE_ARRIVAL'
  | 'CHECK_IN'
  | 'IN_STAY'
  | 'CHECK_OUT'
  | 'POST_STAY'
  | 'SPECIAL_OFFER'
  | 'CUSTOM'

export type CommunicationChannel = 'EMAIL' | 'SMS' | 'LINE' | 'WHATSAPP'

export interface GuestMessageTemplate {
  id: string
  name: string
  type: GuestMessageType
  subject?: string
  body: string
  channels: CommunicationChannel[]
  variables: string[]
  isActive: boolean
  language: 'EN' | 'TH'
  timingTrigger?: {
    type: 'IMMEDIATE' | 'SCHEDULED' | 'RELATIVE'
    relativeTo?: 'CHECK_IN' | 'CHECK_OUT' | 'BOOKING'
    hoursOffset?: number
  }
  createdAt: Date
  updatedAt: Date
}

export interface GuestMessage {
  id: string
  guestId: string
  reservationId?: string
  templateId?: string
  type: GuestMessageType
  channel: CommunicationChannel
  recipient: string
  subject?: string
  body: string
  status: 'DRAFT' | 'SCHEDULED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'
  scheduledAt?: Date
  sentAt?: Date
  deliveredAt?: Date
  readAt?: Date
  errorMessage?: string
  metadata: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

export interface GuestCommunicationSettings {
  autoSendBookingConfirmation: boolean
  autoSendPreArrival: boolean
  preArrivalHoursBefore: number
  autoSendCheckInWelcome: boolean
  autoSendCheckOutThankYou: boolean
  autoSendPostStayReview: boolean
  postStayHoursAfter: number
  defaultChannel: CommunicationChannel
  emailSettings: {
    senderName: string
    senderEmail: string
    replyToEmail: string
  }
  smsSettings: {
    enabled: boolean
    provider?: string
  }
  lineSettings: {
    enabled: boolean
    channelAccessToken?: string
  }
}
