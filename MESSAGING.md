# Unified Guest Messaging Hub

## Overview

The Unified Guest Messaging Hub provides a centralized communication layer for the Sandbox Hotel PMS. It enables front-desk staff to view, manage, and respond to guest communications from one PMS-controlled timeline, regardless of the original channel (email, SMS, WhatsApp, phone calls, or internal notes).

## Architecture

### Domain Model

| Model | Purpose |
|---|---|
| `ConversationThread` | Groups related messages into a single conversation linked to a guest and/or reservation |
| `Message` | Individual message with direction (inbound/outbound/internal), status tracking, and delivery metadata |
| `MessageTemplate` | Reusable message templates with placeholder substitution for operational communications |
| `DeliveryAttempt` | Tracks each delivery attempt per message with provider response and error details |
| `AutomationRule` | Event-driven rules that trigger template-based messages on PMS events |

### Channel Adapter Pattern

Each communication channel is implemented as a `ChannelAdapter` subclass:

| Adapter | Channel | Mode |
|---|---|---|
| `EmailAdapter` | `email` | Live SMTP when configured, mock when not |
| `SmsAdapter` | `sms` | Mock/stub — ready for Twilio/provider hookup |
| `WhatsAppAdapter` | `whatsapp` | Mock/stub — ready for WhatsApp Business API |
| `InternalNoteAdapter` | `internal_note` | Never sent externally |
| `ManualCallLogAdapter` | `manual_call_log` | Record-only, never sent |
| `OtaMessageAdapter` | `ota_message` | Stub for future OTA channel manager integration |

### Message Status Model

Messages flow through these states:

- `draft` — not yet queued
- `queued` — ready for delivery
- `sent` — successfully dispatched to provider
- `delivered` — confirmed delivery (where channel supports it)
- `failed` — delivery error with provider_error detail
- `read` — confirmed read (where channel supports it)

### Thread Statuses

- `open` — active conversation
- `waiting` — awaiting guest response
- `closed` — resolved/completed
- `archived` — historical reference

## Supported Channels

- **Email** — Full SMTP delivery when `SMTP_HOST` is configured; mock mode otherwise
- **SMS** — Stub adapter; replace `SmsAdapter.send()` with provider SDK (e.g., Twilio)
- **WhatsApp** — Stub adapter; integrate WhatsApp Business API
- **Internal Note** — Staff-only notes that never leave the PMS
- **Manual Call Log** — Phone call summaries recorded by staff
- **OTA Message** — Future channel manager integration placeholder

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SMTP_HOST` | No | SMTP server hostname for email delivery |
| `SMTP_PORT` | No | SMTP port (default: 587) |
| `SMTP_USE_TLS` | No | Enable STARTTLS (default: False) |
| `SMTP_USERNAME` | No | SMTP authentication username |
| `SMTP_PASSWORD` | No | SMTP authentication password |
| `MAIL_FROM` | No | Sender email address |
| `WHATSAPP_STAFF_ALERT_WEBHOOK_URL` | No | WhatsApp webhook URL (future) |

When SMTP is not configured, the email adapter operates in **sandbox mock mode** — messages are logged as sent with mock provider IDs.

## Webhook Requirements

### Inbound Message Webhook

```
POST /staff/messaging/inbound
Content-Type: application/json

{
  "channel": "email",
  "sender_address": "guest@example.com",
  "body_text": "When can I check in?",
  "subject": "Check-in question",
  "provider_message_id": "provider-abc-123"
}
```

This endpoint is CSRF-exempt and accepts inbound messages from external providers. It automatically:
- Matches sender to existing guest records (by email or phone)
- Links to active reservations
- Creates or appends to conversation threads
- Increments unread counts

## Staff Usage Guide

### Messaging Inbox

Navigate to **Messaging** in the staff navigation bar. The inbox shows all conversations with:

- Guest name, reservation reference, and channel
- Last message preview and timestamp
- Unread count badge
- Follow-up indicators
- Status badges (Open/Waiting/Closed)

### Filters

- **Channel** — Filter by email, SMS, WhatsApp, etc.
- **Status** — Open, Waiting, Closed
- **Reservation** — Arrivals today, In-house, Post-stay, No reservation
- **Unread only** — Show only conversations with unread messages
- **Needs follow-up** — Show flagged conversations
- **Search** — Guest name, phone, email, or booking code

### Thread View

Click "Open" on any conversation to see the full timeline with:

- All messages in chronological order
- Direction indicators (📥 inbound, 📤 outbound, 📌 internal, 📞 call)
- Delivery status badges
- Guest and reservation context sidebar
- Reply form with channel selection
- Internal note and call log tabs
- Thread actions (close, reopen, mark follow-up, assign)

### Composing Messages

From the inbox or a reservation detail page:

1. Click "New Message" or "Compose"
2. Select channel (Email, SMS, WhatsApp, Internal Note, Call Log)
3. Enter recipient (auto-populated from guest record)
4. Optionally select a template
5. Write message and send

### Reservation Integration

The reservation detail page shows a "Guest Messages" section with all messages linked to that reservation. Staff can:

- View recent communications inline
- Click "New Message" to compose from reservation context
- See delivery errors and status

## Testing Locally

```bash
# Install dependencies
pip install -r sandbox_pms_mvp/requirements.txt -r sandbox_pms_mvp/requirements-dev.txt

# Run all messaging tests
python -m pytest sandbox_pms_mvp/tests/test_phase18_messaging.py -v

# Run full test suite
python -m pytest sandbox_pms_mvp/tests/ -q -k "not sse_endpoint_returns and not sse_emits_event"
```

All channel adapters work in sandbox mock mode by default — no external credentials needed for local testing.

## Migration

The messaging hub adds migration `a1b2c3d4e5f6` which creates:

- `conversation_threads`
- `messages`
- `message_templates`
- `delivery_attempts`
- `automation_rules`

New permissions added:
- `messaging.view` — View guest messaging inbox
- `messaging.send` — Send guest messages
- `messaging.manage` — Manage messaging settings and templates

These permissions are automatically assigned to the `admin` (all) and `front_desk` (view + send) roles.

## Follow-up Recommendations

1. **Email provider integration** — Replace mock mode with actual SMTP or API-based email delivery (e.g., SendGrid, Mailgun)
2. **SMS provider** — Integrate Twilio or similar in `SmsAdapter.send()`
3. **WhatsApp Business API** — Connect WhatsApp Business API in `WhatsAppAdapter`
4. **Real-time updates** — Add WebSocket/SSE for live inbox updates
5. **File attachments** — Extend Message model with attachment support
6. **Template management UI** — Build admin panel for template CRUD
7. **Automation rule UI** — Build admin panel for automation rule configuration
8. **OTA channel manager** — Integrate with channel managers for OTA guest messaging
9. **Read receipts** — Implement delivery/read status webhooks from providers
10. **Message search** — Full-text search across message bodies
