# Real-Time Housekeeping Notifications

## Overview

A real-time notification system built for urgent housekeeping alerts in the Sandbox Hotel PMS. The system provides instant visual and audio feedback for critical housekeeping and maintenance events.

## Features

### ✅ Core Capabilities

- **Real-time notifications** with priority-based alerts
- **Audio alerts** for urgent and high-priority notifications (toggleable)
- **Visual indicators** including:
  - Animated ringing bell icon for unread notifications
  - Unread count badge
  - Priority-based color coding (red for urgent, orange for high, blue for medium)
  - Left border highlighting based on priority
- **Persistent storage** - notifications survive page refreshes
- **Filtering** - View all notifications or unread only
- **Actionable** - Mark as read, dismiss, clear all
- **Sound customization** - Toggle notification sounds on/off

### 📢 Notification Types

1. **HOUSEKEEPING_URGENT** - Critical housekeeping requests
2. **MAINTENANCE_URGENT** - Urgent maintenance issues
3. **ARRIVAL_IMMINENT** - Guest arriving soon, room not ready
4. **CHECKOUT_DELAYED** - Checkout overdue
5. **ROOM_BLOCKED** - Room blocked due to issue
6. **GUEST_REQUEST** - Special guest requests
7. **SYSTEM_ALERT** - System-level notifications

### 🎯 Priority Levels

- **URGENT** (Red) - Critical issues requiring immediate attention
  - Plays double-tone alert sound
  - Shows error toast
  - Bold red left border
- **HIGH** (Orange) - Important issues needing prompt attention
  - Plays single-tone alert sound
  - Shows warning toast
  - Orange left border
- **MEDIUM** (Blue) - Standard notifications
  - No sound
  - Blue left border
- **LOW** (Gray) - Informational updates
  - No sound
  - No border highlight

## Usage

### For Housekeeping Staff

The notification bell appears in the top-right corner of the Housekeeping view:

1. **Viewing Notifications**
   - Click the bell icon to open the notification panel
   - Unread count shows as a red badge on the bell
   - Bell animates with ringing motion when there are unread urgent/high priority notifications

2. **Managing Notifications**
   - Click "Mark Read" on individual notifications
   - Use "Mark All Read" to clear all unread status
   - Use "Clear All" to dismiss all notifications
   - Dismissed notifications are permanently removed

3. **Sound Alerts**
   - Toggle sound on/off using the switch at the bottom of the panel
   - Urgent: Double-tone alert (880Hz)
   - High: Single-tone alert (523Hz)
   - Sound plays automatically for urgent and high priority alerts

### Automatic Triggers

Notifications are automatically triggered when:

- **URGENT maintenance issue** is reported
  - Title: "🚨 URGENT Maintenance: Room XXX"
  - Includes category and issue description
  - Links to room and issue ID

- **HIGH priority maintenance issue** is reported
  - Title: "⚠️ Maintenance: Room XXX"
  - Includes category and issue description
  - Links to room and issue ID

## Implementation

### Hook: `useNotifications()`

```typescript
const {
  notifications,          // All notifications
  activeNotifications,    // Non-dismissed notifications
  unreadNotifications,    // Unread notifications
  unreadCount,           // Count of unread
  soundEnabled,          // Sound toggle state
  addNotification,       // Add a new notification
  markAsRead,            // Mark single as read
  markAllAsRead,         // Mark all as read
  dismissNotification,   // Dismiss single
  clearDismissed,        // Clear dismissed
  clearAll,              // Clear all
  toggleSound,           // Toggle sound on/off
} = useNotifications()
```

### Adding Notifications

```typescript
addNotification({
  type: 'MAINTENANCE_URGENT',
  priority: 'URGENT',
  title: '🚨 URGENT Maintenance: Room 305',
  message: 'AC: Air conditioning not cooling',
  roomNumber: '305',
  roomId: 'room-305',
  actionRequired: true,
  metadata: {
    issueId: 'issue-123',
    category: 'AC',
    blockRoom: true
  }
})
```

### Components

- **`NotificationBell`** - Bell icon button with unread badge and animation
- **`NotificationCenter`** - Side panel showing all notifications with filtering
- **`useNotifications`** - React hook for notification management

## Technical Details

### Data Persistence

- Notifications stored in `useKV('housekeeping-notifications')`
- Sound preference stored in `useKV('notification-sound-enabled')`
- Limited to 100 most recent notifications

### Sound Generation

Uses Web Audio API to generate alert tones:
- No external audio files required
- Consistent cross-browser experience
- Low latency

### Integration Points

Currently integrated with:
- **Mobile Housekeeping View** - Bell icon in header
- **Maintenance Issue Reporting** - Auto-triggers on URGENT/HIGH priority issues

Future integration opportunities:
- Front Desk view (for checkout delays, arrival issues)
- Board view (for room status alerts)
- Manager dashboard (for system alerts)

## Design Philosophy

- **Non-intrusive**: Notifications don't block workflow
- **Actionable**: Each notification can be acted upon or dismissed
- **Priority-driven**: Visual and audio cues match urgency
- **Persistent**: Important alerts don't disappear
- **Accessible**: Clear visual hierarchy and ARIA labels

## Future Enhancements

- [ ] Real-time sync across devices
- [ ] Custom notification sounds
- [ ] Push notifications (browser API)
- [ ] Notification grouping (e.g., "3 maintenance issues in Floor 2")
- [ ] Rich actions (e.g., "Assign to staff" button)
- [ ] Notification history view
- [ ] Staff assignment routing
- [ ] Do Not Disturb hours
- [ ] Custom alert rules per role

## Testing

To test notifications:

1. Go to Housekeeping view
2. Select any room
3. Click "Report Issue"
4. Set priority to "Urgent" or "High"
5. Submit the form
6. Check the bell icon for the notification

Or programmatically:

```typescript
const { addNotification } = useNotifications()

addNotification({
  type: 'HOUSEKEEPING_URGENT',
  priority: 'URGENT',
  title: 'Test Urgent Alert',
  message: 'This is a test notification',
  roomNumber: '301',
  actionRequired: false
})
```
