# Sandbox Hotel PMS — Guest, Housekeeping & Documents

## 1. Guest Profile Data Model

```typescript
interface Guest {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  nationality: string | null
  idType: 'PASSPORT' | 'ID_CARD' | 'DRIVERS_LICENSE' | null
  idNumber: string | null
  
  // Flags
  vipStatus: boolean
  cautionFlag: boolean
  blacklisted: boolean
  
  // Preferences
  preferredContact: 'EMAIL' | 'PHONE' | 'SMS' | null
  preferences: string | null  // JSON: room preferences, dietary, etc.
  
  // History
  totalStays: number
  totalSpend: number
  lastStay: Date | null
  
  // Notes & Warnings
  notes: string | null
  warnings: Warning[]
  
  // Documents
  documents: GuestDocument[]
  
  createdAt: Date
  updatedAt: Date
}

interface Warning {
  id: string
  severity: 'INFO' | 'CAUTION' | 'CRITICAL'
  message: string
  createdBy: string
  createdAt: Date
}

interface GuestDocument {
  id: string
  type: 'ID' | 'PASSPORT' | 'VISA' | 'REGISTRATION_CARD' | 'OTHER'
  fileName: string
  uploadedBy: string
  uploadedAt: Date
  verified: boolean
  verifiedBy: string | null
}
```

## 2. Guest Module Screens

### Screen: Guest List
- Search by name, email, phone, ID number
- Filters: VIP, Blacklist, Caution
- Columns: Name, Phone, Last Stay, Total Stays, Flags
- Click row → Guest Profile

### Screen: Guest Profile
**Tabs:**
1. **Overview** — Contact info, flags, quick stats
2. **Stay History** — Past reservations, spend summary
3. **Documents** — ID/passport uploads, verification status
4. **Notes & Warnings** — Staff notes, caution flags, blacklist reason

**Quick Actions:**
- New Reservation
- Mark VIP / Remove VIP
- Add Warning / Add Note
- Upload Document
- Mark Blacklist

## 3. Duplicate Handling

```typescript
// On guest creation, check for duplicates
async function findDuplicates(input: GuestInput): Promise<Guest[]> {
  const matches = await db.guest.findMany({
    where: {
      OR: [
        { email: input.email, email: { not: null } },
        { phone: input.phone, phone: { not: null } },
        { AND: [
          { firstName: { equals: input.firstName, mode: 'insensitive' } },
          { lastName: { equals: input.lastName, mode: 'insensitive' } }
        ]}
      ]
    }
  })
  
  return matches
}

// UI shows matches with merge option
interface DuplicatePrompt {
  message: "Possible duplicate guest found"
  matches: Guest[]
  actions: ['Use Existing', 'Create New', 'Merge Profiles']
}
```

## 4. Housekeeping Data Model

```typescript
interface Room {
  // ... existing fields
  housekeepingStatus: HKStatus
  lastCleaned: Date | null
  assignedTo: string | null  // Staff member ID
  maintenanceIssues: Issue[]
}

enum HKStatus {
  CLEAN = 'clean',
  DIRTY = 'dirty',
  INSPECTED = 'inspected',
  MAINTENANCE = 'maintenance',
  CLEANING_IN_PROGRESS = 'cleaning'
}

interface Issue {
  id: string
  roomId: string
  type: 'MAINTENANCE' | 'HOUSEKEEPING'
  description: string
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  reportedBy: string
  resolvedBy: string | null
  resolvedAt: Date | null
  createdAt: Date
}

// Room state transition rules
type StatusTransition = {
  from: HKStatus
  to: HKStatus
  allowedRoles: Role[]
}

const transitions: StatusTransition[] = [
  { from: 'dirty', to: 'cleaning', allowedRoles: ['housekeeping'] },
  { from: 'cleaning', to: 'clean', allowedRoles: ['housekeeping'] },
  { from: 'clean', to: 'inspected', allowedRoles: ['manager', 'housekeeping'] },
  { from: 'inspected', to: 'maintenance', allowedRoles: ['all'] },
  { from: 'maintenance', to: 'dirty', allowedRoles: ['manager'] },
]
```

## 5. Housekeeping Mobile View

### Priority Queue (Auto-sorted)
1. **Departures** — Checkout rooms, needs immediate turnover
2. **Arrivals** — Same-day arrivals needing clean rooms
3. **Stayovers** — Occupied rooms needing service
4. **Vacant Dirty** — No pressure, clean when ready

```typescript
interface HKQueueItem {
  roomNumber: string
  status: HKStatus
  priority: 'URGENT' | 'HIGH' | 'NORMAL'
  reason: string  // "Departure 11am, Arrival 2pm"
  occupancyStatus: 'OCCUPIED' | 'VACANT'
  assignedTo: string | null
}

// Priority calculation
function calculatePriority(room: Room, reservations: Reservation[]): Priority {
  const today = new Date()
  const departureToday = reservations.find(r => isSameDay(r.checkOut, today))
  const arrivalToday = reservations.find(r => isSameDay(r.checkIn, today))
  
  if (departureToday && arrivalToday) return 'URGENT'  // Same-day turnover
  if (departureToday) return 'HIGH'
  if (room.occupancyStatus === 'OCCUPIED' && room.housekeepingStatus === 'dirty') return 'HIGH'
  return 'NORMAL'
}
```

### Mobile UI (Touch-Optimized)

```
┌─────────────────────────────┐
│ HOUSEKEEPING    Today: 12/15│
├─────────────────────────────┤
│ □ 305 URGENT                │
│   Departure → Arrival        │
│   [Start Cleaning]           │
│                              │
│ □ 212 HIGH                   │
│   Stayover - Occupied        │
│   [Start Cleaning]           │
│                              │
│ ✓ 310 NORMAL                 │
│   Cleaned 10:30am ✓          │
│   [Mark Inspected]           │
└─────────────────────────────┘
```

### Room Detail (Mobile)
- Large status buttons (80px height)
- Quick issue reporting (predefined options)
- Photo upload for maintenance issues
- Notes field (voice-to-text ready)

```typescript
const quickIssues = [
  'AC not working',
  'Shower leak',
  'Light bulb out',
  'TV remote missing',
  'Minibar needs restock',
  'Bed linens stained',
]
```

## 6. Document Management

```typescript
interface PreCheckInForm {
  id: string
  reservationId: string
  status: 'PENDING' | 'SUBMITTED' | 'REVIEWED'
  
  // Guest-provided data
  arrivalTime: string | null
  specialRequests: string | null
  dietaryNeeds: string | null
  
  // Documents uploaded by guest
  documents: GuestDocument[]
  
  submittedAt: Date | null
  reviewedBy: string | null
  reviewedAt: Date | null
}

// Document collection workflow
interface DocumentRequest {
  reservationId: string
  requiredDocs: DocumentType[]
  optionalDocs: DocumentType[]
  dueDate: Date
  reminderSent: boolean
}

type DocumentType = 'ID' | 'PASSPORT' | 'VISA' | 'CREDIT_CARD'
```

## 7. Pre-Check-In Flow

### Guest Experience (Link sent via email)
1. **Welcome** — Reservation details, check-in time
2. **Guest Info** — Verify/update contact details
3. **Upload Documents** — ID, passport (optional but encouraged)
4. **Preferences** — Arrival time, special requests
5. **Submit** — Confirmation message

### Staff Review Dashboard
```
┌──────────────────────────────────────────┐
│ PRE-CHECK-IN QUEUE                  [7]  │
├──────────────────────────────────────────┤
│ □ John Smith - Room 305 - Arr: Tomorrow  │
│   Documents: ✓ ID, ✓ Passport            │
│   ETA: 14:30                             │
│   [Review & Approve]                     │
│                                          │
│ □ Mary Johnson - Room 212 - Arr: Today   │
│   Documents: ⚠ Missing ID                │
│   [Send Reminder]                        │
└──────────────────────────────────────────┘
```

## 8. Permission Model Updates

```typescript
interface Permission {
  role: Role
  guests: {
    view: boolean
    create: boolean
    edit: boolean
    addWarning: boolean
    blacklist: boolean
    viewDocuments: boolean
    verifyDocuments: boolean
  }
  housekeeping: {
    viewQueue: boolean
    updateStatus: boolean
    assignRooms: boolean
    reportIssues: boolean
    viewAllRooms: boolean
  }
  documents: {
    view: boolean
    upload: boolean
    verify: boolean
    delete: boolean
  }
}

const rolePermissions: Record<Role, Permission> = {
  admin: { /* all true */ },
  manager: { /* most true, no delete docs */ },
  frontDesk: { /* view/edit guests, no blacklist */ },
  housekeeping: { /* HK only, limited guest view */ },
  cashier: { /* limited */ },
}
```

## 9. Key Services

```typescript
// Guest service
guestService.create(data): Promise<Guest>
guestService.findDuplicates(input): Promise<Guest[]>
guestService.addWarning(guestId, warning): Promise<void>
guestService.toggleBlacklist(guestId, reason): Promise<void>
guestService.getStayHistory(guestId): Promise<Reservation[]>

// Housekeeping service
housekeepingService.getQueue(date): Promise<HKQueueItem[]>
housekeepingService.updateStatus(roomId, status, userId): Promise<Room>
housekeepingService.assignRoom(roomId, staffId): Promise<void>
housekeepingService.reportIssue(roomId, issue): Promise<Issue>
housekeepingService.getTurnoverPressure(date): Promise<TurnoverReport>

// Document service
documentService.upload(guestId, file, type): Promise<GuestDocument>
documentService.verify(docId, userId): Promise<void>
documentService.requestDocuments(reservationId): Promise<void>

// Pre-check-in service
preCheckInService.generateLink(reservationId): Promise<string>
preCheckInService.submitForm(formId, data): Promise<void>
preCheckInService.getPendingReviews(): Promise<PreCheckInForm[]>
preCheckInService.approve(formId, userId): Promise<void>
```

## 10. Mobile Housekeeping Strategy

**Constraints:**
- Must work on 5" phone screens
- Touch targets minimum 44×44px
- Works in poor WiFi (queue caches locally)
- Photo uploads queue when offline
- Status updates sync when connected

**Optimizations:**
- Today/tomorrow only (no full calendar)
- Simplified room cards (number + status)
- Swipe actions (swipe right = mark clean)
- Voice notes for issues
- Camera for damage photos
- Push notifications for urgent assignments

**Layout:**
- Bottom navigation: Queue | My Rooms | Issues
- Sticky header: Date + unread count
- Pull to refresh
- Infinite scroll for completed items

## Summary

**Guest Module:** Complete profile system with stay history, documents, warnings, blacklist, duplicate detection, lightweight operational notes.

**Housekeeping Module:** Mobile-first, priority queue, today-focused, fast status updates, maintenance issue tracking, same-day turnover pressure visibility.

**Documents:** Guest document collection, pre-check-in forms, ID verification workflow, staff review dashboard.

**Practical:** No bloat, operational focus, mobile-optimized, permission-aware, real-time ready.
