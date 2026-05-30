export interface LineConfig {
  channelId: string
  channelSecret: string
  channelAccessToken: string
  webhookUrl: string
  webhookEnabled: boolean
  testMode: boolean
  testRecipientIds: string[]
  enabled: boolean
  lastTestedAt?: string
  lastTestSuccess: boolean
}

export interface LineTemplate {
  id: string
  slug: string
  name: string
  category: 'guest' | 'staff'
  trigger: 'manual' | 'automated'
  description: string
  messageType: 'text' | 'flex'
  contentTemplate: string
  flexTemplate?: any
  variables: TemplateVariable[]
  enabled: boolean
}

export interface TemplateVariable {
  key: string
  label: string
  type: 'text' | 'date' | 'currency' | 'url'
  required: boolean
  example: string
}

export interface LineMessage {
  id: string
  templateId?: string
  recipientType: 'guest' | 'staff'
  recipientId?: string
  lineUserId?: string
  phoneNumber?: string
  content: string
  flexContent?: any
  context: MessageContext
  status: 'pending' | 'sent' | 'delivered' | 'failed'
  sentAt?: string
  deliveredAt?: string
  failureReason?: string
  sentBy?: string
  automated: boolean
  reservationId?: string
  metadata?: Record<string, any>
  createdAt: string
}

export interface MessageContext {
  type: 'booking_confirmation' | 'payment_reminder' | 'pre_arrival' | 
        'arrival_reminder' | 'checkout_thank_you' | 'survey' | 
        'staff_alert' | 'custom'
  reservationRef?: string
  bookingId?: string
  alertType?: string
}

export interface LineRecipient {
  id: string
  type: 'guest' | 'staff'
  guestId?: string
  userId?: string
  lineUserId: string
  displayName?: string
  phoneNumber?: string
  verified: boolean
  optedOut: boolean
  optedOutAt?: string
  addedAt: string
  lastMessageAt?: string
}

export interface LineAlertConfig {
  id: string
  alertType: 'new_booking' | 'deposit_pending' | 'arrival_today' | 
              'no_show_candidate' | 'sync_failure' | 'housekeeping_urgent' |
              'maintenance' | 'manager_exception'
  enabled: boolean
  recipients: LineAlertRecipient[]
  throttle: number
  testMode: boolean
}

export interface LineAlertRecipient {
  userId?: string
  role?: string
  lineUserId: string
  displayName: string
}

export interface LineWebhookEvent {
  type: string
  timestamp: number
  source: {
    type: string
    userId?: string
  }
  replyToken?: string
  message?: {
    type: string
    id: string
    text?: string
  }
}

export interface LineBotInfo {
  userId: string
  basicId: string
  displayName: string
  pictureUrl?: string
  chatMode: string
  markAsReadMode: string
}

export const DEFAULT_LINE_TEMPLATES: LineTemplate[] = [
  {
    id: 'booking-confirmation',
    slug: 'booking_confirmation',
    name: 'Booking Confirmation',
    category: 'guest',
    trigger: 'automated',
    description: 'Sent immediately after reservation is created',
    messageType: 'text',
    contentTemplate: `{{propertyName}}

Dear {{guestName}},

Your reservation is confirmed!

📋 Booking: {{bookingRef}}
📅 Check-in: {{checkinDate}} at {{checkinTime}}
📅 Check-out: {{checkoutDate}} at {{checkoutTime}}
🛏️ Room: {{roomType}}
👥 Guests: {{guestCount}}

We look forward to welcoming you!

{{propertyName}}
{{propertyAddress}}
{{propertyPhone}}`,
    variables: [
      { key: 'guestName', label: 'Guest Name', type: 'text', required: true, example: 'Guest full name' },
      { key: 'bookingRef', label: 'Booking Reference', type: 'text', required: true, example: 'SB-20240115-001' },
      { key: 'checkinDate', label: 'Check-in Date', type: 'date', required: true, example: '20 Jan 2024' },
      { key: 'checkinTime', label: 'Check-in Time', type: 'text', required: true, example: '14:00' },
      { key: 'checkoutDate', label: 'Check-out Date', type: 'date', required: true, example: '23 Jan 2024' },
      { key: 'checkoutTime', label: 'Check-out Time', type: 'text', required: true, example: '12:00' },
      { key: 'roomType', label: 'Room Type', type: 'text', required: true, example: 'Deluxe Double' },
      { key: 'guestCount', label: 'Guest Count', type: 'text', required: true, example: '2' },
    ],
    enabled: true,
  },
  {
    id: 'payment-reminder',
    slug: 'payment_reminder',
    name: 'Payment Reminder',
    category: 'guest',
    trigger: 'automated',
    description: 'Sent when deposit payment is pending',
    messageType: 'text',
    contentTemplate: `{{propertyName}}

Dear {{guestName}},

Friendly reminder: Your deposit payment is pending.

📋 Booking: {{bookingRef}}
💰 Amount due: {{depositAmount}} THB
⏰ Deadline: {{depositDeadline}}

If you've already paid, please disregard this message.

Thank you!
{{propertyName}}`,
    variables: [
      { key: 'guestName', label: 'Guest Name', type: 'text', required: true, example: 'Guest full name' },
      { key: 'bookingRef', label: 'Booking Reference', type: 'text', required: true, example: 'SB-20240115-001' },
      { key: 'depositAmount', label: 'Deposit Amount', type: 'currency', required: true, example: '2000' },
      { key: 'depositDeadline', label: 'Deposit Deadline', type: 'date', required: true, example: '18 Jan 2024' },
    ],
    enabled: true,
  },
  {
    id: 'pre-arrival',
    slug: 'pre_arrival',
    name: 'Pre-Arrival Reminder',
    category: 'guest',
    trigger: 'automated',
    description: 'Sent 3 days before arrival',
    messageType: 'text',
    contentTemplate: `{{propertyName}}

Dear {{guestName}},

We're excited to welcome you in {{daysUntilArrival}} days!

📅 Check-in: {{checkinDate}} at {{checkinTime}}
🛏️ Room: {{roomType}}

Have special requests? Reply to this message.

See you soon!
{{propertyName}}`,
    variables: [
      { key: 'guestName', label: 'Guest Name', type: 'text', required: true, example: 'Guest full name' },
      { key: 'daysUntilArrival', label: 'Days Until Arrival', type: 'text', required: true, example: '3' },
      { key: 'checkinDate', label: 'Check-in Date', type: 'date', required: true, example: '20 Jan 2024' },
      { key: 'checkinTime', label: 'Check-in Time', type: 'text', required: true, example: '14:00' },
      { key: 'roomType', label: 'Room Type', type: 'text', required: true, example: 'Deluxe Double' },
    ],
    enabled: true,
  },
  {
    id: 'arrival-day',
    slug: 'arrival_reminder',
    name: 'Arrival Day Reminder',
    category: 'guest',
    trigger: 'automated',
    description: 'Sent on the morning of arrival',
    messageType: 'text',
    contentTemplate: `{{propertyName}}

Good morning {{guestName}}!

We're ready to welcome you today! ☀️

📅 Check-in: From {{checkinTime}}
🛏️ Room: {{roomType}}
Address: {{propertyAddress}}

Safe travels!
{{propertyName}}
{{propertyPhone}}`,
    variables: [
      { key: 'guestName', label: 'Guest Name', type: 'text', required: true, example: 'Guest full name' },
      { key: 'checkinTime', label: 'Check-in Time', type: 'text', required: true, example: '14:00' },
      { key: 'roomType', label: 'Room Type', type: 'text', required: true, example: 'Deluxe Double' },
    ],
    enabled: true,
  },
  {
    id: 'thank-you',
    slug: 'checkout_thank_you',
    name: 'Thank You Message',
    category: 'guest',
    trigger: 'automated',
    description: 'Sent after checkout',
    messageType: 'text',
    contentTemplate: `{{propertyName}}

Dear {{guestName}},

Thank you for staying with us! 🙏

We hope you enjoyed your time at {{propertyName}}.

Hope to see you again soon!

{{propertyName}} Team`,
    variables: [
      { key: 'guestName', label: 'Guest Name', type: 'text', required: true, example: 'Guest full name' },
    ],
    enabled: true,
  },
  {
    id: 'new-booking-alert',
    slug: 'new_booking',
    name: 'New Booking Alert',
    category: 'staff',
    trigger: 'automated',
    description: 'Alert staff when new booking is created',
    messageType: 'text',
    contentTemplate: `🔔 New Booking

{{bookingRef}} | {{roomType}}
Guest: {{guestName}}
Dates: {{checkinDate}} - {{checkoutDate}}
Nights: {{nightCount}}
Source: {{source}}`,
    variables: [
      { key: 'bookingRef', label: 'Booking Reference', type: 'text', required: true, example: 'SB-20240115-001' },
      { key: 'roomType', label: 'Room Type', type: 'text', required: true, example: 'Deluxe Double' },
      { key: 'guestName', label: 'Guest Name', type: 'text', required: true, example: 'Guest full name' },
      { key: 'checkinDate', label: 'Check-in Date', type: 'date', required: true, example: '20 Jan 2024' },
      { key: 'checkoutDate', label: 'Check-out Date', type: 'date', required: true, example: '23 Jan 2024' },
      { key: 'nightCount', label: 'Night Count', type: 'text', required: true, example: '3' },
      { key: 'source', label: 'Booking Source', type: 'text', required: true, example: 'Direct' },
    ],
    enabled: true,
  },
]
