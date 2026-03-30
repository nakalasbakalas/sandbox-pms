# Sandbox Hotel PMS — Data Model & Business Logic

## Core Principles

1. **Room × Date inventory is the source of truth**
2. **Zero double-booking through database constraints**
3. **All mutations are transaction-safe**
4. **Built-in auditability for every state change**
5. **Modular domain structure**

---

## 1. Core Data Model

### Properties
```prisma
model Property {
  id              String   @id @default(cuid())
  code            String   @unique
  name            String
  timezone        String   @default("Asia/Bangkok")
  defaultCheckIn  String   @default("14:00")
  defaultCheckOut String   @default("11:00")
  currency        String   @default("THB")
  rooms           Room[]
  roomTypes       RoomType[]
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

### Room Types
```prisma
model RoomType {
  id              String   @id @default(cuid())
  propertyId      String
  property        Property @relation(fields: [propertyId], references: [id])
  code            String
  name            String
  baseRate        Float
  maxOccupancy    Int
  standardOcc     Int
  rooms           Room[]
  
  @@unique([propertyId, code])
}
```

### Rooms
```prisma
model Room {
  id                  String        @id @default(cuid())
  propertyId          String
  property            Property      @relation(fields: [propertyId], references: [id])
  roomTypeId          String
  roomType            RoomType      @relation(fields: [roomTypeId], references: [id])
  number              String
  floor               Int
  operationalStatus   RoomOpStatus  @default(AVAILABLE)
  currentStatus       RoomStatus    @default(VACANT_CLEAN)
  currentReservation  String?       @unique
  blockedUntil        DateTime?
  notes               String?
  inventory           RoomDateInventory[]
  statusHistory       RoomStatusLog[]
  createdAt           DateTime      @default(now())
  updatedAt           DateTime      @updatedAt
  
  @@unique([propertyId, number])
  @@index([operationalStatus, currentStatus])
}

enum RoomOpStatus {
  AVAILABLE
  OUT_OF_SERVICE
  BLOCKED
}

enum RoomStatus {
  VACANT_CLEAN
  VACANT_DIRTY
  OCCUPIED
  OCCUPIED_DIRTY
}
```

---

## 2. Reservation Model

```prisma
model Reservation {
  id              String            @id @default(cuid())
  confirmationCode String           @unique @default(cuid())
  propertyId      String
  guestId         String
  guest           Guest             @relation(fields: [guestId], references: [id])
  roomTypeId      String
  assignedRoomId  String?
  assignedRoom    Room?
  
  checkIn         DateTime
  checkOut        DateTime
  actualCheckIn   DateTime?
  actualCheckOut  DateTime?
  
  status          ReservationStatus @default(CONFIRMED)
  
  adults          Int
  children        Int               @default(0)
  childAges       Int[]
  
  ratePerNight    Float
  totalAmount     Float
  
  source          BookingSource     @default(DIRECT)
  notes           String?
  
  inventory       RoomDateInventory[]
  folio           Folio?
  history         ReservationLog[]
  
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt
  
  @@index([propertyId, checkIn, checkOut])
  @@index([status, checkIn])
}

enum ReservationStatus {
  CONFIRMED
  CHECKED_IN
  CHECKED_OUT
  CANCELLED
  NO_SHOW
}

enum BookingSource {
  DIRECT
  WALK_IN
  PHONE
  BOOKING_COM
  AGODA
  EXPEDIA
}
```

---

## 3. Room × Date Inventory (Source of Truth)

```prisma
model RoomDateInventory {
  id              String        @id @default(cuid())
  propertyId      String
  roomId          String
  room            Room          @relation(fields: [roomId], references: [id])
  date            DateTime      @db.Date
  
  reservationId   String?
  reservation     Reservation?  @relation(fields: [reservationId], references: [id])
  
  status          InventoryStatus @default(AVAILABLE)
  holdId          String?
  hold            InventoryHold?  @relation(fields: [holdId], references: [id])
  
  rate            Float?
  notes           String?
  
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  
  @@unique([roomId, date])
  @@index([propertyId, date, status])
  @@index([reservationId, date])
}

enum InventoryStatus {
  AVAILABLE
  RESERVED
  HELD
  BLOCKED
  OUT_OF_SERVICE
}
```

**Key Constraint:** `@@unique([roomId, date])` prevents double-booking at database level.

---

## 4. Booking Holds (Temporary Locks)

```prisma
model InventoryHold {
  id          String              @id @default(cuid())
  propertyId  String
  roomTypeId  String
  checkIn     DateTime
  checkOut    DateTime
  expiresAt   DateTime
  status      HoldStatus          @default(ACTIVE)
  createdBy   String
  notes       String?
  inventory   RoomDateInventory[]
  createdAt   DateTime            @default(now())
  
  @@index([expiresAt, status])
}

enum HoldStatus {
  ACTIVE
  CONVERTED
  EXPIRED
  RELEASED
}
```

**Hold Lifecycle:**
1. `ACTIVE` → Created, locks inventory
2. `CONVERTED` → Turned into reservation
3. `EXPIRED` → Auto-released after timeout
4. `RELEASED` → Manually released

---

## 5. Guests

```prisma
model Guest {
  id              String        @id @default(cuid())
  firstName       String
  lastName        String
  email           String?
  phone           String?
  nationality     String?
  idType          String?
  idNumber        String?
  vipStatus       Boolean       @default(false)
  preferences     Json?
  notes           String?
  reservations    Reservation[]
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  
  @@index([email, phone])
  @@index([lastName, firstName])
}
```

---

## 6. Financials

```prisma
model Folio {
  id              String        @id @default(cuid())
  reservationId   String        @unique
  reservation     Reservation   @relation(fields: [reservationId], references: [id])
  
  subtotal        Float
  tax             Float
  total           Float
  paid            Float         @default(0)
  balance         Float
  
  status          FolioStatus   @default(OPEN)
  
  charges         Charge[]
  payments        Payment[]
  
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
}

model Charge {
  id          String      @id @default(cuid())
  folioId     String
  folio       Folio       @relation(fields: [folioId], references: [id])
  date        DateTime    @db.Date
  description String
  category    ChargeCategory
  amount      Float
  quantity    Int         @default(1)
  createdBy   String
  createdAt   DateTime    @default(now())
}

model Payment {
  id          String        @id @default(cuid())
  folioId     String
  folio       Folio         @relation(fields: [folioId], references: [id])
  amount      Float
  method      PaymentMethod
  reference   String?
  processedBy String
  createdAt   DateTime      @default(now())
}

enum FolioStatus {
  OPEN
  CLOSED
  REFUNDED
}

enum ChargeCategory {
  ROOM
  EXTRA_GUEST
  CHILD
  CAFE
  MINIBAR
  LAUNDRY
  OTHER
}

enum PaymentMethod {
  CASH
  CARD
  BANK_TRANSFER
  ONLINE
}
```

---

## 7. Audit Logs

```prisma
model ReservationLog {
  id              String          @id @default(cuid())
  reservationId   String
  reservation     Reservation     @relation(fields: [reservationId], references: [id])
  action          ReservationAction
  fromStatus      ReservationStatus?
  toStatus        ReservationStatus?
  changes         Json?
  performedBy     String
  notes           String?
  createdAt       DateTime        @default(now())
  
  @@index([reservationId, createdAt])
}

enum ReservationAction {
  CREATED
  MODIFIED
  ASSIGNED_ROOM
  CHECKED_IN
  CHECKED_OUT
  CANCELLED
  NO_SHOW
  RATE_ADJUSTED
  MOVED_ROOM
}

model RoomStatusLog {
  id          String      @id @default(cuid())
  roomId      String
  room        Room        @relation(fields: [roomId], references: [id])
  fromStatus  RoomStatus?
  toStatus    RoomStatus
  changedBy   String
  notes       String?
  createdAt   DateTime    @default(now())
  
  @@index([roomId, createdAt])
}
```

---

## 8. Business Rules

### Reservation Lifecycle

```
CONFIRMED → CHECKED_IN → CHECKED_OUT
    ↓           ↓
CANCELLED   NO_SHOW
```

**State Transitions:**
- `CONFIRMED` → `CHECKED_IN`: Room must be VACANT_CLEAN, inventory already allocated
- `CHECKED_IN` → `CHECKED_OUT`: Payment must be settled (or balance recorded)
- `CONFIRMED` → `CANCELLED`: Inventory released back to AVAILABLE
- `CONFIRMED` → `NO_SHOW`: Day after check-in date, inventory released

### Room Operational States

**AVAILABLE:**
- Can be sold
- Appears in availability queries
- Can accept reservations

**OUT_OF_SERVICE:**
- Cannot be sold
- Hidden from availability
- Existing reservations honored
- Inventory marked OUT_OF_SERVICE

**BLOCKED:**
- Temporarily unavailable
- Has `blockedUntil` date
- Auto-returns to AVAILABLE after date
- Used for maintenance, owner use

### Room Availability States

**VACANT_CLEAN:**
- Ready for check-in
- Guest can be assigned immediately

**VACANT_DIRTY:**
- Needs housekeeping
- Warning if assigned
- Can override with manager approval

**OCCUPIED:**
- Guest currently in room
- Cannot check in another guest
- Can perform checkout

**OCCUPIED_DIRTY:**
- Stayover needs cleaning
- Housekeeping priority queue

---

## 9. Inventory Mutation Rules

### Rule 1: No Double-Booking
**Database Constraint:** `@@unique([roomId, date])` on `RoomDateInventory`

**Application Logic:**
```typescript
async function checkAvailability(
  roomTypeId: string,
  checkIn: Date,
  checkOut: Date
): Promise<Room[]> {
  const dates = eachDayOfInterval({ start: checkIn, end: subDays(checkOut, 1) })
  
  const availableRooms = await prisma.room.findMany({
    where: {
      roomTypeId,
      operationalStatus: 'AVAILABLE',
      inventory: {
        none: {
          date: { in: dates },
          status: { in: ['RESERVED', 'HELD', 'BLOCKED'] }
        }
      }
    }
  })
  
  return availableRooms
}
```

### Rule 2: Transaction-Safe Allocation

```typescript
async function createReservation(input: CreateReservationInput) {
  return prisma.$transaction(async (tx) => {
    // 1. Check availability
    const available = await checkAvailability(...)
    if (available.length === 0) throw new Error('No availability')
    
    // 2. Create reservation
    const reservation = await tx.reservation.create({ data: {...} })
    
    // 3. Allocate inventory (atomic)
    const dates = eachDayOfInterval({ start: checkIn, end: subDays(checkOut, 1) })
    await tx.roomDateInventory.createMany({
      data: dates.map(date => ({
        roomId: available[0].id,
        date,
        reservationId: reservation.id,
        status: 'RESERVED',
        rate: input.ratePerNight
      }))
    })
    
    // 4. Create folio
    const folio = await tx.folio.create({ ... })
    
    // 5. Log action
    await tx.reservationLog.create({
      data: {
        reservationId: reservation.id,
        action: 'CREATED',
        toStatus: 'CONFIRMED',
        performedBy: userId
      }
    })
    
    return { reservation, folio }
  })
}
```

### Rule 3: Room Move/Date Change

```typescript
async function moveReservation(
  reservationId: string,
  newRoomId: string,
  newCheckIn?: Date,
  newCheckOut?: Date
) {
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({ ... })
    
    // 1. Release old inventory
    await tx.roomDateInventory.deleteMany({
      where: { reservationId }
    })
    
    // 2. Check new availability
    const checkIn = newCheckIn || reservation.checkIn
    const checkOut = newCheckOut || reservation.checkOut
    const available = await checkAvailability(newRoomId, checkIn, checkOut)
    if (!available) throw new Error('Target room unavailable')
    
    // 3. Allocate new inventory
    const dates = eachDayOfInterval({ start: checkIn, end: subDays(checkOut, 1) })
    await tx.roomDateInventory.createMany({ ... })
    
    // 4. Update reservation
    await tx.reservation.update({
      where: { id: reservationId },
      data: { assignedRoomId: newRoomId, checkIn, checkOut }
    })
    
    // 5. Log move
    await tx.reservationLog.create({
      data: { action: 'MOVED_ROOM', ... }
    })
  })
}
```

### Rule 4: Cancellation

```typescript
async function cancelReservation(reservationId: string) {
  return prisma.$transaction(async (tx) => {
    // 1. Update reservation status
    await tx.reservation.update({
      where: { id: reservationId },
      data: { status: 'CANCELLED' }
    })
    
    // 2. Release inventory
    await tx.roomDateInventory.updateMany({
      where: { reservationId },
      data: { status: 'AVAILABLE', reservationId: null }
    })
    
    // 3. Handle refund (mark folio)
    await tx.folio.update({
      where: { reservationId },
      data: { status: 'REFUNDED' }
    })
    
    // 4. Log cancellation
    await tx.reservationLog.create({ ... })
  })
}
```

---

## 10. Reservation Conflict Logic

### Conflict Types

1. **Same room, overlapping dates** → Database prevents via unique constraint
2. **Guest double-booked** → Application warning (allowed for group bookings)
3. **Overbooking room type** → Prevented by availability check
4. **Check-in to occupied room** → Status check before assignment

### Detection Query

```typescript
async function findConflicts(
  roomId: string,
  checkIn: Date,
  checkOut: Date,
  excludeReservationId?: string
): Promise<Reservation[]> {
  const dates = eachDayOfInterval({ start: checkIn, end: subDays(checkOut, 1) })
  
  return prisma.reservation.findMany({
    where: {
      id: { not: excludeReservationId },
      status: { in: ['CONFIRMED', 'CHECKED_IN'] },
      assignedRoomId: roomId,
      inventory: {
        some: {
          date: { in: dates },
          status: 'RESERVED'
        }
      }
    }
  })
}
```

---

## 11. Duplicate Detection

### Guest Deduplication

```typescript
async function findDuplicateGuests(input: GuestInput): Promise<Guest[]> {
  const emailMatch = input.email 
    ? await prisma.guest.findMany({ where: { email: input.email } })
    : []
  
  const phoneMatch = input.phone
    ? await prisma.guest.findMany({ where: { phone: input.phone } })
    : []
  
  const nameMatch = await prisma.guest.findMany({
    where: {
      firstName: { equals: input.firstName, mode: 'insensitive' },
      lastName: { equals: input.lastName, mode: 'insensitive' }
    }
  })
  
  return [...new Set([...emailMatch, ...phoneMatch, ...nameMatch])]
}
```

### Reservation Deduplication

```typescript
// Check for duplicate booking attempt
async function findPossibleDuplicate(
  guestId: string,
  checkIn: Date,
  checkOut: Date
): Promise<Reservation | null> {
  return prisma.reservation.findFirst({
    where: {
      guestId,
      checkIn: { gte: subDays(checkIn, 1), lte: addDays(checkIn, 1) },
      checkOut: { gte: subDays(checkOut, 1), lte: addDays(checkOut, 1) },
      status: { not: 'CANCELLED' },
      createdAt: { gte: subMinutes(new Date(), 10) }
    }
  })
}
```

---

## 12. Domain Structure (Modular)

```
src/domains/
├── property/
│   ├── property.schema.ts
│   ├── property.service.ts
│   └── property.types.ts
├── room/
│   ├── room.schema.ts
│   ├── room.service.ts
│   ├── availability.service.ts
│   └── room.types.ts
├── reservation/
│   ├── reservation.schema.ts
│   ├── reservation.service.ts
│   ├── pricing.service.ts
│   ├── lifecycle.service.ts
│   └── reservation.types.ts
├── inventory/
│   ├── inventory.schema.ts
│   ├── inventory.service.ts
│   ├── hold.service.ts
│   └── inventory.types.ts
├── guest/
│   ├── guest.schema.ts
│   ├── guest.service.ts
│   ├── deduplication.service.ts
│   └── guest.types.ts
├── folio/
│   ├── folio.schema.ts
│   ├── folio.service.ts
│   ├── charge.service.ts
│   ├── payment.service.ts
│   └── folio.types.ts
└── housekeeping/
    ├── housekeeping.schema.ts
    ├── housekeeping.service.ts
    └── housekeeping.types.ts
```

Each domain module contains:
- **Schema**: Zod validation schemas
- **Service**: Business logic and database operations
- **Types**: TypeScript interfaces

---

## 13. Audit Log Strategy

### What to Log

**Reservation Changes:**
- Creation, modification, cancellation
- Room assignments/moves
- Check-in/check-out
- Rate adjustments
- Status transitions

**Room Changes:**
- Status updates (clean/dirty)
- Operational status (OOS, blocked)
- Maintenance notes

**Financial Changes:**
- Charges added/removed
- Payments processed
- Refunds issued
- Rate overrides

### Log Structure

```typescript
interface AuditLog {
  id: string
  entityType: 'RESERVATION' | 'ROOM' | 'FOLIO'
  entityId: string
  action: string
  before: Json
  after: Json
  performedBy: string
  timestamp: DateTime
}
```

### Automatic Logging

Use Prisma middleware to auto-log changes:

```typescript
prisma.$use(async (params, next) => {
  if (params.action === 'update' && params.model === 'Reservation') {
    const before = await prisma.reservation.findUnique({ where: params.args.where })
    const result = await next(params)
    
    await prisma.reservationLog.create({
      data: {
        reservationId: params.args.where.id,
        action: 'MODIFIED',
        changes: { before, after: result },
        performedBy: getCurrentUserId()
      }
    })
    
    return result
  }
  
  return next(params)
})
```

---

## Summary

**Zero Double-Booking:** Unique constraint on `(roomId, date)` + transaction-safe allocation

**Inventory Control:** Room × Date model as single source of truth

**Concurrency Safety:** All mutations wrapped in Prisma transactions

**Auditability:** Every state change logged with user, timestamp, before/after

**Modularity:** Clear domain boundaries, easy to test and maintain

**Blackout Compatibility:** `OUT_OF_SERVICE` and `BLOCKED` operational statuses prevent selling

**Conflict Resolution:** Pre-flight availability checks + database constraints as final guard
