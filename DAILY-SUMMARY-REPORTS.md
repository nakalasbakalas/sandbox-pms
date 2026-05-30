# Daily Summary Reports — Implementation Guide
**Automated Room Readiness & Operational Intelligence**

---

## Overview

The Daily Summary Report system provides automated morning briefings on hotel operational status, room readiness, and key metrics. Designed to give managers and front desk staff a comprehensive snapshot of the day ahead before operations begin.

---

## Key Features

### 1. Automated Report Generation
- **Scheduled Delivery**: Reports generated automatically at a configured time each day
- **Customizable Schedule**: Set delivery time and active days of the week
- **Manual Generation**: Generate on-demand test reports at any time
- **Persistent History**: Last 50 reports stored for review

### 2. Comprehensive Metrics

**Room Status Overview**
- Total room inventory count
- Clean vs. dirty room distribution
- Inspected room count
- Out-of-service/maintenance rooms
- Clean room percentage

**Today's Schedule**
- Total arrivals expected
- Rooms ready for arrivals
- Arrival readiness percentage
- Total departures
- Departure cleaning completion

**Housekeeping Progress**
- Tasks completed vs. remaining
- Completion rate percentage
- Average cleaning time
- In-progress task count

**Maintenance Issues**
- Total active issues
- Urgent/high priority count
- Rooms blocked due to maintenance
- Oldest issue age (days)

**Readiness Score** (0-100%)
Composite score calculated from:
- Clean room ratio (30% weight)
- Arrival readiness (40% weight)
- Maintenance health (15% weight)
- Housekeeping velocity (15% weight)

### 3. Intelligent Alerts

Reports include contextual alerts based on configurable thresholds:

**Critical Alerts**
- Arrival rooms not ready
- Critical maintenance blocking arrivals
- Zero clean rooms available

**Warning Alerts**
- Readiness score below threshold (default: 80%)
- High maintenance issue count
- Departure cleaning behind schedule

**Info Alerts**
- High checkout volume days
- Unusual operational patterns
- Scheduling notes

### 4. Delivery Channels

**LINE Messaging**
- Send to staff with LINE integration
- Compact format optimized for mobile
- Instant delivery

**Email**
- Detailed HTML email with full metrics
- Charts and visualizations
- Professional formatting

### 5. Recipient Management

**Role-Based Recipients**
- Admin
- Manager
- Front Desk
- Housekeeping
- Cashier
- Maintenance

**Individual Selection**
- Override with specific staff IDs
- Combine roles + individuals
- Must have active status and alert preferences enabled

### 6. Weekly Performance Trends

**Trend Analysis**
- Automatic comparison of current week vs. previous week
- 5 key performance indicators tracked:
  - Readiness Score
  - Clean Room Percentage
  - Housekeeping Efficiency
  - Maintenance Issues
  - Occupancy Rate

**Visual Indicators**
- Trend arrows (up/down/stable)
- Percentage change calculations
- Color-coded performance (green = improving, red = declining)
- Progress bars for each metric

**Insights Generation**
- Automated performance observations
- Threshold-based recommendations
- Pattern recognition (e.g., maintenance increasing, occupancy trends)
- Actionable suggestions for improvement

**Data Management**
- Stores up to 90 days of historical metrics
- Automatic recording with each daily report
- Sample data seeding for demonstration
- Manual data management in settings

---

## Configuration

### Settings Location
**Navigation**: Settings → Daily Reports tab

### Schedule Configuration

```typescript
schedule: {
  time: '07:00',           // HH:MM format (24-hour)
  daysOfWeek: [0,1,2,3,4,5,6]  // 0=Sunday, 6=Saturday
}
```

**Typical Schedules**:
- **Daily Morning Brief**: 07:00, all days
- **Weekday Only**: 07:00, Monday-Friday [1,2,3,4,5]
- **Weekend Focus**: 08:00, Saturday-Sunday [0,6]

### Content Configuration

Toggle which metrics to include:
- ✓ Room Status Overview
- ✓ Housekeeping Progress
- ✓ Arrivals & Departures
- ✓ Maintenance Issues
- ✓ Readiness Score

All enabled by default; disable sections not relevant to your operation.

### Alert Thresholds

```typescript
thresholds: {
  lowReadinessWarning: 80,      // % below which to alert
  highPriorityRoomCount: 3,     // # of critical rooms to flag
}
```

Adjust based on your property size and standards:
- **Larger Properties**: Lower readiness threshold (70-75%)
- **Boutique Hotels**: Higher threshold (85-90%)

### Delivery Channels

Enable/disable independently:
- **LINE**: Requires LINE integration configured
- **Email**: Requires email addresses for recipients

Reports only send if at least one channel is enabled and has valid recipients.

---

## Report Structure

### Header Section
- Report date (full format)
- Generation timestamp
- Property name (from settings)

### Weekly Trends Section (NEW)
Displayed at the top of each daily report:

**Trend Cards** (5 metrics):
1. **Readiness Score**
   - Current week average
   - Previous week average
   - Percentage change
   - Trend indicator (↑/↓/−)
   - Progress visualization

2. **Clean Room Percentage**
   - Weekly average comparison
   - Trend direction
   - Performance indicator

3. **Housekeeping Efficiency**
   - Completion rate trends
   - Week-over-week change
   - Performance status

4. **Maintenance Issues**
   - Average issue count
   - Trend analysis
   - Health indicator

5. **Occupancy Rate**
   - Booking trends
   - Week comparison
   - Growth indicator

**Weekly Summary Panel**
- Days tracked this week
- Average arrivals per day
- Average cleaning time
- Quick statistics

**Performance Insights**
- Automated observations (e.g., "Readiness score improved by 6.2% this week")
- Threshold-based alerts (e.g., "Housekeeping completion rate below target")
- Trend warnings (e.g., "Maintenance issues increased - inspection recommended")
- Positive reinforcement (e.g., "Operations stable - metrics within normal ranges")

### Metrics Dashboard
Four key metrics displayed prominently:
1. **Readiness Score** with progress indicator
2. **Clean Rooms** (count and percentage)
3. **Arrivals Today** with readiness status
4. **Maintenance Issues** with blocked room count

### Active Alerts Section
Grouped by severity:
- **Critical** (red): Immediate action required
- **Warning** (yellow): Attention needed
- **Info** (blue): Awareness items

Each alert includes:
- Severity badge
- Category (Housekeeping, Arrivals, Maintenance, Operations)
- Clear message
- Affected room numbers (if applicable)

### Detailed Metrics

**Room Status Breakdown**
- Inspected: ✓ (green)
- Clean: ✓ (blue)
- Dirty: × (orange)
- Out of Service: ⚠ (red)

**Today's Schedule Detail**
- Departures total and completed
- Arrivals total and ready
- Readiness percentage with progress bar

**Housekeeping Progress**
- Grid showing completed/in-progress/not-started
- Completion rate with progress indicator
- Average cleaning time

**Readiness Factor Breakdown**
Individual scores for each component:
- Arrival Readiness
- Clean Room Ratio
- Housekeeping Velocity
- Maintenance Health

### Rooms Needing Attention
High-priority rooms displayed with:
- Room number
- Current status badge
- Arrival/departure indicators
- Special notes

Limit: First 12 rooms shown in settings, all in full report

### Complete Room Grid
All rooms displayed in compact grid format:
- Room number (monospace for alignment)
- Status badge (color-coded)
- Arrival ↓ / Departure ↑ icons
- Visual highlighting for rooms needing attention

---

## Usage Patterns

### Morning Operations Brief

**Time**: 07:00 (before shift starts)
**Recipients**: Manager, Front Desk Lead
**Focus**: Arrival readiness, critical issues

Gives leadership team the day's operational status before front desk opens.

### Housekeeping Dispatch

**Time**: 06:30 (early morning)
**Recipients**: Housekeeping Manager, Supervisors
**Focus**: Departure cleaning, priority rooms

Enables housekeeping to plan the day's workload and staff allocation.

### Management Dashboard

**Time**: 08:00 (after shift start)
**Recipients**: General Manager, Operations Manager
**Focus**: Readiness score, maintenance health

High-level overview for management review and strategic decisions.

### Evening Prep

**Time**: 22:00 (night before)
**Recipients**: Night Audit, Next Day Manager
**Focus**: Tomorrow's arrivals, overnight issues

Preview of next day's challenges for advance preparation.

---

## Technical Architecture

### Data Sources

**Room Status**: `pms-rooms` (BoardRoomCard[])
- Current clean status
- Occupancy state
- Maintenance flags

**Reservations**: Derived from room check-in/check-out dates
- Arrival detection (check-in = today)
- Departure detection (check-out = today)

**Staff**: `staff-members` (StaffMember[])
- Active status filter
- Alert preference filter
- Contact methods (LINE ID, email)

### Report Generation Logic

```typescript
// Readiness Score Calculation
readinessScore = 
  (cleanRoomRatio × 0.30) +
  (arrivalReadiness × 0.40) +
  (maintenanceHealth × 0.15) +
  (housekeepingVelocity × 0.15)
```

**Component Calculations**:
- `cleanRoomRatio`: (clean + inspected) / total × 100
- `arrivalReadiness`: roomsReadyForArrivals / totalArrivals × 100
- `maintenanceHealth`: max(0, 100 - (issueCount × 10))
- `housekeepingVelocity`: completedTasks / totalTasks × 100

### Storage Schema

**Settings**: `daily-summary-settings` (DailySummarySettings)
```typescript
{
  enabled: boolean
  schedule: { time: string, daysOfWeek: number[] }
  channels: { line: boolean, email: boolean }
  recipients: { roles: Role[], staffIds: string[] }
  includeMetrics: { [metric]: boolean }
  thresholds: { lowReadinessWarning: number, ... }
}
```

**Report Logs**: `daily-summary-logs` (DailySummaryLog[])
```typescript
{
  id: string
  reportDate: Date
  generatedAt: Date
  sentAt?: Date
  sentVia: ('line' | 'email')[]
  recipientCount: number
  deliveryStatus: 'PENDING' | 'SENT' | 'FAILED'
  reportSummary: { cleanRooms, dirtyRooms, arrivals, readinessScore }
}
```

**Last Report**: `last-daily-summary-report` (DailySummaryReport)
Full report object for display in UI

**Performance History**: `weekly-performance-history` (WeeklyPerformanceMetrics[])
```typescript
{
  date: Date
  readinessScore: number
  cleanRoomPercentage: number
  arrivalReadiness: number
  housekeepingCompletionRate: number
  maintenanceIssues: number
  totalRooms: number
  arrivals: number
  departures: number
  averageCleanTime: number
}
```
Stores up to 90 days of daily metrics for trend analysis

### Automated Scheduling

```typescript
// Check every 5 minutes if report should be sent
useEffect(() => {
  const checkInterval = setInterval(() => {
    if (shouldGenerateToday()) {
      generateAndSend()
    }
  }, 5 * 60 * 1000)
  
  return () => clearInterval(checkInterval)
}, [settings])
```

**Generation Conditions**:
1. Reports enabled
2. Current day in schedule.daysOfWeek
3. Current time within ±15 minutes of schedule.time
4. No report sent today yet (prevents duplicates)

---

## Integration Points

### Room Status Updates
When housekeeping marks room clean/inspected:
- Next scheduled report reflects new status
- Readiness score recalculates
- Alert conditions re-evaluated

### Check-In/Check-Out
When guests check in or out:
- Arrival/departure counts update
- Room status changes reflect in report
- Priority room list adjusts

### Maintenance Issues
When maintenance issues logged:
- Issue count increments
- Maintenance health score decreases
- Alert generated if threshold exceeded

### Staff Management
When staff updated (role, contact info):
- Recipient list recalculates
- Delivery channels validated
- Alert preferences respected

---

## Best Practices

### 1. Schedule Timing
- **Before Shift**: 30 minutes before front desk opens
- **After Housekeeping**: After morning room inspections complete
- **Consistent Time**: Same time daily for routine

### 2. Recipient Selection
- **Keep Focused**: Only staff who need to act on the data
- **Role-Based**: Use roles rather than individuals for scalability
- **Test Regularly**: Send test reports to verify delivery

### 3. Threshold Tuning
- **Start Conservative**: Begin with default 80% readiness threshold
- **Adjust Based on Data**: Review 2 weeks of reports, tune thresholds
- **Seasonal Variation**: Higher standards during peak season

### 4. Alert Fatigue
- **Prioritize Critical**: Reserve "critical" for action-required items only
- **Reduce Noise**: Disable info alerts if not actionable
- **Review Weekly**: Check if alerts are driving behavior changes

### 5. Report Review Cadence
- **Daily**: Front desk reviews morning report
- **Weekly**: Management reviews readiness score trends
- **Monthly**: Analyze patterns, adjust thresholds/content

---

## Troubleshooting

### Report Not Generating

**Check**:
1. Reports enabled in settings?
2. Current day in schedule.daysOfWeek?
3. Within ±15 minutes of schedule.time?
4. Browser tab open? (Timer runs client-side)

**Solution**: Generate manual test report to verify system

### No Recipients Receiving

**Check**:
1. Recipients have active status?
2. Recipients have receiveAlerts enabled?
3. At least one delivery channel enabled?
4. LINE users have valid lineUserId?
5. Email users have valid email address?

**Solution**: Review staff member settings and channel configuration

### Readiness Score Always Low

**Check**:
1. Clean status threshold too strict?
2. Maintenance issues overcounting?
3. Housekeeping completion data accurate?
4. Thresholds set appropriately for property size?

**Solution**: Review score factor breakdown, adjust weights if needed

### Duplicate Reports

**Check**:
1. Multiple browser tabs open?
2. Report already sent today per logs?
3. Timer logic working correctly?

**Solution**: Close extra tabs, check delivery logs for today

---

## Future Enhancements

### Recently Added Features
- ✅ **Weekly Performance Trends**: Week-over-week comparison of key metrics
  - Readiness score trending
  - Clean room percentage changes
  - Housekeeping efficiency tracking
  - Maintenance issue patterns
  - Occupancy rate analysis
  - Automated insight generation
  - Historical data retention (90 days)

### Planned Features
- **Predictive Alerts**: Forecast issues before they occur
- **Custom Metrics**: Property-specific KPIs
- **Export Options**: PDF download, CSV data export
- **Mobile App Push**: Native mobile notifications
- **Smart Scheduling**: ML-based optimal delivery time
- **Comparative Analysis**: Benchmark against industry standards

### Integration Roadmap
- **Channel Manager**: Include OTA reservation data
- **Revenue Management**: ADR and RevPAR in reports
- **Guest Feedback**: Integrate review scores
- **Staff Performance**: Individual housekeeper metrics

---

## API Reference

### Hook: `useDailySummary()`

```typescript
const {
  settings,              // Current settings
  setSettings,           // Update settings (functional updates)
  reportLogs,            // Recent report delivery logs
  lastGeneratedReport,   // Most recent full report
  generateReport,        // Generate report from room data
  sendReport,            // Send report via channels (auto-records metrics)
  generateAndSend,       // Generate + send in one call
  getRecipients,         // Get current recipient list
  shouldGenerateToday,   // Check if should auto-generate
} = useDailySummary()
```

### Hook: `useWeeklyTrends()`

```typescript
const {
  weeklyTrends,          // Current vs previous week comparison + insights
  recordDailyMetrics,    // Manually record metrics from report
  historicalMetrics,     // Raw historical data (90 days max)
} = useWeeklyTrends()
```

**WeeklyTrends Object**:
```typescript
{
  currentWeek: WeeklyPerformanceMetrics[]    // This week's daily data
  previousWeek: WeeklyPerformanceMetrics[]   // Last week's daily data
  trends: {
    readinessScore: { current, previous, change, trend }
    cleanRoomPercentage: { current, previous, change, trend }
    housekeepingEfficiency: { current, previous, change, trend }
    maintenanceIssues: { current, previous, change, trend }
    occupancyRate: { current, previous, change, trend }
  }
  insights: string[]    // Generated observations and recommendations
}
```

### Types

**DailySummarySettings**: Configuration object
**DailySummaryReport**: Full report data structure
**DailySummaryLog**: Delivery log entry
**DailySummaryAlert**: Individual alert object
**DailySummaryRoomDetail**: Per-room detail object
**WeeklyPerformanceMetrics**: Daily performance snapshot
**WeeklyTrends**: Trend analysis with insights

See `src/types/daily-summary.ts` for complete type definitions.

---

## Usage Guide

### Viewing Weekly Trends

1. **Navigate to Daily Summary Report**
   - Main menu → Reports or Settings → Daily Reports → View Last Report
   
2. **Weekly Trends Card**
   - Appears at the top of every daily summary report
   - Shows comparison of current week vs. previous week
   - Displays 5 key metrics with trend indicators
   
3. **Understanding Trend Indicators**
   - ↑ Green = Performance improving
   - ↓ Red = Performance declining
   - − Gray = Stable (within ±2% threshold)
   
4. **Reading Insights**
   - Automated observations appear in the insights panel
   - Focus on actionable items marked with specific recommendations
   - Positive reinforcement for good performance

### Managing Trend Data

**Location**: Settings → Daily Reports → Trend Data Management

**Seed Sample Data**
- Generates 14 days of simulated data
- Useful for testing and demonstration
- Shows improvement pattern (previous week 82%, current week 88%)

**Clear All Data**
- Removes all historical metrics
- Fresh start for production use
- Cannot be undone

**Data Collection**
- Automatic: Metrics recorded each time a daily report is generated
- Storage: Up to 90 days of history
- Retention: Oldest data automatically pruned

---

## Conclusion

The Daily Summary Report system transforms operational data into actionable intelligence, delivered automatically when staff need it most. By providing clear metrics, intelligent alerts, and comprehensive room details, it enables proactive management and ensures every day starts with full operational awareness.

**Key Benefits**:
- ✓ Proactive issue identification
- ✓ Improved arrival readiness
- ✓ Better housekeeping coordination
- ✓ Data-driven decision making
- ✓ Reduced operational surprises

Configure once, benefit daily.
