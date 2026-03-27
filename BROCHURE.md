# Sandbox Hotel PMS

### The all-in-one property management system built for independent hotels and boutique properties

---

## Elevator Pitch

**Sandbox Hotel PMS** is a modern, full-stack property management system that gives independent hotels, boutique resorts, and serviced-apartment operators everything they need to run their property — from a guest-facing booking engine and digital pre-check-in, through front desk operations, housekeeping, and cashier workflows, all the way to manager reporting and OTA channel sync — in a single, secure, multilingual platform that deploys to the cloud in minutes.

No per-room licensing. No vendor lock-in. One codebase, your data, your rules.

---

## At a Glance

| | |
|---|---|
| **Built with** | Flask, PostgreSQL, Alembic, Jinja2, vanilla JS |
| **Deployment** | Render Blueprint (one-click), any WSGI host, Docker-ready |
| **Languages** | Thai (primary), English, Simplified Chinese |
| **Security** | Argon2id auth, TOTP MFA, RBAC, CSRF, encrypted secrets, full audit trail |
| **Database** | PostgreSQL (production), SQLite (demo/dev) |
| **Architecture** | 11 Flask Blueprints, 19 service modules, 40+ database models |
| **Development** | 14 phases of iterative, production-oriented development |
| **Test coverage** | 587+ automated tests across 30 test modules |

---

## Core Modules

### 1. Public Booking Engine

A conversion-optimized, mobile-first booking flow your guests use directly.

- **Real-time availability search** — date range + occupancy against a live inventory ledger
- **Atomic inventory holds** — rooms are held during booking to prevent double-sells
- **Idempotent confirmation** — safe for browser refreshes and retries
- **Guest self-service** — cancellation and modification requests without calling the front desk
- **Multilingual** — Thai, English, and Simplified Chinese with full copy translations
- **Policy transparency** — cancellation, no-show, and privacy policies displayed inline

**Real-world example:** A couple searches for a Deluxe room for 3 nights next month on their phone. They see live availability, select a room, fill in their details, accept the cancellation policy, and receive a confirmation email with their booking code — all in under 2 minutes, in Thai or English.

---

### 2. Digital Pre-Check-In

Reduce front desk queues and capture guest information before arrival.

- **Pre-arrival form** — guests receive a secure link to submit personal details, ETA, and special requests
- **Document upload with OCR** — passport or ID photos are scanned and data is extracted automatically
- **Staff verification workflow** — front desk reviews, approves, or requests corrections
- **Policy acknowledgment** — guests accept check-in policies digitally before they arrive

**Real-world example:** Three days before arrival, a guest receives a pre-check-in email. They upload a photo of their passport, confirm their arrival time, request a late checkout, and acknowledge the house rules. When they arrive, the front desk already has their verified details — check-in takes 30 seconds.

---

### 3. Front Desk Operations

The operational heart of the hotel — an interactive workspace for daily arrivals, departures, and everything in between.

- **Interactive board** — visual room/date grid with drag-and-drop for room assignment, reservation moves, and date changes
- **One-click check-in/check-out** — with room readiness validation, deposit verification, and automatic room charge posting
- **Walk-in creation** — same-day reservations captured in seconds
- **No-show processing** — mark no-shows with automatic inventory release
- **Shift handover panel** — summarize current status for the incoming shift
- **Real-time stats** — occupancy, arrivals, departures, and housekeeping status at a glance
- **Push notifications** — service worker support for offline and real-time alerts

**Real-world example:** It's 14:00 and the afternoon shift starts. The front desk agent opens the board, sees 8 arrivals expected today, 3 rooms still being cleaned. They drag a just-cleaned Superior room onto a confirmed reservation, click check-in, verify the deposit was paid, and hand the guest their key — all without leaving the board view.

---

### 4. Reservation Management

Full back-office control over every reservation from inquiry to checkout.

- **Complete lifecycle** — inquiry, tentative, confirmed, checked-in, checked-out, cancelled, no-show, waitlist, house use
- **Stay date edits** — change dates with automatic repricing and inventory reallocation
- **Room reassignment** — move guests between rooms with availability validation
- **Group blocks** — reserve multiple rooms under a group code for events and corporate accounts
- **Review queue** — staff approval workflow for new public bookings before confirmation
- **Reservation duplication** — quickly copy a booking for returning guests
- **Guest merge** — deduplicate guest records across bookings

**Real-world example:** A corporate travel agent calls to book 10 rooms for a 3-day conference. The reservations manager creates a group block with code "TECHCONF2026", assigns room types, and sends the confirmation. When 2 delegates cancel, those rooms are released back to inventory instantly.

---

### 5. Guest Management

Build guest profiles that follow guests across stays and help personalize service.

- **Rich profiles** — name, nationality, contact, ID documents, preferences, notes
- **Loyalty program** — tiered membership (Bronze, Silver, Gold, Platinum) with point tracking and automatic tier recalculation
- **Staff notes** — typed notes (housekeeping, front desk, management) with importance flags and visibility scope
- **Blacklist** — flag problematic guests across all future bookings
- **Post-stay surveys** — automated satisfaction surveys with ratings and free-text feedback

**Real-world example:** A returning Gold-tier guest checks in. The front desk sees their preference for a high floor, allergy to feather pillows, and a note from their last stay about preferring extra towels. Housekeeping is notified automatically. After checkout, the guest receives a survey link and rates their stay 5 stars.

---

### 6. Housekeeping Operations

A mobile-friendly operations board that keeps rooms turning over efficiently.

- **Room status board** — filterable by floor, status, priority, room type, arrival/departure flags
- **16 room statuses** — dirty, clean, inspected, pickup, occupied clean/dirty, DND, sleep, out of order/service, cleaning in progress, and more
- **Task management** — create, assign, start, complete, and inspect cleaning tasks with priority and shift-based scheduling
- **Inspection workflow** — supervisors inspect completed tasks and pass or fail them
- **Bulk operations** — update multiple rooms at once for shift turnovers
- **Quick actions** — one-tap mark dirty/clean/inspected, block/unblock, maintenance toggle, rush clean
- **Mobile view** — optimized for housekeeping staff using phones or tablets on the floor

**Real-world example:** At 10:00 AM, the housekeeping supervisor opens the board on her tablet. She sees 12 checkouts from this morning marked as dirty. She bulk-assigns 6 rooms to two attendants each, sets priority on the 2 rooms with arrivals expected before noon, and flags one room for maintenance (broken shower handle). As each room is cleaned, the attendant taps "complete" and it moves to the inspection queue.

---

### 7. Cashier & Folio

Transparent financial management with itemized folios and integrated payment tracking.

- **Itemized folios** — room charges, POS charges, manual adjustments, voids, all on one ledger
- **Automatic room charge posting** — post nightly charges through any date
- **Payment recording** — cash, card, transfer with optional receipt email
- **Refunds and voids** — with reason tracking and reversal entries
- **Hosted deposit payments** — send payment links to guests via email
- **Payment provider sync** — automatic status updates from the payment gateway
- **Document issuance** — folio, receipt, and invoice generation
- **Print-ready views** — formatted for thermal printers and A4
- **POS integration API** — external restaurant, spa, or minibar systems post charges directly via JSON API

**Real-world example:** A guest orders room service (posted via the restaurant's POS system), uses the spa (posted via the spa POS), and requests a late checkout (manual adjustment by front desk). At checkout, the cashier sees all charges on one folio, the guest pays by card, and receives a receipt by email before they leave the lobby.

---

### 8. Guest Messaging Hub

A unified inbox for all guest communication across channels.

- **Multi-channel inbox** — email, LINE, WhatsApp, and internal notes in one thread view
- **Message templates** — reusable templates for common responses
- **Auto-response rules** — keyword-triggered automatic replies
- **Automation rules** — event-triggered messages (booking confirmation, pre-arrival, post-stay)
- **Call logging** — record phone interactions in the conversation thread
- **Thread assignment** — assign conversations to specific staff members
- **Follow-up flags** — mark threads that need attention
- **Inbound webhooks** — receive messages from external providers with HMAC signature verification

**Real-world example:** A guest emails asking about airport transfer options. The message appears in the messaging hub, auto-tagged to their reservation. The front desk agent replies using the "Airport Transfer" template, customizes the pickup time, and flags the thread for follow-up. When the guest replies via LINE, the response appears in the same thread.

---

### 9. Manager Dashboard & Reporting

Data-driven insights for property managers and owners.

- **KPI dashboard** — occupancy, revenue, housekeeping performance, payment status, audit activity
- **10 daily report types:**
  1. Arrivals Report
  2. Departures Report
  3. Room Status Report
  4. Payment Due Report
  5. Housekeeping Performance Report
  6. Occupancy Report
  7. Revenue Management Report
  8. Channel Performance Report
  9. Booking Source Report
  10. No-show & Cancellation Report
- **Date range presets** — today, this week, this month, next 7 days, custom range
- **CSV export** — download any report for offline analysis or accounting
- **Audit log** — filterable by actor, entity, action, and date range

**Real-world example:** The general manager opens the dashboard Monday morning. She sees weekend occupancy hit 94%, revenue was up 12% from last month, and the Booking Source Report shows direct bookings overtaking Agoda for the first time. She exports the Revenue Management Report as CSV and sends it to the owner.

---

### 10. Administration & Configuration

Full control over property setup, pricing, policies, and staff access.

- **Room types and rooms** — create and edit room categories with photos, amenities, occupancy limits, and base rates; manage individual rooms with floor, number, and status
- **Dynamic pricing** — 12 rate rule types: base, seasonal, day-of-week, length-of-stay, promotional, early bird, last minute, occupancy-based, weekend, holiday, event, and more
- **Inventory overrides** — manually close or open rooms/types for specific date ranges
- **Blackout periods** — restrict bookings by type (closed to booking, no arrival, no departure, property closed)
- **Policy documents** — versioned cancellation, no-show, check-in/checkout, child/extra guest, and privacy policies
- **Notification templates** — multi-language, multi-channel templates with live preview
- **Staff user management** — create accounts, assign roles, manage permissions, reset passwords, enable/disable MFA
- **Role-based access control** — granular permissions enforced server-side
- **Rate calculator** — interactive tool for staff to preview pricing for any date range and room type

**Real-world example:** The revenue manager creates a "Songkran Festival" rate rule: 30% premium on all room types from April 12-16, with a minimum 2-night stay. She also creates a "Early Bird Summer" promotion: 15% discount for bookings made 60+ days in advance for June-August stays. The rate calculator confirms the rules stack correctly.

---

### 11. Provider / Owner Portal

A dedicated portal for property owners and external partners.

- **Booking overview** — search and filter reservations by status, dates, deposit state
- **Payment management** — create deposit requests, send payment links, track payment status
- **Calendar management** — create private iCal feeds, import external calendars (Airbnb, VRBO), sync with conflict detection
- **OTA channel push** — push inventory and availability updates to Booking.com, Expedia, Agoda, and other channels
- **Provider-initiated cancellation** — cancel bookings from the portal with proper inventory release

**Real-world example:** A property owner managing 3 villas through Sandbox PMS imports their Airbnb calendar to prevent double bookings. When a guest books directly through the PMS, availability is pushed to Booking.com and Expedia automatically. The owner checks their deposit dashboard weekly and sends payment reminders with one click.

---

### 12. Coupon Studio

Create branded promotional vouchers without needing a designer.

- **Visual editor** — design coupons with hotel branding
- **Print-ready output** — formatted for professional printing

**Real-world example:** The marketing coordinator creates "Stay 3, Pay 2" vouchers for a tourism fair. She designs them in Coupon Studio with the hotel logo and prints 200 copies for the booth.

---

## Integration Points

| Integration | Method | Use Case |
|---|---|---|
| POS systems (restaurant, spa, minibar) | JSON REST API | Post charges to guest folios from external POS |
| Document scanners | JSON REST API | Capture ID/passport scans with OCR extraction |
| Email providers | Inbound webhook | Parse guest replies into conversation threads |
| Messaging providers (LINE, WhatsApp) | HMAC-verified webhook | Receive messages from external channels |
| OTA channels (Booking.com, Expedia, Agoda) | Outbound push + config | Push inventory and availability updates |
| External calendars (Airbnb, VRBO) | iCal import/export | Two-way calendar sync with conflict detection |
| Payment gateways | Hosted payment pages + sync | Deposit collection and status tracking |

---

## Security & Compliance

- **Argon2id password hashing** with automatic rehash from legacy formats
- **TOTP-based MFA** with hashed recovery codes
- **Database-backed sessions** with configurable idle (15 min) and absolute (8 hr) timeouts
- **CSRF protection** on all form submissions
- **Brute-force protection** — account lockout after 5 failed attempts
- **IP-based rate limiting** on sensitive endpoints
- **Encrypted secrets at rest** — API keys and tokens encrypted via Fernet
- **Role-based access control** — granular permissions enforced server-side, not just in UI
- **Complete audit trail** — append-only audit log on all data mutations
- **Soft delete** — business entities are never hard-deleted
- **UUID primary keys** — no sequential IDs to enumerate

---

## Technical Specifications

| Specification | Detail |
|---|---|
| **Language** | Python 3.12 |
| **Framework** | Flask 3.1 |
| **ORM** | SQLAlchemy 2.x (modern `Mapped[]` style) |
| **Migrations** | Alembic via Flask-Migrate |
| **Database** | PostgreSQL 16 (production), SQLite (dev/demo) |
| **Auth** | Argon2id + TOTP MFA + RBAC |
| **Sessions** | Server-side, database-backed |
| **Encryption** | Fernet (symmetric) for secrets at rest |
| **i18n** | Custom module — Thai, English, Simplified Chinese |
| **Templates** | Jinja2 with Bootstrap-based responsive layouts |
| **Frontend** | Vanilla JS, no framework dependency |
| **Deployment** | Render Blueprint (render.yaml), any Gunicorn/WSGI host |
| **CI/CD** | Auto-deploy on branch push, pre-commit hooks |
| **Tests** | pytest (587+ tests, 30 modules) |
| **Architecture** | 11 Blueprints, 19 services, 40+ models, 47 shared helpers |
| **API style** | Server-rendered HTML + JSON API endpoints for integrations |

---

## Deployment Options

### Render (Recommended)

One-click deployment via Render Blueprint:
- Web service + managed PostgreSQL
- Auto-deploy on push
- SSL included
- Recommended subdomain split: `book.` (public) + `staff.` (PMS)

### Self-Hosted

Any environment that supports Python 3.12 + PostgreSQL:
- Gunicorn behind Nginx
- Docker-compatible
- Alembic handles all migrations

---

## Who Is This For?

| Operator Type | Why Sandbox PMS Fits |
|---|---|
| **Boutique hotels (10-80 rooms)** | Full operational suite without enterprise complexity or per-room fees |
| **Serviced apartments & apart-hotels** | Calendar sync, owner portal, and flexible rate rules for longer stays |
| **Independent resorts** | Multilingual booking engine, group blocks, and activity POS integration |
| **Hotel management companies** | Multi-property potential with provider portal and channel management |
| **Property owners with OTA listings** | iCal sync prevents double bookings across Airbnb, Booking.com, VRBO |

---

## Real-World Scenario: A Day at Sandbox Hotel

**06:00** — The night auditor runs the Daily Arrivals Report. 14 guests arriving today.

**07:00** — Housekeeping supervisor opens the mobile board, bulk-assigns 20 checkout rooms to morning shift attendants.

**08:30** — A guest submits pre-check-in online: uploads passport, requests gluten-free breakfast, ETA 15:00.

**09:00** — The revenue manager notices occupancy is low next weekend, creates a "Flash Weekend" promo rate — 20% off for bookings made in the next 48 hours.

**10:00** — A corporate travel agent calls. The reservations team creates a 5-room group block for "ACME Corp" and emails the confirmation.

**11:00** — Three rooms are cleaned, inspected, and marked ready. The front desk sees them turn green on the board.

**12:00** — An early arrival walks in. Front desk creates a walk-in reservation, assigns a ready room, checks them in, and posts the first night's charge — 2 minutes flat.

**14:00** — The afternoon shift starts. The shift handover panel shows: 6 remaining arrivals, 2 rooms still cleaning, 1 maintenance issue, 3 pending deposit payments.

**15:00** — The pre-checked-in guest arrives. Verified documents, confirmed preferences — check-in in 30 seconds. The guest receives a welcome email automatically.

**16:00** — A guest messages via LINE asking about restaurant hours. It appears in the messaging hub. Front desk replies using a template. Same thread, different channel.

**18:00** — The restaurant POS posts dinner charges to 4 guest folios via the API. No manual entry needed.

**20:00** — A Booking.com reservation comes through. It enters the review queue. Staff approves, inventory is allocated, and the guest receives confirmation in English.

**22:00** — The manager opens the dashboard from home. Today's occupancy: 91%. RevPAR up 8%. Direct bookings: 42% of total. She exports the channel performance report.

---

*Sandbox Hotel PMS — Own your operations. Own your data. Own your guest experience.*
