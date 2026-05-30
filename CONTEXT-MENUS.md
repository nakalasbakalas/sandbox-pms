# Right-Click Context Menus Implementation

## Overview
Comprehensive right-click context menus have been added throughout the PMS for faster room operations and improved workflow efficiency.

## Implemented Context Menus

### 1. Room Board Context Menu
**Location**: Board view - Right-click on any room in the calendar view

**Available Operations**:

#### Guest Operations (When Room is Occupied)
- **Edit Reservation** - Quick access to edit reservation details
- **View Folio** - View guest billing and charges
- **Post Charge** - Add charges to the guest folio
- **Transfer to Another Room** - Move guest to a different room
- **Toggle VIP Status** - Mark or unmark guest as VIP
- **Add Note** - Add notes specific to this reservation
- **Print Registration** - Print registration card
- **Copy Reservation Info** - Copy details to clipboard
- **Extend Stay** - Quick extend by 1, 2, 3 nights or 1 week
- **Shorten Stay** - Quick shorten by 1, 2, or 3 nights
- **Check Out Guest** - Process checkout

#### Vacant Room Actions (When Room is Empty)
- **Quick Check-In** - Assign from unassigned reservations
- **View Availability Calendar** - See booking calendar for the room

#### Housekeeping Operations
- **Mark as Clean** - Update room clean status
- **Mark as Dirty** - Mark room needs cleaning
- **Request Housekeeping** - Send priority cleaning request

#### Room Status Operations
- **Block Room** - Temporarily block from inventory
- **Mark Out of Service** - Mark room unavailable for maintenance
- **Make Available** - Return blocked/OOS room to inventory

### 2. Housekeeping Context Menu
**Location**: Housekeeping views - Right-click on any room card
**Component**: `src/components/housekeeping/HousekeepingContextMenu.tsx`

**Available Operations**:

#### Status Changes
- **Mark as Clean** - Room has been cleaned
- **Mark as Dirty** - Room needs cleaning
- **Mark as Inspected** - Room has passed inspection
- **Request Inspection** - Send room for inspection

#### Priority Management
- **Set Priority**
  - High Priority (for departures, VIP arrivals)
  - Medium Priority (regular turnover)
  - Low Priority (stay-over cleaning)

#### Staff Operations
- **Assign Staff** - Assign room to specific housekeeper
- **Reassign Staff** - Change assignment

#### Notes & Issues
- **Add Note** - Add housekeeping notes
- **Report Issue** - Report maintenance or cleanliness issues

#### Room Status
- **Mark Out of Service** - For maintenance
- **Mark Available** - Return to service

### 3. Reservation Context Menu
**Location**: Reservations view - Right-click on any reservation
**Component**: `src/components/reservations/ReservationContextMenu.tsx`

**Available Operations**:

#### Basic Operations
- **View Reservation Details** - Open detail view
- **Edit Reservation** - Modify reservation

#### Guest Operations (Active Reservations)
- **Check In Guest** - Process check-in (for confirmed reservations)
- **Check Out Guest** - Process checkout (for checked-in guests)
- **Change Room** - Transfer to different room
- **View Folio** - See billing details
- **Post Charge** - Add charges
- **Toggle VIP Status** - VIP designation
- **Add Note** - Reservation-specific notes

#### Stay Modifications (Checked-In Guests)
- **Extend Stay**
  - +1 Night
  - +2 Nights
  - +3 Nights
  - +1 Week
- **Shorten Stay**
  - -1 Night
  - -2 Nights
  - -3 Nights

#### Communication
- **Send Email** - Email guest
- **Call Guest** - Initiate call

#### Administrative
- **Print Confirmation** - Print reservation confirmation
- **Copy Reservation Info** - Copy to clipboard
- **Cancel Reservation** - Cancel booking

## Implementation Details

### Board View Integration
The context menu is integrated into the `CalendarRoomRow` component and wraps each room row. The menu is context-aware and only shows relevant options based on:
- Room occupancy status
- Guest presence
- Room clean status
- Operational status (available/blocked/OOS)

### Handler Functions
All context menu actions are implemented as handler functions in `Board.tsx`:
- `handleCheckOut` - Process guest checkout
- `handleMarkClean/Dirty` - Update clean status
- `handleBlockRoom/UnblockRoom` - Manage room availability
- `handleExtendStay/ShortenStay` - Modify reservation dates
- `handleToggleVIP` - Toggle VIP status
- `handlePostCharge` - Add charges (placeholder)
- `handleViewFolio` - View billing (placeholder)
- `handleAddNote` - Add notes (placeholder)
- `handlePrintRegistration` - Print registration
- `handleTransferRoom` - Room transfer mode
- `handleMarkOutOfService` - OOS management
- `handleRequestHousekeeping` - Priority cleaning
- `handleCopyReservation` - Copy to clipboard
- `handleViewCalendar` - Availability calendar

### User Experience
- **Right-click activation** - Context menu appears on right-click
- **Keyboard accessible** - Can be activated via keyboard
- **Organized sections** - Operations grouped logically
- **Icon indicators** - Visual icons for each action
- **Contextual** - Only relevant actions shown
- **Non-destructive first** - Dangerous actions at bottom
- **Color coding** - Destructive actions in red

## Benefits

### Efficiency Gains
- **Reduced clicks** - Common operations 1-2 clicks instead of 3-5
- **Faster workflows** - No need to open dialogs for simple actions
- **Contextual discovery** - Users can explore available actions
- **Muscle memory** - Consistent patterns across views

### Workflow Improvements
- Quick status updates without dialog navigation
- Instant access to guest operations
- Fast room modifications
- Easy priority setting for housekeeping

### Power User Features
- Keyboard shortcuts work alongside context menus
- Batch operations still available for bulk changes
- Context menus complement existing UI, don't replace it

## Usage Guidelines

### For Front Desk Staff
1. Right-click room on board for quick operations
2. Use for single-room operations (batch dialog for multiple)
3. Check-out, extend/shorten stays without opening dialogs
4. Quick VIP designation changes

### For Housekeeping Staff
1. Right-click rooms to update status
2. Set priorities without navigating to settings
3. Report issues immediately
4. Request inspections on-the-fly

### For Managers
1. Quick room blocking/unblocking
2. View details and folios rapidly
3. Override assignments and priorities
4. Access all operations from one menu

## Future Enhancements

### Planned Additions
- [ ] Guest list context menu (contacts, history, preferences)
- [ ] Calendar event context menu (block dates, set rates)
- [ ] Channel manager context menu (sync, update, disconnect)
- [ ] Staff context menu (assign, schedule, performance)

### Advanced Features
- [ ] Custom actions based on user role
- [ ] Configurable menu items
- [ ] Recent actions quick-access
- [ ] Keyboard shortcut hints in menu

## Technical Notes

### Components
- `RoomContextMenu.tsx` - Board room operations
- `HousekeepingContextMenu.tsx` - Housekeeping operations  
- `ReservationContextMenu.tsx` - Reservation operations

### Dependencies
- Radix UI Context Menu components
- Phosphor Icons for visual indicators
- Sonner for toast notifications

### Performance
- Menus render on-demand (not pre-rendered)
- Handlers use functional updates for state safety
- Context menus don't impact drag-and-drop operations

### Accessibility
- Keyboard navigation supported
- Screen reader compatible
- Focus management preserved
- ARIA labels for all actions
