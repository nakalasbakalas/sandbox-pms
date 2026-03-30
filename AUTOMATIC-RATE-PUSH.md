# Automatic Rate Push to OTA Channels

**Version:** 1.0  
**Domain:** Channel Management, Rate Distribution  
**Status:** Implemented
**Related:** RATES-AND-PRICING.md, OTA-CHANNEL-MANAGER.md

---

## Overview

The Automatic Rate Push feature monitors rate changes in the PMS and automatically distributes updated rates to connected OTA channels (Booking.com, Agoda, Expedia, Airbnb) in real-time, ensuring rate parity across all distribution channels.

---

## Architecture

### Core Components

1. **useRatePush Hook** (`/src/hooks/use-rate-push.ts`)
   - Monitors rate changes (base rates, rules, overrides)
   - Triggers automatic pushes when changes detected
   - Manages push queue and retry logic
   - Tracks push success/failure by channel

2. **RatePushPanel Component** (`/src/components/rates/RatePushPanel.tsx`)
   - Visual dashboard for push activity
   - Settings configuration
   - Success rate monitoring
   - Push history with detailed logs

3. **Integration Points**
   - Rates View: Tab for managing automatic push settings
   - Channels View: Push activity visible in channel logs
   - Real-time monitoring of rate changes via React hooks

---

## Push Triggers

### Automatic Triggers

The system monitors three types of rate changes:

#### 1. Base Rate Changes
```typescript
// Triggered when room type base rate is modified
{
  pushOnBaseRateChange: true,  // Enable/disable
  pushWindow: 90,               // Days ahead to push
  triggeredBy: 'AUTO_BASE_RATE'
}
```

**Example:**
- Manager updates Deluxe Room base rate from ฿2,500 to ฿2,800
- System detects change
- Automatically pushes updated rates for next 90 days to all connected channels

#### 2. Rate Rule Changes
```typescript
// Triggered when rate rules are added, modified, or toggled
{
  pushOnRuleChange: true,
  triggeredBy: 'AUTO_RULE'
}
```

**Example:**
- Manager creates "Weekend Premium" rule (+15%)
- System recalculates affected dates
- Pushes updated weekend rates to channels

#### 3. Rate Override Changes
```typescript
// Triggered when manual overrides are set or removed
{
  pushOnOverrideChange: true,
  triggeredBy: 'AUTO_OVERRIDE'
}
```

**Example:**
- Manager sets special event override for festival dates
- System pushes override rates only for those specific dates

### Manual Push

Staff can manually trigger rate pushes:

```typescript
manualPushRates(
  roomTypeId: string,
  startDate: string,
  endDate: string,
  targetChannels: string[]
)
```

---

## Rate Push Flow

### 1. Change Detection

```typescript
useEffect(() => {
  // Monitor roomTypes changes
  if (previousRoomTypesRef.current !== roomTypes) {
    // Detect base rate changes
    // Trigger push for affected dates
  }
  
  // Monitor rateRules changes
  if (previousRateRulesRef.current !== rateRules) {
    // Detect rule modifications
    // Trigger push for affected date ranges
  }
  
  // Monitor rateOverrides changes
  if (previousRateOverridesRef.current !== rateOverrides) {
    // Detect override changes
    // Trigger push for specific dates
  }
}, [roomTypes, rateRules, rateOverrides])
```

### 2. Rate Calculation

```typescript
const calculateRateForDate = (roomTypeId: string, date: Date): number => {
  const roomType = roomTypes.find(rt => rt.id === roomTypeId)
  let rate = roomType.baseRate

  // Check for override (highest priority)
  const override = rateOverrides.find(...)
  if (override) return override.rate

  // Apply applicable rules in priority order
  const applicableRules = rateRules.filter(...)
  applicableRules.forEach(rule => {
    if (rule.type === 'PERCENTAGE') {
      rate += rate * (rule.value / 100)
    } else if (rule.type === 'FIXED_DELTA') {
      rate += rule.value
    }
  })

  return Math.round(rate)
}
```

### 3. Channel Distribution

```typescript
const pushRatesToChannels = async (
  roomTypeId: string,
  dates: string[],
  targetChannels: string[],
  triggeredBy: 'AUTO_BASE_RATE' | 'AUTO_RULE' | 'AUTO_OVERRIDE' | 'MANUAL'
) => {
  // Filter active channels
  const activeChannels = targetChannels.filter(ch => 
    channel.connected && channel.enabled
  )

  // Push to each channel
  for (const date of dates) {
    const rate = calculateRateForDate(roomTypeId, new Date(date))
    
    for (const channelId of activeChannels) {
      const success = await pushRateToChannel(
        channelId, roomTypeId, date, rate
      )
      
      if (success) {
        successfulChannels.push(channelId)
      } else {
        failedChannels.push(channelId)
      }
    }
  }

  // Log push result
  const log: RatePushLog = {
    id, timestamp, roomTypeId, date, rate,
    status: failedChannels.length === 0 ? 'SUCCESS' :
            successfulChannels.length === 0 ? 'FAILED' :
            'PARTIAL',
    successfulChannels,
    failedChannels,
    triggeredBy
  }

  // Show notification
  toast.success(`Rates pushed to ${channelNames}`)
}
```

### 4. Error Handling & Retry

```typescript
// Retry logic for failed pushes
{
  retryFailedPushes: true,
  retryAttempts: 3
}

// Push statuses
type PushStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED'

// Partial success: some channels succeeded, others failed
// Failed: all channels failed to receive update
```

---

## Data Model

### RatePushLog

```typescript
interface RatePushLog {
  id: string
  timestamp: string
  roomTypeId: string
  date: string
  rate: number
  channels: string[]                 // Attempted channels
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED'
  successfulChannels: string[]
  failedChannels: string[]
  error?: string
  triggeredBy: 'MANUAL' | 'AUTO_BASE_RATE' | 'AUTO_RULE' | 'AUTO_OVERRIDE'
}
```

### RatePushSettings

```typescript
interface RatePushSettings {
  autoEnabled: boolean               // Master switch
  pushOnBaseRateChange: boolean      // Base rate trigger
  pushOnRuleChange: boolean          // Rule change trigger
  pushOnOverrideChange: boolean      // Override trigger
  pushWindow: number                 // Days ahead (default: 90)
  selectedChannels: string[]         // Empty = all connected
  retryFailedPushes: boolean
  retryAttempts: number
}
```

### PendingRatePush

```typescript
interface PendingRatePush {
  id: string
  roomTypeId: string
  dates: string[]
  channels: string[]
  reason: string
  createdAt: string
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
}
```

---

## User Interface

### Rate Push Panel (Rates View)

**Location:** Rates → Channel Push tab

**Features:**
- Auto Push status (ON/OFF)
- Success rate percentage
- Total push count
- Active channels display
- Recent push activity log
- Settings configuration

**Stats Cards:**
```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│ Auto Push    │ Success Rate │ Total Pushes │ Active       │
│ ON           │ 98%          │ 147          │ Channels     │
│ ⚡            │ [Progress]   │ ↑            │ 3            │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

**Activity Log:**
```
┌─────────────────────────────────────────────────────────┐
│ Deluxe Room                               [SUCCESS]     │
│ Mar 15, 14:30 • Base Rate Change                       │
│ Rate: ฿2,800                                           │
│ ✓ Booking.com  ✓ Agoda  ✓ Expedia                     │
├─────────────────────────────────────────────────────────┤
│ Superior Room                             [PARTIAL]     │
│ Mar 15, 13:15 • Rule Change                            │
│ Rate: ฿3,200                                           │
│ ✓ Booking.com  ✗ Agoda  ✓ Expedia                     │
└─────────────────────────────────────────────────────────┘
```

**Settings Panel:**
```
┌─────────────────────────────────────────────────────────┐
│ ⚙️ Settings                                             │
│                                                         │
│ Auto Push                               [ON]            │
│ Automatically push rate changes                         │
│                                                         │
│ ─────────────────────────────────                      │
│                                                         │
│ Push Triggers                                          │
│ Base Rate           When base rate changes  [ON]        │
│ Rate Rules          When rules are modified [ON]        │
│ Overrides           When overrides are set  [ON]        │
│                                                         │
│ ─────────────────────────────────────                  │
│                                                         │
│ Push Window                                             │
│ [90] days                                               │
│ How far ahead to push rates                             │
│                                                         │
│ ─────────────────────────────────────                  │
│                                                         │
│ Channel Status                                          │
│ ✓ Booking.com                                          │
│ ✓ Agoda                                                │
│ ✓ Expedia                                              │
└─────────────────────────────────────────────────────────┘
```

### Channels View Integration

**Location:** Channels → Rate Push tab

Shows the same RatePushPanel for unified access to rate distribution monitoring from both Rates and Channels sections.

---

## Notifications

### Success Notification
```
✅ Rates pushed to Booking.com, Agoda, Expedia
   3 dates updated for Deluxe Room
```

### Partial Success Notification
```
⚠️ Rates partially pushed
   Success: Booking.com, Expedia. Some channels failed.
```

### Failure Notification
```
❌ Failed to push rates
   All channels failed for Superior Room
```

---

## Configuration

### Default Settings

```typescript
const DEFAULT_SETTINGS: RatePushSettings = {
  autoEnabled: true,                  // Auto push enabled by default
  pushOnBaseRateChange: true,         // Monitor base rates
  pushOnRuleChange: true,             // Monitor rules
  pushOnOverrideChange: true,         // Monitor overrides
  pushWindow: 90,                     // 90 days ahead
  selectedChannels: [],               // All connected channels
  retryFailedPushes: true,
  retryAttempts: 3
}
```

### Updating Settings

```typescript
// Via UI Settings Dialog
updateSettings({
  pushWindow: 120  // Extend to 120 days
})

// Via Settings Panel Switches
updateSettings({
  pushOnRuleChange: false  // Disable rule change trigger
})
```

---

## Performance Considerations

### Rate Calculation Caching

```typescript
// Calculations are memoized per date to avoid redundant processing
const cachedRates = useMemo(() => {
  return dates.map(date => calculateRateForDate(roomTypeId, date))
}, [roomTypeId, dates, roomTypes, rateRules, rateOverrides])
```

### Batch Processing

```typescript
// Multiple dates are processed in a single batch per channel
for (const date of dates) {
  const rate = calculateRateForDate(roomTypeId, new Date(date))
  
  // Batch API call per channel for all dates
  for (const channelId of activeChannels) {
    await pushRateToChannel(channelId, roomTypeId, date, rate)
  }
}
```

### Push Throttling

```typescript
// Simulated API latency: 300-800ms per push
await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 300))
```

---

## Monitoring & Analytics

### Success Rate Tracking

```typescript
const getSuccessRate = () => {
  if (pushLogs.length === 0) return 100

  const successful = pushLogs.filter(log => log.status === 'SUCCESS').length
  return Math.round((successful / pushLogs.length) * 100)
}
```

### Channel-Specific Analytics

```typescript
const getPushesByChannel = (channelId: string) => {
  return pushLogs.filter(log => 
    log.successfulChannels.includes(channelId) || 
    log.failedChannels.includes(channelId)
  )
}
```

### Recent Activity

```typescript
const getRecentPushes = (limit: number = 20) => {
  return pushLogs.slice(0, limit)
}
```

---

## Best Practices

### 1. Test Before Enabling
- Connect test channel accounts first
- Verify rate calculation accuracy
- Monitor initial pushes closely

### 2. Appropriate Push Window
- Default 90 days suitable for most properties
- Extend to 120-180 days for advance bookings
- Shorter window (30-60 days) reduces API load

### 3. Monitor Failure Patterns
- Check failed channel logs regularly
- Investigate persistent failures
- Verify API credentials if channels fail consistently

### 4. Strategic Rule Changes
- Bulk rule updates during low-traffic periods
- Test rules with preview before activation
- Monitor push logs after rule changes

### 5. Override Management
- Document override reasons thoroughly
- Review override push success after setting
- Clear expired overrides to reduce push volume

---

## Troubleshooting

### Issue: Rates not pushing automatically

**Check:**
1. Auto Push enabled? (Settings panel)
2. Channels connected and enabled?
3. Trigger switches enabled? (Base Rate, Rules, Overrides)
4. Review push logs for errors

### Issue: Partial push failures

**Causes:**
- Channel API connectivity issues
- Invalid credentials
- Rate format incompatibility
- Channel-specific restrictions

**Resolution:**
1. Check channel connection status
2. Verify credentials in Channel Manager
3. Review failed channel logs for specific errors
4. Manually retry push if needed

### Issue: High failure rate

**Investigate:**
- Network connectivity
- API rate limits exceeded
- Credential expiration
- Channel system maintenance

**Action:**
- Enable retry logic (Settings)
- Stagger rate changes to reduce batch size
- Contact channel support if persistent

---

## Future Enhancements

### Planned Features

1. **Selective Room Type Push**
   - Choose which room types to auto-push
   - Per-room-type channel mapping

2. **Rate Differential Rules**
   - Channel-specific markups/discounts
   - Automatic commission adjustment

3. **Advanced Retry Logic**
   - Exponential backoff
   - Scheduled retry queue
   - Priority-based retry

4. **Push Scheduling**
   - Schedule bulk pushes for off-peak hours
   - Batch multiple changes into single push

5. **Rate Parity Integration**
   - Auto-detect parity violations after push
   - Alert on push-induced parity breaks

6. **Detailed Analytics Dashboard**
   - Push success trends over time
   - Channel performance comparison
   - Rate distribution heatmap

---

## Integration with Existing Systems

### Rate Parity Monitoring

After successful rate push:
```typescript
// Trigger rate parity check to verify channels received correct rates
await checkRateParity(roomTypeId, startDate, endDate, targetChannels)
```

### Inventory Synchronization

Rate pushes work in concert with inventory sync:
```typescript
// Push rates + inventory in coordinated fashion
await pushRatesToChannels(...)
await syncInventoryToChannels(...)
```

### Channel Sync Logs

Rate push activity appears in channel sync logs:
```typescript
const log: SyncLog = {
  id: generateId(),
  channelId,
  timestamp: new Date().toISOString(),
  type: 'RATE_PUSH',
  status: 'SUCCESS',
  message: `Pushed rates for ${roomType.name} (${dates.length} dates)`,
  details: `Rate: ฿${rate}, Triggered by: ${triggeredBy}`
}
```

---

## Summary

The Automatic Rate Push feature ensures **rate distribution accuracy** and **operational efficiency** by:

✅ **Detecting** rate changes in real-time across all rate types  
✅ **Calculating** accurate rates using PMS pricing engine  
✅ **Distributing** rates to connected OTA channels automatically  
✅ **Monitoring** push success with detailed logs and analytics  
✅ **Alerting** staff to failures with actionable notifications  
✅ **Retrying** failed pushes to maintain rate parity  

This feature eliminates manual rate updates across channels, reduces rate parity violations, and ensures guests see consistent rates regardless of booking source.

---

**End of Automatic Rate Push Documentation**
