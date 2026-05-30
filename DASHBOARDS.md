# Manager Dashboards & Operational Intelligence
**Sandbox Hotel PMS - Real-Time Visibility**

---

## Philosophy

Dashboards must answer: **"What needs my attention right now?"**

**Not:** vanity metrics, pretty charts, meaningless KPIs.

**Yes:** actionable intelligence, real problems, urgent items, operational state.

Dashboards are **operational command centers**, not executive slide decks.

---

## Dashboard Types

### 1. Front Desk Dashboard
**Primary users:** Front desk staff, reception
**Context:** Daily operations, guest arrivals/departures, immediate actions

### 2. Manager Dashboard
**Primary users:** Hotel manager, operations manager
**Context:** Business oversight, exception handling, performance monitoring

### 3. Housekeeping Dashboard
**Primary users:** Housekeeping supervisor, housekeeping staff
**Context:** Room readiness, cleaning priorities, turnover pressure

---

## Front Desk Dashboard

### Purpose
Give front desk staff complete situational awareness for today's operations.

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Front Desk | Today: 15 Jan 2024                        [↻]   │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│ ┌─ Today's Overview ──────────────────────────────────────┐ │
│ │ Occupancy: 26/30 (87%)  |  Arrivals: 8  |  Departures: 5 │ │
│ │ In-House: 26            |  Due-In: 3    |  Due-Out: 2    │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                               │
│ ┌─ Action Queue ────────────────────────────────────────┐   │
│ │ ⚠️ Payment Due: 3 reservations                        │   │
│ │ ⏰ Deposit Pending: 2 bookings (deadline today)       │   │
│ │ 🧹 Rooms Ready: 24/26 clean | 2 dirty                 │   │
│ │ ❌ No-Show Candidates: 1 (4h past check-in)           │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                               │
│ ┌─ Arrivals Today ──────────────────────────────────────┐   │
│ │ Time  | Room | Guest           | Status    | Action   │   │
│ │───────┼──────┼─────────────────┼───────────┼──────────│   │
│ │ 14:00 | 201  | John Smith      | Due-In    | Check-In │   │
│ │ 14:00 | 305  | Sarah Lee       | Due-In    | Check-In │   │
│ │ 15:30 | 208  | Mike Johnson    | Checked-In| ✓        │   │
│ │ 16:00 | 312  | Anna Wong       | ⚠️ Deposit| Reminder  │   │
│ │ ...                                                    │   │
│ │                                              [View All]│   │
│ └──────────────────────────────────────────────────────┘   │
│                                                               │
│ ┌─ Departures Today ────────────────────────────────────┐   │
│ │ Time  | Room | Guest           | Status    | Action   │   │
│ │───────┼──────┼─────────────────┼───────────┼──────────│   │
│ │ 11:00 | 203  | David Chen      | In-House  | Check-Out│   │
│ │ 11:00 | 307  | Lisa Park       | ⚠️ Balance| Collect   │   │
│ │ 12:00 | 210  | Tom Wilson      | Checked-Out| ✓        │   │
│ │ ...                                                    │   │
│ │                                              [View All]│   │
│ └──────────────────────────────────────────────────────┘   │
│                                                               │
│ ┌─ In-House Guests ─────────────────────────────────────┐   │
│ │ Room | Guest           | Nights | Checkout  | Notes   │   │
│ │──────┼─────────────────┼────────┼───────────┼─────────│   │
│ │ 201  | Emma Brown      | 3/5    | 18 Jan    |          │   │
│ │ 204  | Jack Lee        | 1/2    | 16 Jan    | VIP      │   │
│ │ 305  | Maria Garcia    | 2/7    | 22 Jan    |          │   │
│ │ ...                                         [View All]│   │
│ └──────────────────────────────────────────────────────┘   │
│                                                               │
│ ┌─ Room Status ─────────────────────────────────────────┐   │
│ │ Clean: 24 | Dirty: 2 | Inspected: 22 | Maintenance: 1 │   │
│ │ Blocked: 2 (216, 316)                                  │   │
│ │                                         [Housekeeping] │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                               │
│ [Go to Board] [New Walk-In] [Search Guest]                   │
└──────────────────────────────────────────────────────────────┘
```

### Key Metrics

**Today's Overview:**
- Occupancy: current/total (%)
- Arrivals: scheduled arrivals today
- Departures: scheduled departures today
- In-House: currently checked-in guests
- Due-In: not yet checked-in arrivals
- Due-Out: not yet checked-out departures

**Action Queue:**
- Payment Due: reservations with unpaid balances
- Deposit Pending: deposits due today or overdue
- Rooms Ready: clean/inspected count vs required
- No-Show Candidates: past check-in time by >2-4 hours
- OTA Sync Issues: recent failures (if any)

**Arrivals Today:**
- Time: expected check-in time
- Room: assigned room number
- Guest: guest name
- Status: Due-In, Checked-In, Deposit Pending, No-Show
- Action: Check-In button, Remind, Mark No-Show

**Departures Today:**
- Time: checkout time
- Room: room number
- Guest: guest name
- Status: In-House, Balance Due, Checked-Out
- Action: Check-Out button, Collect Payment

**In-House Guests:**
- Room: room number
- Guest: guest name
- Nights: current/total
- Checkout: departure date
- Notes: VIP, Special Request, Caution flags

**Room Status:**
- Clean: ready for guests
- Dirty: needs cleaning
- Inspected: cleaned and verified
- Maintenance: out of order
- Blocked: non-sellable rooms

### Interactions

**Click on Arrival/Departure:** Open reservation side panel
**Check-In/Check-Out buttons:** Start check-in/checkout flow
**Action Queue items:** Navigate to relevant screen with filters applied
**Auto-refresh:** Every 60 seconds for live updates

---

## Manager Dashboard

### Purpose
Give managers complete visibility into hotel performance, exceptions, and operational health.

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Manager Dashboard | Today: 15 Jan 2024               [↻]     │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│ ┌─ Performance Snapshot ────────────────────────────────┐   │
│ │ Today               │ MTD                │ vs Last Month│   │
│ │─────────────────────┼────────────────────┼─────────────│   │
│ │ Revenue: 45,000 THB │ 675,000 THB        │ +12%        │   │
│ │ Occupancy: 87%      │ 82%                │ +5%         │   │
│ │ ADR: 1,730 THB      │ 1,650 THB          │ +4%         │   │
│ │ RevPAR: 1,505 THB   │ 1,353 THB          │ +11%        │   │
│ └──────────────────────────────────────────────────────────┘ │
│                                                               │
│ ┌─ Operational Status ──────────────────────────────────┐   │
│ │ 🟢 Occupancy: 26/30 (87%)                              │   │
│ │ 🟢 Arrivals: 8 | Departures: 5                         │   │
│ │ 🟡 Payment Due: 3 reservations (67,500 THB)           │   │
│ │ 🔴 Deposit Overdue: 2 bookings (15,000 THB)           │   │
│ │ 🟢 Room Readiness: 24/26 clean                         │   │
│ │ 🟡 Turnover Pressure: 2 rooms (same-day checkout→in)  │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                               │
│ ┌─ Urgent Exceptions ───────────────────────────────────┐   │
│ │ ⚠️ No-Show Candidate: John Smith (Room 201, 4h late)  │   │
│ │ ⚠️ Deposit Overdue: Sarah Lee (15,000 THB, 2d late)   │   │
│ │ ⚠️ Balance Due: Room 307 checking out (7,500 THB)     │   │
│ │ 🔧 Maintenance: Room 214 (AC issue, blocked)          │   │
│ │                                            [View All]  │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                               │
│ ┌─ Channel Health ──────────────────────────────────────┐   │
│ │ Provider       │ Status  │ Last Sync │ Reservations  │   │
│ │────────────────┼─────────┼───────────┼───────────────│   │
│ │ Booking.com    │ 🟢 OK   │ 10m ago   │ 12 this week  │   │
│ │ Agoda          │ 🟢 OK   │ 15m ago   │ 8 this week   │   │
│ │ Expedia        │ 🔴 Error│ 2h ago    │ -             │   │
│ │ Airbnb         │ 🟢 OK   │ 30m ago   │ 3 this week   │   │
│ │                                            [Channels]  │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                               │
│ ┌─ Revenue Trend (Last 7 Days) ─────────────────────────┐   │
│ │     50K ┤                                         ●    │   │
│ │     40K ┤                     ●         ●              │   │
│ │     30K ┤         ●       ●       ●                    │   │
│ │     20K ┤     ●                                        │   │
│ │     10K ┤ ●                                            │   │
│ │      0K └─────────────────────────────────────────────│   │
│ │          9  10  11  12  13  14  15 Jan                │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                               │
│ ┌─ Next 7 Days Forecast ────────────────────────────────┐   │
│ │ Date     | Occ  | Arr | Dep | Revenue    | Notes      │   │
│ │──────────┼──────┼─────┼─────┼────────────┼────────────│   │
│ │ 16 Jan   | 88%  |  7  |  5  | 46,200 THB |            │   │
│ │ 17 Jan   | 90%  |  6  |  4  | 48,000 THB |            │   │
│ │ 18 Jan   | 85%  |  5  |  7  | 43,500 THB |            │   │
│ │ 19 Jan   | 70%  |  3  |  8  | 36,000 THB |            │   │
│ │ 20 Jan   | 75%  |  8  |  5  | 39,000 THB | Weekend    │   │
│ │ 21 Jan   | 92%  | 10  |  3  | 51,000 THB | Weekend    │   │
│ │ 22 Jan   | 95%  |  5  |  2  | 54,000 THB |            │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                               │
│ [Go to Board] [Reports] [Channels] [Settings]                │
└──────────────────────────────────────────────────────────────┘
```

### Key Metrics

**Performance Snapshot:**
- Today: revenue, occupancy, ADR, RevPAR
- MTD (month-to-date): aggregated metrics
- vs Last Month: percentage change

**Operational Status:**
- Occupancy: current state
- Arrivals/Departures: today's flow
- Payment Due: outstanding balances (count + amount)
- Deposit Overdue: late deposits (count + amount)
- Room Readiness: clean count vs needed
- Turnover Pressure: same-day turnover rooms

**Urgent Exceptions:**
- No-Show Candidates: late arrivals needing action
- Deposit Overdue: payment collection needed
- Balance Due: checkout payment pending
- Maintenance: blocked rooms with issues
- OTA Sync Failures: channel problems

**Channel Health:**
- Provider: OTA name
- Status: OK, Warning, Error
- Last Sync: time since last successful sync
- Reservations: count this week

**Revenue Trend:**
- Simple line chart showing last 7 days revenue
- Visual pattern recognition

**Next 7 Days Forecast:**
- Date
- Occupancy %
- Arrivals count
- Departures count
- Projected revenue
- Notes (weekend, events, etc.)

### Interactions

**Exception items:** Click to navigate to relevant screen
**Channel Health:** Click to open channel details
**Forecast rows:** Click to open board at that date
**Auto-refresh:** Every 2 minutes

---

## Housekeeping Dashboard

### Purpose
Give housekeeping staff clear priorities and room status visibility.

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Housekeeping | Today: 15 Jan 2024                    [↻]     │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│ ┌─ Today's Workload ────────────────────────────────────┐   │
│ │ Dirty: 2 | Cleaning: 0 | Clean: 24 | Inspected: 22   │   │
│ │ Maintenance: 1 | Blocked: 2                           │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                               │
│ ┌─ Priority Rooms ───────────────────────────────────────┐  │
│ │ Room | Type   | Status      | Priority | Action       │  │
│ │──────┼────────┼─────────────┼──────────┼──────────────│  │
│ │ 203  | Twin   | Dirty       | 🔴 URGENT│ [Start Clean]│  │
│ │ 307  | Double | Dirty       | 🔴 URGENT│ [Start Clean]│  │
│ │ 210  | Twin   | Clean       | Normal   | [Inspect]    │  │
│ │ 208  | Twin   | Clean       | Normal   | [Inspect]    │  │
│ │ ...                                                    │  │
│ └──────────────────────────────────────────────────────┘   │
│                                                               │
│ Priority: 🔴 URGENT = Same-day turnover (checkout→checkin)  │
│           🟡 HIGH = Departure today, next arrival tomorrow  │
│           Normal = Standard cleaning                         │
│                                                               │
│ ┌─ Turnover Rooms (Same-Day) ───────────────────────────┐   │
│ │ Room | Checkout | Next Checkin | Time Left | Status   │   │
│ │──────┼──────────┼──────────────┼───────────┼──────────│   │
│ │ 203  | 11:00    | 15:00 (today)│ 3h 15m    | Dirty    │   │
│ │ 307  | 12:00    | 16:00 (today)│ 4h 15m    | Dirty    │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                               │
│ ┌─ Room Status (All Floors) ────────────────────────────┐   │
│ │ Floor 2: ✓✓✓ ✓✓✓ ✓✓✓ ✓✓✓ ⚠️ 🚫                        │   │
│ │ Floor 3: ✓✓✓ ✓✓✓ ✓✓✓ ✓✓✓ ⚠️ 🚫                        │   │
│ │                                                        │   │
│ │ Legend: ✓=Clean  ⚠️=Dirty/Maintenance  🚫=Blocked      │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                               │
│ ┌─ Maintenance Issues ───────────────────────────────────┐  │
│ │ Room | Issue            | Reported    | Status        │  │
│ │──────┼──────────────────┼─────────────┼───────────────│  │
│ │ 214  | AC not cooling   | 14 Jan 16:30│ Pending       │  │
│ │                                            [View All]  │  │
│ └──────────────────────────────────────────────────────┘   │
│                                                               │
│ [View All Rooms] [Report Issue] [Refresh]                    │
└──────────────────────────────────────────────────────────────┘
```

### Key Metrics

**Today's Workload:**
- Dirty: needs cleaning
- Cleaning: currently being cleaned
- Clean: cleaned, not inspected
- Inspected: ready for guests
- Maintenance: blocked due to issues
- Blocked: non-sellable (216, 316)

**Priority Rooms:**
- Room number
- Room type
- Status
- Priority: URGENT (same-day turnover), HIGH (next-day arrival), Normal
- Action: Start Clean, Inspect buttons

**Turnover Rooms:**
- Rooms with same-day checkout → check-in
- Checkout time
- Next check-in time
- Time remaining until check-in
- Current status

**Room Status (Visual):**
- Floor-based visual grid
- Quick scan of entire property
- Color-coded status indicators

**Maintenance Issues:**
- Room number
- Issue description
- Reported time
- Status

### Interactions

**Start Clean button:** Mark room as "cleaning in progress"
**Inspect button:** Mark room as "inspected" (ready)
**Report Issue button:** Create maintenance request
**Mobile-friendly:** Large touch targets, simple layout
**Auto-refresh:** Every 60 seconds

---

## Dashboard Data Services

### DashboardService

```typescript
class DashboardService {
  async getFrontDeskDashboard(): Promise<FrontDeskDashboard>
  async getManagerDashboard(): Promise<ManagerDashboard>
  async getHousekeepingDashboard(): Promise<HousekeepingDashboard>
  
  async getOccupancySnapshot(date: Date): Promise<OccupancySnapshot>
  async getArrivals(date: Date): Promise<Arrival[]>
  async getDepartures(date: Date): Promise<Departure[]>
  async getActionQueue(): Promise<ActionQueue>
  async getChannelHealth(): Promise<ChannelHealth[]>
  async getRevenueTrend(days: number): Promise<RevenueTrend[]>
  async getForecast(days: number): Promise<ForecastDay[]>
  async getHousekeepingPriorities(): Promise<HousekeepingPriority[]>
}
```

### Dashboard Data Models

```typescript
interface FrontDeskDashboard {
  snapshot: OccupancySnapshot
  actionQueue: ActionQueue
  arrivals: Arrival[]
  departures: Departure[]
  inHouse: InHouseGuest[]
  roomStatus: RoomStatusSummary
  lastUpdated: Date
}

interface ManagerDashboard {
  performanceSnapshot: PerformanceSnapshot
  operationalStatus: OperationalStatus
  exceptions: Exception[]
  channelHealth: ChannelHealth[]
  revenueTrend: RevenueTrend[]
  forecast: ForecastDay[]
  lastUpdated: Date
}

interface HousekeepingDashboard {
  workloadSummary: WorkloadSummary
  priorities: HousekeepingPriority[]
  turnovers: TurnoverRoom[]
  roomStatusGrid: RoomStatusGrid
  maintenanceIssues: MaintenanceIssue[]
  lastUpdated: Date
}

interface OccupancySnapshot {
  date: Date
  occupied: number
  available: number
  occupancyPercent: number
  arrivals: number
  departures: number
  inHouse: number
  dueIn: number
  dueOut: number
}

interface ActionQueue {
  paymentDue: ActionItem[]
  depositPending: ActionItem[]
  roomsNotReady: number
  noShowCandidates: ActionItem[]
  otaSyncIssues: ActionItem[]
}

interface Arrival {
  id: string
  time: string
  room?: string
  guestName: string
  status: 'due-in' | 'checked-in' | 'no-show' | 'deposit-pending'
  depositPending: boolean
  preCheckinComplete: boolean
  notes?: string
}

interface Departure {
  id: string
  time: string
  room: string
  guestName: string
  status: 'in-house' | 'checked-out' | 'balance-due'
  balanceDue: number
  notes?: string
}

interface PerformanceSnapshot {
  today: DayMetrics
  mtd: PeriodMetrics
  vsLastMonth: ComparisonMetrics
}

interface DayMetrics {
  revenue: number
  occupancy: number
  adr: number
  revpar: number
}

interface OperationalStatus {
  occupancy: StatusItem
  flow: StatusItem
  payments: StatusItem
  deposits: StatusItem
  rooms: StatusItem
  turnover: StatusItem
}

interface StatusItem {
  severity: 'ok' | 'warning' | 'error'
  label: string
  value: string | number
  detail?: string
}

interface Exception {
  id: string
  type: 'no-show' | 'deposit-overdue' | 'balance-due' | 'maintenance' | 'sync-failure'
  severity: 'warning' | 'error'
  title: string
  description: string
  actionUrl: string
}

interface ChannelHealth {
  provider: string
  status: 'ok' | 'warning' | 'error'
  lastSync: Date
  reservationsThisWeek: number
  errorMessage?: string
}

interface ForecastDay {
  date: Date
  occupancy: number
  arrivals: number
  departures: number
  revenue: number
  notes?: string
}

interface HousekeepingPriority {
  roomNumber: string
  roomType: string
  status: 'dirty' | 'clean' | 'inspected'
  priority: 'urgent' | 'high' | 'normal'
  reason?: string
  nextCheckIn?: Date
}

interface TurnoverRoom {
  roomNumber: string
  checkoutTime: string
  nextCheckInTime: string
  hoursUntilCheckIn: number
  status: string
}
```

---

## Real-Time Updates

### SSE (Server-Sent Events) Approach

**Client subscribes:**
```typescript
const eventSource = new EventSource('/api/dashboard/stream')

eventSource.addEventListener('dashboard-update', (event) => {
  const data = JSON.parse(event.data)
  updateDashboard(data)
})

eventSource.addEventListener('action-queue-update', (event) => {
  const actionQueue = JSON.parse(event.data)
  updateActionQueue(actionQueue)
})
```

**Server pushes updates:**
```typescript
// When reservation status changes
notifyDashboardUpdate('front-desk', {
  type: 'arrival-checked-in',
  reservationId: 'xxx',
  guestName: 'John Smith'
})

// When room status changes
notifyDashboardUpdate('housekeeping', {
  type: 'room-cleaned',
  roomNumber: '203'
})
```

### Update Triggers

**Dashboard should update when:**
- Reservation checked in/out
- Room status changed
- Payment collected
- Deposit received
- OTA sync completed/failed
- Maintenance issue reported
- Arrival/departure time approaching

**Throttle updates:** Max 1 update per 10 seconds per dashboard type

---

## Performance Requirements

**Dashboard must:**
- Load initial data in <2 seconds
- Refresh data without full page reload
- Use efficient queries (indexed, aggregated)
- Cache computed metrics briefly (30-60s)
- Handle concurrent users gracefully

**Dashboard must NOT:**
- Run slow queries on every refresh
- Recompute static data repeatedly
- Block on external API calls
- Refresh more than needed
- Cause database load spikes

---

## Mobile Adaptation

**Front Desk Dashboard:**
- Stack sections vertically
- Collapse less urgent sections
- Focus on action queue and today's arrivals/departures
- Swipe-friendly tables

**Manager Dashboard:**
- Performance snapshot at top
- Exceptions always visible
- Charts/graphs optional (collapsible)
- Quick access to board and reports

**Housekeeping Dashboard:**
- Priority rooms prominent
- Large action buttons
- Visual room grid simplified
- Fast status updates

---

## Dashboard Permissions

| Dashboard Type     | Admin | Manager | Front Desk | Housekeeping | Cashier |
|-------------------|-------|---------|------------|--------------|---------|
| Front Desk        | ✓     | ✓       | ✓          | View only    | ✓       |
| Manager           | ✓     | ✓       | Limited    | ✗            | ✗       |
| Housekeeping      | ✓     | ✓       | View only  | ✓            | ✗       |

**Limited:** See operational metrics, not financial details.

---

## Implementation Priority

### Phase 1: Front Desk Dashboard
- Today's overview
- Action queue
- Arrivals/departures
- Room status summary
- Manual refresh

### Phase 2: Manager Dashboard
- Performance snapshot
- Operational status
- Exceptions list
- Channel health

### Phase 3: Real-Time Updates
- SSE/WebSocket integration
- Auto-refresh
- Live status changes

### Phase 4: Housekeeping Dashboard
- Workload summary
- Priority list
- Visual room grid
- Mobile optimization

---

## Success Criteria

**Dashboard must:**
- Answer "what needs attention?" in <5 seconds
- Show accurate, real-time data
- Highlight urgent items clearly
- Link to action screens directly
- Update without page refresh
- Be mobile-usable
- Load fast (<2s)

**Dashboard must NOT:**
- Show stale data (>2 minutes old)
- Overwhelm with irrelevant metrics
- Require scrolling for critical info
- Have confusing or ambiguous indicators
- Crash or freeze under load

