# Tablet Housekeeping App Documentation

## Overview

The Tablet Housekeeping App is a mobile-optimized interface specifically designed for housekeeping staff using tablets (iPads, Android tablets, etc.) to manage room cleaning operations efficiently. This app provides a touch-friendly, visually intuitive interface that allows staff to quickly view room statuses, update cleaning progress, and manage maintenance issues.

---

## Key Features

### 1. **Dual View Modes**

The system provides two distinct housekeeping views optimized for different use cases:

#### **Tablet Mode** (Grid Layout)
- **Visual grid of room cards** - See multiple rooms at once
- **Large touch targets** - Easy to tap even with gloves
- **Color-coded status indicators** - Instant visual recognition
- **One-tap status updates** - Quick action buttons on each card
- **Advanced filtering & search** - Find rooms quickly
- **Sliding detail sheets** - Access full room information without leaving the grid

#### **Mobile Mode** (List Layout)
- **Compact list view** - More rooms visible on smaller screens
- **Grouped by floor** - Logical organization for cleaning routes
- **Swipe gestures** - Swipe right to mark clean, left to mark dirty
- **Full-screen detail views** - Tap any room for complete information
- **Staff assignment tools** - Assign rooms to specific team members

### 2. **Mode Selection**

On first launch, users are presented with an elegant mode selection screen:
- **Visual comparison** - Clear description of each mode's benefits
- **Persistent preference** - Choice is saved for future sessions
- **Easy switching** - Toggle between modes anytime via the header button

---

## Tablet Mode Features

### Dashboard Statistics
At the top of the screen, five interactive stat cards show:
- **To Clean** (Dirty rooms) - Orange highlight
- **Cleaning** (In progress) - Purple highlight
- **Clean** (Ready for inspection) - Green highlight
- **Inspected** (Quality checked) - Blue highlight
- **Priority** (Arrivals/Departures today) - Red highlight

Tapping any stat card filters the room grid to show only that category.

### Search and Filtering
- **Real-time search** - Filter by room number or guest name
- **Smart sorting** - Toggle between Room Number, Status, or Priority
- **Active filter indicators** - Highlighted stat cards show active filters

### Room Cards
Each room card displays:
- **Large room number** - Bold, easy to read
- **Status dot** - Color-coded (Green/Orange/Blue/Purple)
- **Guest count badge** - Number of occupants
- **Arrival/Departure badges** - Time-sensitive information highlighted
- **Maintenance alerts** - Red badge with issue count
- **Staff assignment** - Colored initial bubble showing assigned cleaner
- **Guest name** - When applicable
- **Special instructions** - Visible at a glance

### Quick Actions
Each card has a prominent action button that changes based on status:
- **Dirty → Clean** (Green button)
- **Cleaning → Done** (Green button)
- **Clean → Inspect** (Blue button)
- **Clean/Inspected → Dirty** (Orange button)

### Room Detail Sheet
Tapping a room card opens a sliding sheet with three tabs:

#### **Overview Tab**
- Priority alerts (arrivals/departures)
- Maintenance issue list
- Room information (type, floor, occupancy)
- Guest details
- Special instructions
- Last cleaned timestamp and staff member

#### **Clean Tab**
- **Cleaning checklist button** - Opens detailed task list
- **Quick status buttons** - Large touch-friendly options
  - Start Cleaning (Purple)
  - Mark as Clean (Green)
  - Mark as Inspected (Blue)
  - Mark as Dirty (Orange)

#### **Issues Tab**
- **Report New Issue button** - Opens maintenance form
- **Issue history** - All reported problems for the room
- Issue details include:
  - Title and description
  - Category (AC, Plumbing, Electrical, etc.)
  - Priority (Low, Medium, High, Urgent)
  - Status (Pending, In Progress, Resolved)
  - Reporter and timestamp
  - Room blocking status

### Cleaning Checklist
Interactive checklist organized by category:
- **Bathroom** - Toilet, sink, shower, toiletries, towels
- **Bedroom** - Linens, vacuum, dusting
- **Amenities** - Minibar, TV remote
- **General** - Trash, AC/heating

Features:
- Large checkboxes for easy tapping
- Progress tracking (X/Y tasks, percentage)
- Optional notes field
- Cannot complete until all tasks checked
- Auto-resets after completion

### Maintenance Reporting
Easy-to-use form with:
- **Category dropdown** - AC, Plumbing, Electrical, Furniture, Bathroom, Bedding, Other
- **Priority selector** - Low, Medium, High, Urgent
- **Title field** - Short description
- **Description area** - Detailed explanation
- **Block room toggle** - Prevent selling if necessary

High/Urgent issues automatically create notifications for management.

---

## Mobile Mode Features

### Floor-Based Organization
- Rooms grouped by floor (Floor 2, Floor 3, etc.)
- Collapsible sections to reduce clutter
- Quick floor summary (dirty, cleaning, clean, inspected counts)

### Swipe Gestures
- **Swipe right** on dirty/cleaning room → Mark as clean
- **Swipe left** on clean/inspected room → Mark as dirty
- Visual feedback during swipe (colored background)
- Swipe threshold prevents accidental actions

### Undo Functionality
- Toast notification with Undo button after status changes
- 5-second window to reverse actions
- Shows room number and status change

### Staff Assignment View
Dedicated screen for managing cleaning assignments:
- Assign specific rooms to team members
- Color-coded staff identification
- Visual assignment indicators on room cards

### Print Functionality
Generate housekeeping reports including:
- All room statuses
- Grouped by floor
- Staff assignments
- Print-optimized layout

---

## User Experience Design

### Touch Optimization
- **Minimum touch targets**: 44x44px (iOS guidelines)
- **Large buttons**: 14-16px height for primary actions
- **Generous spacing**: Prevents accidental taps
- **Swipe-friendly**: Natural gestures for quick updates

### Visual Hierarchy
- **Bold room numbers**: Largest text on cards
- **Color coding**: Instant status recognition
  - Orange = Needs attention (Dirty)
  - Purple = In progress (Cleaning)
  - Green = Complete (Clean)
  - Blue = Quality assured (Inspected)
  - Red = Urgent (Maintenance/Priority)

### Performance
- **Instant feedback**: All actions respond within 100ms
- **Optimistic updates**: UI updates immediately, syncs in background
- **Efficient rendering**: Grid/list virtualization for large properties
- **Smooth animations**: 60fps transitions and interactions

### Accessibility
- **High contrast**: WCAG AA compliant color combinations
- **Large text**: Base font size 14-16px
- **Clear labels**: Descriptive button text
- **Error prevention**: Confirmation for destructive actions

---

## Integration Points

### Real-Time Synchronization
- **Board integration**: Status changes instantly reflect on main board
- **Multi-device sync**: Front desk sees housekeeping updates immediately
- **Conflict resolution**: Last-write-wins with timestamp tracking

### Notifications
- **Room ready alerts**: Notify front desk when rooms are clean/inspected
- **Maintenance escalation**: Urgent issues trigger immediate notifications
- **Assignment updates**: Staff notified of new room assignments

### Data Persistence
- **Local storage**: All data persists across sessions using KV store
- **Mode preference**: View choice saved per user
- **Staff assignments**: Retained for shift planning
- **History tracking**: Complete audit trail of status changes

---

## Best Practices for Staff

### Morning Routine
1. Launch housekeeping app
2. Select preferred view mode (tablet/mobile)
3. Review priority rooms (departures/arrivals)
4. Check staff assignments
5. Start with highest priority rooms

### Room Cleaning Workflow
1. Navigate to room (via list or grid)
2. Tap room card to open details
3. Review any special instructions
4. Tap "Start Cleaning" to mark in progress
5. Complete work using checklist
6. Report any maintenance issues
7. Tap "Finish Cleaning" when done

### End of Shift
1. Review completion stats
2. Report any outstanding issues
3. Check for reassignments needed
4. Print daily report if required

---

## Technical Implementation

### Components
- **HousekeepingModeSwitcher**: Mode selection launcher
- **TabletHousekeepingApp**: Grid-based tablet interface
- **MobileHousekeepingView**: List-based mobile interface
- **RoomDetailSheet**: Sliding detail panel (tablet)
- **RoomDetailView**: Full-screen details (mobile)

### State Management
- **useKV hook**: Persistent data storage
- **useRoomSync**: Real-time room status synchronization
- **Local state**: UI interactions and temporary data

### Data Flow
1. User action (tap, swipe, form submit)
2. Optimistic UI update (instant feedback)
3. KV store update (persistence)
4. Board sync (propagate to other views)
5. Notification dispatch (if applicable)

---

## Future Enhancements

### Planned Features
- **Photo attachments**: Add images to maintenance reports
- **Voice notes**: Quick audio recordings for special instructions
- **Route optimization**: Suggest efficient cleaning order
- **Time tracking**: Record cleaning duration per room
- **Inventory management**: Track supply usage
- **Multi-language support**: Thai/English toggle
- **Offline mode**: Full functionality without internet
- **Push notifications**: Native mobile app alerts

### Under Consideration
- **Barcode scanning**: QR codes on room doors
- **Biometric check-in**: Fingerprint for clock in/out
- **Team chat**: Direct messaging between staff
- **Performance metrics**: Individual cleaning speed stats
- **Predictive cleaning**: AI-suggested priority based on patterns

---

## Troubleshooting

### Common Issues

**Q: Swipe gestures not working?**
A: Make sure you're swiping on the room row, not on badges or buttons. Swipe threshold is 100px.

**Q: Can't complete checklist?**
A: All tasks must be checked before the Complete button activates.

**Q: Changes not saving?**
A: Check browser console for errors. Data uses KV persistence which should work offline.

**Q: Want to switch view modes?**
A: Tap the device icon in the header (tablet icon in mobile view, mobile icon in tablet view).

**Q: Stats not updating?**
A: Refresh the page. Real-time sync should be automatic but cache may need clearing.

---

## Support

For technical issues, feature requests, or training needs, contact the development team or refer to the main PMS documentation.
