# Room-Ready Automated Notifications

## Overview

The Room-Ready Notification system automatically alerts front desk staff when rooms are cleaned and ready for the next guest. This feature integrates with the housekeeping workflow to send real-time notifications via LINE or email when rooms reach a "ready" status.

## How It Works

### Automatic Triggers

Notifications are automatically triggered when housekeeping staff:
1. **Mark a room as CLEAN** - After completing housekeeping tasks
2. **Mark a room as INSPECTED** - After supervisor inspection/approval

### Notification Flow

```
Housekeeping Staff marks room → CLEAN or INSPECTED
        ↓
System checks notification settings
        ↓
Applies filters (arrivals only, schedule, throttle)
        ↓
Sends notification via configured channels (LINE/Email)
        ↓
Front Desk receives: "✅ Room 305 Ready - Arrival at 14:00"
        ↓
Notification logged for audit trail
```

## Features

### ✅ Smart Filtering

- **Arrival-Only Mode**: Only notify for rooms with guests arriving today
- **Status Selection**: Choose to notify on CLEAN, INSPECTED, or both
- **Throttling**: Prevent duplicate notifications for the same room within X minutes
- **Schedule Control**: Limit notifications to specific hours and days of the week

### 📬 Multi-Channel Delivery

- **LINE Messaging**: Instant notifications to staff LINE accounts
- **Email**: Traditional email notifications for staff without LINE

### 👥 Role-Based Recipients

Notifications automatically sent to staff based on their role:
- **FRONT_DESK**: Primary recipients (default enabled)
- **MANAGER**: Supervisors and managers (default enabled)
- **HOUSEKEEPING**: Housekeeping supervisors (optional)
- **ADMIN**: System administrators (optional)

### 📝 Customizable Messages

Template variables for personalized notifications:
- `{{roomNumber}}`: The room number (e.g., "305")
- `{{status}}`: The room status (e.g., "clean", "inspected")
- `{{arrivalInfo}}`: Arrival details if applicable (e.g., " (Arrival at 14:00 - John Smith)")

**Default Template:**
- Title: `✅ Room {{roomNumber}} Ready`
- Body: `Room {{roomNumber}} is now {{status}} and ready for the next guest{{arrivalInfo}}.`

**Example Output:**
- ✅ Room 305 Ready
- Room 305 is now clean and ready for the next guest (Arrival at 14:00 - John Smith).

### 📊 Audit Trail

Every notification attempt is logged with:
- Room number and status
- Whether notification was sent or suppressed
- Reason for suppression (if applicable)
- Number of recipients
- Channels used (LINE, Email)
- Timestamp
- Arrival information

## Configuration

### Access Settings

1. Navigate to **Settings** from the main menu
2. Click the **Room Ready** tab
3. Configure notification preferences

### Basic Setup

#### 1. Enable Notifications
Toggle the main switch to activate the system.

#### 2. Choose Triggers
Select which status changes trigger notifications:
- ☑ Notify when Clean
- ☑ Notify when Inspected  
- ☑ Only for Today's Arrivals

#### 3. Select Channels
Choose delivery methods:
- ☑ LINE (requires staff to have LINE user IDs configured)
- ☐ Email (requires staff to have email addresses configured)

#### 4. Configure Recipients
Click role badges to include/exclude:
- ADMIN
- MANAGER (✓ default)
- FRONT_DESK (✓ default)
- HOUSEKEEPING
- CASHIER
- MAINTENANCE

### Advanced Configuration

#### Throttling
Prevent notification spam for the same room:
- **Enable**: Toggle throttling on/off
- **Minutes Between**: Minimum time before another notification for same room (default: 5 minutes)

#### Schedule
Limit notifications to specific times:
- **Enable**: Toggle schedule restrictions
- **Start Time**: Begin sending notifications (e.g., 06:00)
- **End Time**: Stop sending notifications (e.g., 23:00)
- **Days of Week**: Select active days (Sun-Sat)

#### Message Templates
Customize notification text:
- **Title Template**: Short heading for notification
- **Body Template**: Full message content
- Use template variables for dynamic content

## Use Cases

### Scenario 1: High-Turnover Day
**Setup:**
- Only for Today's Arrivals: ✓
- Notify on Clean: ✓
- Notify on Inspected: ✗
- Recipients: FRONT_DESK, MANAGER

**Flow:**
1. Guest checks out at 11:00
2. Housekeeping cleans room by 12:30
3. Marks room CLEAN in mobile app
4. **System checks**: Guest arriving at 14:00 ✓
5. **Notification sent** to 3 front desk staff via LINE
6. Front desk prepares for early check-in

**Result:** Rooms ready 90 minutes before arrival, smooth check-in process.

### Scenario 2: Quality Control Mode
**Setup:**
- Only for Today's Arrivals: ✓
- Notify on Clean: ✗
- Notify on Inspected: ✓
- Recipients: FRONT_DESK, MANAGER

**Flow:**
1. Housekeeping marks room CLEAN
2. **No notification sent** (waiting for inspection)
3. Supervisor inspects and marks INSPECTED
4. **Notification sent** to front desk
5. Room confirmed ready to highest standard

**Result:** Only inspection-approved rooms trigger check-in readiness.

### Scenario 3: 24/7 Operation with Schedule
**Setup:**
- Schedule: Enabled
- Active Hours: 06:00 - 23:00
- Days: Mon-Sun
- Throttle: 10 minutes

**Flow:**
1. Room cleaned at 02:00 (night shift)
2. **Notification suppressed** (outside schedule)
3. Room cleaned again at 08:00
4. **Notification sent** (within schedule)
5. Another clean at 08:05
6. **Notification suppressed** (throttled - too soon)

**Result:** Staff not disturbed during quiet hours, no duplicate alerts.

## Integration with Existing Systems

### Housekeeping Mobile View
- Notifications trigger automatically when staff update room status
- No additional steps required - works seamlessly with existing workflow
- Success toast confirms notification was sent

### Staff Alert System
- Uses existing staff directory from Alert Settings
- Respects staff active/inactive status
- Only sends to staff marked as "Receive Alerts"

### LINE Integration
- Uses LINE user IDs configured in Staff Settings
- Requires LINE channel setup (see LINE Settings tab)
- Test mode available to verify delivery

## Monitoring & Troubleshooting

### Notification Dashboard

The **Recent Notifications** section shows the last 10 attempts:

**Sent Successfully:**
- ✓ Green checkmark icon
- "Sent via LINE to 3 recipients"
- Timestamp and room details

**Suppressed:**
- ⊘ Orange clock icon
- Suppression reason:
  - `DISABLED`: Notifications turned off in settings
  - `NO_ARRIVAL`: Room has no arrival today (arrivals-only mode active)
  - `SCHEDULE`: Outside configured time window
  - `THROTTLED`: Too soon since last notification for this room
  - `NO_RECIPIENTS`: No staff configured to receive notifications

### Common Issues

#### No Notifications Being Sent

**Check:**
1. Is the system enabled? (Main toggle)
2. Are any roles selected as recipients?
3. Do staff members have LINE IDs or emails configured?
4. Are staff marked as "Active" and "Receive Alerts"?
5. Is schedule restricting current time?
6. Is "Only for Arrivals" enabled with no arrivals?

#### Duplicate Notifications

**Solution:**
- Enable throttling
- Increase throttle minutes
- Check if multiple staff are marking same room

#### Notifications at Wrong Times

**Solution:**
- Review schedule settings
- Check start/end times
- Verify days of week selection
- Consider timezone if using external services

## Statistics

The dashboard shows three key metrics:

1. **Sent**: Total notifications successfully delivered
2. **Recipients**: Active staff members receiving notifications
3. **Suppressed**: Notifications blocked by filters

Use these metrics to:
- Validate system is working
- Optimize filter settings
- Identify configuration issues
- Track notification volume

## Best Practices

### Recommended Settings for Most Hotels

```yaml
Enabled: true
Notify on Clean: true
Notify on Inspected: true
Only for Arrivals: true
LINE: enabled
Email: disabled (if LINE available)
Recipients: FRONT_DESK, MANAGER
Throttle: enabled, 5 minutes
Schedule: enabled, 06:00-23:00, all days
```

### For Boutique Hotels (< 30 rooms)
- Send on CLEAN only (faster notification)
- No throttling needed (lower volume)
- Include HOUSEKEEPING role (smaller team, all informed)

### For Larger Properties (30+ rooms)
- Send on INSPECTED only (quality assurance)
- Throttle 10-15 minutes (higher volume)
- Separate roles (FRONT_DESK only, managers monitor logs)

### For Extended Stay / Apartments
- Disable "Only for Arrivals" (notify for all cleans)
- Longer throttle (30-60 minutes)
- Include scheduled hours only (business hours)

## Technical Details

### Data Storage
- Settings: `room-ready-notification-settings` (KV storage)
- Logs: `room-ready-notification-logs` (last 100 entries)
- Staff: Shared with `staff-members` from Alert Settings

### Performance
- Notifications processed in <100ms
- No impact on housekeeping workflow
- Async delivery (non-blocking)

### Privacy & Security
- No sensitive guest data in notifications (optional guest name only)
- Staff LINE IDs and emails protected
- Audit log for compliance
- No external services required (LINE/Email gateways excepted)

### Future Enhancements
- [ ] SMS delivery channel
- [ ] Push notifications (browser API)
- [ ] Conditional logic (VIP guests, room types)
- [ ] Notification grouping ("5 rooms ready")
- [ ] Analytics dashboard (average time to ready)
- [ ] Integration with third-party PMS systems

## Support

For issues or questions:
1. Check Recent Notifications log for clues
2. Verify staff configuration in Alerts tab
3. Test with a single room and recipient first
4. Review suppression reasons in audit log
5. Ensure LINE integration is properly configured

---

**Related Documentation:**
- [Staff Alert Configuration](./STAFF-ALERTS.md)
- [LINE Integration Setup](./LINE-INTEGRATION.md)
- [Housekeeping Mobile View](./HOUSEKEEPING-SYNC.md)
- [Notifications Architecture](./NOTIFICATIONS.md)
