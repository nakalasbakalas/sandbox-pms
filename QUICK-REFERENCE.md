# Sandbox Hotel PMS — Quick Reference Guide
**Architecture at a Glance**

---

## System Overview

**What:** Next-generation Property Management System for boutique hotels  
**Who:** Sandbox Hotel (30 rooms) — Twin 201-215, Double 301-315  
**Why:** Replace outdated PMS with fast, simple, operationally superior system  
**When:** 24-week implementation (6 months to launch)

---

## Core Philosophy

```
BOARD-FIRST        →  Room grid is the command center
OPERATIONS-FIRST   →  Daily execution over feature bloat
SPEED OVER FLUFF   →  <45s check-in, <200ms board load
ZERO DOUBLE BOOK   →  Database-enforced integrity
THAILAND-FIRST     →  LINE messaging, local workflows
```

---

## Technology Stack

```
Frontend:     Next.js 15 + React 19 + TypeScript
Backend:      Next.js API Routes + PostgreSQL + Prisma
Auth:         NextAuth.js v5 (role-based permissions)
Real-Time:    Server-Sent Events (SSE) + fallback polling
State:        TanStack Query (server) + Zustand (client)
Styling:      Tailwind CSS v4 + shadcn components
Deploy:       Vercel (recommended) or self-hosted
```

---

## Data Model (Core Tables)

```
Property
  ├── RoomType (TWIN, DOUBLE)
  │     └── Room (30 rooms total)
  │           ├── RoomDateInventory ← SOURCE OF TRUTH
  │           └── RoomStatusHistory (audit)
  │
  ├── Guest
  │     └── Reservation
  │           ├── Folio
  │           │     ├── FolioItem
  │           │     └── Payment
  │           └── ReservationLog (audit)
  │
  ├── RateAdjustmentRule
  │     └── RateOverride
  │
  └── User
        └── Role (ADMIN, MANAGER, FRONT_DESK, HOUSEKEEPING, CASHIER)
```

**Critical Constraint:** `@@unique([roomId, date])` prevents double-booking

---

## Module Map

### Primary Modules (Always Visible)

```
1. Board               → Room grid, real-time status, today's activity
2. Front Desk          → Check-in/out workflows, arrivals/departures
3. Reservations        → Pipeline, calendar, list, modifications
4. Guests              → Profiles, history, notes, documents
5. Housekeeping        → Mobile-optimized status updates, cleaning queue
6. Cashier             → Folios, payments, invoices, reconciliation
7. Rates               → Pricing rules, rate calendar, overrides
8. Channels            → OTA sync, mappings, health monitoring
9. Reports             → Occupancy, revenue, operations, analytics
10. Admin              → Users, settings, audit logs, system config
```

### Secondary Modules (Tucked Away)

```
- Messaging            → Internal notes, communication history
- Pre-check-in         → Guest portal, online check-in forms
- Documents            → Templates, policy documents
- Surveys              → Guest feedback collection
- Promotions           → Special offers, discount codes
- Cafe POS             → Charge-to-room (optional module)
- Audit Logs           → Security, data access tracking
- Automation           → Rule-based actions, alerts
```

---

## User Roles & Permissions

| Role | Board | Check-In/Out | Reservations | Financials | Rates | Admin |
|------|-------|--------------|--------------|------------|-------|-------|
| **Admin** | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| **Manager** | ✅ Full | ✅ Full | ✅ Full | ✅ View | ✅ Full | ❌ No |
| **Front Desk** | ✅ View | ✅ Full | ✅ Create/View | ✅ View | ❌ No | ❌ No |
| **Housekeeping** | ✅ View | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No |
| **Cashier** | ✅ View | ❌ No | ✅ View | ✅ Full | ❌ No | ❌ No |

---

## Key User Flows

### 1. Guest Check-In (Target: <45 seconds)

```
1. Guest arrives
2. Staff clicks guest name from arrivals list
3. System shows reservation details
4. Staff verifies ID, confirms room assignment
5. Staff clicks "Check In"
6. System updates:
   - Reservation status → CHECKED_IN
   - Room status → OCCUPIED
   - Board updates in real-time
7. Staff hands over key
```

### 2. Guest Check-Out (Target: <60 seconds)

```
1. Guest approaches front desk
2. Staff clicks room number on board
3. System shows folio with all charges
4. Staff confirms balance with guest
5. Staff collects final payment (if any)
6. Staff clicks "Check Out"
7. System updates:
   - Reservation status → CHECKED_OUT
   - Room status → VACANT_DIRTY
   - Folio → CLOSED
8. System sends room to housekeeping queue
9. Receipt generated (print or email)
```

### 3. Create Reservation (Target: <90 seconds)

```
1. Staff presses Cmd+N (or clicks New Reservation)
2. Enter dates, select room type
3. System checks availability in real-time
4. Enter guest details (or select existing guest)
5. System calculates rate (base + adjustments + extras)
6. Confirm and save
7. System creates:
   - Reservation record
   - Room-date inventory locks
   - Folio with projected charges
8. Confirmation sent via LINE/email
```

### 4. Housekeeping: Mark Room Clean (Target: <10 seconds)

```
1. Housekeeper opens mobile interface
2. Views priority queue (checkout rooms first)
3. Taps room number
4. Taps "Mark Clean"
5. System updates:
   - Room status → VACANT_CLEAN
   - Board updates for all users in real-time
6. Front desk sees room ready for check-in
```

---

## Pricing Engine Flow

```
START: Room Type Base Rate (e.g., 1000 THB)
  ↓
Apply Day-of-Week Adjustment (e.g., +10% weekend)
  ↓
Apply Seasonal Adjustment (e.g., +20% high season)
  ↓
Apply Peak/Event Adjustment (e.g., +30% festival)
  ↓
Apply Long-Stay Discount (e.g., -10% for 7+ nights)
  ↓
Apply Manual Override (if exists) ← ALWAYS WINS
  ↓
Add Extra Guest Fees (200 THB × extra guests)
  ↓
Add Child Fees (100 THB × children 6-11)
  ↓
Calculate Tax-Inclusive Public Price
  ↓
END: Final Rate (with full explanation for staff)
```

---

## Real-Time Architecture

### Server-Sent Events (SSE)

```
Client (Browser)
  ↓ Subscribe to /api/board/stream
SSE Endpoint
  ↓ Listen for events
Event Emitter (in-memory or Redis)
  ↓ Emit on data changes
Service Layer
  ↓ On room status change, check-in, check-out
Database
```

**Fallback:** Polling every 5 seconds if SSE unavailable

**Events:**
- `room-status-change` → Update room card color
- `check-in` → Add guest name to room, update arrivals list
- `check-out` → Clear room, update departures list
- `reservation-created` → Add to board timeline
- `payment-received` → Update deposit status badge

---

## Security Checklist

```
✓ Strong password policy (12+ chars, complexity)
✓ Password hashing (bcrypt/Argon2)
✓ HTTPS/TLS enforced (no HTTP)
✓ Session management (secure, HTTP-only cookies)
✓ CSRF protection
✓ Rate limiting on login (prevent brute force)
✓ Role-based access control (RBAC)
✓ Permission checks on every route
✓ SQL injection prevention (parameterized queries)
✓ XSS prevention (output encoding, CSP headers)
✓ Input validation (Zod schemas)
✓ API authentication
✓ Webhook signature verification
✓ Audit logging (sensitive operations)
✓ Encrypted fields (LINE tokens, payment info)
✓ Environment variables for secrets
```

---

## Performance Targets

| Metric | Target | Critical? |
|--------|--------|-----------|
| Board load (30 rooms) | <200ms | ✅ Yes |
| API response (p95) | <500ms | ✅ Yes |
| Check-in completion | <45s | ✅ Yes |
| Check-out completion | <60s | ✅ Yes |
| Search results | <100ms | ✅ Yes |
| Room status propagation | <1s | ✅ Yes |
| Report generation | <5s | ⚠️ Important |
| Uptime | >99.5% | ✅ Yes |
| Error rate | <0.1% | ✅ Yes |

---

## Launch Readiness Criteria

### Must-Have (Blockers)

- ✅ Zero double-booking guarantee (tested)
- ✅ Financial data integrity (tested)
- ✅ Real-time board updates (working)
- ✅ Mobile housekeeping (tablet-optimized)
- ✅ LINE messaging (operational)
- ✅ Security hardening (complete)
- ✅ Staff training (confident)
- ✅ Backup/restore (verified)
- ✅ All stakeholders sign-off

### Nice-to-Have (Can Launch Without)

- ⚠️ OTA channel sync (can add post-launch)
- ⚠️ Advanced reporting (basic reports sufficient)
- ⚠️ Pre-check-in portal (can use manual process)
- ⚠️ Cafe POS integration (optional module)

---

## Implementation Phases

```
Phase 1: Foundation                (Weeks 1-3)
  → Project setup, database, auth, basic UI

Phase 2: Board & Operations        (Weeks 4-6)
  → Room grid, check-in/out, real-time updates

Phase 3: Guest & Housekeeping      (Weeks 7-8)
  → Guest profiles, mobile housekeeping

Phase 4: Financial Operations      (Weeks 9-10)
  → Folios, payments, invoices

Phase 5: Rates & Pricing           (Weeks 11-12)
  → Pricing engine, rate calendar

Phase 6: Public Booking Engine     (Weeks 13-14)
  → Guest-facing booking website

Phase 7: OTA Integration           (Weeks 15-17)
  → Channel manager, sync operations

Phase 8: LINE & Messaging          (Weeks 18-19)
  → LINE integration, automated messages

Phase 9: Reporting & Dashboards    (Weeks 20-21)
  → Analytics, KPIs, role-specific dashboards

Phase 10: Hardening & Launch       (Weeks 22-24)
  → Security, testing, training, go-live
```

**Total: 24 weeks (6 months)**

---

## Critical Success Factors

### Data Integrity
- Room × Date inventory as source of truth
- `@@unique([roomId, date])` database constraint
- Transaction-wrapped multi-step operations
- Optimistic locking for concurrent edits
- Comprehensive audit logging

### Operational Excellence
- Board-first interface (no navigation maze)
- Real-time updates (SSE + fallback polling)
- Keyboard shortcuts for power users
- Mobile-optimized for housekeeping
- <45s check-in, <60s check-out

### Staff Adoption
- Minimal training required
- Obvious affordances, clear hierarchy
- Consistent patterns across modules
- Helpful error messages
- Direct support during launch

### System Reliability
- >99.5% uptime
- Zero data loss
- Graceful error handling
- Rollback plan ready
- Monitoring and alerting configured

---

## Quick Commands (Keyboard Shortcuts)

```
Global:
  Cmd+K          Open search
  Cmd+B          Toggle sidebar
  Cmd+N          New reservation
  Cmd+/          Show shortcuts help
  Esc            Close modal/panel

Board:
  Arrow keys     Navigate room grid
  Enter          Open selected room
  C              Mark room clean
  D              Mark room dirty
  I              Check-in to selected room
  O              Checkout from selected room

Navigation:
  Cmd+1-9        Jump to primary module
```

---

## Support & Escalation

### During Launch (First 30 Days)

**Hotline:** Direct line to dev team (response <1 hour)  
**Daily Standups:** Quick issue resolution  
**Weekly Feedback:** Survey staff, adjust as needed  

### Post-Launch

**P0 (Critical):** <1 hour response, 24/7  
**P1 (High):** <4 hours response, business hours  
**P2 (Medium):** <24 hours response  
**P3 (Low):** <1 week response  

---

## Key Documents

1. **PRD.md** — Product vision and principles
2. **UX-ARCHITECTURE.md** — Design system and patterns
3. **TECHNICAL-ARCHITECTURE.md** — Tech stack and structure
4. **DATA-MODEL.md** — Database schema and business logic
5. **BOARD-AND-OPERATIONS.md** — Board and front desk workflows
6. **RATES-AND-PRICING.md** — Pricing engine and rate rules
7. **OTA-CHANNEL-MANAGER.md** — Channel integration architecture
8. **LINE-INTEGRATION.md** — LINE messaging and alerts
9. **LAUNCH-READINESS.md** — Security and launch checklist
10. **ARCHITECTURE-REVIEW.md** — Complete assessment and recommendations

---

## Contact & Resources

**Project Status:** Architecture Complete — Ready for Implementation  
**Next Step:** Assemble development team, begin Phase 1  
**Timeline:** 24 weeks to launch  
**Confidence:** High (9/10)  

---

*This is a production business system. Launch when ready, not before.*
