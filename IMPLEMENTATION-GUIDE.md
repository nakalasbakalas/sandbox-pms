# Implementation Quick Reference
**Sandbox Hotel PMS - Developer Onboarding & Implementation Guide**

---

## Document Map

This project has 11 comprehensive architecture documents. Here's how to navigate them:

### **Start Here**
1. **EXECUTIVE-SUMMARY.md** — Complete system overview, roadmap, success criteria

### **Product & Design**
2. **PRD.md** — Product vision, user roles, module map, success criteria
3. **UX-ARCHITECTURE.md** — Navigation, design system, component patterns, responsive strategy

### **Technical Foundation**
4. **TECHNICAL-ARCHITECTURE.md** — Tech stack, folder structure, deployment, testing strategy
5. **DATA-MODEL.md** — Database schema, business rules, lifecycle models, concurrency

### **Core Modules**
6. **BOARD-AND-OPERATIONS.md** — Board UI, front desk workflows, check-in/out
7. **GUEST-HOUSEKEEPING-DOCUMENTS.md** — Guest profiles, housekeeping, documents, pre-check-in
8. **BOOKING-ENGINE-AND-FINANCIAL-OPS.md** — Public booking, cashier, folio, payments
9. **RATES-AND-PRICING.md** — Pricing engine, rate rules, rate calendar
10. **OTA-CHANNEL-MANAGER.md** — Channel integration, sync, conflict handling

### **Operational Intelligence**
11. **REPORTING-AND-INTELLIGENCE.md** — Reports, KPIs, export
12. **DASHBOARDS.md** — Front desk, manager, housekeeping dashboards
13. **LINE-INTEGRATION.md** — LINE messaging (Thailand-first)
14. **MESSAGING-ARCHITECTURE.md** — Unified communication layer
15. **LAUNCH-READINESS.md** — Security, hardening, testing, launch checklist

---

## Quick Start: First 30 Minutes

### 1. Understand the Property
- 30 rooms: Twin (201-215), Double (301-315)
- Rooms 216, 316 non-sellable
- No overbooking permitted
- Check-in: 14:00, Check-out: 11:00
- Extra guest: 200 THB/night
- Children: 0-5 free, 6-11: 100 THB/night

### 2. Know the User Roles
- **Admin:** Full access
- **Manager:** Oversight, exceptions, reports
- **Front Desk:** Daily operations, check-in/out
- **Housekeeping:** Room status (mobile-friendly)
- **Cashier:** Payments, folios

### 3. Understand the Core Philosophy
- **Board-first:** Everything radiates from the room board
- **Operations-first:** Speed over features
- **Thailand-first:** LINE integration, local workflows
- **Production-minded:** No shortcuts, no data loss

---

## Tech Stack Summary

**Frontend:**
- Next.js 14+ (App Router)
- React 19
- TypeScript
- Tailwind CSS
- Shadcn UI components
- Framer Motion

**Backend:**
- Next.js API Routes
- Prisma ORM
- PostgreSQL
- Server-Sent Events (real-time)

**Key Libraries:**
- React Query (data fetching)
- React Hook Form + Zod (forms)
- date-fns (dates)
- sonner (toasts)
- Phosphor Icons

---

## Project Structure

```
/app                    # Next.js app directory
  /api                  # API routes
    /reservations       # Reservation endpoints
    /guests             # Guest endpoints
    /rooms              # Room endpoints
    /folios             # Folio endpoints
    /channels           # OTA sync endpoints
    /line               # LINE messaging endpoints
    /reports            # Report generation
  /(dashboard)          # Main app routes (authenticated)
    /board              # Room board
    /reservations       # Reservations list
    /guests             # Guest profiles
    /housekeeping       # Housekeeping
    /cashier            # Cashier/folios
    /rates              # Rate management
    /channels           # Channel manager
    /reports            # Reports
    /admin              # Admin settings
  /(public)             # Public booking engine
    /book               # Public booking flow

/components
  /ui                   # Shadcn components
  /board                # Board-specific components
  /reservations         # Reservation components
  /guests               # Guest components
  /housekeeping         # Housekeeping components
  /cashier              # Cashier components
  /rates                # Rate components
  /channels             # Channel components
  /reports              # Report components
  /dashboards           # Dashboard components
  /messaging            # Messaging components
  /shared               # Shared components

/lib
  /db                   # Prisma client, queries
  /services             # Business logic services
    /reservation        # Reservation service
    /guest              # Guest service
    /room               # Room service
    /folio              # Folio service
    /pricing            # Pricing engine
    /channel            # Channel sync service
    /line               # LINE service
    /message            # Message service
    /report             # Report service
  /utils                # Utilities
  /validation           # Zod schemas

/prisma
  schema.prisma         # Database schema
  /migrations           # Migration files
  seed.ts               # Seed data

/types
  index.ts              # Shared TypeScript types

/public
  /assets               # Images, fonts, etc.
```

---

## Data Model Quick Reference

### Core Tables

**Property**
- id, name, address, phone, email, checkInTime, checkOutTime, currency, timezone

**RoomType**
- id, name, slug, baseOccupancy, maxOccupancy, baseRate, description

**Room**
- id, number, roomTypeId, floor, status, isAvailable, notes

**Reservation**
- id, guestId, roomId, status, checkInDate, checkOutDate, guestCount, childCount, ratePerNight, totalAmount, depositAmount, depositStatus, source, channel, notes

**Guest**
- id, firstName, lastName, email, phone, nationality, idNumber, passportNumber, dateOfBirth, vipStatus, preferences, notes

**Folio**
- id, reservationId, status, subtotal, taxAmount, totalAmount, balanceDue

**FolioLineItem**
- id, folioId, type, description, date, quantity, unitPrice, totalPrice

**Payment**
- id, folioId, reservationId, amount, method, transactionRef, status, collectedBy, notes

**RoomStatusHistory**
- id, roomId, status, changedBy, notes, timestamp

**AuditLog**
- id, userId, action, entityType, entityId, changes, timestamp

---

## Key Services

### ReservationService
```typescript
createReservation(data): Reservation
modifyReservation(id, data): Reservation
cancelReservation(id, reason): Reservation
checkIn(id, roomId): Reservation
checkOut(id): Reservation
validateAvailability(roomTypeId, checkIn, checkOut): boolean
detectConflicts(roomId, checkIn, checkOut): Conflict[]
```

### PricingService
```typescript
calculateRate(roomTypeId, checkIn, checkOut, guests): RateCalculation
getRateForDate(roomTypeId, date): Rate
applyRateRules(baseRate, date, guests): AppliedRate
explainRate(rateCalculation): RateExplanation
```

### ChannelService
```typescript
syncInventory(channelId, dates): SyncResult
syncRates(channelId, dates): SyncResult
pullReservations(channelId): ImportedReservation[]
handleConflict(importedReservation): ConflictResolution
testConnection(channelId): ConnectionStatus
```

### LineService
```typescript
sendMessage(recipient, template, variables): Message
sendStaffAlert(alertType, content): Message[]
getMessageHistory(recipientId): Message[]
testConnection(): boolean
```

### ReportService
```typescript
generateReport(reportId, filters): ReportResult
exportCSV(reportId, filters): Buffer
getOccupancy(dateRange): OccupancyData[]
getRevenue(dateRange): RevenueData[]
```

---

## Critical Business Rules

### Reservation Rules
1. **No double booking:** Database constraint + validation
2. **No overbooking:** Check availability before save
3. **Room assignment:** Only to available, clean rooms
4. **Status transitions:** Must follow lifecycle (confirmed → checked-in → checked-out)
5. **Cancellation:** Record reason, release inventory immediately
6. **Modification:** Validate new dates, re-check availability

### Pricing Rules
1. **Base rate:** From RoomType or RateCalendar
2. **Apply rules:** Weekday/weekend, seasonal, long-stay
3. **Extra guests:** 200 THB/night beyond base occupancy
4. **Children:** 0-5 free, 6-11: 100 THB/night
5. **Manager override:** Log in audit trail

### Financial Rules
1. **Folio balance:** Always = sum(charges) - sum(payments)
2. **No negative balance:** Without explicit permission
3. **Void/reversal:** Requires permission, logged
4. **Deposit:** Track separately from payments
5. **Receipt:** Immutable after generation

### Channel Sync Rules
1. **Validate imports:** Check conflicts before save
2. **Idempotency:** Same sync twice = same result
3. **Conflict handling:** Manual review if can't auto-resolve
4. **Sync failure:** Alert manager, log error
5. **Rate parity:** Monitor, alert on discrepancies

---

## Performance Requirements

| Operation | Target | Critical |
|-----------|--------|----------|
| Board load (30 rooms, 7 days) | <3s | <5s |
| Page load (typical) | <2s | <3s |
| Search response | <1s | <2s |
| API response | <500ms | <1s |
| Report generation (30 days) | <5s | <10s |
| Check-in flow (complete) | <45s | <90s |
| Check-out flow (complete) | <60s | <120s |

---

## Security Checklist

**Authentication:**
- [ ] Strong password policy
- [ ] Password hashing (bcrypt/Argon2)
- [ ] Secure session management
- [ ] CSRF protection
- [ ] Rate limiting on login

**Authorization:**
- [ ] Role-based access control
- [ ] Permission checks on all routes
- [ ] API authentication
- [ ] Audit logging

**Data Protection:**
- [ ] HTTPS enforced
- [ ] Encrypted sensitive fields
- [ ] Secure environment variables
- [ ] No secrets in codebase

**Input Validation:**
- [ ] SQL injection prevention
- [ ] XSS prevention
- [ ] Request size limits
- [ ] Input sanitization

---

## Testing Strategy

### Unit Tests
- Business logic functions
- Pricing calculations
- Validation functions
- Utility functions

### Integration Tests
- API endpoints
- Database operations
- Service interactions
- Channel sync flows

### E2E Tests (Critical Paths)
- Complete check-in flow
- Complete check-out flow
- Create reservation → assign room → check-in → check-out
- OTA import → conflict resolution
- Payment collection → receipt generation

### Manual Testing (Pre-Launch)
- All user workflows per role
- Concurrent operations
- Error scenarios
- Performance under load

---

## Common Gotchas

### 1. Date/Time Handling
- Always use UTC internally
- Convert to property timezone for display
- Check-in/out times matter (14:00, 11:00)
- Date ranges are inclusive (check-in date, check-out date)

### 2. useKV vs useState
- **useKV:** Data that persists between sessions
- **useState:** UI state, temporary data
- **Always use functional updates with useKV:** `setValue(current => ...)`

### 3. Reservation Status Lifecycle
- Created → Confirmed → Checked-In → Checked-Out
- Can cancel from: Created, Confirmed
- Cannot cancel from: Checked-In (must check-out first)
- No-Show: From Confirmed if past check-in time

### 4. Room Status vs Availability
- **Status:** Physical state (clean, dirty, maintenance)
- **Availability:** Can be sold (true/false)
- Blocked rooms: status = "blocked", isAvailable = false
- Occupied rooms: status = "occupied", isAvailable = false

### 5. Folio Balance
- Always recalculate, never trust cached value
- Balance = sum(lineItems) - sum(payments)
- Validate before checkout: balance must be 0 or approved

---

## Deployment Checklist

### Pre-Deployment
- [ ] All tests passing
- [ ] No TypeScript errors
- [ ] No console warnings
- [ ] Environment variables configured
- [ ] Database migrations applied
- [ ] Seed data loaded (if new database)

### Deployment
- [ ] Build successful
- [ ] Database backup created
- [ ] Deploy to staging first
- [ ] Smoke tests on staging
- [ ] Deploy to production
- [ ] Verify health check endpoint

### Post-Deployment
- [ ] Monitor error logs (1 hour)
- [ ] Verify critical flows working
- [ ] Check database connectivity
- [ ] Verify OTA connections
- [ ] Test LINE integration (if enabled)

---

## Support Contacts

**Technical Issues:**
- Developer: [contact info]
- On-call: [phone]

**Operational Issues:**
- Hotel Manager: [contact info]
- Admin User: [contact info]

**Emergency:**
- Critical system down: [emergency contact]

---

## Learning Path for New Developers

### Day 1: Understanding
1. Read EXECUTIVE-SUMMARY.md
2. Read PRD.md
3. Review DATA-MODEL.md
4. Explore codebase structure

### Day 2: Setup
1. Clone repository
2. Install dependencies
3. Setup database
4. Run migrations and seed data
5. Start dev server
6. Explore UI

### Day 3: Core Modules
1. Study Board component
2. Study Reservation service
3. Study Pricing engine
4. Make a small change (UI tweak)

### Day 4: Business Logic
1. Study reservation lifecycle
2. Study room availability logic
3. Study check-in/check-out flows
4. Review audit logging

### Day 5: Practice
1. Implement a small feature
2. Write tests
3. Submit for review
4. Deploy to staging

---

## Useful Commands

```bash
# Development
npm run dev

# Build
npm run build

# Test
npm run test

# Lint
npm run lint

# Database
npx prisma migrate dev
npx prisma studio
npx prisma db seed

# Type checking
npm run type-check
```

---

## Architecture Decisions Log

### Why Next.js?
- Server-side rendering for initial load speed
- API routes for backend
- App Router for modern routing
- Excellent TypeScript support
- Vercel deployment ready

### Why PostgreSQL?
- Relational data (reservations, guests, rooms)
- Strong ACID guarantees (no data loss)
- Excellent with Prisma
- Mature, reliable, well-understood

### Why Prisma?
- Type-safe database queries
- Excellent migration system
- Great developer experience
- Auto-generated types

### Why Server-Sent Events?
- Simpler than WebSockets for one-way updates
- Built into browsers
- Easy to implement
- Sufficient for PMS real-time needs

### Why LINE first?
- Thailand market standard
- Guests already use LINE
- Staff already use LINE
- Better engagement than email

---

## Success Metrics (Review Monthly)

**Operational:**
- Zero double bookings
- Zero data loss incidents
- Check-in time <45s (average)
- Check-out time <60s (average)
- Board load time <3s

**User Satisfaction:**
- Staff satisfaction score >90%
- Training time <2 hours per role
- Error rate <1%
- Support tickets <10/month

**Business:**
- Occupancy tracking accurate
- Revenue reports match accounting
- OTA sync success rate >99%
- Direct bookings increasing

---

## Next Steps After Launch

### Week 1
- Monitor errors daily
- Collect staff feedback
- Fix critical bugs immediately
- Performance optimization if needed

### Month 1
- Address all feedback
- Optimize slow queries
- Improve UX based on usage
- Add minor feature requests

### Quarter 1
- Implement phase 2 features
- Advanced reporting
- Additional OTA integrations
- Mobile app (if justified)

---

**This is a living system. Expect to learn and improve continuously.**

**Build with care. Launch with confidence.**

