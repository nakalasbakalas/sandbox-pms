# Sandbox Hotel PMS — Board & Front Desk Operations

## 1. Board Requirements

### Visual Layout (30 Rooms, One Screen)

**Grid: 5 columns × 6 rows**
- Card size: 180×120px (comfortable), 160×100px (compact)
- Floor grouping: Twin (201-215), Double (301-315)
- Right panel: 320px activity sidebar
- Default view: 7 days
- Toggle views: 14-day, 30-day (horizontal scroll)

### Board Data Structure

```typescript
interface BoardState {
  rooms: RoomCard[]
  arrivals: Arrival[]
  departures: Departure[]
  stats: DailyStats
  filters: BoardFilters
}

interface RoomCard {
  roomId: string
  number: string
  floor: number
  type: 'TWIN' | 'DOUBLE'
  status: RoomStatus
  operationalStatus: 'AVAILABLE' | 'OUT_OF_SERVICE' | 'BLOCKED'
  
  // Current occupancy
  guestName?: string
  reservationId?: string
  checkIn?: Date
  checkOut?: Date
  nightsRemaining?: number
  guestCount?: number
  
  // Flags
  isArrivalToday: boolean
  isDepartureToday: boolean
  isVIP: boolean
  hasIssue: boolean
  needsAttention: boolean
  
  // Housekeeping
  cleanStatus: 'CLEAN' | 'DIRTY' | 'INSPECTED'
  lastCleaned?: Date
  
  // Payment
  depositStatus: 'PAID' | 'PENDING' | 'NONE'
  balanceDue?: number
}
```

### Color Coding

```typescript
const statusColors = {
  // Occupancy
  OCCUPIED: 'bg-blue-500',
  VACANT_CLEAN: 'bg-emerald-500',
  VACANT_DIRTY: 'bg-amber-500',
  RESERVED: 'bg-purple-400',
  
  // Operational
  OUT_OF_SERVICE: 'bg-gray-400',
  BLOCKED: 'bg-gray-500',
  
  // Overlays (borders/badges)
  ARRIVAL_TODAY: 'border-l-4 border-l-green-600',
  DEPARTURE_TODAY: 'border-l-4 border-l-red-600',
  VIP: 'ring-2 ring-yellow-400',
  ISSUE: 'ring-2 ring-red-500',
  DEPOSIT_PENDING: 'border-t-2 border-t-orange-500',
}
```

### Fast Filters

```typescript
interface BoardFilters {
  view: '7day' | '14day' | '30day'
  show: {
    arrivals: boolean      // Today's arrivals
    departures: boolean    // Today's departures
    inHouse: boolean       // Currently occupied
    vacant: boolean        // All vacant rooms
    dirty: boolean         // Needs housekeeping
    maintenance: boolean   // Out of service
    vip: boolean          // VIP guests only
    issues: boolean       // Flagged rooms
    depositPending: boolean
  }
  roomNumbers: string[]    // Specific rooms
  guestName?: string       // Search filter
}
```

### Keyboard Shortcuts

```
Cmd+K       Global search
Cmd+N       New reservation
Cmd+I       Check-in modal
Cmd+O       Checkout modal
C           Mark selected room clean
D           Mark selected room dirty
I           Check-in to selected room
O           Checkout from selected room
F           Toggle filters
1-9         Jump to filter preset
Arrows      Navigate room grid
Enter       Open room detail
Esc         Close panel/modal
```

---

## 2. Board Interactions

### Room Card Click → Side Panel

```typescript
interface RoomDetailPanel {
  room: RoomCard
  tabs: ['Overview', 'Reservation', 'Guest', 'Folio', 'History']
  quickActions: Action[]
}

const quickActions = [
  { label: 'Check In', visible: room.isArrivalToday && !room.guestName },
  { label: 'Check Out', visible: room.status === 'OCCUPIED' },
  { label: 'Mark Clean', visible: room.cleanStatus === 'DIRTY' },
  { label: 'Move Guest', visible: room.status === 'OCCUPIED' },
  { label: 'Extend Stay', visible: room.status === 'OCCUPIED' },
  { label: 'Add Charge', visible: room.status === 'OCCUPIED' },
  { label: 'Take Out of Service', visible: room.operationalStatus === 'AVAILABLE' },
]
```

### Drag & Drop Room Moves

```typescript
const onRoomDragStart = (roomId: string) => {
  setDraggingRoom(roomId)
  // Highlight valid drop targets (vacant clean rooms)
}

const onRoomDrop = (targetRoomId: string) => {
  const sourceRoom = rooms.find(r => r.id === draggingRoom)
  
  // Validate target
  if (targetRoom.status !== 'VACANT_CLEAN') {
    toast.error('Target room must be clean')
    return
  }
  
  // Execute move
  await moveReservation({
    reservationId: sourceRoom.reservationId,
    fromRoomId: sourceRoom.id,
    toRoomId: targetRoomId,
  })
  
  toast.success(`Moved ${sourceRoom.guestName} to room ${targetRoom.number}`)
}
```

### Drag to Extend/Shorten Stay

```typescript
// Timeline view (7/14/30 day)
const onStayDragEnd = (reservationId: string, newCheckOut: Date) => {
  const reservation = getReservation(reservationId)
  const nightsChanged = differenceInDays(newCheckOut, reservation.checkOut)
  
  if (nightsChanged > 0) {
    // Extension - check availability
    const available = await checkAvailability({
      roomId: reservation.roomId,
      checkIn: reservation.checkOut,
      checkOut: newCheckOut,
    })
    
    if (!available) {
      toast.error('Room not available for extension')
      return
    }
  }
  
  await extendStay({ reservationId, newCheckOut })
  toast.success(`Stay ${nightsChanged > 0 ? 'extended' : 'shortened'} by ${Math.abs(nightsChanged)} nights`)
}
```

### Hover Preview

```typescript
const RoomCardHover = () => (
  <Popover>
    <PopoverTrigger>
      <RoomCard {...room} />
    </PopoverTrigger>
    <PopoverContent className="w-80" side="top">
      <div className="space-y-2 text-sm">
        <div className="font-semibold">{room.guestName}</div>
        <div className="text-muted-foreground">
          {format(room.checkIn, 'MMM dd')} → {format(room.checkOut, 'MMM dd')}
        </div>
        <div className="flex gap-4">
          <span>{room.guestCount} guests</span>
          <span>Balance: ฿{room.balanceDue}</span>
        </div>
        {room.notes && <div className="text-xs italic">{room.notes}</div>}
      </div>
    </PopoverContent>
  </Popover>
)
```

---

## 3. Front Desk Workspace

### Layout Structure

```
┌─────────────────────────────────────────────────────┐
│ FRONT DESK                                    [+New]│
├──────────────────┬──────────────────┬───────────────┤
│ ARRIVALS (5)     │ DEPARTURES (3)   │ IN-HOUSE (18) │
│                  │                  │               │
│ □ John Smith     │ □ Jane Doe       │ 18 occupied   │
│   Room: 305      │   Room: 212      │ 4 dirty       │
│   ETA: 14:00     │   Balance: ฿0    │ 2 VIP         │
│   [Check In]     │   [Check Out]    │ 1 issue       │
│                  │                  │               │
│ □ Mary Johnson   │ □ Bob Wilson     │ [View Board]  │
│   Unassigned     │   Room: 310      │               │
│   Walk-in        │   Due: ฿500      │               │
│   [Assign]       │   [Settle]       │               │
├──────────────────┴──────────────────┴───────────────┤
│ ISSUES & PENDING                                     │
│                                                      │
│ ⚠ Room 305 - AC not working                         │
│ ⏱ Room 212 - Late checkout requested (13:00)       │
│ 💰 3 deposits pending                                │
│ 🚫 2 no-show candidates (>6pm)                       │
└──────────────────────────────────────────────────────┘
```

### Quick Actions Toolbar

```typescript
const frontDeskActions = [
  { icon: Plus, label: 'New Reservation', shortcut: 'Cmd+N' },
  { icon: SignIn, label: 'Walk-in Check-in', shortcut: 'Cmd+W' },
  { icon: Search, label: 'Find Guest', shortcut: 'Cmd+F' },
  { icon: ArrowsLeftRight, label: 'Room Move', shortcut: 'Cmd+M' },
  { icon: Clock, label: 'Extend Stay', shortcut: 'Cmd+E' },
  { icon: CurrencyDollar, label: 'Post Charge', shortcut: 'Cmd+P' },
]
```

---

## 4. Check-In Flow

```typescript
interface CheckInFlow {
  steps: [
    'verify-reservation',
    'verify-room',
    'verify-payment',
    'update-guest',
    'confirm-assignment',
    'complete',
  ]
}

// Step 1: Verify Reservation
const VerifyReservation = () => {
  const reservation = useReservation(reservationId)
  
  return (
    <div>
      <h3>Verify Booking Details</h3>
      <dl>
        <dt>Guest</dt>
        <dd>{reservation.guest.name}</dd>
        <dt>Room Type</dt>
        <dd>{reservation.roomType}</dd>
        <dt>Dates</dt>
        <dd>{formatDateRange(reservation.checkIn, reservation.checkOut)}</dd>
        <dt>Guests</dt>
        <dd>{reservation.adults} adults, {reservation.children} children</dd>
        <dt>Rate</dt>
        <dd>฿{reservation.ratePerNight}/night</dd>
      </dl>
      
      {reservation.checkIn > today && (
        <Alert variant="warning">Early check-in (scheduled for {format(reservation.checkIn, 'MMM dd')})</Alert>
      )}
      
      <Button onClick={nextStep}>Confirm Details</Button>
    </div>
  )
}

// Step 2: Verify Room Readiness
const VerifyRoom = () => {
  const room = useRoom(selectedRoomId)
  
  return (
    <div>
      <h3>Room Assignment</h3>
      <RoomSelector
        roomType={reservation.roomType}
        filter={(room) => room.status === 'VACANT_CLEAN'}
        selected={selectedRoomId}
        onChange={setSelectedRoomId}
      />
      
      {room.status === 'VACANT_DIRTY' && (
        <Alert variant="warning">
          Room is not clean. Override?
          <Checkbox onChange={setAllowDirtyOverride} /> Manager approval
        </Alert>
      )}
      
      <Button onClick={nextStep} disabled={!selectedRoomId}>Confirm Room</Button>
    </div>
  )
}

// Step 3: Verify Payment
const VerifyPayment = () => {
  const folio = useFolio(reservation.id)
  
  return (
    <div>
      <h3>Payment Status</h3>
      <dl>
        <dt>Total Amount</dt>
        <dd>฿{folio.total}</dd>
        <dt>Paid</dt>
        <dd>฿{folio.paid}</dd>
        <dt>Balance Due</dt>
        <dd className={folio.balance > 0 ? 'text-red-600 font-bold' : ''}>
          ฿{folio.balance}
        </dd>
      </dl>
      
      {folio.balance > 0 && (
        <div>
          <Label>Collect Payment</Label>
          <PaymentForm onSubmit={recordPayment} />
          <Checkbox {...register('allowUnpaid')} />
          <Label>Allow check-in with balance (Manager approval)</Label>
        </div>
      )}
      
      <Button onClick={nextStep}>Continue</Button>
    </div>
  )
}

// Step 4: Update Guest Details
const UpdateGuest = () => (
  <div>
    <h3>Guest Information</h3>
    <GuestForm
      defaultValues={reservation.guest}
      fields={['firstName', 'lastName', 'email', 'phone', 'nationality', 'idNumber']}
      onSubmit={updateGuest}
    />
    <Button onClick={nextStep}>Continue</Button>
  </div>
)

// Step 5: Confirm
const ConfirmCheckIn = () => (
  <div>
    <h3>Ready to Check In</h3>
    <div className="bg-muted p-4 rounded">
      <p className="font-semibold">{guest.name} → Room {room.number}</p>
      <p>{formatDateRange(checkIn, checkOut)} ({nights} nights)</p>
      <p>Balance: ฿{folio.balance}</p>
    </div>
    
    <Textarea placeholder="Check-in notes (optional)" {...register('notes')} />
    
    <Button onClick={completeCheckIn} size="lg">Complete Check-In</Button>
  </div>
)

// Complete Action
const completeCheckIn = async () => {
  await checkIn({
    reservationId,
    roomId: selectedRoomId,
    notes: form.notes,
    actualCheckIn: new Date(),
  })
  
  // Update board state optimistically
  updateRoomStatus(selectedRoomId, 'OCCUPIED')
  
  toast.success(`${guest.name} checked in to room ${room.number}`)
  
  // Print key card / receipt
  if (settings.autoPrint) {
    printKeyCard({ guest, room, checkOut })
  }
  
  onClose()
}
```

---

## 5. Check-Out Flow

```typescript
// Step 1: Open Folio
const FolioReview = () => {
  const folio = useFolio(reservationId)
  
  return (
    <div>
      <h3>Folio Review - Room {room.number}</h3>
      
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {folio.charges.map(charge => (
            <TableRow key={charge.id}>
              <TableCell>{format(charge.date, 'MMM dd')}</TableCell>
              <TableCell>{charge.description}</TableCell>
              <TableCell className="text-right">฿{charge.amount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      
      <div className="space-y-1 text-right font-mono">
        <div>Subtotal: ฿{folio.subtotal}</div>
        <div>Tax: ฿{folio.tax}</div>
        <div className="text-lg font-bold">Total: ฿{folio.total}</div>
        <div className="text-green-600">Paid: ฿{folio.paid}</div>
        <div className={cn("text-xl font-bold", folio.balance > 0 && "text-red-600")}>
          Balance: ฿{folio.balance}
        </div>
      </div>
      
      <div className="flex gap-2">
        <Button variant="outline" onClick={addCharge}>+ Add Charge</Button>
        <Button onClick={nextStep}>Continue to Payment</Button>
      </div>
    </div>
  )
}

// Step 2: Collect Balance
const CollectPayment = () => (
  <div>
    <h3>Collect Payment</h3>
    
    {folio.balance > 0 && (
      <PaymentForm
        amount={folio.balance}
        onSubmit={processPayment}
      />
    )}
    
    {folio.balance === 0 && (
      <Alert variant="success">Folio fully settled</Alert>
    )}
    
    <Button onClick={nextStep}>Complete Checkout</Button>
  </div>
)

// Step 3: Complete
const completeCheckOut = async () => {
  if (folio.balance > 0 && !allowUnpaid) {
    toast.error('Balance must be settled')
    return
  }
  
  await checkOut({
    reservationId,
    actualCheckOut: new Date(),
    finalCharges: pendingCharges,
    notes: form.notes,
  })
  
  // Update room status
  await updateRoomStatus(room.id, 'VACANT_DIRTY')
  
  // Generate receipt
  const receipt = await generateReceipt(reservationId)
  
  if (settings.autoPrint) {
    printReceipt(receipt)
  }
  
  if (guest.email && settings.autoEmail) {
    emailReceipt({ email: guest.email, receipt })
  }
  
  toast.success(`${guest.name} checked out from room ${room.number}`)
  onClose()
}
```

---

## 6. Walk-In Flow

```typescript
const WalkInFlow = () => {
  const [step, setStep] = useState<'availability' | 'guest' | 'payment' | 'complete'>('availability')
  
  // Step 1: Check Availability
  const CheckAvailability = () => (
    <div>
      <h3>Walk-In Booking</h3>
      <DateRangePicker
        value={{ checkIn, checkOut }}
        onChange={setDates}
        minDate={today}
      />
      
      <Select value={roomType} onChange={setRoomType}>
        <option value="TWIN">Twin Room</option>
        <option value="DOUBLE">Double Room</option>
      </Select>
      
      <Input type="number" label="Adults" {...register('adults')} />
      <Input type="number" label="Children" {...register('children')} />
      
      {availability.length > 0 ? (
        <Alert variant="success">
          {availability.length} rooms available
        </Alert>
      ) : (
        <Alert variant="destructive">No availability</Alert>
      )}
      
      <Button onClick={() => setStep('guest')} disabled={!availability.length}>
        Continue
      </Button>
    </div>
  )
  
  // Step 2: Guest Details
  const GuestDetails = () => (
    <div>
      <h3>Guest Information</h3>
      <GuestForm onSubmit={createGuest} />
      <Button onClick={() => setStep('payment')}>Continue</Button>
    </div>
  )
  
  // Step 3: Payment
  const Payment = () => (
    <div>
      <h3>Payment</h3>
      <div className="text-lg">Total: ฿{calculatedTotal}</div>
      <PaymentForm onSubmit={processPayment} />
      <Button onClick={completeWalkIn}>Complete Booking & Check In</Button>
    </div>
  )
  
  const completeWalkIn = async () => {
    // 1. Create reservation
    const reservation = await createReservation({...})
    
    // 2. Assign room
    const room = availability[0]
    
    // 3. Check in immediately
    await checkIn({ reservationId: reservation.id, roomId: room.id })
    
    toast.success(`Walk-in complete - Room ${room.number}`)
  }
}
```

---

## 7. Quick Operations

### Room Assignment (Unassigned Reservations)

```typescript
const QuickRoomAssignment = ({ reservationId }) => {
  const availableRooms = useAvailableRooms(reservation.roomType, reservation.checkIn)
  
  return (
    <Select onChange={(roomId) => assignRoom(reservationId, roomId)}>
      <option value="">Select room...</option>
      {availableRooms.map(room => (
        <option key={room.id} value={room.id}>
          Room {room.number} {room.status === 'VACANT_DIRTY' && '(needs cleaning)'}
        </option>
      ))}
    </Select>
  )
}
```

### Quick Stay Modification

```typescript
const QuickExtend = ({ reservationId }) => {
  const [nights, setNights] = useState(1)
  
  const extend = async () => {
    await extendStay({
      reservationId,
      additionalNights: nights,
    })
    toast.success(`Extended by ${nights} nights`)
  }
  
  return (
    <div className="flex gap-2">
      <Input
        type="number"
        min="1"
        value={nights}
        onChange={(e) => setNights(Number(e.target.value))}
        className="w-20"
      />
      <Button onClick={extend}>Extend Stay</Button>
    </div>
  )
}
```

### Quick Charge Posting

```typescript
const QuickCharge = ({ reservationId }) => {
  const presets = [
    { label: 'Minibar', amount: 100 },
    { label: 'Laundry', amount: 150 },
    { label: 'Extra Towel', amount: 50 },
  ]
  
  const postCharge = async (description: string, amount: number) => {
    await addCharge({
      reservationId,
      description,
      amount,
      category: 'OTHER',
    })
    toast.success(`Charged ฿${amount}`)
  }
  
  return (
    <div className="flex gap-2">
      {presets.map(preset => (
        <Button
          key={preset.label}
          variant="outline"
          size="sm"
          onClick={() => postCharge(preset.label, preset.amount)}
        >
          {preset.label} (฿{preset.amount})
        </Button>
      ))}
    </div>
  )
}
```

---

## 8. Backend Services Required

```typescript
// Board service
boardService.getState(propertyId, date): BoardState
boardService.subscribeToUpdates(callback): UnsubscribeFn

// Room service
roomService.updateStatus(roomId, status, userId): Promise<Room>
roomService.moveGuest(reservationId, toRoomId): Promise<void>

// Reservation service
reservationService.checkIn(data): Promise<Reservation>
reservationService.checkOut(data): Promise<Reservation>
reservationService.extendStay(reservationId, newCheckOut): Promise<Reservation>
reservationService.assignRoom(reservationId, roomId): Promise<Reservation>

// Folio service
folioService.addCharge(reservationId, charge): Promise<Folio>
folioService.recordPayment(reservationId, payment): Promise<Folio>
folioService.generateReceipt(reservationId): Promise<Receipt>
```

---

## 9. Acceptance Criteria

### Board
- [ ] All 30 rooms visible on 1920×1080 screen without scrolling (compact mode)
- [ ] Room status updates appear within 1 second across all connected clients
- [ ] Drag-drop room move completes in <2 seconds
- [ ] Hover preview appears within 100ms
- [ ] Keyboard shortcuts work for all primary actions
- [ ] Filters apply instantly (<100ms)
- [ ] Color coding is instantly recognizable (tested with 5 staff members)

### Front Desk
- [ ] Check-in completes in <45 seconds (average across 10 test runs)
- [ ] Check-out completes in <60 seconds (including payment)
- [ ] Walk-in booking to check-in <90 seconds
- [ ] Today's arrivals/departures always visible without scrolling
- [ ] Issue queue updates in real-time
- [ ] Quick actions accessible with max 2 clicks

### Reliability
- [ ] Zero double-booking in 100 concurrent check-in attempts
- [ ] Optimistic updates rollback correctly on server error
- [ ] Works offline (board displays cached state, queues mutations)
- [ ] Print operations don't block UI
- [ ] No data loss on browser crash (all writes persisted immediately)
