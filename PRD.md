# Sandbox Hotel PMS — Product Requirements Document

A purpose-built property management system for boutique hotel operations in Thailand.

---

## Product Vision

**The definitive single-screen command center for boutique hotel operations.**

Sandbox Hotel PMS reimagines hotel management software as a real-time operational dashboard rather than a labyrinth of nested forms and reports. Built for the rhythm of daily hotel work — morning checkouts, afternoon arrivals, housekeeping flows, and instant guest requests — this system removes friction between thought and action. Every interaction is direct, every screen is purposeful, and every feature serves the person working the shift.

This is not enterprise software adapted for small hotels. This is boutique hotel operations, digitally perfected.

---

## Product Principles

1. **Board-First Architecture** — The room board is the source of truth. All actions radiate from the board. Room status, guest details, reservations, housekeeping — everything flows through visual room state.

2. **Zero-Navigation Operations** — Critical tasks (check-in, check-out, room status updates, reservation lookup) happen without leaving the main screen. Modal overlays for depth, not navigation mazes.

3. **Immediate Clarity** — Room state visible at a glance. Color-coded status. Occupancy indicators. Arrival/departure markers. No clicking to discover what should be obvious.

4. **Real-Time Sync** — Multiple staff viewing the board see changes instantly. Housekeeping marks a room clean, front desk sees it immediately. No refresh buttons, no stale data.

5. **Operational Precision** — Handle Thailand-specific requirements natively: tax-inclusive pricing, child policies (0–5 free, 6–11 charged), extra guest fees, THB currency, 14:00 check-in / 11:00 check-out defaults.

6. **Speed Over Features** — Fast room board rendering, instant search, keyboard shortcuts, autofocus on modals. Optimize for the 200th time someone checks in a guest today, not the first.

7. **Compact Elegance** — Premium feel without visual excess. Sharp typography, purposeful color, generous whitespace, smooth micro-interactions. Boutique hotel aesthetic, not corporate SaaS.

8. **Production-Grade Foundations** — Proper TypeScript types, error boundaries, input validation, loading states, optimistic updates. Built to run a real hotel, not demonstrate a concept.

---

## Operating Philosophy

**Daily Hotel Rhythm:**
- **Morning (06:00–12:00):** Checkout flurry, housekeeping dispatch, breakfast service coordination
- **Afternoon (12:00–18:00):** Check-in wave, room turnover tracking, reservation confirmations
- **Evening (18:00–00:00):** Late arrivals, special requests, night audit preparation
- **Night (00:00–06:00):** Minimal activity, emergency handling, system rollover

**Staff Mental Model:**
Front desk staff think in rooms, not databases. "Room 305 needs cleaning." "Check in the 3-night reservation to 212." "Mark 308 out of service." The system must mirror this language exactly.

**Information Hierarchy:**
1. Room board (what's happening right now)
2. Today's arrivals/departures (what's about to happen)
3. Reservation pipeline (what's coming)
4. Historical data (what happened)

**Interaction Philosophy:**
Click a room → see everything → take action → done. No drilling through tabs. No "save" buttons unless editing existing data. Immediate feedback on every action.

---

## System Goals

**Operational:**
- ✅ Complete check-in in under 45 seconds (industry standard: 3–5 minutes)
- ✅ Update 30 room statuses in under 2 minutes (housekeeping handoff)
- ✅ Find any guest/reservation in under 3 seconds
- ✅ Zero training required for room status updates (housekeeping staff)
- ✅ Handle walk-in booking to room assignment in under 90 seconds

**Technical:**
- ✅ Board renders 30 rooms with full state in under 200ms
- ✅ All user actions receive feedback within 100ms
- ✅ Full offline capability for viewing current state (sync when connected)
- ✅ Works flawlessly on tablet (iPad at front desk)
- ✅ Zero data loss on browser crash (persistence layer resilient)

**Business:**
- ✅ Prevent double-bookings (hard constraint)
- ✅ Prevent check-in to occupied/dirty rooms (hard constraint)
- ✅ Track revenue by room type, channel, date range
- ✅ Calculate extra guest fees, child fees automatically
- ✅ Audit trail for rate changes, cancellations, refunds

---

## User Roles & Permissions

**Admin** (Owner/Manager)
- Full system access
- Rate management, inventory control
- Financial reports, occupancy analytics
- User management, audit logs
- System configuration

**Manager** (Duty Manager/Supervisor)
- Reservation management (create, modify, cancel, adjust rates)
- Check-in/check-out
- Room moves, special requests
- Daily reporting (occupancy, revenue)
- Limited financial adjustments

**Front Desk** (Reception Staff)
- Check-in/check-out
- Reservation lookup/confirmation
- Room assignments
- Guest information management
- Payment processing (view rates, cannot adjust)

**Housekeeping** (Room Attendants)
- View room board (simplified view)
- Update room status (clean, inspected, maintenance needed)
- View priority cleaning list (checkouts first, VIP arrivals)
- Mark room issues (maintenance notes)

**Cashier** (Finance/Reception)
- Payment processing
- Invoice generation
- Refund processing
- Daily cash reconciliation
- Transaction history

**Cafe Staff** (Optional Module)
- Guest charge-to-room (requires room number + guest confirmation)
- Transaction logging
- Basic guest lookup by room
- No access to reservations or sensitive guest data

---

## High-Level Module Map

### **Module 1: BOARD (Primary Interface)**
*The operational dashboard. Always visible, always current.*

**Components:**
- **Room Grid:** Visual 30-room board showing real-time status
  - Color-coded by status (occupied, vacant-clean, vacant-dirty, out-of-service, reserved)
  - Occupancy indicators (guest count, nights remaining)
  - Quick-action buttons (click room → context menu)
  - Arrival/departure markers for today
- **Today's Activity Panel:** Compact sidebar
  - Arrivals list (pending check-ins)
  - Departures list (pending checkouts)
  - Housekeeping queue (rooms needing service)
  - Quick stats (occupancy %, available rooms)
- **Quick Search:** Always-accessible search bar (Cmd+K)
  - Search by: guest name, room number, reservation ID, phone
  - Instant results with contextual actions

**Interactions:**
- Click room → Room Detail Modal (guest info, reservation details, actions)
- Drag & drop to move reservations between rooms (optional, advanced)
- Right-click room → Quick actions menu
- Keyboard shortcuts for power users

---

### **Module 2: RESERVATIONS**
*Pipeline view of bookings. Past, present, future.*

**Views:**
- **Timeline View:** Calendar grid showing reservations across dates
- **List View:** Filterable table (date range, status, room type, channel)
- **Detail View:** Full reservation information, modification history

**Actions:**
- Create reservation (walk-in, phone, online)
- Modify reservation (dates, room type, rate, guest count)
- Cancel reservation (with refund rules)
- Split/merge reservations
- Apply discounts or promotional rates
- Add guest notes/preferences

**Business Logic:**
- Block overbooking (hard constraint)
- Calculate pricing with taxes, extra guests, children
- Validate room availability before confirmation
- Generate booking confirmations (print/email)

---

### **Module 3: GUESTS**
*Guest profiles and history. Relationship memory.*

**Features:**
- Guest profile (name, contact, nationality, ID/passport, preferences)
- Stay history (past reservations, spend, visit frequency)
- Notes (VIP status, allergies, complaints, preferences)
- Quick-create from reservation (auto-populate fields)

**Use Cases:**
- Return guest recognition (search by name/phone → see history)
- Preference tracking (extra pillows, high floor, quiet room)
- VIP flagging (auto-highlight on board)

---

### **Module 4: HOUSEKEEPING**
*Service tracking and room readiness.*

**Tablet-Optimized View:**
- **Priority Queue:** Rooms needing attention (checkouts first, then stayovers)
- **Status Updates:** Large touch-friendly buttons
  - Vacant Dirty → Cleaning → Vacant Clean
  - Occupied Dirty → Cleaning → Occupied Clean
  - Mark for Maintenance
- **Maintenance Notes:** Quick voice-to-text or predefined issues (AC, shower, lights, etc.)

**Manager View:**
- Room status dashboard (all 30 rooms, color-coded)
- Average cleaning times per room type
- Maintenance backlog
- Staff assignment (which attendant owns which floors)

---

### **Module 5: FINANCIALS**
*Revenue tracking and payment processing.*

**Features:**
- **Folios:** Per-reservation billing
  - Room charges (nightly breakdown)
  - Extra guest fees
  - Additional services (cafe charges, minibar, laundry)
  - Tax breakdown
- **Payments:** Cash, card, bank transfer recording
- **Invoices/Receipts:** Print or email
- **Reports:**
  - Daily revenue summary
  - Occupancy + ADR + RevPAR
  - Revenue by room type
  - Payment method breakdown
  - Outstanding balances

**Cashier Features:**
- End-of-day reconciliation
- Cash drawer tracking
- Deposit preparation
- Transaction audit log

---

### **Module 6: REPORTS & ANALYTICS**
*Performance insights and operational metrics.*

**Key Reports:**
- Occupancy trends (daily, weekly, monthly)
- Revenue analysis (by room type, channel, date range)
- Average length of stay
- Lead time distribution (booking window)
- Cancellation rates
- Housekeeping performance (average cleaning time)

**Dashboard (Manager/Admin):**
- Today's snapshot (occupancy, revenue, arrivals/departures)
- Week-ahead forecast (expected occupancy, revenue projection)
- Month-to-date performance vs. targets

---

### **Module 7: SETTINGS & CONFIGURATION** *(Admin Only)*
*System setup and management.*

**Configuration:**
- **Room Setup:** Room numbers, types, default rates, occupancy limits
- **Rate Management:** Seasonal rates, promotional rates, channel-specific rates
- **Policies:** Check-in/check-out times, cancellation rules, child policies
- **Users:** Staff accounts, role assignments, permissions
- **Integrations:** Channel manager connectors (Booking.com, Agoda, etc.)
- **Backup/Audit:** System logs, data export, restore points

---

### **Module 8: CHANNEL MANAGER & INVENTORY SYNC**
*Real-time inventory synchronization with OTA channels.*

**Core Features:**
- **Channel Connections:**
  - Booking.com, Agoda, Expedia, Airbnb integration
  - Secure credential storage (encrypted)
  - Connection health monitoring
  - Enable/disable per channel

- **Real-Time Inventory Sync:**
  - Automatic sync within 30 seconds of any inventory change
  - Triggered by: check-ins, check-outs, reservations, cancellations, room blocks
  - Intelligent event batching for API efficiency
  - Parallel channel updates
  - Automatic retry on transient failures

- **Inventory Visibility:**
  - 30-day forward-looking availability calendar per room type
  - Color-coded availability levels (Good/Limited/Low/Sold Out)
  - Weekend date highlighting
  - Reserved vs. blocked unit breakdown
  - Real-time availability overview

- **Sync Monitoring:**
  - Live event stream showing all inventory changes
  - Per-channel health indicators (Healthy/Degraded/Error)
  - Success rate tracking
  - Average sync duration metrics
  - Complete operation history

- **Manual Controls:**
  - Auto-sync toggle (on/off)
  - Force sync button for full reconciliation
  - Per-channel enable/disable
  - Date range selection for targeted sync

- **Reservation Import:**
  - Pull reservations from channels
  - Conflict detection (duplicate, inventory unavailable)
  - Manual review queue for conflicts
  - Auto-accept for clean imports
  - One-click import to PMS

- **Rate Push:**
  - Automatic rate synchronization (nightly)
  - Dynamic pricing rule application
  - Channel-specific markups
  - Weekend/seasonal adjustments

**Sync Architecture:**
- Event-driven: Each PMS action creates sync event
- Batching window: 30 seconds for efficiency
- Sync latency: 1-35 seconds typical
- Supports: 10+ simultaneous channels
- Handles: 1000+ events/hour

**Operational Benefits:**
- Zero manual inventory updates
- Eliminates overbooking risk
- Maximizes revenue (always current availability)
- Complete audit trail
- Manager-friendly visibility

**Integration Points:**
- Check-in → auto-sync inventory decrease
- Check-out + clean → auto-sync inventory increase
- Reservation created → auto-sync availability update
- Cancellation → auto-sync inventory release
- Room blocked/unblocked → auto-sync status change

---

### **Module 9: CAFE MODULE** *(Optional, Shared Login)*
*Guest charge-to-room interface for cafe staff.*

**Simplified Interface:**
- Room number lookup
- Item selection (menu with prices)
- Charge to room (posts to guest folio)
- Daily transaction log
- No access to reservations or personal guest data

**Constraints:**
- Cannot charge to vacant rooms
- Requires room number + verbal guest confirmation
- All charges appear in folio immediately

---

## System Success Criteria

**Operational Metrics:**
- Front desk completes check-in/check-out 60%+ faster than old system
- Housekeeping staff can use board with zero training
- Zero double-bookings in production use
- Zero data loss incidents
- Staff reports reduced cognitive load and fewer errors

**User Satisfaction:**
- "I can see everything I need without clicking around" (Front Desk)
- "Room status updates are instant" (Housekeeping)
- "I always know what's coming today" (Manager)
- "Financial tracking is finally simple" (Cashier)

**Technical Performance:**
- Board loads in under 200ms (30 rooms, full state)
- Search returns results in under 100ms
- All interactions feel instant (under 100ms perceived latency)
- Works reliably on Safari iPad (front desk hardware)
- Zero runtime errors in console over 7-day test period

**Business Impact:**
- Increased staff efficiency (fewer late checkouts, faster turnover)
- Reduced errors (pricing, room assignments, double-bookings)
- Better guest experience (faster service, fewer mistakes)
- Revenue insights drive better pricing decisions
- System pays for itself in time savings within 60 days

---

## Final Product Direction Statement

**We are building the PMS that boutique hotels deserve but have never had.**

Enterprise PMS platforms (Opera, Cloudbeds, Mews) are built for 200-room properties with complex hierarchies and feature bloat. Budget solutions are clunky, slow, and feel like someone's weekend project. Spreadsheet-based systems are error-prone and scale terribly.

Sandbox Hotel PMS occupies the unserved middle ground: **professional-grade software purpose-built for 20–50 room boutique properties.**

The system respects the intelligence of hotel staff while removing friction from repetitive tasks. It surfaces the right information at the right time. It feels fast because it *is* fast. It looks premium because the hotel *is* premium.

This is software that gets out of the way and lets professionals do their work.

**Core Experience:**
Walk into the front desk. Open the PMS. The board shows every room, color-coded by status. Today's arrivals are listed on the right. A guest walks up. Click their name. Assign room 304. Click check-in. Hand over key. 38 seconds elapsed. The room turns blue on the board. Housekeeping sees it on their tablet across the property. The night audit will include this transaction automatically. No save button. No confirmation dialog. No page refresh.

**That** is the experience we're building.

**This is not a Phase 1 MVP.** This is the complete system, built correctly from day one, designed to run Sandbox Hotel's operations in production for the next decade.

Let's build something sharp.

---

## Experience Qualities

1. **Immediate** — Information appears instantly, actions complete without delay, feedback is instantaneous
2. **Uncluttered** — Every pixel earns its place, visual hierarchy guides the eye, cognitive load stays low
3. **Confident** — Interactions feel precise, system behavior is predictable, staff trust the data

**Complexity Level**: Complex Application (advanced functionality, likely with multiple views)

This is a full-featured PMS with real-time board management, reservation pipeline, multi-role permissions, financial tracking, housekeeping coordination, and analytics — requiring sophisticated state management and multiple coordinated views.

---

## Essential Features

### **Feature 1: Real-Time Room Board**
- **Functionality:** Visual grid displaying all 30 rooms with current status, occupancy, and guest information
- **Purpose:** Provides instant operational awareness of entire property state
- **Trigger:** Primary screen on load, always visible
- **Progression:** View board → identify room → click room → see details/take action → return to board
- **Success Criteria:** All 30 rooms render in <200ms, status updates appear instantly across all connected devices

### **Feature 2: Guest Check-In**
- **Functionality:** Assign arriving guest to clean room, collect payment, activate reservation
- **Purpose:** Transform pending reservation into active occupancy
- **Trigger:** Click guest from arrivals list or search for reservation
- **Progression:** Select guest → assign available room → confirm details → process payment → complete check-in → room turns occupied on board
- **Success Criteria:** Complete flow in <45 seconds, guest appears in room immediately, housekeeping sees room as occupied

### **Feature 3: Guest Check-Out**
- **Functionality:** Settle folio, process final payment, release room to housekeeping
- **Purpose:** Complete guest stay and prepare room for next arrival
- **Trigger:** Click occupied room or select from departures list
- **Progression:** Open folio → review charges → process payment → complete checkout → room turns vacant-dirty → housekeeping notified
- **Success Criteria:** Complete flow in <60 seconds, folio shows all charges correctly, room ready for housekeeping queue

### **Feature 4: Reservation Creation**
- **Functionality:** Create new booking with dates, room type, guest info, pricing
- **Purpose:** Capture walk-in, phone, or direct bookings
- **Trigger:** "New Reservation" button or keyboard shortcut (Cmd+N)
- **Progression:** Enter dates → select room type → check availability → enter guest details → confirm rate → create reservation → appears on board timeline
- **Success Criteria:** Complete booking in <90 seconds, system prevents double-booking, pricing calculates automatically (extra guests, children, taxes)

### **Feature 5: Housekeeping Status Updates**
- **Functionality:** Staff mark rooms as cleaned, inspected, or needing maintenance
- **Purpose:** Track room readiness for guest assignment
- **Trigger:** Housekeeping staff open tablet view, see priority queue
- **Progression:** View dirty room list → select room → mark as cleaning → finish → mark as clean → front desk sees update instantly
- **Success Criteria:** Status change visible to all users within 1 second, large touch-friendly buttons work on iPad, priority queue auto-sorts by checkout time

### **Feature 6: Global Search**
- **Functionality:** Instant search across guests, reservations, room numbers
- **Purpose:** Find any guest or booking in seconds
- **Trigger:** Click search bar or press Cmd+K
- **Progression:** Type query → see instant filtered results → click result → open detail modal with actions
- **Success Criteria:** Results appear as user types (<100ms), searches guest name/room/phone/reservation ID, works with partial matches

### **Feature 7: Rate & Availability Management**
- **Functionality:** Set base rates by room type, create seasonal pricing, manage promotions
- **Purpose:** Control pricing strategy and room inventory
- **Trigger:** Admin navigates to settings → rates section
- **Progression:** Select date range → set rate by room type → save → applies to new reservations automatically
- **Success Criteria:** Rates apply correctly during reservation creation, promotional rates override base rates, system prevents conflicting rate rules

### **Feature 8: Financial Reporting**
- **Functionality:** Revenue summaries, occupancy metrics, payment tracking
- **Purpose:** Business performance visibility and accounting reconciliation
- **Trigger:** Manager/admin opens reports section
- **Progression:** Select report type → choose date range → view metrics → export if needed
- **Success Criteria:** Daily revenue matches sum of all folios, occupancy calculations are accurate, reports generate in <2 seconds

---

## Edge Case Handling

- **Double-Booking Prevention** — System blocks room assignment if dates overlap with existing reservation; shows nearest available alternative
- **Dirty Room Check-In** — Warning modal if attempting check-in to vacant-dirty room; option to override if housekeeping confirms verbal clean status
- **Out-of-Service Rooms** — Rooms 216, 316 default unavailable; admin can toggle status; system excludes from availability calculations
- **Early Check-In / Late Checkout** — Allow time override with note field; flag on board if non-standard times; no extra charge calculation (manual decision)
- **No-Show Handling** — Reservation stays in "expected arrival" until marked no-show; room remains available for walk-ins; admin decides refund policy
- **System Rollover** — Automatic date change at 06:00; departures not checked out auto-flagged; occupied rooms increment night count
- **Payment Failures** — Allow check-in with unpaid balance; flag folio as outstanding; prevent checkout until settled
- **Extra Guest Additions** — Detect mid-stay guest count changes; calculate prorated fees; append to folio automatically
- **Browser Crash Recovery** — All data persists immediately; reloading page restores exact state; no lost transactions
- **Concurrent Edits** — Last-write-wins with optimistic updates; conflicts are rare (different staff work different rooms); critical conflicts show warning

---

## Design Direction

The design should evoke **calm precision in a premium environment.**

This is not a tech startup's colorful dashboard. This is a tool for professionals running a refined boutique hotel. The aesthetic should feel:

- **Sophisticated, not flashy** — Premium typography, restrained color, purposeful whitespace
- **Focused, not busy** — Clear hierarchy, minimal decoration, information density where needed
- **Responsive, not sluggish** — Buttery smooth interactions, immediate feedback, physics-based motion
- **Trustworthy, not playful** — Professional tone, accurate data, reliable behavior

Think: **Luxury hotel lobby meets Swiss design meets modern Japanese efficiency.**

---

## Color Selection

**Approach:** Warm neutrals with strategic color accents that map to operational states. Colors must be immediately recognizable and communicatively distinct.

- **Primary Color:** Deep charcoal gray `oklch(0.25 0.01 270)` — Professional, grounding, used for primary actions and headings. Communicates seriousness and reliability.

- **Secondary Colors:**
  - **Warm Beige** `oklch(0.92 0.02 85)` — Soft backgrounds for cards and panels, evokes boutique hotel warmth without distraction
  - **Soft Taupe** `oklch(0.85 0.015 70)` — Muted elements, disabled states, borders
  - **Cream White** `oklch(0.98 0.005 90)` — Page background, clean and spacious

- **Accent Color:** Terracotta `oklch(0.62 0.15 40)` — Warm, inviting, used for CTAs and important interactive elements. Evokes Thai hospitality and warmth.

- **Operational Status Colors:**
  - **Occupied:** Deep blue `oklch(0.45 0.15 250)` — Guest in room
  - **Vacant Clean:** Jade green `oklch(0.65 0.13 155)` — Ready for check-in
  - **Vacant Dirty:** Amber `oklch(0.70 0.14 75)` — Needs housekeeping
  - **Out of Service:** Cool gray `oklch(0.50 0.01 270)` — Unavailable
  - **Reserved:** Soft purple `oklch(0.55 0.12 290)` — Future arrival

- **Foreground/Background Pairings:**
  - Primary (Deep Charcoal `oklch(0.25 0.01 270)`): White text `oklch(0.98 0.005 90)` — Ratio 9.2:1 ✓
  - Accent (Terracotta `oklch(0.62 0.15 40)`): White text `oklch(0.98 0.005 90)` — Ratio 4.8:1 ✓
  - Occupied (Deep Blue `oklch(0.45 0.15 250)`): White text `oklch(0.98 0.005 90)` — Ratio 6.1:1 ✓
  - Background (Cream `oklch(0.98 0.005 90)`): Dark text `oklch(0.25 0.01 270)` — Ratio 9.2:1 ✓
  - Muted (Warm Beige `oklch(0.92 0.02 85)`): Dark text `oklch(0.30 0.01 270)` — Ratio 7.5:1 ✓

---

## Font Selection

**Characteristics:** Professional, highly legible, sophisticated without being cold. Must work for dense information displays (guest names, dates, amounts) while maintaining elegance.

- **Primary:** **Inter Variable** — Clean, neutral, excellent at small sizes, perfect for data-dense interfaces, humanist warmth
- **Accent/Display:** **Newsreader** — Elegant serif for section headings and hotel branding elements, contrasts beautifully with Inter

**Typographic Hierarchy:**
- **H1 (Module Titles):** Newsreader SemiBold / 32px / -0.02em tracking / 1.2 line-height
- **H2 (Section Headers):** Inter SemiBold / 20px / -0.01em tracking / 1.3 line-height
- **H3 (Subsection Labels):** Inter Medium / 16px / normal tracking / 1.4 line-height
- **Body (Primary Content):** Inter Regular / 15px / normal tracking / 1.6 line-height
- **Small (Secondary Info):** Inter Regular / 13px / normal tracking / 1.5 line-height
- **Captions (Metadata):** Inter Medium / 11px / 0.01em tracking / 1.4 line-height / uppercase
- **Monospace (IDs, Amounts):** Inter Variable / tabular-nums feature / right-aligned for numbers

---

## Animations

**Approach:** Subtle, functional, physics-based. Animations should communicate state changes and guide attention, never delay actions or feel gratuitous.

**Key Animation Moments:**
- **Room Status Change:** Gentle color crossfade (200ms ease-out) when status updates
- **Modal Entry:** Scale up from 0.96 to 1.0 with fade-in (250ms spring), backdrop blur-in simultaneously
- **Check-In Success:** Subtle pulse animation on room card (300ms) when guest assigned
- **List Item Updates:** Slide-in from right for new arrivals/reservations (300ms ease-out)
- **Hover States:** Soft lift (2px translateY) with shadow increase (150ms ease-out) on interactive cards
- **Loading States:** Skeleton screens with shimmer effect, not spinners
- **Toast Notifications:** Slide in from top-right (300ms spring), auto-dismiss after 4s with fade-out

**Constraints:**
- No animations longer than 400ms
- All transitions interruptible (user can click again immediately)
- Reduced motion support (respects prefers-reduced-motion)
- 60fps mandatory, no jank

---

## Component Selection

**Core Shadcn Components:**
- **Dialog:** Check-in/check-out modals, reservation details, guest profiles
- **Card:** Room cards on board, stats panels, folio line items
- **Button:** Primary actions (check-in), secondary actions (cancel), ghost buttons (quick actions)
- **Input, Textarea, Label:** Guest information forms, search bars, note fields
- **Select:** Room type selection, payment method, status dropdowns
- **Table:** Reservation list view, financial reports, transaction logs
- **Tabs:** Switching between module views (Reservations → Guests → Reports)
- **Badge:** Room status indicators, VIP flags, unread counts
- **Popover:** Quick action menus on room hover, date pickers
- **Calendar:** Date range selection for reservations and reports
- **Switch:** Toggle settings (out-of-service rooms, availability)
- **Toast (Sonner):** Success confirmations, error messages, status updates
- **Separator:** Visual grouping in forms and lists
- **ScrollArea:** Long lists (reservation history, transaction logs)

**Customizations:**
- **Room Card Component:** Custom component representing each room on board
  - Background color determined by status
  - Compact layout: room number (large), guest name, nights remaining, occupancy icons
  - Hover state: subtle lift + shadow
  - Click opens detail dialog
- **Activity Feed:** Custom component for arrivals/departures list
  - Chronological ordering
  - Expandable items showing guest details
  - Action buttons (check-in, view reservation)
- **Folio Component:** Custom billing display
  - Line items with dates, descriptions, amounts
  - Running total calculation
  - Payment history section
  - Print/email buttons

**States:**
- **Buttons:** Distinct hover (brighten 10%), active (darken 5%), disabled (50% opacity + no pointer)
- **Inputs:** Focus ring (2px terracotta), error state (red border + message), success (green checkmark icon)
- **Room Cards:** Normal, hover (lift + shadow), active/selected (terracotta border), disabled (grayscale + 50% opacity)

**Icon Selection:**
- **Phosphor Icons** (primary icon library):
  - `House` — Room board navigation
  - `CalendarBlank` — Reservations module
  - `Users` — Guests module
  - `Broom` — Housekeeping module
  - `CurrencyDollar` — Financials module
  - `ChartLine` — Reports & analytics
  - `Gear` — Settings
  - `Coffee` — Cafe module
  - `SignIn` / `SignOut` — Check-in / check-out actions
  - `MagnifyingGlass` — Search
  - `Plus` / `X` — Add / remove actions
  - `Check` — Confirmation, completed states
  - `Warning` — Alerts, issues
  - `DotsThreeVertical` — More actions menu

**Spacing:**
- Base unit: 4px (Tailwind's default)
- **Compact spacing** (dense tables, room cards): `gap-2` (8px), `p-3` (12px)
- **Standard spacing** (forms, panels): `gap-4` (16px), `p-6` (24px)
- **Generous spacing** (module headers, section breaks): `gap-8` (32px), `p-12` (48px)
- **Grid gutters:** `gap-3` for room board (12px between cards)

**Mobile Adaptations:**
- **Board View:** Switches to single-column scrolling list on mobile (<768px), card size increases for touch
- **Modals:** Full-screen takeover on mobile (not centered overlays)
- **Navigation:** Hamburger menu collapses module tabs into slide-out drawer
- **Tables:** Horizontal scroll with sticky first column, or stack into cards on very small screens
- **Search:** Always visible (sticky header), larger touch target
- **Tablet Optimization:** Board remains grid on iPad (primary device), buttons sized for touch (min 44px)

---

## Technical Architecture Notes

**State Management:**
- `useKV` for all persistent data (reservations, guests, room status, settings)
- Regular `useState` for UI state (modal open/closed, search query, selected room)
- Critical data keys:
  - `reservations` — array of reservation objects
  - `guests` — array of guest profiles
  - `rooms` — array of room configuration + current status
  - `folios` — array of billing records
  - `payments` — array of payment transactions
  - `settings` — system configuration object

**Data Modeling:**
- **Reservation:** id, guestId, roomId, checkInDate, checkOutDate, status, ratePerNight, guestCount, childCount, childAges, totalAmount, createdAt, modifiedAt, notes
- **Guest:** id, firstName, lastName, email, phone, nationality, idNumber, vipStatus, preferences, stayHistory
- **Room:** number, type (twin/double), floor, status (occupied/vacant-clean/vacant-dirty/out-of-service/reserved), currentReservationId, maxOccupancy, isAvailable
- **Folio:** id, reservationId, lineItems (array), payments (array), balanceDue, status (open/closed)

**Key Interactions:**
- Room board polls for updates every 5 seconds (or use optimistic updates + periodic sync)
- Status changes persist immediately with optimistic UI updates
- Search debounced (300ms) to avoid excessive filtering
- All forms validated with react-hook-form + zod schemas

---

## Development Priorities

**Phase 1: Foundation (Core Board)**
1. Room board rendering with static data
2. Room status display (color-coded)
3. Room detail modal (view only)
4. Basic navigation structure

**Phase 2: Reservations**
5. Reservation creation flow
6. Guest information capture
7. Rate calculation engine
8. Availability checking logic

**Phase 3: Operations**
9. Check-in workflow
10. Check-out workflow
11. Housekeeping status updates
12. Today's arrivals/departures panel

**Phase 4: Search & Management**
13. Global search functionality
14. Guest profiles and history
15. Reservation modification
16. Room reassignment

**Phase 5: Financials**
17. Folio generation
18. Payment processing
19. Invoice printing
20. Basic financial reports

**Phase 6: Analytics & Admin**
21. Occupancy reporting
22. Revenue analytics
23. Rate management interface
24. User role management
25. System settings

**Phase 7: Polish & Production**
26. Error handling and validation
27. Offline mode support
28. Performance optimization
29. Accessibility audit
30. Production deployment checklist

---

*This PRD is a living document and will evolve as implementation reveals insights.*
