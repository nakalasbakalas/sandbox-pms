# Reporting and Operational Intelligence
**Sandbox Hotel PMS - Final Layer**

---

## Philosophy

Reporting must be **operationally useful, not vanity analytics**.

Every report must answer:
- What do I need to do today?
- How is the business performing?
- Where are the problems?
- What trends matter?

**No bloated BI dashboards.**
**No meaningless vanity metrics.**
**No giant report builders that staff never use.**

Fast, clear, actionable intelligence.

---

## Report Architecture

### Report Groups

#### A. Operations Reports

**Daily Operations**
- Arrivals by day (date range)
- Departures by day (date range)
- In-house by day
- Room status distribution (dirty/clean/inspected/maintenance/blocked)
- Housekeeping readiness timeline
- Turnover pressure (same-day checkout → check-in)

**Operational Trends**
- Occupancy by day/week/month
- Reservation source mix
- Cancellations (count, rate, lead time)
- No-show trends
- Modification volume
- Average stay length

**Filters**: date range, room type, source, status

---

#### B. Revenue & Financial Reports

**Revenue Summary**
- Revenue by day/week/month
- ADR (Average Daily Rate)
- RevPAR (Revenue Per Available Room)
- Occupancy % (rooms sold / rooms available)
- Room revenue vs extras breakdown
- Payment collection trends
- Outstanding balance summary

**Financial Detail**
- Folio categories (room, extras, fees)
- Deposit performance (collected, pending, overdue)
- Channel revenue comparison
- Refund/void summary
- Tax collected summary

**Filters**: date range, room type, channel, payment status

---

#### C. Reservation Reports

**Booking Performance**
- Booking pace (reservations by booking date)
- Lead time distribution (days between booking and arrival)
- Stay length distribution
- Room type performance
- Direct vs OTA comparison
- Modification/cancellation volume by source

**Conversion Funnel** (if public booking engine tracks this)
- Search volume
- Hold conversions
- Booking confirmations
- Cancellation rate

**Filters**: booking date range, arrival date range, source, room type

---

#### D. Housekeeping Reports

**Cleaning Operations**
- Cleaning completion rate
- Average readiness timing (checkout → clean → inspected)
- Turnover workload by day
- Maintenance-related room loss (room-nights lost)
- Blocked/out-of-service trends

**Room Status Timeline**
- Status changes by room by date
- Turnover pressure days
- Inspection compliance

**Filters**: date range, room, status type

---

#### E. Channel Reports

**Channel Performance**
- Reservations by channel
- Revenue by channel
- ADR by channel
- Sync success/failure counts
- Imported booking trends
- Rate parity monitoring (if practical)

**Sync Health**
- Last sync time by provider
- Error summary
- Unmapped room warnings
- Conflict resolution summary

**Filters**: date range, channel, sync status

---

#### F. Guest & Feedback Reports

**Guest Intelligence**
- Repeat guest count and rate
- Guest nationality distribution
- Average stay length by guest type
- VIP/caution flag summary

**Feedback Summary** (if survey module exists)
- Survey response rate
- Satisfaction trends
- Common themes (manual review)

**Filters**: date range, guest status, flag type

---

## Report Data Model

### ReportDefinition

```typescript
interface ReportDefinition {
  id: string
  slug: string
  name: string
  category: 'operations' | 'revenue' | 'reservation' | 'housekeeping' | 'channel' | 'guest'
  description: string
  defaultFilters: ReportFilters
  availableFilters: FilterConfig[]
  columns: ColumnDefinition[]
  sortOptions: SortOption[]
  exportFormats: ('csv' | 'pdf' | 'print')[]
  refreshInterval?: number
  permissions: Permission[]
}

interface ReportFilters {
  dateRange?: { start: Date; end: Date }
  roomTypes?: string[]
  channels?: string[]
  status?: string[]
  customFilters?: Record<string, any>
}

interface ColumnDefinition {
  key: string
  label: string
  type: 'text' | 'number' | 'currency' | 'percent' | 'date' | 'status'
  format?: string
  width?: string
  align?: 'left' | 'center' | 'right'
  sortable: boolean
  exportable: boolean
}
```

### ReportExecution

```typescript
interface ReportExecution {
  id: string
  reportId: string
  executedAt: Date
  executedBy: string
  filters: ReportFilters
  resultCount: number
  executionTime: number
  format: 'view' | 'csv' | 'pdf'
  status: 'success' | 'error'
  errorMessage?: string
}
```

### SavedReport

```typescript
interface SavedReport {
  id: string
  userId: string
  reportId: string
  name: string
  description?: string
  filters: ReportFilters
  schedule?: ReportSchedule
  createdAt: Date
  lastRun?: Date
}

interface ReportSchedule {
  frequency: 'daily' | 'weekly' | 'monthly'
  time: string
  dayOfWeek?: number
  dayOfMonth?: number
  recipients: string[]
  format: 'csv' | 'pdf'
  enabled: boolean
}
```

---

## Report UX

### Report Landing Page

**Layout:**
```
┌─────────────────────────────────────────┐
│ Reports                                  │
├─────────────────────────────────────────┤
│                                          │
│ ┌─ Operations ─────────────────────┐   │
│ │ • Arrivals & Departures           │   │
│ │ • Occupancy Trends                │   │
│ │ • Room Status Distribution        │   │
│ │ • Turnover Pressure               │   │
│ └───────────────────────────────────┘   │
│                                          │
│ ┌─ Revenue & Financial ────────────┐   │
│ │ • Revenue Summary                 │   │
│ │ • ADR & RevPAR                    │   │
│ │ • Payment Collections             │   │
│ │ • Outstanding Balances            │   │
│ └───────────────────────────────────┘   │
│                                          │
│ ┌─ Reservations ───────────────────┐   │
│ │ • Booking Pace                    │   │
│ │ • Lead Time Analysis              │   │
│ │ • Channel Performance             │   │
│ └───────────────────────────────────┘   │
│                                          │
│ ┌─ Quick Access ───────────────────┐   │
│ │ Saved Reports: [dropdown]         │   │
│ └───────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### Report View Page

**Layout:**
```
┌─────────────────────────────────────────────────┐
│ ← Back | Report Name                             │
├─────────────────────────────────────────────────┤
│ Filters: [Date Range] [Room Type] [Channel]     │
│ [Apply] [Reset] [Save Preset] [Export CSV]      │
├─────────────────────────────────────────────────┤
│                                                  │
│ Summary Cards (if applicable)                   │
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐   │
│ │ Total  │ │  ADR   │ │  Occ%  │ │RevPAR  │   │
│ │ 450K   │ │ 1,500  │ │  85%   │ │ 1,275  │   │
│ └────────┘ └────────┘ └────────┘ └────────┘   │
│                                                  │
│ ┌─ Results Table ─────────────────────────┐    │
│ │ Date     | Arr | Dep | Occ% | Revenue   │    │
│ │──────────┼─────┼─────┼──────┼───────────│    │
│ │ 2024-... │  12 │  10 │  85% │    45,000 │    │
│ │ 2024-... │   8 │  12 │  78% │    39,000 │    │
│ │ ...                                      │    │
│ └──────────────────────────────────────────┘    │
│                                                  │
│ Showing 1-50 of 120 results                     │
│ [Previous] [1] [2] [3] [Next]                   │
└─────────────────────────────────────────────────┘
```

### Report Features

**Filtering:**
- Date range picker (with presets: today, yesterday, last 7 days, last 30 days, this month, last month)
- Multi-select for room types, channels, statuses
- Save filter presets for quick access

**Sorting:**
- Click column headers to sort
- Persist sort preference

**Export:**
- CSV: all columns, all rows (respecting filters)
- PDF: formatted, printable view
- Print: browser print dialog with clean layout

**Saved Reports:**
- Save current report + filters as preset
- Quick access from report landing
- Share with team (if useful)

**Performance:**
- Paginate large result sets (50 rows default)
- Cache common queries briefly
- Show loading state for slow reports
- Warn if date range is excessive

---

## Report Implementation Strategy

### Backend Services

**ReportService**
```typescript
class ReportService {
  async executeReport(
    reportId: string,
    filters: ReportFilters,
    userId: string
  ): Promise<ReportResult>

  async exportReport(
    reportId: string,
    filters: ReportFilters,
    format: 'csv' | 'pdf',
    userId: string
  ): Promise<Buffer>

  async getSavedReports(userId: string): Promise<SavedReport[]>

  async saveReportPreset(
    userId: string,
    reportId: string,
    name: string,
    filters: ReportFilters
  ): Promise<SavedReport>

  async getReportDefinitions(): Promise<ReportDefinition[]>
}
```

**Report Queries**
- Use direct SQL for performance (Prisma raw queries or query builder)
- Index critical columns (date, status, roomTypeId, channelId)
- Use materialized views for complex aggregations if needed
- Cache common date range queries briefly

**Export Handlers**
- CSV: simple row-based export using csv library
- PDF: html-pdf or puppeteer for formatted output
- Ensure exports respect user permissions

---

## KPI Definitions

### Occupancy %
```
(Room Nights Sold / Room Nights Available) × 100
```
Exclude blocked/out-of-service rooms from available pool.

### ADR (Average Daily Rate)
```
Room Revenue / Room Nights Sold
```
Room revenue only, exclude extras.

### RevPAR (Revenue Per Available Room)
```
Room Revenue / Room Nights Available
```
OR
```
ADR × Occupancy %
```

### Turnover Pressure
Rooms with same-day checkout followed by same-day check-in.
```
Count of (checkout date = checkin date) for different reservations
```

### Booking Pace
Number of reservations created by booking date (not arrival date).
Shows when bookings are happening.

### Lead Time
Days between booking date and arrival date.
```
arrival_date - booking_date (in days)
```

### No-Show Rate
```
(No-Shows / Expected Arrivals) × 100
```

### Cancellation Rate
```
(Cancellations / Total Bookings) × 100
```

---

## Report Permissions

| Report Category | Admin | Manager | Front Desk | Housekeeping | Cashier |
|----------------|-------|---------|------------|--------------|---------|
| Operations     | ✓     | ✓       | ✓          | Limited      | ✗       |
| Revenue        | ✓     | ✓       | Limited    | ✗            | ✓       |
| Reservation    | ✓     | ✓       | ✓          | ✗            | ✗       |
| Housekeeping   | ✓     | ✓       | Limited    | ✓            | ✗       |
| Channel        | ✓     | ✓       | View only  | ✗            | ✗       |
| Guest          | ✓     | ✓       | ✓          | ✗            | ✗       |

**Limited:** Can view summaries, cannot export detailed data.

---

## Implementation Phases

### Phase 1: Core Reports
- Operations: Arrivals/Departures
- Revenue Summary
- Occupancy Trends
- Basic CSV export

### Phase 2: Advanced Analytics
- Channel Performance
- Booking Pace
- Lead Time Analysis
- PDF export

### Phase 3: Saved Reports & Automation
- Saved presets
- Scheduled reports (future)
- Advanced filters
- Report sharing

---

## Success Criteria

**Report must:**
- Load within 2 seconds for typical date ranges (30 days)
- Warn if query will be slow (>90 days)
- Export CSV within 5 seconds for typical result sets
- Display clear "no data" states
- Show accurate calculations matching financial records
- Respect user permissions
- Provide clear filter feedback
- Be mobile-viewable (responsive tables)

**Report must NOT:**
- Show incorrect totals
- Allow unauthorized data access
- Export more data than user can view
- Crash on large date ranges
- Have confusing or ambiguous metrics
- Overwhelm staff with complexity

---

## Future Enhancements

**Possible additions:**
- Forecasting (predictive occupancy)
- Benchmark comparisons (vs last year)
- Report subscriptions (email delivery)
- Custom report builder (for power users)
- Chart visualizations (trends over time)
- Real-time dashboards (separate from reports)

**Do not build these unless operationally justified.**

