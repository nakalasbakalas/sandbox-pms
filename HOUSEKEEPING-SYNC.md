# Real-Time Housekeeping Integration

## Overview

The housekeeping mobile view and main Board view are now integrated with real-time synchronization. When housekeeping staff update room statuses on their mobile devices, those changes immediately reflect on the Board without requiring page refreshes.

## Architecture

### Shared State Management (`use-room-sync.ts`)

The integration uses a custom React hook `useRoomSync` that provides centralized room state management through the Spark KV persistence API:

```typescript
const { 
  rooms,           // Current room data (BoardRoomCard[])
  lastUpdate,      // Most recent status update
  updateRoomStatus,// Function to update a room's clean status
  getRoomById,     // Helper to find a room by ID
  getRoomByNumber, // Helper to find a room by number
  initializeRooms  // Initialize room data
} = useRoomSync()
```

### Key Components

1. **Board View** (`Board.tsx`)
   - Reads from shared room state
   - Displays live sync indicator when updates occur
   - Shows toast notifications for housekeeping updates
   - Automatically initializes mock data if none exists

2. **Housekeeping View** (`MobileHousekeepingView.tsx`)
   - Updates shared room state when staff mark rooms clean/dirty
   - Converts BoardRoomCard data to HousekeepingRoom format
   - Maintains maintenance issues and status history separately

3. **Data Conversion** (`convertBoardRoomToHousekeepingRoom`)
   - Transforms BoardRoomCard objects to HousekeepingRoom format
   - Calculates room priority based on arrival/departure status
   - Maps clean status between the two schemas

## How It Works

### Updating Room Status

When housekeeping staff update a room status:

1. User taps "Mark as Clean" in mobile housekeeping view
2. `handleUpdateRoomStatus` is called with roomId and new status
3. `updateRoomStatus` from `useRoomSync` hook updates the shared state
4. The update is persisted to `pms-rooms` KV key
5. A timestamp update is written to `last-room-update` KV key
6. Board view detects the `lastUpdate` change via useEffect
7. Toast notification appears on Board
8. Room card visual state updates automatically

### State Flow

```
Mobile Housekeeping View
    ↓ (user action)
handleUpdateRoomStatus
    ↓
useRoomSync.updateRoomStatus
    ↓
useKV('pms-rooms') - updates state
    ↓
useKV('last-room-update') - triggers notification
    ↓
Board View (useEffect watches lastUpdate)
    ↓
Toast notification + visual update
```

## Room Status Mapping

The system handles two different clean status schemas:

### BoardRoomCard Status
- `OCCUPIED_CLEAN` - Guest in room, room is clean
- `OCCUPIED_DIRTY` - Guest in room, room needs cleaning
- `VACANT_CLEAN` - No guest, room is ready
- `VACANT_DIRTY` - No guest, room needs cleaning

### HousekeepingRoom Status
- `CLEAN` - Room has been cleaned
- `DIRTY` - Room needs cleaning
- `INSPECTED` - Room has been cleaned and inspected
- `CLEANING` - Room is currently being cleaned

The conversion function automatically maps between these:
- `CLEAN` or `INSPECTED` → `OCCUPIED_CLEAN` or `VACANT_CLEAN` (depending on occupancy)
- `DIRTY` → `OCCUPIED_DIRTY` or `VACANT_DIRTY` (depending on occupancy)
- `CLEANING` → treated as `DIRTY` on the board

## Real-Time Indicators

### Board View

**Live Sync Indicator**
- Appears in top-right when `lastUpdate` is populated
- Shows pulsing green dot + "Live sync active" text
- Confirms that real-time updates are working

**Toast Notifications**
- Appears whenever a room status changes
- Format: "Room 201 updated to CLEAN"
- Duration: 2 seconds

### Housekeeping View

**Status Update Feedback**
- Shows loading state during update (`isUpdating`)
- Returns to list view after update completes
- Toast notification confirms success

## Data Persistence

All data is persisted using Spark's KV API:

- **`pms-rooms`**: Array of BoardRoomCard objects (source of truth)
- **`last-room-update`**: RoomStatusUpdate object with timestamp
- **`maintenance-issues`**: Array of maintenance reports
- **`status-history`**: Map of roomId → StatusHistoryEntry[]

## Room Priority Calculation

The system automatically calculates cleaning priority based on:

1. **Priority 10**: Departure + Arrival same day (turnover room)
2. **Priority 8**: Departure today
3. **Priority 7**: Arrival today
4. **Priority 6**: Dirty room (stayover)
5. **Priority 5**: Default

Higher priority rooms appear first in the housekeeping mobile view.

## Usage

### Viewing Real-Time Updates

1. Open Board view in one browser window
2. Open Housekeeping view in another window (or mobile device)
3. Mark a room as clean in Housekeeping view
4. Watch the Board view update instantly with:
   - Changed room color
   - Updated clean status indicator
   - Toast notification
   - Live sync indicator pulse

### Testing the Integration

```typescript
// From Board view - check current state
const { rooms, lastUpdate } = useRoomSync()
console.log('Current rooms:', rooms)
console.log('Last update:', lastUpdate)

// From Housekeeping view - update a room
updateRoomStatus({
  roomId: 'room-201',
  cleanStatus: 'CLEAN',
  lastCleaned: new Date(),
  cleanedBy: 'Test User'
})
```

## Future Enhancements

Potential improvements for true multi-user real-time sync:

1. **WebSocket Integration**: Replace KV polling with WebSocket push notifications
2. **Optimistic Updates**: Update UI immediately, sync in background
3. **Conflict Resolution**: Handle simultaneous updates from multiple users
4. **Offline Support**: Queue updates when connection is lost
5. **User Indicators**: Show which staff member is working on which room
6. **Audit Trail**: Track all status changes with timestamps and user info

## Technical Notes

- The system uses functional updates in `useKV` to prevent race conditions
- All dates are stored as Date objects and serialized automatically by KV
- The hook uses `useCallback` to prevent unnecessary re-renders
- BoardRoomCard is the source of truth; HousekeepingRoom is derived
