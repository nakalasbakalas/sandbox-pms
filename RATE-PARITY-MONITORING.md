# Rate Parity Monitoring
## Sandbox Hotel PMS - OTA Channel Rate Management

---

## Overview

The Rate Parity Monitoring system automatically detects and alerts on rate discrepancies between your Property Management System (PMS) and connected OTA channels (Booking.com, Agoda, Expedia, Airbnb). This ensures consistent pricing across all sales channels, maximizes revenue, and maintains brand integrity.

### Key Features

- **Automated monitoring**: Periodic checks of rates across all channels
- **Real-time violation detection**: Instant alerts for rate discrepancies
- **Severity classification**: CRITICAL, HIGH, MEDIUM, and LOW violations
- **Health scoring**: Per-channel and overall parity score (0-100)
- **Bulk operations**: Acknowledge or resolve multiple violations at once
- **Configurable thresholds**: Set your own tolerance for rate variance
- **Historical tracking**: Complete audit trail of all violations

---

## How It Works

### 1. Rate Comparison

The system periodically fetches rates from all connected OTA channels and compares them to your PMS base rates:

```
PMS Rate (Source of Truth)
    ↓
Compare with Channel Rates
    ↓
Calculate Variance (absolute and percentage)
    ↓
Classify Severity
    ↓
Create Violation (if threshold exceeded)
```

### 2. Severity Classification

Violations are automatically classified based on the percentage variance from PMS rates:

- **CRITICAL**: ≥15% variance - Immediate action required
- **HIGH**: 10-14% variance - Priority attention needed
- **MEDIUM**: 5-9% variance - Should be addressed
- **LOW**: <5% variance (above threshold) - Monitor

### 3. Health Scoring

Each channel receives a **Parity Score** (0-100) based on:
- Number of active violations
- Total rates checked
- Average variance percentage

**Score Interpretation:**
- **95-100**: EXCELLENT - Near-perfect parity
- **85-94**: GOOD - Minor discrepancies
- **75-84**: FAIR - Notable issues
- **<75**: POOR - Significant problems

### 4. Automatic Monitoring

When auto-check is enabled:
- System checks rates at configured intervals (default: 1 hour)
- Checks next 30 days of rates for all room types
- Compares across all enabled channels
- Creates violations for discrepancies above threshold
- Sends toast notifications for critical/high violations

---

## User Interface

### Rate Parity Tab

Located in **Channels → Rate Parity**, this provides comprehensive monitoring:

#### Dashboard Cards

**Parity Score**
- Overall health metric (0-100)
- Color-coded status (green/blue/yellow/red)
- Status label (EXCELLENT/GOOD/FAIR/POOR)

**Active Issues**
- Total count of unresolved violations
- Number of channels monitored

**Critical Count**
- Count of critical severity violations
- Requires immediate attention indicator

**Last Check**
- Timestamp of most recent check
- Auto-check status (ON/OFF)

#### Channel Health Cards

For each connected channel:
- Channel name and overall status badge
- Parity score with progress bar
- Active violation count
- Average variance percentage

#### Violations List

Complete view of all rate discrepancies:

**Filters:**
- By severity (All, Critical, High, Medium, Low)
- By channel (All channels or specific)

**Each Violation Shows:**
- Severity badge with icon
- Channel and room type
- Date of discrepancy
- PMS rate vs. Channel rate
- Variance (absolute ฿ and percentage)
- Trend indicator (up/down arrow)
- Detection timestamp

**Actions Per Violation:**
- **Acknowledge**: Mark as seen (doesn't resolve)
- **Resolve**: Mark as fixed and remove from active list
- **Ignore**: Dismiss without resolution

**Bulk Operations:**
- Select multiple violations
- Resolve all selected at once
- Select all filtered violations

#### Summary Badges

At top of violation list:
- Critical: X
- High: X
- Medium: X
- Low: X

Color-coded for quick assessment.

---

## Workflow Examples

### Daily Morning Check

```
1. Open Channels → Rate Parity tab
2. Review Parity Score and Active Issues
3. Check for any Critical violations (red badge)
4. Review specific violations in detail
5. Take action:
   - If channel error: Update channel rates
   - If intentional: Acknowledge or ignore
   - If resolved: Mark as resolved
```

### Responding to Critical Violation

```
ALERT: "3 critical rate parity violations detected"
    ↓
1. Navigate to Rate Parity tab
2. Filter by CRITICAL severity
3. Review each violation:
   - Deluxe Room on Booking.com
   - PMS: ฿2,500 | Channel: ฿2,900
   - Variance: +฿400 (+16%)
4. Log into Booking.com extranet
5. Update rate to ฿2,500
6. Return to PMS
7. Click "Resolve" on violation
```

### Bulk Resolution After Rate Update

```
1. Updated all rates across channels manually
2. Open Rate Parity tab
3. Click "Check Now" to verify
4. Filter by specific channel
5. Click "Select All"
6. Click "Resolve Selected"
7. Violations cleared from active list
```

### Intentional Rate Difference

Some scenarios warrant different channel rates:
```
1. Notice LOW violation
2. Review: Agoda exclusive promotion
3. Click "Acknowledge"
   - Stays in list but marked as seen
   - Won't trigger repeated alerts
4. Or click "Ignore" to remove entirely
```

---

## Settings Configuration

### Opening Settings

Click the **Settings** button in the Rate Parity tab header.

### Available Settings

**Auto-Check Enabled**
- Toggle automatic rate monitoring
- When OFF: Manual checks only
- When ON: Periodic automatic checks

**Alert Threshold (%)**
- Minimum variance to trigger violation
- Default: 5%
- Range: 0-100%
- Lower = stricter monitoring

**Check Interval (minutes)**
- How often to auto-check rates
- Default: 60 minutes
- Range: 5-1440 minutes (24 hours)
- Shorter intervals = more API calls

### Recommended Settings

**High-Volume Property:**
- Auto-Check: ON
- Threshold: 3%
- Interval: 30 minutes

**Boutique Hotel:**
- Auto-Check: ON
- Threshold: 5%
- Interval: 60 minutes

**Testing/Setup:**
- Auto-Check: OFF
- Threshold: 10%
- Manual checks only

---

## Manual Operations

### Manual Rate Check

When you need to check rates immediately:

1. Click **Check Now** button
2. System checks all room types
3. Checks next 30 days of rates
4. Compares across all enabled channels
5. Creates violations for discrepancies
6. Displays results immediately

**Duration**: 5-15 seconds depending on channels

**When to Use:**
- After updating rates in channel extranet
- Before major promotional periods
- Weekly reconciliation
- Troubleshooting rate issues

### Violation Management

**Acknowledge**
- Marks violation as seen
- Remains in active list
- Prevents repeated notifications
- Use for: Known discrepancies you're monitoring

**Resolve**
- Marks violation as fixed
- Removes from active list
- Records resolution timestamp
- Use for: Issues you've corrected

**Ignore**
- Dismisses violation
- Removes from active list
- No resolution tracking
- Use for: False positives, intentional differences

---

## Integration with Operations

### Connected to Rates Tab

Rate parity monitoring uses base rates from your PMS:
- Standard rack rates
- Seasonal adjustments
- Room type pricing

Update your PMS rates first, then channels should follow.

### Connected to Channels Tab

Requires active channel connections:
- Channels must be connected
- Channels must be enabled
- Valid API credentials required

If a channel is disabled, it won't be checked.

### Connected to Inventory Sync

Works alongside inventory synchronization:
- Both use same channel connections
- Independent monitoring systems
- Can operate separately

You can have inventory sync ON and rate parity monitoring OFF, or vice versa.

---

## Understanding Violations

### What Causes Violations?

**Common Causes:**
1. **Manual rate update not synced**: Changed PMS rate but didn't update channel
2. **Channel extranet changes**: Staff updated channel directly
3. **Promotional rates**: Channel has exclusive deal
4. **Currency fluctuation**: International channels with conversion
5. **Channel commission differences**: Different commission structures
6. **Sync delays**: Recent changes not yet propagated
7. **API errors**: Failed rate pushes

### Rate Variance Interpretation

**Positive Variance (Channel rate higher than PMS):**
```
PMS: ฿2,500
Channel: ฿2,900
Variance: +฿400 (+16%)
```
- **Impact**: Potential lost bookings (too expensive)
- **Risk**: Lower conversion rate on that channel
- **Action**: Usually should be reduced

**Negative Variance (Channel rate lower than PMS):**
```
PMS: ฿2,500
Channel: ฿2,100
Variance: -฿400 (-16%)
```
- **Impact**: Revenue loss per booking
- **Risk**: Underselling room value
- **Action**: Usually should be increased

### When to Take Action

**CRITICAL (≥15%):**
- ⚠️ Immediate action required
- Significant revenue impact
- Address within 1 hour

**HIGH (10-14%):**
- ⚠️ Priority attention
- Notable discrepancy
- Address same day

**MEDIUM (5-9%):**
- ⚠️ Should be corrected
- Moderate impact
- Address within 24-48 hours

**LOW (<5%):**
- ℹ️ Minor variance
- May be acceptable
- Monitor or adjust as needed

---

## Performance Characteristics

### Checking Speed

- **Single channel, single date**: ~200-500ms
- **Single channel, 30 days**: ~5-10 seconds
- **All channels (4), 30 days**: ~20-40 seconds
- **All room types (3), all channels**: ~60-120 seconds

### Resource Usage

- Minimal local processing
- Primary load is API calls to channels
- Respectful of channel rate limits
- Cached results reduce duplicate checks

### Scalability

- Supports 10+ simultaneous channels
- Handles 100+ violations without performance impact
- Stores last 500 checks and violations
- Auto-cleanup of old resolved violations

---

## Best Practices

### Setup Phase

1. **Connect all channels first**
   - Ensure valid credentials
   - Test connections
   - Enable channels

2. **Configure base rates in PMS**
   - Set accurate standard rates
   - Define seasonal adjustments
   - Establish rate structure

3. **Set appropriate threshold**
   - Start with 5% for standard monitoring
   - Adjust based on your tolerance
   - Consider currency fluctuation

4. **Enable auto-check**
   - Start with 60-minute intervals
   - Adjust based on rate change frequency
   - Monitor for performance impact

5. **Perform initial manual check**
   - Verify all channels return rates
   - Review any initial violations
   - Establish baseline

### Daily Operations

**Morning Routine:**
- Check parity score
- Review any overnight violations
- Address critical issues before check-in period

**After Rate Changes:**
- Update PMS rates first
- Update all channel extranets
- Run manual check within 30 minutes
- Verify no new violations

**Weekly Review:**
- Analyze violation trends
- Review channel health scores
- Adjust thresholds if needed
- Document systematic issues

### Troubleshooting

**Issue: No violations detected but rates seem wrong**
- Verify channels are enabled
- Check last check timestamp
- Run manual check
- Verify API credentials

**Issue: Too many false positives**
- Increase alert threshold
- Check for currency conversion issues
- Verify PMS base rates are correct
- Consider channel-specific pricing needs

**Issue: Violations not resolving**
- Confirm channel rate actually changed
- Wait 5-10 minutes for cache to clear
- Run manual check
- Check channel extranet directly

**Issue: Performance degradation**
- Increase check interval
- Reduce number of days checked
- Disable unused channels
- Check network connectivity

---

## API Integration

### For Developers

The rate parity system exposes these hooks:

```typescript
const {
  violations,              // All violations
  parityChecks,           // Check history
  settings,               // Current settings
  checkRateParity,        // Run check
  acknowledgeViolation,   // Acknowledge one
  resolveViolation,       // Resolve one
  ignoreViolation,        // Ignore one
  bulkResolveViolations,  // Resolve multiple
  getActiveViolations,    // Get unresolved
  getChannelHealth,       // Get health metrics
  getOverallParityScore,  // Get overall score
  updateSettings          // Change settings
} = useRateParity()
```

### Triggering Checks Programmatically

```typescript
// Check specific room type, date range, channels
await checkRateParity(
  'deluxe',                    // roomTypeId
  '2024-03-15',               // startDate
  '2024-04-15',               // endDate
  ['booking', 'agoda']        // channelIds
)
```

### Custom Integrations

Rate parity can be integrated with:
- Custom notification systems
- External monitoring dashboards
- Automated rate adjustment workflows
- Revenue management systems

---

## Data Model

### Rate Snapshot
```typescript
{
  roomTypeId: string           // e.g., "deluxe"
  date: string                 // ISO date "2024-03-15"
  pmsRate: number             // Base rate from PMS
  channelRates: {
    booking: number           // Rate on Booking.com
    agoda: number            // Rate on Agoda
    ...
  }
  lastChecked: string         // ISO timestamp
}
```

### Parity Violation
```typescript
{
  id: string
  roomTypeId: string
  date: string
  pmsRate: number            // ฿2,500
  channelId: string          // "booking"
  channelRate: number        // ฿2,900
  variance: number           // 400
  variancePercent: number    // 16.0
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  status: 'DETECTED' | 'ACKNOWLEDGED' | 'RESOLVED' | 'IGNORED'
  detectedAt: string
  resolvedAt?: string
  resolvedBy?: string
}
```

### Parity Check
```typescript
{
  id: string
  timestamp: string
  roomTypeId: string
  dateRange: { start: string; end: string }
  channelsChecked: string[]
  violationsFound: number
  duration: number           // milliseconds
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED'
  errors?: string[]
}
```

---

## Notifications

### Toast Notifications

**Critical Violations:**
```
"3 critical rate parity violations detected"
Type: Error (red)
Duration: 6 seconds
```

**High Violations:**
```
"5 high priority rate parity violations detected"
Type: Warning (orange)
Duration: 4 seconds
```

**Resolution:**
```
"Rate parity violation resolved"
Type: Success (green)
Duration: 2 seconds
```

**Bulk Resolution:**
```
"12 violations resolved"
Type: Success (green)
Duration: 2 seconds
```

---

## Security & Privacy

### API Credentials

- Channel credentials encrypted at rest
- Never logged in plain text
- Transmitted over HTTPS only
- Scoped to rate read access only

### Access Control

- Rate parity visible to all staff
- Violation resolution requires appropriate permissions
- Settings changes restricted to managers/admins
- Audit trail for all actions

### Data Retention

- Active violations: Retained until resolved
- Resolved violations: 90 days
- Rate snapshots: 30 days
- Check logs: 500 most recent

---

## Reporting

### Metrics Available

**Overall Health:**
- Parity score (0-100)
- Active violations count
- Violations by severity breakdown
- Last check timestamp

**Per Channel:**
- Channel-specific parity score
- Violation count
- Average variance percentage
- Health status (EXCELLENT/GOOD/FAIR/POOR)

**Per Room Type:**
- Room type-specific violations
- Average variance
- Most problematic dates

**Historical:**
- Violation trends over time
- Resolution rate
- Average time to resolution
- Most common violation patterns

---

## Future Enhancements

### Planned Features

**Automatic Rate Synchronization:**
- Push PMS rates to channels automatically
- Two-way rate sync options
- Rate parity enforcement mode

**Advanced Analytics:**
- Violation trend analysis
- Seasonal pattern detection
- Channel performance comparison
- Revenue impact calculation

**Smart Alerts:**
- Email notifications for critical violations
- SMS alerts for managers
- Slack/LINE integration
- Customizable alert rules

**Competitive Monitoring:**
- Track competitor rates
- Market positioning analysis
- Dynamic pricing recommendations

**Machine Learning:**
- Predict optimal rates per channel
- Detect anomalies automatically
- Suggest rate adjustments

---

## Troubleshooting Guide

### Common Issues

**Problem**: "No channels connected"
- **Cause**: No active channel connections
- **Fix**: Go to Channels tab, connect at least one channel

**Problem**: "Check failed for some channels"
- **Cause**: API credentials invalid or network issue
- **Fix**: Verify credentials in channel settings, test connection

**Problem**: "Violations not appearing"
- **Cause**: Variance below threshold
- **Fix**: Lower alert threshold in settings

**Problem**: "Too many LOW severity violations"
- **Cause**: Threshold too strict
- **Fix**: Increase alert threshold to 5-7%

**Problem**: "Auto-check not running"
- **Cause**: Auto-check disabled
- **Fix**: Enable in Settings dialog

**Problem**: "Slow performance"
- **Cause**: Too many channels or long date ranges
- **Fix**: Increase check interval, check fewer days

---

## Support

### Getting Help

**Documentation:**
- Read this guide thoroughly
- Check INVENTORY-SYNC.md for channel setup
- Review RATES-AND-PRICING.md for rate management

**Training:**
- Video tutorials (planned)
- Interactive onboarding
- Live training sessions

**Technical Support:**
- In-app feedback button
- Email: support@sandboxpms.com
- Live chat (business hours)

---

## Summary

The Rate Parity Monitoring system ensures your hotel maintains consistent, competitive pricing across all OTA channels. By automatically detecting and alerting on rate discrepancies, it protects revenue, maintains brand integrity, and reduces manual monitoring effort.

**Key Benefits:**
- 📊 Real-time rate discrepancy detection
- 🎯 Severity-based prioritization
- 🚀 Automated monitoring (set and forget)
- 💡 Health scoring and analytics
- ⚡ Bulk operations for efficiency
- 🔧 Flexible configuration
- 📈 Complete audit trail

**Remember:**
- Your PMS rate is the source of truth
- Act on CRITICAL violations immediately
- Review parity score daily
- Adjust threshold to your needs
- Document systematic issues

**Rate parity is not just compliance—it's revenue protection.**

---

*Last Updated: Implementation Phase*
*Version: 1.0*
