# Bulk Room Assignment Feature

## Overview
The Bulk Room Assignment feature allows front desk staff to quickly assign multiple unassigned reservations to available rooms in a single operation, dramatically improving efficiency during check-in periods or when preparing for multiple arrivals.

## Location
**Primary Access:** Reservations View → Select Multiple → Assign Rooms

## User Flow

### 1. Entering Bulk Selection Mode
- Navigate to the Reservations view
- Click "Select Multiple" button to enter bulk selection mode
- Select one or more reservations using the checkboxes

### 2. Initiating Bulk Room Assignment
- Once reservations are selected, the "Assign Rooms (X)" button appears if there are unassigned reservations
- The counter shows how many of the selected reservations need room assignments
- Click "Assign Rooms (X)" to open the bulk assignment dialog

### 3. Auto-Assignment Modes

#### Smart Mode (Default - Recommended)
- Prioritizes arriving guests first
- Considers stay length (longer stays get priority)
- Assigns cleanest rooms first (Clean → Dirty priority)
- Prevents conflicts automatically
- Optimal for most scenarios

#### Sequential Mode
- Assigns rooms in numerical order
- Good for maintaining organized room blocks
- Still respects availability and conflicts

#### Manual Only Mode
- User selects each room assignment individually
- Full control for special requirements
- Good when specific room requests are involved

### 4. Assignment Process
- Each unassigned reservation is displayed with:
  - Guest name
  - Check-in and check-out dates
  - Number of nights
  - Room type required
  - Number of guests
  - Current assignment status (green = assigned, amber = pending)

- For each reservation, the system shows:
  - Available rooms that match the room type
  - Room cleanliness status (sparkle icon = clean, broom icon = dirty)
  - Conflict detection (no rooms shown if dates conflict)

- Users can:
  - Use "Auto-Assign All" to let the system assign all at once
  - Manually select rooms from dropdowns for specific reservations
  - Remove assignments by clicking the X button
  - Change assignments by selecting a different room

### 5. Applying Assignments
- Review the assignments (green indicator shows assigned count)
- Click "Assign X Rooms" to apply all assignments
- System validates all assignments
- Updates are saved to persistent storage
- Success notification confirms the operation
- Selection is automatically cleared

## Features

### Conflict Detection
- Automatically checks for overlapping dates
- Prevents double-booking
- Only shows truly available rooms for each reservation's dates
- Warns when no rooms are available for specific dates

### Visual Feedback
- Color-coded status indicators:
  - Green dot/border = Room assigned
  - Amber dot = Pending assignment
- Real-time counter showing assigned vs. pending
- Clean status icons (sparkle/broom) for each room
- Warning messages for reservations with no available rooms

### Smart Room Filtering
- Only shows rooms matching the required room type
- Excludes rooms with operational issues (Out of Service, Blocked)
- Filters out rooms with conflicting reservations
- Considers the full date range of each reservation

### Bulk Operations Support
- Assign 1-50+ reservations at once
- Mixed auto and manual assignments
- Partial assignment support (assign some, leave others)
- Easy review and modification before applying

## Technical Implementation

### Data Persistence
- Uses `useKV` hook for persistent storage
- Updates both reservation and room data
- Maintains referential integrity
- Atomic updates prevent inconsistent states

### Validation Rules
1. Room must match the reservation's room type
2. Room must be operationally available
3. No date conflicts with other reservations
4. Reservations must be CONFIRMED or CHECKED_IN status

### Performance
- Efficient filtering using useMemo
- Optimized conflict detection
- Minimal re-renders
- Handles large reservation lists smoothly

## Use Cases

### Daily Operations
1. **Morning Check-In Preparation**
   - Select all arriving guests for the day
   - Auto-assign to clean rooms
   - Review and adjust as needed

2. **Bulk Booking Processing**
   - Process group bookings efficiently
   - Assign adjacent rooms for families/groups
   - Handle multiple OTA imports at once

3. **Room Type Changes**
   - Upgrade/downgrade multiple guests
   - Reassign after room closures
   - Handle maintenance room moves

### Edge Cases Handled
- No available rooms → Clear warning message
- Partial availability → Assign what's possible
- Mixed room types → Filtered correctly per reservation
- Already assigned → Excluded from the dialog
- Different date ranges → Individual conflict checking

## User Benefits
- **Speed:** Assign 10+ reservations in under 30 seconds
- **Accuracy:** Automatic conflict detection prevents errors
- **Flexibility:** Choose between auto and manual assignment
- **Visibility:** Clear status of what's assigned and what's pending
- **Confidence:** Visual confirmation before committing changes

## Staff Training Notes
- Start with manual mode to understand the system
- Progress to smart auto-assign for daily operations
- Use sequential mode for organized room blocks
- Always review before clicking "Assign"
- Undo by returning to bulk select and reassigning

## Future Enhancements (Potential)
- Room preference matching (VIP rooms, specific floors)
- Group booking auto-clustering (adjacent rooms)
- Integration with housekeeping priority
- Pre-assignment during reservation creation
- Drag-and-drop bulk assignment from board view
