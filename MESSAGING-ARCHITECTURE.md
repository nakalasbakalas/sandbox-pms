# Messaging & Communication Architecture
**Sandbox Hotel PMS - Unified Communication Layer**

---

## Philosophy

Communication must be:
- **Contextual** — sent for a reason, at the right time
- **Useful** — provides value to recipient
- **Trackable** — delivery status known
- **Safe** — no spam, no errors, no wrong recipients
- **Lightweight** — does not overwhelm the core PMS UX

**Communication is a supporting system, not a feature showcase.**

---

## Communication Channels

### 1. LINE (Primary - Thailand)
- Guest notifications
- Staff alerts
- Booking confirmations
- Payment reminders
- Pre-arrival communications
- Post-stay follow-up

### 2. Email (Secondary)
- Formal confirmations
- Receipts/invoices
- Reports
- Administrative communications

### 3. SMS (Optional, Rare)
- Emergency notifications
- Backup if LINE unavailable
- International guests (if LINE not available)

### 4. In-App Notifications (Internal)
- Staff alerts within PMS
- Real-time updates
- Action queue notifications

---

## Message Types

### Guest Messages

**Booking Lifecycle:**
1. **Booking Confirmation** — immediate after reservation created
2. **Deposit Reminder** — if deposit pending (1 day before deadline)
3. **Pre-Arrival Reminder** — 3 days before arrival
4. **Pre-Check-In Link** — with pre-arrival reminder
5. **Arrival Day Reminder** — morning of arrival
6. **Welcome Message** — after check-in (optional)
7. **In-Stay Support** — during stay (optional, rare)
8. **Checkout Reminder** — morning of checkout (optional)
9. **Thank You Message** — day after checkout
10. **Survey Link** — 2 days after checkout

**Modification/Cancellation:**
- Modification confirmation
- Cancellation confirmation
- Refund notification (if applicable)

**Payment:**
- Payment received confirmation
- Payment pending reminder
- Balance due reminder

### Staff Messages

**Operational Alerts:**
- New booking alert
- Deposit pending alert
- Arrival today summary (morning)
- No-show candidate alert
- Maintenance alert
- OTA sync failure alert
- Housekeeping urgent alert
- Manager exception alert

**Daily Summaries:**
- Morning arrival summary
- Evening occupancy summary
- Payment collection summary

---

## Data Model

### Message

```typescript
interface Message {
  id: string
  type: MessageType
  channel: 'line' | 'email' | 'sms' | 'internal'
  recipientType: 'guest' | 'staff'
  recipientId: string // Guest or User ID
  
  // Channel-specific identifiers
  lineUserId?: string
  email?: string
  phoneNumber?: string
  
  // Content
  templateId?: string
  subject?: string
  content: string
  htmlContent?: string
  flexContent?: object // LINE Flex Message
  
  // Context
  context: MessageContext
  reservationId?: string
  guestId?: string
  
  // Delivery
  status: 'pending' | 'queued' | 'sent' | 'delivered' | 'failed' | 'bounced'
  sentAt?: Date
  deliveredAt?: Date
  failedAt?: Date
  failureReason?: string
  retryCount: number
  maxRetries: number
  
  // Tracking
  sentBy?: string // User ID if manual
  automated: boolean
  metadata?: Record<string, any>
  
  createdAt: Date
  updatedAt: Date
}

enum MessageType {
  // Guest messages
  BOOKING_CONFIRMATION = 'booking_confirmation',
  DEPOSIT_REMINDER = 'deposit_reminder',
  PRE_ARRIVAL = 'pre_arrival',
  ARRIVAL_REMINDER = 'arrival_reminder',
  WELCOME = 'welcome',
  IN_STAY_SUPPORT = 'in_stay_support',
  CHECKOUT_REMINDER = 'checkout_reminder',
  THANK_YOU = 'thank_you',
  SURVEY = 'survey',
  MODIFICATION_CONFIRMATION = 'modification_confirmation',
  CANCELLATION_CONFIRMATION = 'cancellation_confirmation',
  PAYMENT_RECEIVED = 'payment_received',
  PAYMENT_REMINDER = 'payment_reminder',
  
  // Staff alerts
  NEW_BOOKING = 'new_booking',
  DEPOSIT_PENDING = 'deposit_pending',
  ARRIVAL_SUMMARY = 'arrival_summary',
  NO_SHOW_CANDIDATE = 'no_show_candidate',
  MAINTENANCE_ALERT = 'maintenance_alert',
  SYNC_FAILURE = 'sync_failure',
  HOUSEKEEPING_URGENT = 'housekeeping_urgent',
  MANAGER_EXCEPTION = 'manager_exception',
  
  // Custom
  CUSTOM = 'custom'
}

interface MessageContext {
  type: MessageType
  triggeredBy: 'automated' | 'manual' | 'scheduled'
  triggerEvent?: string
  reservationRef?: string
  bookingId?: string
  alertType?: string
  priority?: 'low' | 'normal' | 'high' | 'urgent'
}
```

### MessageTemplate

```typescript
interface MessageTemplate {
  id: string
  slug: string
  name: string
  description: string
  
  // Classification
  category: 'guest' | 'staff'
  type: MessageType
  channels: ('line' | 'email' | 'sms')[]
  
  // Content templates per channel
  lineTemplate?: LineTemplateContent
  emailTemplate?: EmailTemplateContent
  smsTemplate?: SmsTemplateContent
  
  // Variables
  variables: TemplateVariable[]
  
  // Settings
  enabled: boolean
  automated: boolean
  automationTrigger?: AutomationTrigger
  
  // Throttling
  throttle?: ThrottleConfig
  
  createdAt: Date
  updatedAt: Date
}

interface LineTemplateContent {
  messageType: 'text' | 'flex'
  textTemplate?: string
  flexTemplate?: object
  quickReplies?: QuickReply[]
}

interface EmailTemplateContent {
  subjectTemplate: string
  textTemplate: string
  htmlTemplate?: string
}

interface SmsTemplateContent {
  textTemplate: string // max 160 chars
}

interface TemplateVariable {
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'currency' | 'url' | 'boolean'
  required: boolean
  example: string
  defaultValue?: string
}

interface AutomationTrigger {
  event: 'reservation_created' | 'reservation_modified' | 'deposit_due' | 
         'arrival_approaching' | 'checkout_completed' | 'sync_failed'
  delay?: number // minutes after event
  conditions?: AutomationCondition[]
}

interface AutomationCondition {
  field: string
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'contains'
  value: any
}

interface ThrottleConfig {
  maxPerRecipientPerHour: number
  maxPerRecipientPerDay: number
  minIntervalMinutes: number
}
```

### MessageQueue

```typescript
interface MessageQueue {
  id: string
  messageId: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  scheduledFor: Date
  attempts: number
  maxAttempts: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  processingStartedAt?: Date
  processingCompletedAt?: Date
  error?: string
  createdAt: Date
}
```

### MessageRecipient

```typescript
interface MessageRecipient {
  id: string
  type: 'guest' | 'staff'
  guestId?: string
  userId?: string
  
  // Contact methods
  lineUserId?: string
  email?: string
  phoneNumber?: string
  
  // Preferences
  optedOut: boolean
  optedOutAt?: Date
  optOutChannels?: ('line' | 'email' | 'sms')[]
  
  // Verification
  lineVerified: boolean
  emailVerified: boolean
  phoneVerified: boolean
  
  // Stats
  messagesSent: number
  lastMessageAt?: Date
  
  createdAt: Date
  updatedAt: Date
}
```

---

## Messaging Service Architecture

### MessageService

```typescript
class MessageService {
  async sendMessage(
    recipientId: string,
    recipientType: 'guest' | 'staff',
    templateId: string,
    variables: Record<string, any>,
    channel: 'line' | 'email' | 'sms' | 'auto',
    userId?: string
  ): Promise<Message>

  async sendBulkMessages(
    recipients: string[],
    templateId: string,
    variables: Record<string, any>[],
    channel: 'line' | 'email' | 'sms'
  ): Promise<Message[]>

  async scheduleMessage(
    recipientId: string,
    templateId: string,
    variables: Record<string, any>,
    scheduledFor: Date
  ): Promise<MessageQueue>

  async cancelMessage(messageId: string): Promise<void>

  async retryFailedMessage(messageId: string): Promise<Message>

  async getMessageHistory(
    recipientId: string,
    recipientType: 'guest' | 'staff',
    limit?: number
  ): Promise<Message[]>

  async getDeliveryStatus(messageId: string): Promise<DeliveryStatus>

  async trackDelivery(
    messageId: string,
    status: 'sent' | 'delivered' | 'failed',
    metadata?: Record<string, any>
  ): Promise<void>
}
```

### TemplateService

```typescript
class TemplateService {
  async renderTemplate(
    template: MessageTemplate,
    variables: Record<string, any>,
    channel: 'line' | 'email' | 'sms'
  ): Promise<RenderedMessage>

  async validateVariables(
    template: MessageTemplate,
    variables: Record<string, any>
  ): Promise<ValidationResult>

  async getTemplate(slug: string): Promise<MessageTemplate>

  async listTemplates(
    category?: 'guest' | 'staff',
    type?: MessageType
  ): Promise<MessageTemplate[]>

  async createTemplate(
    data: CreateTemplateData
  ): Promise<MessageTemplate>

  async updateTemplate(
    id: string,
    data: UpdateTemplateData
  ): Promise<MessageTemplate>
}

interface RenderedMessage {
  channel: 'line' | 'email' | 'sms'
  subject?: string
  content: string
  htmlContent?: string
  flexContent?: object
}
```

### AutomationService

```typescript
class AutomationService {
  async triggerAutomation(
    event: string,
    context: Record<string, any>
  ): Promise<void>

  async evaluateConditions(
    conditions: AutomationCondition[],
    context: Record<string, any>
  ): Promise<boolean>

  async scheduleAutomatedMessage(
    template: MessageTemplate,
    recipient: MessageRecipient,
    context: Record<string, any>
  ): Promise<MessageQueue>

  async processScheduledMessages(): Promise<void>

  async cancelScheduledMessage(queueId: string): Promise<void>
}
```

### ThrottleService

```typescript
class ThrottleService {
  async canSendMessage(
    recipientId: string,
    throttleConfig: ThrottleConfig
  ): Promise<boolean>

  async recordSent(recipientId: string): Promise<void>

  async getMessageCount(
    recipientId: string,
    period: 'hour' | 'day'
  ): Promise<number>

  async getRateLimitStatus(
    recipientId: string
  ): Promise<RateLimitStatus>
}

interface RateLimitStatus {
  recipientId: string
  sentLastHour: number
  sentLastDay: number
  limitReached: boolean
  nextAvailableAt?: Date
}
```

### QueueService

```typescript
class QueueService {
  async enqueue(
    message: Message,
    priority: 'low' | 'normal' | 'high' | 'urgent',
    scheduledFor?: Date
  ): Promise<MessageQueue>

  async dequeue(limit: number): Promise<MessageQueue[]>

  async processQueue(): Promise<void>

  async retryFailed(maxRetries: number): Promise<void>

  async getQueueStats(): Promise<QueueStats>
}

interface QueueStats {
  pending: number
  processing: number
  completed: number
  failed: number
  averageProcessingTime: number
}
```

---

## Message Automation

### Automated Flows

#### 1. Booking Confirmation Flow

**Trigger:** Reservation created
**Delay:** Immediate
**Conditions:** None
**Messages:**
- Booking confirmation (LINE/Email)
- Include: booking ref, dates, room, guest count, deposit info

#### 2. Deposit Reminder Flow

**Trigger:** Deposit due date approaching
**Delay:** 24 hours before due date
**Conditions:** Deposit status = pending
**Messages:**
- Deposit reminder (LINE/Email)
- Include: amount, deadline, payment link

#### 3. Pre-Arrival Flow

**Trigger:** 3 days before arrival
**Delay:** 09:00 on trigger day
**Conditions:** Status = confirmed
**Messages:**
- Pre-arrival reminder (LINE/Email)
- Include: arrival date, check-in time, pre-check-in link

#### 4. Arrival Day Flow

**Trigger:** Day of arrival
**Delay:** 08:00
**Conditions:** Status = confirmed or due-in
**Messages:**
- Arrival reminder (LINE/Email)
- Include: check-in time, address, contact

#### 5. Thank You & Survey Flow

**Trigger:** Day after checkout
**Delay:** 10:00
**Conditions:** Status = checked-out
**Messages:**
- Thank you message (LINE/Email)
- Include: survey link (if configured)

#### 6. Staff Alert Flows

**New Booking Alert:**
- Trigger: Reservation created
- Delay: Immediate
- Recipients: Manager, Front Desk
- Conditions: Always

**Deposit Overdue Alert:**
- Trigger: Deposit due date passed
- Delay: 4 hours after due time
- Recipients: Manager
- Conditions: Deposit status = pending

**No-Show Candidate Alert:**
- Trigger: Check-in time passed
- Delay: 4 hours after check-in time
- Recipients: Manager, Front Desk
- Conditions: Status = due-in (not checked-in)

**OTA Sync Failure Alert:**
- Trigger: OTA sync failed
- Delay: Immediate
- Recipients: Manager, Admin
- Conditions: Error severity = high

---

## Message Templates (Examples)

### Guest Templates

**1. Booking Confirmation (LINE)**
```
🏨 Sandbox Hotel

Dear {{guestName}},

Your reservation is confirmed! ✓

📋 Booking: {{bookingRef}}
📅 Check-in: {{checkinDate}} at {{checkinTime}}
📅 Check-out: {{checkoutDate}} at {{checkoutTime}}
🛏️ Room: {{roomType}}
👥 Guests: {{guestCount}}

{{#if depositRequired}}
💰 Deposit Required:
Amount: {{depositAmount}} THB
Deadline: {{depositDeadline}}
Pay now: {{paymentUrl}}
{{/if}}

We look forward to welcoming you!

Sandbox Hotel
📍 {{propertyAddress}}
📞 {{propertyPhone}}
```

**2. Pre-Arrival Reminder (EMAIL)**
```
Subject: Your stay at Sandbox Hotel is coming up!

Dear {{guestName}},

We're excited to welcome you to Sandbox Hotel in {{daysUntilArrival}} days!

Reservation Details:
- Booking Reference: {{bookingRef}}
- Check-in: {{checkinDate}} at {{checkinTime}}
- Check-out: {{checkoutDate}} at {{checkoutTime}}
- Room Type: {{roomType}}
- Guests: {{guestCount}}

Complete Pre-Check-In:
Save time at arrival by completing your pre-check-in form:
{{preCheckinUrl}}

Getting Here:
{{propertyAddress}}
{{directionsUrl}}

Need to make changes or have special requests?
Reply to this email or contact us at {{propertyPhone}}

See you soon!

The Sandbox Hotel Team
```

**3. Thank You & Survey (LINE)**
```
🏨 Sandbox Hotel

Dear {{guestName}},

Thank you for staying with us! 🙏

We hope you enjoyed your time at Sandbox Hotel.

We'd love to hear about your experience:
{{surveyUrl}}

Your feedback helps us improve. 
(Takes just 2 minutes)

We hope to welcome you back soon!

Warm regards,
The Sandbox Hotel Team

---
Book your next stay: {{bookingUrl}}
```

### Staff Templates

**4. Arrival Today Summary (LINE)**
```
📅 Arrivals Today: {{arrivalCount}}

{{#each arrivals}}
{{index}}. {{time}} | {{roomNumber}} | {{guestName}}
   {{roomType}} | {{nights}} nights
   {{#if depositPending}}⚠️ Deposit pending{{/if}}
   {{#if preCheckinIncomplete}}⚡ Pre-check-in incomplete{{/if}}
   {{#if vip}}⭐ VIP{{/if}}
{{/each}}

Board: {{boardUrl}}
Front Desk: {{frontDeskUrl}}

Have a great day! 💪
```

**5. No-Show Candidate Alert (LINE)**
```
⚠️ Possible No-Show

Booking: {{bookingRef}}
Guest: {{guestName}}
Room: {{roomAssignment}}

Expected: {{checkinTime}}
Status: {{hoursSinceCheckin}} hours past check-in

Action needed:
1. Contact guest: {{guestPhone}}
2. Extend grace period, or
3. Mark as no-show and release room

View: {{reservationUrl}}
```

**6. OTA Sync Failure (LINE)**
```
❌ Channel Sync Failed

Provider: {{provider}}
Operation: {{operation}}
Time: {{failureTime}}

Error: {{errorMessage}}

⚠️ Reservations may be out of sync.

Action needed:
1. Check channel connection
2. Review sync logs
3. Manual sync if needed

View: {{channelUrl}}

This alert will not repeat for 30 minutes.
```

---

## Delivery Tracking

### Delivery Status Flow

```
Created → Queued → Sent → Delivered
                      ↓
                   Failed → Retrying → Sent
                      ↓
                   Bounced (permanent failure)
```

### Status Definitions

- **Created:** Message created, not yet queued
- **Queued:** In queue, waiting to send
- **Sent:** Sent to channel API, awaiting confirmation
- **Delivered:** Confirmed delivered by channel
- **Failed:** Temporary failure, will retry
- **Bounced:** Permanent failure, won't retry

### Retry Logic

**Retry schedule:**
- Attempt 1: Immediate
- Attempt 2: 5 minutes after first failure
- Attempt 3: 30 minutes after second failure
- Attempt 4: 2 hours after third failure
- Max attempts: 4

**Permanent failures (no retry):**
- Invalid recipient (phone/email/LINE ID)
- Recipient blocked bot (LINE)
- Recipient opted out
- Invalid message format
- Channel quota exceeded (wait, don't retry immediately)

---

## Message History & Audit

### Message History View

**Location:** Guest profile, Reservation detail, Staff user profile

**Display:**
```
┌─ Message History ───────────────────────────┐
│ Date/Time       | Type              | Status │
│─────────────────┼───────────────────┼────────│
│ 2024-01-15 10:30│ Thank You         │ ✓ Sent │
│ 2024-01-15 08:00│ Arrival Reminder  │ ✓ Sent │
│ 2024-01-12 09:00│ Pre-Arrival       │ ✓ Sent │
│ 2024-01-10 14:15│ Booking Confirm   │ ✓ Sent │
│ 2024-01-09 16:00│ Deposit Reminder  │ ✗ Failed│
│                                              │
│ [View All] [Send New Message]                │
└──────────────────────────────────────────────┘
```

**Click message:** Show full message content and delivery details

### Audit Requirements

**All messages must log:**
- Who sent (user ID if manual, 'system' if automated)
- When sent (timestamp)
- To whom (recipient ID)
- What type (message type)
- What channel (LINE/email/SMS)
- Delivery status
- Failure reason (if failed)

**Audit retention:** 2 years minimum

---

## Anti-Spam & Safety

### Anti-Spam Rules

**Per-recipient throttling:**
- Max 3 messages per hour per recipient (guest)
- Max 10 messages per day per recipient (guest)
- No throttle for staff alerts (but use alert throttling)

**Alert throttling:**
- Same alert type: max 1 per 30 minutes
- Critical alerts: max 1 per 10 minutes
- Daily summaries: max 1 per day (obviously)

**Opt-out:**
- Honor opt-outs immediately
- Provide opt-out mechanism in messages (LINE, email footer)
- Allow opt-out per channel (opt out of LINE but still get email)
- Never send marketing to opted-out recipients
- Transactional messages (booking confirmation) may still send even if opted out

### Safety Checks

**Before sending:**
- Validate recipient exists
- Check opt-out status
- Check throttle limits
- Verify channel credentials configured
- Test mode check (redirect to test recipients)

**After sending:**
- Track delivery status
- Alert on repeated failures
- Review bounce rate (>5% indicates problem)
- Monitor spam complaints (if channel provides)

---

## Integration with PMS

### Message Triggers in PMS

**Reservation Module:**
- Create reservation → Booking confirmation
- Modify reservation → Modification confirmation
- Cancel reservation → Cancellation confirmation
- Deposit received → Payment confirmation

**Check-In/Check-Out:**
- Check in → Welcome message (optional)
- Check out → Thank you message

**Front Desk:**
- Manual send from reservation detail
- Manual send from guest profile

**Cashier:**
- Payment collected → Payment confirmation (optional)

**Channels:**
- Sync failure → Staff alert

**Housekeeping:**
- Maintenance reported → Staff alert

### Message Actions in PMS

**From Reservation:**
- [Send Message] button → Open send panel
- View message history

**From Guest Profile:**
- [Send Message] button → Open send panel
- View message history
- Opt-out status

**From Dashboard:**
- Click alert → View related messages

---

## Performance & Scalability

### Queue Processing

**Background job:**
- Process queue every 60 seconds
- Process up to 100 messages per batch
- Prioritize: urgent > high > normal > low

**Async sending:**
- Messages sent asynchronously (don't block UI)
- Queue immediately, deliver later
- User sees "Message queued" confirmation

**Peak handling:**
- Large batch sends (e.g., 100 pre-arrival reminders) spread over time
- Rate limit respect (channel API limits)
- Backpressure handling (if queue grows too large, slow down)

### Channel API Limits

**LINE Messaging API:**
- Push messages: 500/second (verify current limit)
- Broadcast: varies by plan
- Rate limit handling: backoff and retry

**Email:**
- SMTP: varies by provider
- Transactional email service (SendGrid, etc.): 100-1000/second

**SMS:**
- Varies by provider
- Typically 10-100/second

---

## Testing Strategy

### Test Environments

**Test Mode:**
- Guest messages redirect to test recipients
- Staff alerts go to test recipients only
- All messages clearly marked "[TEST]"

**Staging:**
- Real channel APIs but isolated data
- Safe to test full flows

**Production:**
- Real messages to real guests
- Staff alerts to real staff
- No test mode (disable after launch validation)

### Test Scenarios

**Guest Messages:**
- [ ] Booking confirmation sent immediately
- [ ] Deposit reminder sent 24h before deadline
- [ ] Pre-arrival sent 3 days before
- [ ] Arrival reminder sent morning of arrival
- [ ] Thank you sent day after checkout
- [ ] Message history visible in guest profile

**Staff Alerts:**
- [ ] New booking alert sent to manager
- [ ] Deposit overdue alert sent after deadline
- [ ] No-show candidate alert sent 4h after check-in time
- [ ] Sync failure alert sent on error

**Throttling:**
- [ ] Sending 4 messages to same guest in 1 hour blocks 4th
- [ ] Same alert type within 30 min does not resend

**Opt-Out:**
- [ ] Opted-out guest does not receive marketing
- [ ] Opted-out guest still receives transactional (booking confirmation)

**Delivery:**
- [ ] Delivery status tracked correctly
- [ ] Failed message retries automatically
- [ ] Permanent failure does not retry

---

## Success Criteria

**Messaging system must:**
- Send messages reliably (>99% delivery)
- Deliver within 60 seconds of trigger
- Track delivery status accurately
- Respect opt-outs immediately
- Honor throttle limits
- Provide clear audit trail
- Be test-safe (no accidental real messages)
- Integrate seamlessly with PMS workflows

**Messaging system must NOT:**
- Spam recipients
- Send to wrong recipients
- Fail silently
- Expose sensitive data in logs
- Break if channel API is down (graceful degradation)
- Allow unauthorized sends

---

## Future Enhancements

**Possible additions:**
- Two-way messaging (reply handling)
- Chatbot responses
- SMS fallback if LINE fails
- Message templates with images/attachments
- Broadcast messaging to segments
- A/B testing for message effectiveness
- Advanced personalization (based on guest history)
- Multi-language support (detect guest language)

**Do not build unless operationally justified.**

