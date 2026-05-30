# Channel Management Quick Reference
## Inventory Sync + Rate Parity Monitoring

---

## Two Complementary Systems

### Inventory Synchronization
**Purpose**: Keep room availability synchronized across all OTA channels  
**Monitors**: Available units per room type per date  
**Triggers**: Check-ins, check-outs, reservations, room blocks  
**Action**: Automatically pushes inventory changes to channels  
**Documentation**: See INVENTORY-SYNC.md

### Rate Parity Monitoring
**Purpose**: Ensure consistent pricing across all OTA channels  
**Monitors**: Room rates per room type per date  
**Triggers**: Scheduled checks or manual triggers  
**Action**: Alerts on rate discrepancies, requires manual resolution  
**Documentation**: See RATE-PARITY-MONITORING.md

---

## Side-by-Side Comparison

| Feature | Inventory Sync | Rate Parity |
|---------|---------------|-------------|
| **What it syncs** | Room availability | Rate discrepancies |
| **Direction** | PMS → Channels (Push) | PMS ← → Channels (Compare) |
| **Automation** | Fully automatic | Detection automatic, resolution manual |
| **Trigger** | Operational events | Scheduled checks |
| **Latency** | 1-35 seconds | 5-60 minutes (configurable) |
| **Action required** | None (auto-sync) | Review and resolve violations |
| **Tab location** | Real-Time Sync | Rate Parity |

---

## Quick Navigation

### Channels Tab
**Location**: Main Navigation → Channels  
**Purpose**: Connect and manage OTA channel integrations

**What you can do:**
- Connect/disconnect channels (Booking.com, Agoda, Expedia, Airbnb)
- Enable/disable channels
- View channel performance metrics
- Test connections
- Configure API credentials

### Real-Time Sync Tab
**Location**: Channels → Real-Time Sync  
**Purpose**: Monitor and control inventory synchronization

**What you can do:**
- View pending inventory events
- Monitor channel health (sync success rate)
- Enable/disable auto-sync
- Force manual sync
- Review sync operation logs
- View live event stream

### Rate Parity Tab
**Location**: Channels → Rate Parity  
**Purpose**: Monitor and manage rate consistency

**What you can do:**
- View overall parity score
- Check active violations
- Run manual rate checks
- Acknowledge/resolve/ignore violations
- Configure alert thresholds
- Monitor per-channel health

### Inventory Tab
**Location**: Channels → Inventory  
**Purpose**: View availability calendars per room type

**What you can do:**
- See 30-day availability outlook
- Identify sold-out dates
- Monitor occupancy levels
- Review reserved vs. blocked units

---

## Daily Workflow

### Morning Check (5 minutes)

```
1. Open Channels → Rate Parity
   → Check parity score
   → Review any overnight violations
   → Address critical issues

2. Open Channels → Real-Time Sync
   → Verify all channels show HEALTHY
   → Check for pending events (should be 0)
   → Review any sync errors

3. Open Channels → Inventory
   → Scan today and next 7 days
   → Verify availability looks correct
   → Note any sold-out periods
```

### After Check-Out (Automatic)

```
Guest checks out
    ↓
Housekeeping cleans room
    ↓
Room marked VACANT_CLEAN
    ↓
[AUTOMATIC]
Inventory event created
    ↓
Synced to all channels within 30 seconds
    ↓
Room available for booking
```

No action required - fully automatic!

### After Updating Rates (5-10 minutes)

```
1. Update base rates in PMS (Rates tab)
2. Update rates in each channel extranet
   - Booking.com extranet
   - Agoda YCS
   - Expedia Partner Central
   - Airbnb hosting dashboard
3. Return to PMS
4. Channels → Rate Parity
5. Click "Check Now"
6. Verify no violations appear
7. If violations exist:
   → Review discrepancies
   → Fix in channel extranet
   → Check again
   → Resolve violations
```

### Weekly Review (15 minutes)

```
1. Channels → Rate Parity
   → Review parity score trend
   → Identify problematic channels
   → Document recurring issues

2. Channels → Real-Time Sync
   → Review sync success rates
   → Check for patterns in errors
   → Verify auto-sync still enabled

3. Channels → Performance
   → Compare channel booking volumes
   → Review revenue by channel
   → Assess occupancy rates

4. Take action:
   → Adjust poorly performing channels
   → Investigate systematic issues
   → Update procedures if needed
```

---

## Common Scenarios

### Scenario: New Booking from Booking.com

```
1. Guest books on Booking.com
2. [Manual] Import reservation from "Pending Reservations" tab
3. [Automatic] Inventory reduced for booked dates
4. [Automatic] Synced to other channels within 30 seconds
5. Result: Availability decreased on Agoda, Expedia, Airbnb
```

### Scenario: Manual Rate Increase

```
1. Decision: Increase weekend rates by 10%
2. [Manual] Update PMS base rates (Rates tab)
3. [Manual] Update each channel extranet
4. [Manual] Run rate parity check (Check Now button)
5. [Review] Verify no violations
6. Result: Consistent rates across all channels
```

### Scenario: Critical Rate Parity Violation

```
ALERT: "2 critical rate parity violations detected"
1. Open Channels → Rate Parity
2. Filter by CRITICAL
3. Review violation details:
   - Booking.com showing ฿3,500
   - PMS rate is ฿2,500
   - Variance: +40% (CRITICAL)
4. Log into Booking.com extranet
5. Find the issue: Old promotional rate still active
6. Update rate to ฿2,500
7. Return to PMS
8. Click "Resolve" on violation
9. Optionally: Run "Check Now" to verify
```

### Scenario: Intentional Channel-Specific Pricing

```
Situation: Agoda exclusive 15% discount promotion
1. Rate violation appears (MEDIUM severity)
2. Review violation:
   - Agoda: ฿2,125
   - PMS: ฿2,500
   - Variance: -15%
3. Recognize as intentional
4. Click "Acknowledge"
   - Marks as seen
   - Stops repeated alerts
   - Remains in list for tracking
5. Add note in your records
6. Set reminder to end promotion
```

### Scenario: Inventory Sync Failure

```
Symptoms: Channel showing ERROR state in Real-Time Sync
1. Open Channels → Real-Time Sync
2. Identify channel with ERROR health
3. Check recent sync logs for error messages
4. Common issues:
   - "Invalid credentials" → Update API key
   - "Network timeout" → Retry, check connectivity
   - "Room type not mapped" → Configure mapping
5. Click channel's "Test Connection" button
6. If connection succeeds:
   → Click "Sync Now" to resume
7. If connection fails:
   → Update credentials in Channels tab
   → Test again
```

---

## Health Indicators

### Inventory Sync Health

**HEALTHY** (Green)
- ✅ Success rate ≥ 95%
- ✅ All mappings complete
- ✅ Recent syncs successful
- **Action**: None needed

**DEGRADED** (Yellow)
- ⚠️ Success rate 80-94%
- ⚠️ Some sync failures
- ⚠️ Possible missing mappings
- **Action**: Review recent errors, investigate

**ERROR** (Red)
- ❌ Success rate < 80%
- ❌ Repeated failures
- ❌ Connection issues
- **Action**: Check credentials, test connection

### Rate Parity Health

**EXCELLENT** (95-100 score)
- ✅ Near-perfect parity
- ✅ 0-1 minor violations
- **Action**: None needed

**GOOD** (85-94 score)
- ✅ Minor discrepancies
- ⚠️ 2-5 violations
- **Action**: Review and resolve when convenient

**FAIR** (75-84 score)
- ⚠️ Notable issues
- ⚠️ 6-15 violations
- **Action**: Address within 24 hours

**POOR** (<75 score)
- ❌ Significant problems
- ❌ 15+ violations
- **Action**: Immediate attention required

---

## Settings Recommendations

### Inventory Sync

**Auto-Sync**: Always ON (unless troubleshooting)  
**Why**: Real-time availability critical to prevent overbooking

**Batching Window**: 30 seconds (default)  
**Why**: Optimal balance between speed and API efficiency

### Rate Parity

**Auto-Check**: ON for active properties  
**Why**: Proactive monitoring catches issues early

**Alert Threshold**: 5% (default)  
**Why**: Catches significant discrepancies, ignores minor fluctuations

**Check Interval**: 60 minutes (default)  
**Why**: Frequent enough to catch issues, respectful of API limits

**Adjust if:**
- High-volume property: 30 minutes
- Seasonal rates change frequently: 30 minutes
- Stable pricing: 120 minutes

---

## Troubleshooting Quick Guide

### Problem: Inventory not syncing

**Check:**
1. Auto-sync toggle is ON?
2. Channel is enabled?
3. Channel shows HEALTHY?
4. Pending events count increasing?

**Fix:**
1. Enable auto-sync if disabled
2. Enable channel if disabled
3. Test channel connection
4. Click "Sync Now" to force

### Problem: Rate violations not detected

**Check:**
1. Auto-check toggle is ON?
2. Channels are connected?
3. Last check timestamp recent?
4. Alert threshold too high?

**Fix:**
1. Enable auto-check
2. Connect channels
3. Click "Check Now"
4. Lower threshold to 5%

### Problem: Too many false positive violations

**Check:**
1. Alert threshold too low?
2. Currency conversion issues?
3. PMS base rates incorrect?

**Fix:**
1. Increase threshold to 7-10%
2. Verify rates in same currency
3. Update PMS rates first

### Problem: Channels showing ERROR

**Check:**
1. API credentials valid?
2. Network connectivity?
3. Channel maintenance window?

**Fix:**
1. Update credentials
2. Test connection
3. Wait and retry

---

## Integration Points

### Check-In Flow → Inventory Sync
```
Check-in guest
    ↓
Room becomes OCCUPIED
    ↓
[Automatic] Inventory event created
    ↓
[Automatic] -1 availability synced to channels
```

### Check-Out Flow → Inventory Sync
```
Check-out guest
    ↓
Housekeeping cleans room
    ↓
Room becomes VACANT_CLEAN
    ↓
[Automatic] Inventory event created
    ↓
[Automatic] +1 availability synced to channels
```

### Rate Update → Rate Parity Check
```
Update PMS rates
    ↓
Update channel extranets
    ↓
[Manual] Click "Check Now"
    ↓
[Automatic] Rates compared
    ↓
Violations created if discrepancies found
```

---

## Keyboard Shortcuts

Currently implemented shortcuts:

**Command Palette**: `Cmd/Ctrl + K`
- Type "channels" → Jump to Channels view
- Type "rates" → Jump to Rates view

**Planned shortcuts:**
- `Alt + R` → Run rate parity check
- `Alt + S` → Sync all channels
- `Esc` → Close modals/dialogs

---

## Best Practices Summary

### DO:
✅ Keep auto-sync enabled at all times  
✅ Check parity score daily  
✅ Resolve critical violations within 1 hour  
✅ Update PMS rates before channel rates  
✅ Run manual check after rate updates  
✅ Monitor channel health weekly  
✅ Document systematic issues  

### DON'T:
❌ Disable auto-sync without reason  
❌ Ignore critical violations  
❌ Update channels before PMS  
❌ Set threshold too low (<3%)  
❌ Leave channels disconnected  
❌ Ignore degraded health states  
❌ Forget to resolve violations  

---

## Support Resources

**Documentation:**
- INVENTORY-SYNC.md - Complete inventory sync guide
- RATE-PARITY-MONITORING.md - Complete rate parity guide
- OTA-CHANNEL-MANAGER.md - Channel connection guide
- RATES-AND-PRICING.md - Rate management guide

**Training:**
- Onboarding wizard (first login)
- In-app tooltips and help text
- Video tutorials (planned)

**Help:**
- Command palette (`Cmd/Ctrl + K`)
- Documentation search
- Support contact (planned)

---

## Summary

The Channel Management system provides two powerful, complementary tools:

1. **Inventory Synchronization** keeps your availability accurate across all channels automatically
2. **Rate Parity Monitoring** ensures your pricing remains consistent with proactive alerts

Together, they form a complete channel distribution solution that:
- Prevents overbookings
- Protects revenue
- Reduces manual work
- Provides complete visibility
- Maintains brand integrity

**Set it up once. Monitor it daily. Trust it completely.**

---

*For detailed documentation, see:*
- *INVENTORY-SYNC.md - Inventory synchronization deep dive*
- *RATE-PARITY-MONITORING.md - Rate parity monitoring deep dive*
