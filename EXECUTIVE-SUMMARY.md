# Sandbox Hotel PMS - Complete System Architecture
**Executive Summary & Implementation Roadmap**

---

## Overview

This document represents the complete architectural design for a modern, production-ready Property Management System (PMS) for Sandbox Hotel — a 30-room boutique hotel in Thailand.

The system is designed from scratch as a greenfield rebuild, prioritizing:
- **Operational excellence** over feature bloat
- **Speed and clarity** over visual complexity
- **Data integrity** over convenience shortcuts
- **Thailand-first operations** (LINE integration, local workflows)
- **Production readiness** from day one

---

## System Vision

**Create the definitive next-generation PMS** that is:
- Seamless, fast, simple, powerful
- Compact, elegant, operationally superior
- Production-minded, maintainable
- Board-first, operations-first
- Built for daily hotel execution

**Not:** A generic enterprise SaaS dashboard
**Yes:** A premium boutique hotel operations tool

---

## Property Context

**Sandbox Hotel:**
- 30 rooms total
- Twin rooms: 201–215 (15 rooms)
- Double rooms: 301–315 (15 rooms)
- Rooms 216, 316: Non-sellable (blocked/out-of-service)
- Standard occupancy: 2, Max occupancy: 3
- Extra guest: 200 THB/night
- Children: 0-5 free (shared bedding), 6-11: 100 THB/night (shared bedding)
- Check-in: 14:00, Check-out: 11:00
- Public rates: Tax-inclusive
- No overbooking permitted

**User Roles:**
- Admin (full system access)
- Manager (oversight, exceptions, reports)
- Front Desk (daily operations, check-in/out)
- Housekeeping (room status, mobile-friendly)
- Cashier (payments, folios)
- Cafe Staff (secondary POS module, optional)

---

## Architecture Documents

The complete system is documented across 10 comprehensive architecture documents:

### 1. **PRD.md** — Product Vision & Principles
- Product vision and philosophy
- Operating principles
- User roles and goals
- System success criteria
- Product direction statement

### 2. **UX-ARCHITECTURE.md** — Information Architecture & Design System
- Navigation architecture (primary/secondary)
- Screen hierarchy
- Page layout system
- Side panel/drawer patterns
- Density modes
- Color/status semantics
- Typography system
- Button/input/form patterns
- Table/board patterns
- Mobile/tablet adaptation

### 3. **TECHNICAL-ARCHITECTURE.md** — Tech Stack & Repo Structure
- Recommended stack (Next.js, React, TypeScript, PostgreSQL, Prisma)
- Frontend/backend architecture
- API/service strategy
- Auth/session strategy
- Real-time update strategy (SSE/WebSockets)
- Modular domain structure
- Repo/folder structure
- Deployment architecture
- Testing strategy

### 4. **DATA-MODEL.md** — Core Data Model & Business Logic
- Complete relational schema
- Reservation lifecycle model
- Room/inventory lifecycle model
- Business rules
- Concurrency/integrity rules
- Audit log strategy
- Status enums/state machines
- Migration/domain structure

### 5. **BOARD-AND-OPERATIONS.md** — Board & Front Desk Module
- Board UX and interaction model
- Front desk workflows
- Check-in/check-out flows
- Walk-in creation
- Room assignment/moves
- Board mutation rules
- Backend services
- Frontend component structure

### 6. **GUEST-HOUSEKEEPING-DOCUMENTS.md** — Guest & Housekeeping Modules
- Guest profile system
- Guest stay history
- Document collection
- Pre-check-in workflows
- Housekeeping readiness workflows
- Room status transitions
- Mobile housekeeping UX

### 7. **BOOKING-ENGINE-AND-FINANCIAL-OPS.md** — Public Booking & Cashier
- Public booking engine
- Booking holds and confirmations
- Cancellation/modification flows
- Cashier/folio architecture
- Payment collection
- Invoice/receipt generation
- Financial permissions

### 8. **RATES-AND-PRICING.md** — Pricing Engine
- Pricing engine architecture
- Rate rule model
- Rate calendar UX
- Pricing logic (order of operations)
- Staff rate explanation model
- Manager workflows
- Validation and audit rules

### 9. **OTA-CHANNEL-MANAGER.md** — Channel Integration
- OTA/channel architecture
- Provider adapter contract
- Channel data model
- Room/rate mapping model
- Sync lifecycle model
- Conflict handling flow
- Health state monitoring
- Security model for secrets

### 10. **Operational Intelligence Layer** (This Iteration):
- **REPORTING-AND-INTELLIGENCE.md** — Reporting module
- **LINE-INTEGRATION.md** — LINE messaging (Thailand-first)
- **MESSAGING-ARCHITECTURE.md** — Unified communication layer
- **DASHBOARDS.md** — Manager/Front Desk/Housekeeping dashboards
- **LAUNCH-READINESS.md** — Security hardening & launch checklist

---

## Core Modules

### Board (Primary Operating Surface)
The heart of the PMS. All 30 rooms visible, 7-day default view, color-coded reservation blocks, drag-and-drop room moves, real-time updates, keyboard shortcuts.

**Board visibility:**
- Arrivals/departures today
- In-house guests
- Due-in/due-out
- Payment due, deposit pending
- Room status (dirty/clean/inspected/maintenance/blocked)
- Turnover pressure
- VIP/problem flags

### Front Desk
Daily operations center for check-in, check-out, walk-ins, room assignments, quick extensions, quick charges.

**Key workflows:**
- Check-in flow (verify payment, room readiness, identity, complete check-in)
- Check-out flow (review folio, collect balance, mark departed, send to housekeeping)
- Walk-in creation
- Room moves
- Quick notes

### Reservations
Complete reservation lifecycle management.

**Features:**
- Create/modify/cancel reservations
- Room assignment
- Date changes
- Guest count changes
- Special requests
- Deposit tracking
- Payment collection
- Reservation history
- Duplicate detection

### Guests
Guest profile system with stay history, contact details, nationality/ID fields, notes/warnings, blacklist/caution flags.

**Guest data:**
- Contact information
- Stay history
- Document collection
- Pre-check-in completion
- Message history
- Notes and warnings

### Housekeeping
Compact, operational, mobile-friendly module for room readiness.

**Features:**
- Dirty/clean/inspected/maintenance states
- Readiness indicators
- Same-day turnover pressure
- Mobile actions (mark clean, mark inspected)
- Maintenance issue reporting
- Assignment support

### Cashier / Folio
Financial operations: charge posting, payment collection, folio management, invoice/receipt generation.

**Features:**
- Folio view
- Charge posting (room, extras, fees)
- Reversal/void (with permission)
- Deposit tracking
- Payment collection
- Payment history
- Balance due clarity
- Receipt/invoice generation
- Auditability

### Rates & Pricing
Powerful but understandable pricing engine.

**Features:**
- Room-type base rates
- Weekday/weekend rules
- Seasonal rules
- Peak/low season rates
- Long-stay discounts
- Manual overrides
- Rate calendar (visual pricing by date and room type)
- Rate explanation (staff can see how rate was calculated)
- Bulk edit tools

### Channels (OTA Integration)
First-class OTA channel manager supporting Booking.com, Agoda, Expedia, Airbnb.

**Features:**
- Provider adapter architecture
- Channel dashboard (status, last sync, warnings)
- Channel configuration (credentials, environment mode)
- Room/rate mapping
- Sync operations (reservation pull, inventory push, rate push)
- Conflict handling
- Sync logs
- Health monitoring

### Reporting
Practical, operationally useful reports (not vanity analytics).

**Report Groups:**
- Operations (arrivals, departures, occupancy, room status, turnover)
- Revenue/Financial (revenue, ADR, RevPAR, payment collections, deposits)
- Reservations (booking pace, lead time, stay length, channel performance)
- Housekeeping (cleaning completion, turnover workload, maintenance loss)
- Channels (sync health, reservations by channel, rate parity)
- Guest/Feedback (repeat guests, satisfaction trends)

**Features:**
- Filters (date range, room type, channel, status)
- Saved presets
- CSV export
- Printable/PDF views

### LINE Integration (Thailand-First)
First-class LINE messaging for guest and staff communications.

**Guest Messages:**
- Booking confirmation
- Payment reminders
- Pre-arrival reminders
- Pre-check-in link delivery
- Arrival reminders
- Thank you & survey links
- Manual send from reservation/guest screens

**Staff Alerts:**
- New booking alerts
- Deposit pending alerts
- Arrival today summary
- No-show candidate alerts
- OTA sync failure alerts
- Housekeeping urgent alerts
- Maintenance alerts
- Manager exception alerts

**Features:**
- Template system
- Variable substitution
- Delivery tracking
- Message history
- Anti-spam/throttling
- Opt-out support
- Test mode (safe testing)
- Webhook verification

### Dashboards
Real-time operational intelligence dashboards.

**Front Desk Dashboard:**
- Today's overview (occupancy, arrivals, departures)
- Action queue (payment due, deposit pending, room readiness, no-shows)
- Arrivals today (with check-in actions)
- Departures today (with check-out actions)
- In-house guests
- Room status summary

**Manager Dashboard:**
- Performance snapshot (revenue, ADR, RevPAR, occupancy)
- Operational status
- Urgent exceptions
- Channel health
- Revenue trend (7 days)
- Forecast (next 7 days)

**Housekeeping Dashboard:**
- Today's workload (dirty/clean/inspected counts)
- Priority rooms (urgent turnovers)
- Turnover rooms (same-day checkout→checkin)
- Room status grid (visual floor overview)
- Maintenance issues

### Admin
System configuration, user management, property settings, audit logs.

**Features:**
- User management (create, edit, roles, permissions)
- Property configuration
- Room setup
- Rate configuration
- Channel configuration
- LINE configuration
- Template management
- Audit logs
- System settings

---

## Data Integrity Guarantees

**Reservation Integrity:**
- ✓ No double booking (database-level enforcement)
- ✓ No overbooking (validation before save)
- ✓ Transaction-safe room assignment
- ✓ Atomic status transitions
- ✓ Concurrent edit handling (optimistic locking)

**Financial Integrity:**
- ✓ No lost payments
- ✓ No negative balances (without permission)
- ✓ Folio balance always consistent
- ✓ Charge posting logged and traceable
- ✓ Reversal/void requires permission and audit trail
- ✓ Receipt generation immutable

**Channel Sync Integrity:**
- ✓ OTA reservations validated before import
- ✓ Conflict detection on import
- ✓ Sync failure handling (alert, retry, manual review)
- ✓ Sync audit log (all operations recorded)
- ✓ Idempotency (duplicate sync safe)

---

## Security Hardening

**Authentication & Authorization:**
- Strong password policy
- Password hashing (bcrypt/Argon2)
- Secure session management
- CSRF protection
- Rate limiting on login
- Role-based access control (RBAC)
- Permission checks on every route

**Data Protection:**
- HTTPS/TLS enforced
- Sensitive fields encrypted at rest
- Database connection encrypted
- Environment variables for secrets
- Audit logging for sensitive data access

**Input Validation:**
- SQL injection prevention (parameterized queries)
- XSS prevention (output encoding, CSP headers)
- Request size limits
- Input sanitization

**API Security:**
- API authentication required
- Rate limiting per endpoint
- Webhook signature verification
- CORS policy

---

## Performance Requirements

**Page Load Times:**
- Typical screens: <2s
- Board (30 rooms, 7 days): <3s
- Search response: <1s
- Report generation: <5s (typical date range)
- API response: <500ms (typical requests)

**Database:**
- Queries optimized (indexed, efficient)
- N+1 query problems resolved
- Large result sets paginated
- Connection pooling configured

**Scalability:**
- Stateless API design (horizontal scaling ready)
- Session storage externalized
- File uploads stored externally
- Background job processing
- Cache strategy for read-heavy data

---

## Implementation Roadmap

### Phase 1: Foundation (Weeks 1-3)
**Goal:** Core infrastructure and data model

- [ ] Project setup (Next.js, TypeScript, Prisma, PostgreSQL)
- [ ] Database schema implementation
- [ ] Authentication & authorization
- [ ] User management
- [ ] Property/room configuration
- [ ] Basic audit logging

**Deliverables:**
- Working development environment
- Database with core tables
- User login and role-based access
- Admin panel for basic config

---

### Phase 2: Board & Core Operations (Weeks 4-6)
**Goal:** Primary operating surface

- [ ] Board UI (30 rooms, 7-day view)
- [ ] Reservation creation
- [ ] Room assignment
- [ ] Check-in workflow
- [ ] Check-out workflow
- [ ] Room status management
- [ ] Front desk dashboard

**Deliverables:**
- Functional board with reservations
- Complete check-in/check-out flows
- Real-time updates (SSE)
- Room status tracking

---

### Phase 3: Guest & Housekeeping (Weeks 7-8)
**Goal:** Guest profiles and housekeeping operations

- [ ] Guest profile system
- [ ] Guest search
- [ ] Stay history
- [ ] Document collection
- [ ] Housekeeping module
- [ ] Room readiness workflow
- [ ] Maintenance issue reporting

**Deliverables:**
- Complete guest profiles
- Mobile-friendly housekeeping interface
- Room status transitions
- Turnover pressure visibility

---

### Phase 4: Financial Operations (Weeks 9-10)
**Goal:** Cashier, folio, payments

- [ ] Folio system
- [ ] Charge posting
- [ ] Payment collection
- [ ] Deposit tracking
- [ ] Receipt/invoice generation
- [ ] Payment history
- [ ] Reversal/void workflows

**Deliverables:**
- Complete folio management
- Payment tracking
- Financial audit trail
- Receipt generation

---

### Phase 5: Rates & Pricing (Weeks 11-12)
**Goal:** Pricing engine

- [ ] Rate rule system
- [ ] Rate calendar
- [ ] Pricing logic (weekday/weekend, seasonal)
- [ ] Long-stay discounts
- [ ] Rate explanation for staff
- [ ] Bulk editing tools

**Deliverables:**
- Functional pricing engine
- Visual rate calendar
- Staff rate transparency

---

### Phase 6: Public Booking Engine (Weeks 13-14)
**Goal:** Guest-facing booking

- [ ] Availability search
- [ ] Room type presentation
- [ ] Booking flow
- [ ] Booking holds
- [ ] Booking confirmation
- [ ] Payment request support
- [ ] Cancellation/modification request

**Deliverables:**
- Public booking website
- Inventory-safe bookings
- Mobile-friendly booking flow

---

### Phase 7: OTA Integration (Weeks 15-17)
**Goal:** Channel manager

- [ ] Provider adapter architecture
- [ ] Booking.com integration
- [ ] Agoda integration
- [ ] Expedia integration
- [ ] Airbnb/iCal integration
- [ ] Room/rate mapping
- [ ] Sync operations
- [ ] Conflict handling
- [ ] Channel health monitoring

**Deliverables:**
- Working OTA integrations
- Automatic inventory/rate sync
- Reservation import
- Sync monitoring

---

### Phase 8: LINE & Messaging (Weeks 18-19)
**Goal:** Communication layer

- [ ] LINE integration
- [ ] Message template system
- [ ] Automated guest messages (booking confirmation, reminders)
- [ ] Staff alerts
- [ ] Message history
- [ ] Delivery tracking
- [ ] Anti-spam/throttling

**Deliverables:**
- LINE messaging functional
- Automated guest communications
- Staff alert system
- Message audit trail

---

### Phase 9: Reporting & Dashboards (Weeks 20-21)
**Goal:** Operational intelligence

- [ ] Core reports (operations, revenue, reservations)
- [ ] Report filters
- [ ] CSV export
- [ ] Manager dashboard
- [ ] Front desk dashboard
- [ ] Housekeeping dashboard

**Deliverables:**
- Complete report suite
- Real-time dashboards
- Export functionality

---

### Phase 10: Hardening & Launch (Weeks 22-24)
**Goal:** Production readiness

- [ ] Security hardening
- [ ] Performance optimization
- [ ] Load testing
- [ ] Security testing
- [ ] Staff training
- [ ] Documentation
- [ ] Backup strategy
- [ ] Disaster recovery plan
- [ ] Launch checklist execution

**Deliverables:**
- Production-ready system
- Trained staff
- Complete documentation
- Launch approval

---

## Technology Stack

**Frontend:**
- React 19
- TypeScript
- Next.js (App Router)
- Tailwind CSS
- Shadcn UI components
- Framer Motion (animations)
- React Query (data fetching)

**Backend:**
- Next.js API Routes
- Prisma ORM
- PostgreSQL database
- Server-Sent Events (real-time updates)

**Infrastructure:**
- Vercel or self-hosted Node.js
- PostgreSQL (managed or self-hosted)
- Redis (sessions, cache)
- S3 or equivalent (file storage)

**Integrations:**
- LINE Messaging API
- Booking.com API
- Agoda API
- Expedia API
- Airbnb iCal

**Development:**
- TypeScript
- ESLint + Prettier
- Vitest (testing)
- Playwright (e2e testing)
- GitHub (version control)
- CI/CD pipeline

---

## Key Metrics & KPIs

**Operational Metrics:**
- Occupancy % = (Room Nights Sold / Room Nights Available) × 100
- ADR = Room Revenue / Room Nights Sold
- RevPAR = Room Revenue / Room Nights Available
- Turnover Pressure = Rooms with same-day checkout→checkin
- No-Show Rate = (No-Shows / Expected Arrivals) × 100
- Cancellation Rate = (Cancellations / Total Bookings) × 100

**Technical Metrics:**
- Page load time <2s
- Board load time <3s
- API response time <500ms
- Uptime >99.5%
- Error rate <0.1%
- Database query time <100ms (p95)

---

## Launch Readiness Criteria

**System is launch-ready when:**
- ✓ All core features working correctly
- ✓ All security hardening completed
- ✓ All performance benchmarks met
- ✓ All staff trained and confident
- ✓ All integrations tested and working
- ✓ All documentation complete
- ✓ Backup and disaster recovery verified
- ✓ Monitoring and alerting configured
- ✓ No known critical bugs
- ✓ Rollback plan ready
- ✓ Support structure in place
- ✓ Stakeholder sign-off obtained

**Final sign-off required from:**
- Hotel Manager
- Admin User
- Front Desk Staff
- Technical Lead

---

## Success Criteria

**The PMS is successful when:**

1. **Staff love using it** — faster than the old system, easier to learn, fewer errors
2. **Operations are smoother** — no double bookings, no lost reservations, no payment errors
3. **Guests have better experiences** — faster check-in, accurate bookings, timely communications
4. **Managers have visibility** — real-time data, accurate reports, exception handling
5. **System is stable** — >99.5% uptime, no data loss, graceful error handling
6. **Business grows** — increased direct bookings, better OTA management, higher occupancy

**Quantitative success metrics:**
- Zero double bookings (critical)
- Zero data loss (critical)
- <5 minutes check-in time (down from 10+)
- <2 seconds board load time
- >95% staff satisfaction score
- <1% error rate
- >99.5% uptime

---

## Risk Mitigation

**Technical Risks:**
- **Database corruption:** Daily automated backups, tested restore procedures
- **API failures:** Graceful degradation, retry logic, manual fallbacks
- **Performance issues:** Load testing, query optimization, caching strategy
- **Security breaches:** Security hardening checklist, penetration testing, audit logging

**Operational Risks:**
- **Staff resistance:** Comprehensive training, early involvement, feedback loops
- **Data migration issues:** Careful migration plan, validation, rollback capability
- **Integration failures:** Test mode, staging environment, manual override options
- **Launch timing:** Phased rollout option, parallel operations option

---

## Support & Maintenance

**Post-Launch Support:**
- P0 (Critical): <1 hour response, 24/7
- P1 (High): <4 hours response, business hours
- P2 (Medium): <24 hours response
- P3 (Low): <1 week response

**Ongoing Maintenance:**
- Daily monitoring (errors, performance, uptime)
- Weekly review (feedback, minor issues)
- Monthly review (feature requests, improvements)
- Quarterly review (strategic planning, major features)

**Continuous Improvement:**
- Staff feedback collection
- Usage analytics review
- Performance monitoring
- Security updates
- Feature enhancements

---

## Conclusion

This architecture represents a complete, production-ready PMS designed specifically for Sandbox Hotel's operational needs.

**Core Principles:**
- Operations-first (not feature-first)
- Speed and clarity (not visual complexity)
- Data integrity (not convenience shortcuts)
- Production-minded (not prototype-minded)

**Next Steps:**
1. Review and approve architecture
2. Finalize technology choices
3. Assemble development team
4. Begin Phase 1 implementation
5. Execute roadmap

**This is not a demo. This is not a prototype. This is a production business system.**

**Launch when ready. Not before.**

---

**Architecture Version:** 1.0  
**Date:** January 2024  
**Status:** Complete — Ready for Implementation

