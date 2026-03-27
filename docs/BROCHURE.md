# Sandbox Hotel PMS

**One system for your entire hotel operation — from online booking to checkout receipt.**

---

## Elevator Pitch

Sandbox Hotel PMS is a cloud-hosted property management system purpose-built for independent boutique hotels in Thailand. It replaces spreadsheets, disconnected OTA dashboards, and manual room charts with a single integrated platform covering direct booking, front desk operations, housekeeping coordination, cashier and folio management, guest communications, channel management, and manager reporting. Thai-first and multilingual (Thai, English, Simplified Chinese), it runs on modern infrastructure with hosted payments, real-time room status sync, and a full audit trail from reservation to checkout.

---

## Core Modules

### Public Booking Engine

Direct booking through your own branded website. Guests search live availability by date and occupancy, see nightly rates with tax breakdowns, and complete their reservation in one flow. A 7-minute hold prevents double-booking while the guest fills out their details. Deposit collection happens via Stripe hosted checkout — a secure payment link sent by email with configurable expiry. Guests receive a unique reservation code (e.g. `SBX-00000001`) and can later request modifications or cancellations through self-service pages. The engine supports Thai, English, and Simplified Chinese.

### Front Desk Workspace

A purpose-built operational board for arrivals, departures, and in-house guests. Staff see deposit status, room readiness, early-arrival flags, and outstanding balances at a glance. Check-in captures identity documents and verifies deposit collection. Check-out settles the folio, marks the room dirty for housekeeping turnover, and issues receipts. Walk-in bookings use the same rate engine and reservation flow as online bookings. Room reassignment prevents double-booking and validates housekeeping readiness before assignment.

### Housekeeping Board

Real-time room status management with live sync to the front desk via Server-Sent Events (~1-second latency). Room statuses include clean, dirty, inspected, occupied clean/dirty, do not disturb, out of service, and out of order. Task types cover checkout cleans, daily service, rush cleans, deep cleans, inspections, turndowns, and maintenance. Checkout clean tasks are auto-created on departure. When an incoming arrival is assigned to a room, the priority is automatically escalated to urgent. Supervisors inspect completed work before the room becomes assignable. Filters by floor, status, priority, and room type keep the board manageable.

### Cashier & Folio

An append-only ledger that serves as the single source of truth for every financial transaction. Charge codes cover room (RM), VAT, deposits (DEP), payments by method (PMT-CASH, PMT-CARD, PMT-QR, PMT-BANK), extra guest fees (EXG), early check-in (ECI), late check-out (LCO), adjustments (ADJ), corrections (CORR), and refunds (REF). Room charges are auto-posted nightly from reservation and rate data with duplicate-safe posting keys. Voiding creates a reversing correction — the original is never deleted. Invoices and receipts are auto-numbered per business date (e.g. `INV-20260309-0001`). Balance calculation is server-side: settled, unpaid, partially paid, or overpaid.

### Guest Communications

Automated notifications across email, SMS, LINE, and WhatsApp. Multilingual templates cover booking confirmation, deposit payment requests, payment success/failure, pre-arrival reminders, cancellation and modification confirmations, and internal staff alerts. A digital pre-check-in portal lets guests upload identity documents, provide arrival details, and complete registration before they arrive — reducing front desk wait times. Delivery tracking captures status from pending through sent, delivered, and failed with automatic retry. A messaging hub gives staff conversation threads linked to reservations, quick-reply templates, and follow-up tracking.

### Channel Manager

iCal-based calendar sync with Booking.com, Expedia, and Agoda. Outbound feeds export blocked dates to OTA calendars via token-protected URLs. Inbound sync imports OTA reservations, detects conflicts, and flags them for manual review. Every reservation tracks its booking source — direct web, walk-in, phone, LINE, WhatsApp, Google Business, Facebook, QR, referral, or specific OTA — for accurate channel attribution in reports.

### Manager Dashboards & Reports

Daily and period reports covering occupancy percentage, ADR, RevPAR, booking source attribution, deposit pipeline (collected/pending/missing), cancellation and no-show rates, and housekeeping performance metrics. The front desk dashboard surfaces today's arrivals and departures, rooms ready for sale, urgent housekeeping tasks, and deposit collection status. The manager dashboard adds revenue pacing, channel performance, and audit activity summaries. All reports support date range filtering and CSV export.

### Admin & Security

Role-based access control with five built-in roles: Admin, Manager, Front Desk, Housekeeping, and Provider. Granular permissions cover every sensitive action — reservation management, folio adjustments, payment processing, rate configuration, user management, and audit access — enforced server-side on all routes. Authentication uses Argon2id password hashing with TOTP-based multi-factor authentication and recovery codes. Sessions enforce idle timeout (15 min) and absolute lifetime (8 hr) with full revocation on logout or password reset. Account lockout activates after 5 failed attempts. Every staff action is logged to an immutable audit trail with user attribution and timestamps.

---

## Real-World Scenarios

### Scenario 1 — Direct Online Booking → Check-in → Checkout

A guest visits `book.sandboxhotel.com`, selects dates and occupancy, and browses available room types with nightly rates displayed including VAT. They choose a room and the system creates a 7-minute hold to prevent double-booking. The guest fills in their contact details, accepts booking policies, and confirms. The system generates reservation `SBX-00000042` and emails a 50% deposit payment link via Stripe hosted checkout (60-minute expiry).

One day before arrival, the guest receives a pre-arrival reminder with a link to the pre-check-in portal. They complete a mobile-friendly form: name, phone, nationality, estimated arrival time, special requests, and upload a photo of their passport. The front desk sees the reservation status update to "ready for arrival."

At check-in, the front desk agent verifies the uploaded ID, confirms the deposit is collected, assigns a clean and inspected room, and issues the key. During the stay, room charges are auto-posted nightly to the folio. At checkout, the cashier settles the remaining balance (card, cash, or QR), issues receipt `RCT-20260315-0003`, and marks the room dirty. A checkout clean task is automatically created on the housekeeping board.

### Scenario 2 — OTA Booking + Housekeeping Coordination

A reservation arrives from Booking.com via iCal sync. The system creates the booking with `ota_booking_com` source attribution and shows it on the front desk arrivals board. The assigned room is still dirty from the previous guest's checkout.

On the housekeeping board, a supervisor assigns a rush clean to the room. Because an incoming arrival is linked to that room, the system auto-escalates the task priority to urgent. The attendant completes the clean, the supervisor inspects and approves, and the room status updates to inspected. The front desk board reflects the change in real-time via SSE — the room is now assignable and the agent proceeds with check-in.

### Scenario 3 — Walk-in Guest + Payment Collection

A guest arrives without a reservation. The front desk agent creates a walk-in booking directly from the board. The rate engine applies the standard base rate (฿750/night default) plus occupancy-based markup if the property exceeds 85% occupancy. An extra guest fee of ฿200/night is added for a third occupant.

The folio opens with room charges, extra guest charges, and 7% VAT auto-calculated. The guest stays two nights. At checkout, the cashier records a cash payment (PMT-CASH), the system settles the folio, and issues invoice `INV-20260317-0001`. Every step — reservation creation, charge posting, payment recording, document issuance — is captured in the audit log with user attribution.

---

## At a Glance

| Category | Details |
|---|---|
| **Deployment** | Render.com with managed PostgreSQL, auto-migrations on deploy |
| **Stack** | Python 3.11 / Flask 3.0 / SQLAlchemy / Gunicorn |
| **Domains** | Marketing site · Booking engine · Staff PMS (separate subdomains) |
| **Languages** | Thai (primary), English, Simplified Chinese |
| **Payments** | Stripe hosted checkout with webhook verification |
| **OTA Channels** | Booking.com, Expedia, Agoda (iCal sync) |
| **Security** | Argon2id hashing, TOTP MFA, RBAC, CSRF protection, session timeouts, rate limiting |
| **Roles** | Admin, Manager, Front Desk, Housekeeping, Provider |
| **Reports** | Occupancy, ADR, RevPAR, channel attribution, payment pipeline, CSV export |
| **Data Model** | 30+ domain models, UUID primary keys, append-only folio ledger |
| **Monitoring** | Health check endpoint, Sentry error tracking, cron job scheduling |
| **Notifications** | Email, SMS, LINE, WhatsApp with delivery tracking and retry |

---

## Get Started

Sandbox Hotel PMS is designed for independent properties that want direct booking capability, operational control, and clear financial reporting in one system. Contact the team to schedule a walkthrough or request a staging environment.
