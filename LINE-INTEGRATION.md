# LINE Integration & Messaging Architecture
**Sandbox Hotel PMS - Thailand-First Communication**

---

## Philosophy

LINE is the dominant messaging platform in Thailand.

**LINE integration must be first-class**, not an afterthought.

Email is secondary. SMS is rarely used. LINE is how Thailand communicates.

The messaging system must be:
- **operationally useful**, not spam
- **contextual**, not generic
- **trackable**, not fire-and-forget
- **safe**, not noisy

---

## LINE Integration Overview

### Guest-Facing LINE Messages

**Booking Journey:**
1. **Booking Confirmation** — immediate after reservation created
2. **Payment Reminder** — if deposit pending
3. **Pre-Arrival Reminder** — 3 days before (configurable)
4. **Pre-Check-In Link** — with pre-arrival reminder or separate
5. **Arrival Day Reminder** — morning of arrival
6. **In-Stay Support** — optional during stay
7. **Post-Stay Thank You** — day after checkout
8. **Survey Link** — with thank you or 2 days after

**Manual Send:**
- Staff can send from Reservation or Guest screen
- Template selector
- Variable substitution
- Preview before send
- Delivery tracking

---

### Staff-Facing LINE Alerts

**Operational Alerts:**
- New booking created
- Deposit pending (unpaid after X hours)
- Arrival today (morning summary)
- No-show candidate (4 hours past check-in time)
- OTA sync failure
- Housekeeping critical (urgent turnover)
- Maintenance alert (room issue reported)
- Manager exception (override, refund, etc.)

**Alert Routing:**
- Alerts go to role-based groups or individual staff LINE accounts
- Configurable per alert type
- Test mode support
- Anti-spam throttling (no flood)

---

## LINE Architecture

### LINE Messaging API

**Requirements:**
- LINE Official Account (Business or Premium)
- Channel Access Token (long-lived)
- Channel Secret (for webhook verification)
- Webhook endpoint for incoming messages (future)

**Environment Safety:**
- Separate LINE channels for dev/staging/production
- Credentials stored in secure environment variables
- Test mode prevents accidental guest messaging

### LINE Message Types

**Text Messages** (most common)
```
🏨 Sandbox Hotel

Dear [GuestName],

Your reservation is confirmed!

Booking: [BookingRef]
Check-in: [Date] at [Time]
Room: [RoomType]

We look forward to welcoming you.
```

**Flex Messages** (structured, rich)
```json
{
  "type": "flex",
  "altText": "Booking Confirmation",
  "contents": {
    "type": "bubble",
    "body": {
      "type": "box",
      "layout": "vertical",
      "contents": [
        {
          "type": "text",
          "text": "Booking Confirmed",
          "weight": "bold",
          "size": "xl"
        },
        {
          "type": "text",
          "text": "Sandbox Hotel",
          "size": "sm",
          "color": "#999999"
        },
        {
          "type": "separator",
          "margin": "md"
        },
        {
          "type": "box",
          "layout": "vertical",
          "margin": "lg",
          "spacing": "sm",
          "contents": [
            {
              "type": "box",
              "layout": "baseline",
              "contents": [
                {
                  "type": "text",
                  "text": "Booking",
                  "color": "#999999",
                  "size": "sm",
                  "flex": 2
                },
                {
                  "type": "text",
                  "text": "SB-20240115-001",
                  "weight": "bold",
                  "size": "sm",
                  "flex": 3,
                  "wrap": true
                }
              ]
            }
          ]
        }
      ]
    },
    "footer": {
      "type": "box",
      "layout": "vertical",
      "contents": [
        {
          "type": "button",
          "action": {
            "type": "uri",
            "label": "View Booking",
            "uri": "https://booking.sandbox-hotel.com/reservation/[id]"
          },
          "style": "primary"
        }
      ]
    }
  }
}
```

**Quick Reply Buttons** (optional, for interactive flows)
```json
{
  "type": "text",
  "text": "Would you like to complete pre-check-in?",
  "quickReply": {
    "items": [
      {
        "type": "action",
        "action": {
          "type": "uri",
          "label": "Complete Now",
          "uri": "https://booking.sandbox-hotel.com/pre-checkin/[token]"
        }
      }
    ]
  }
}
```

---

## Data Model

### LineConfig

```typescript
interface LineConfig {
  id: string
  environment: 'dev' | 'staging' | 'production'
  channelId: string
  channelSecret: string // encrypted
  channelAccessToken: string // encrypted
  webhookUrl?: string
  webhookEnabled: boolean
  testMode: boolean
  testRecipientIds: string[] // LINE user IDs for testing
  enabled: boolean
  lastTestedAt?: Date
  lastTestSuccess: boolean
  createdAt: Date
  updatedAt: Date
}
```

### LineTemplate

```typescript
interface LineTemplate {
  id: string
  slug: string
  name: string
  category: 'guest' | 'staff'
  trigger: 'manual' | 'automated'
  description: string
  messageType: 'text' | 'flex'
  contentTemplate: string // with variables like {{guestName}}
  flexTemplate?: object // JSON structure for flex messages
  variables: TemplateVariable[]
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

interface TemplateVariable {
  key: string
  label: string
  type: 'text' | 'date' | 'currency' | 'url'
  required: boolean
  example: string
}
```

### LineMessage

```typescript
interface LineMessage {
  id: string
  templateId?: string
  recipientType: 'guest' | 'staff'
  recipientId?: string // Guest or User ID in PMS
  lineUserId?: string // LINE platform user ID
  phoneNumber?: string // for guest lookup
  content: string
  flexContent?: object
  context: MessageContext
  status: 'pending' | 'sent' | 'delivered' | 'failed'
  sentAt?: Date
  deliveredAt?: Date
  failureReason?: string
  sentBy?: string // staff user ID if manual
  automated: boolean
  reservationId?: string
  metadata?: Record<string, any>
  createdAt: Date
}

interface MessageContext {
  type: 'booking_confirmation' | 'payment_reminder' | 'pre_arrival' | 
        'arrival_reminder' | 'checkout_thank_you' | 'survey' | 
        'staff_alert' | 'custom'
  reservationRef?: string
  bookingId?: string
  alertType?: string
}
```

### LineRecipient

```typescript
interface LineRecipient {
  id: string
  type: 'guest' | 'staff'
  guestId?: string
  userId?: string // staff user
  lineUserId: string // LINE platform user ID
  displayName?: string
  phoneNumber?: string
  verified: boolean
  optedOut: boolean
  optedOutAt?: Date
  addedAt: Date
  lastMessageAt?: Date
}
```

### LineAlertConfig

```typescript
interface LineAlertConfig {
  id: string
  alertType: 'new_booking' | 'deposit_pending' | 'arrival_today' | 
              'no_show_candidate' | 'sync_failure' | 'housekeeping_urgent' |
              'maintenance' | 'manager_exception'
  enabled: boolean
  recipients: LineAlertRecipient[]
  throttle: number // minutes between same alert type
  testMode: boolean
  createdAt: Date
  updatedAt: Date
}

interface LineAlertRecipient {
  userId?: string
  role?: string
  lineUserId: string
  displayName: string
}
```

---

## LINE Integration Services

### LineService

```typescript
class LineService {
  async sendMessage(
    recipientId: string,
    templateId: string,
    variables: Record<string, any>,
    context: MessageContext,
    userId?: string
  ): Promise<LineMessage>

  async sendStaffAlert(
    alertType: string,
    content: string,
    metadata?: Record<string, any>
  ): Promise<LineMessage[]>

  async testConnection(): Promise<boolean>

  async validateWebhook(
    signature: string,
    body: string
  ): boolean

  async handleWebhook(event: LineWebhookEvent): Promise<void>

  async getMessageHistory(
    recipientType: 'guest' | 'staff',
    recipientId: string,
    limit?: number
  ): Promise<LineMessage[]>

  async getDeliveryStatus(messageId: string): Promise<DeliveryStatus>

  async addRecipient(
    type: 'guest' | 'staff',
    lineUserId: string,
    targetId: string,
    phoneNumber?: string
  ): Promise<LineRecipient>

  async optOut(lineUserId: string): Promise<void>
}
```

### Template Rendering

```typescript
class LineTemplateRenderer {
  render(template: LineTemplate, variables: Record<string, any>): string {
    let content = template.contentTemplate
    
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`
      content = content.replaceAll(placeholder, this.formatValue(value, key, template))
    }
    
    return content
  }

  renderFlex(template: LineTemplate, variables: Record<string, any>): object {
    let flexJson = JSON.stringify(template.flexTemplate)
    
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`
      flexJson = flexJson.replaceAll(placeholder, this.formatValue(value, key, template))
    }
    
    return JSON.parse(flexJson)
  }

  private formatValue(value: any, key: string, template: LineTemplate): string {
    const variable = template.variables.find(v => v.key === key)
    if (!variable) return String(value)

    switch (variable.type) {
      case 'date':
        return formatDate(value, 'dd MMM yyyy')
      case 'currency':
        return formatCurrency(value, 'THB')
      default:
        return String(value)
    }
  }
}
```

### Anti-Spam & Throttling

```typescript
class LineThrottleService {
  private lastAlertTime: Map<string, Date> = new Map()

  canSendAlert(alertType: string, throttleMinutes: number): boolean {
    const key = alertType
    const lastSent = this.lastAlertTime.get(key)
    
    if (!lastSent) return true
    
    const minutesSince = (Date.now() - lastSent.getTime()) / 1000 / 60
    return minutesSince >= throttleMinutes
  }

  recordAlert(alertType: string): void {
    this.lastAlertTime.set(alertType, new Date())
  }

  async canSendToGuest(guestId: string): Promise<boolean> {
    const recentMessages = await this.getRecentMessages(guestId, 60) // last hour
    return recentMessages.length < 3 // max 3 messages per hour
  }

  private async getRecentMessages(recipientId: string, minutes: number): Promise<LineMessage[]> {
    const since = new Date(Date.now() - minutes * 60 * 1000)
    return await prisma.lineMessage.findMany({
      where: {
        recipientId,
        createdAt: { gte: since }
      }
    })
  }
}
```

---

## LINE Message Templates

### Guest Templates

#### 1. Booking Confirmation
```
🏨 Sandbox Hotel

Dear {{guestName}},

Your reservation is confirmed!

📋 Booking: {{bookingRef}}
📅 Check-in: {{checkinDate}} at {{checkinTime}}
📅 Check-out: {{checkoutDate}} at {{checkoutTime}}
🛏️ Room: {{roomType}}
👥 Guests: {{guestCount}}

{{#if depositRequired}}
💰 Deposit: {{depositAmount}} THB
Payment deadline: {{depositDeadline}}
Pay online: {{paymentUrl}}
{{/if}}

We look forward to welcoming you!

Sandbox Hotel
📍 123 Beach Road, Phuket
📞 +66 76 123 456
```

#### 2. Payment Reminder
```
🏨 Sandbox Hotel

Dear {{guestName}},

Friendly reminder: Your deposit payment is pending.

📋 Booking: {{bookingRef}}
💰 Amount due: {{depositAmount}} THB
⏰ Deadline: {{depositDeadline}}

Pay now: {{paymentUrl}}

If you've already paid, please disregard this message.

Thank you!
Sandbox Hotel
```

#### 3. Pre-Arrival Reminder
```
🏨 Sandbox Hotel

Dear {{guestName}},

We're excited to welcome you in {{daysUntilArrival}} days!

📅 Check-in: {{checkinDate}} at {{checkinTime}}
🛏️ Room: {{roomType}}

✨ Complete pre-check-in for faster arrival:
{{preCheckinUrl}}

Have special requests? Reply to this message.

See you soon!
Sandbox Hotel
```

#### 4. Arrival Day Reminder
```
🏨 Sandbox Hotel

Good morning {{guestName}}!

We're ready to welcome you today! ☀️

📅 Check-in: From {{checkinTime}}
🛏️ Room: {{roomType}}
📍 Address: 123 Beach Road, Phuket

{{#if preCheckinCompleted}}
✅ Pre-check-in complete — faster arrival!
{{else}}
Complete pre-check-in: {{preCheckinUrl}}
{{/if}}

Safe travels!
Sandbox Hotel
📞 +66 76 123 456
```

#### 5. Thank You & Survey
```
🏨 Sandbox Hotel

Dear {{guestName}},

Thank you for staying with us! 🙏

We hope you enjoyed your time at Sandbox Hotel.

We'd love to hear about your experience:
{{surveyUrl}}

(Takes just 2 minutes)

Hope to see you again soon!

Sandbox Hotel Team
```

---

### Staff Alert Templates

#### 1. New Booking Alert
```
🔔 New Booking

{{bookingRef}} | {{roomType}}
Guest: {{guestName}}
Dates: {{checkinDate}} - {{checkoutDate}}
Nights: {{nightCount}}
Source: {{source}}

{{#if depositRequired}}
⚠️ Deposit required: {{depositAmount}} THB
{{/if}}

View: {{bookingUrl}}
```

#### 2. Deposit Pending Alert
```
⚠️ Deposit Overdue

{{bookingRef}} | {{guestName}}
Deposit: {{depositAmount}} THB
Deadline: {{depositDeadline}} ({{hoursOverdue}}h ago)

Arrival: {{checkinDate}}

Action needed: Contact guest or cancel

View: {{bookingUrl}}
```

#### 3. Arrival Today Summary
```
📅 Arrivals Today: {{arrivalCount}}

{{#each arrivals}}
- {{time}}: {{guestName}} ({{roomType}})
  {{#if depositPending}}⚠️ Deposit pending{{/if}}
  {{#if preCheckinIncomplete}}⚡ Pre-check-in incomplete{{/if}}
{{/each}}

Board: {{boardUrl}}
```

#### 4. No-Show Candidate
```
⚠️ Possible No-Show

{{bookingRef}} | {{guestName}}
Room: {{roomAssignment}}
Expected: {{checkinTime}}
Status: {{hoursSinceCheckin}}h past check-in

Action: Contact guest or mark no-show

View: {{bookingUrl}}
```

#### 5. OTA Sync Failure
```
❌ Channel Sync Failed

Provider: {{provider}}
Operation: {{operation}}
Time: {{failureTime}}
Error: {{errorMessage}}

Reservations may be out of sync.

View: {{channelUrl}}
```

#### 6. Housekeeping Urgent
```
🧹 Urgent Turnover

Room {{roomNumber}} needs immediate attention:
Checkout: {{checkoutTime}}
Next Arrival: {{nextCheckinTime}} ({{hoursUntilCheckin}}h)

Priority cleaning required!

View: {{housekeepingUrl}}
```

---

## LINE Admin UX

### LINE Settings Page

**Layout:**
```
┌─────────────────────────────────────────────────┐
│ LINE Integration                                 │
├─────────────────────────────────────────────────┤
│                                                  │
│ ┌─ Connection Status ──────────────────────┐   │
│ │ Status: ● Connected                       │   │
│ │ Environment: Production                   │   │
│ │ Last Test: 2024-01-15 14:30               │   │
│ │ [Test Connection]                         │   │
│ └───────────────────────────────────────────┘   │
│                                                  │
│ ┌─ Configuration ──────────────────────────┐   │
│ │ Channel ID: [**************]              │   │
│ │ Channel Secret: [**************] [Show]   │   │
│ │ Access Token: [**************] [Show]     │   │
│ │ Webhook URL: https://pms.../line/webhook  │   │
│ │ Webhook Enabled: [✓]                      │   │
│ │                                            │   │
│ │ Test Mode: [✓] (Guest messages go to test │   │
│ │              recipients only)              │   │
│ │                                            │   │
│ │ [Save Configuration]                       │   │
│ └───────────────────────────────────────────┘   │
│                                                  │
│ ┌─ Staff Alert Recipients ─────────────────┐   │
│ │ Alert Type              Recipients        │   │
│ │ ────────────────────── ──────────────────│   │
│ │ New Booking            Manager, FrontDesk │   │
│ │ Deposit Pending        Manager            │   │
│ │ Arrival Today          FrontDesk          │   │
│ │ No-Show Candidate      Manager, FrontDesk │   │
│ │ Sync Failure           Manager, Admin     │   │
│ │ Housekeeping Urgent    Housekeeping, Mgr  │   │
│ │                                            │   │
│ │ [Edit Recipients]                          │   │
│ └───────────────────────────────────────────┘   │
│                                                  │
│ ┌─ Message History ────────────────────────┐   │
│ │ Last 24 hours:                            │   │
│ │ Sent: 47 | Delivered: 45 | Failed: 2      │   │
│ │                                            │   │
│ │ [View Full History]                        │   │
│ └───────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### Send Message Panel (from Reservation)

**Side Panel:**
```
┌─────────────────────────────────────┐
│ Send LINE Message                   │
├─────────────────────────────────────┤
│                                      │
│ To: John Smith                      │
│ Phone: +66 81 234 5678              │
│ LINE: ● Connected                   │
│                                      │
│ Template: [Booking Confirmation  ▾] │
│                                      │
│ ┌─ Preview ─────────────────────┐  │
│ │ 🏨 Sandbox Hotel               │  │
│ │                                │  │
│ │ Dear John Smith,               │  │
│ │                                │  │
│ │ Your reservation is confirmed! │  │
│ │                                │  │
│ │ 📋 Booking: SB-20240115-001    │  │
│ │ 📅 Check-in: 20 Jan 2024       │  │
│ │ ...                            │  │
│ └────────────────────────────────┘  │
│                                      │
│ [Cancel] [Send Message]             │
└─────────────────────────────────────┘
```

### Message History (Guest Profile)

**Section in Guest Profile:**
```
┌─ LINE Messages ──────────────────────────┐
│ Status: ● Connected                       │
│ Phone: +66 81 234 5678                    │
│                                            │
│ Recent Messages:                           │
│ ┌────────────────────────────────────┐   │
│ │ 2024-01-15 14:30 | ✓ Delivered     │   │
│ │ Thank You & Survey                  │   │
│ │ [View]                              │   │
│ ├────────────────────────────────────┤   │
│ │ 2024-01-15 09:00 | ✓ Delivered     │   │
│ │ Arrival Day Reminder                │   │
│ │ [View]                              │   │
│ ├────────────────────────────────────┤   │
│ │ 2024-01-12 10:15 | ✓ Delivered     │   │
│ │ Pre-Arrival Reminder                │   │
│ │ [View]                              │   │
│ └────────────────────────────────────┘   │
│                                            │
│ [Send New Message]                         │
└────────────────────────────────────────────┘
```

---

## Implementation Strategy

### Phase 1: LINE Foundation
- LINE config storage (encrypted)
- Test connection capability
- Basic text message sending
- Message logging
- Manual send from reservation

### Phase 2: Guest Automation
- Template system
- Variable substitution
- Booking confirmation automation
- Payment reminder automation
- Message history tracking

### Phase 3: Staff Alerts
- Alert configuration
- Role-based routing
- Throttling/anti-spam
- Alert delivery tracking
- Arrival summary automation

### Phase 4: Advanced Features
- Flex message support
- Webhook handling (incoming messages)
- Pre-check-in link delivery
- Survey link delivery
- Delivery analytics

---

## Security & Safety

**Credential Protection:**
- Store LINE secrets in encrypted fields
- Use environment variables for sensitive config
- Never log access tokens
- Rotate tokens periodically

**Test Mode:**
- Test mode redirects guest messages to test recipients
- Clear visual indicator when test mode active
- Production messages require explicit confirmation

**Webhook Verification:**
- Validate LINE signature on incoming webhooks
- Reject unverified requests
- Log suspicious activity

**Rate Limiting:**
- Respect LINE API rate limits (push messages)
- Implement backoff for failures
- Queue messages if needed

**Anti-Spam:**
- Throttle staff alerts (no flood)
- Limit guest messages per hour
- Opt-out support
- Message audit trail

**Privacy:**
- Guest phone numbers are sensitive
- LINE user IDs are personal identifiers
- Message content may contain personal details
- Comply with data protection requirements

---

## LINE API Integration Details

### Sending Messages (Push API)

**Endpoint:**
```
POST https://api.line.me/v2/bot/message/push
Authorization: Bearer {CHANNEL_ACCESS_TOKEN}
Content-Type: application/json
```

**Request Body:**
```json
{
  "to": "U1234567890abcdef1234567890abcdef",
  "messages": [
    {
      "type": "text",
      "text": "Hello from Sandbox Hotel!"
    }
  ]
}
```

**Response:**
```json
{
  "sentMessages": [
    {
      "id": "message_id_123",
      "quoteToken": "quote_token_456"
    }
  ]
}
```

### Testing Connection

**Endpoint:**
```
GET https://api.line.me/v2/bot/info
Authorization: Bearer {CHANNEL_ACCESS_TOKEN}
```

**Response:**
```json
{
  "userId": "U1234567890abcdef1234567890abcdef",
  "basicId": "@sandbox",
  "displayName": "Sandbox Hotel",
  "pictureUrl": "https://...",
  "chatMode": "bot",
  "markAsReadMode": "auto"
}
```

### Webhook Events (Future)

**Event Types:**
- `message` — User sent message
- `follow` — User added bot as friend
- `unfollow` — User blocked bot
- `join` — Bot added to group
- `leave` — Bot removed from group

**Webhook Payload:**
```json
{
  "destination": "U1234567890abcdef",
  "events": [
    {
      "type": "message",
      "message": {
        "type": "text",
        "id": "123456789",
        "text": "Hello"
      },
      "timestamp": 1640000000000,
      "source": {
        "type": "user",
        "userId": "U1234567890abcdef1234567890abcdef"
      },
      "replyToken": "reply_token_abc"
    }
  ]
}
```

---

## Success Criteria

**LINE integration must:**
- Send messages reliably (>99% delivery)
- Deliver within 30 seconds of trigger
- Track delivery status accurately
- Support manual and automated sends
- Respect opt-outs immediately
- Provide clear error messages
- Be test-safe (no accidental guest messages)
- Log all communications
- Integrate seamlessly with reservation flow

**LINE integration must NOT:**
- Spam guests with excessive messages
- Send to wrong recipients
- Fail silently
- Expose credentials in logs
- Break if LINE API is down (graceful degradation)
- Allow unauthorized message sending

---

## Future Enhancements

**Possible additions:**
- Rich menus (persistent LINE app UI)
- LIFF apps (LINE Frontend Framework for web views)
- Two-way conversations (reply handling)
- Chatbot responses (automated replies)
- Message templates with images
- Broadcast messages to segments
- A/B testing for message effectiveness

**Do not build these unless operationally justified.**

