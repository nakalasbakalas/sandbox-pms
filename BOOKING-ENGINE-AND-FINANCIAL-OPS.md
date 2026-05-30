# Sandbox Hotel PMS — Booking Engine & Financial Operations

**Clean, Trustworthy, Friction-Light Architecture**

---

## Core Principles

1. **Public booking engine must be conversion-focused**
2. **Financial flows remain operationally simple**
3. **Everything is traceable and auditable**
4. **Payment and folio state stay consistent with reservation lifecycle**
5. **Inventory safety is paramount — no double-booking**
6. **Mobile-first booking experience**
7. **Zero unnecessary friction in guest flows**

---

## 1. Public Booking Engine Architecture

### Design Philosophy

**Simple. Stable. Mobile-Friendly. Conversion-Focused. Inventory-Safe.**

The booking engine is a **separate Next.js route group** under `app/(booking)/` with:
- Distinct visual identity (guest-facing, not operational UI)
- No authentication required
- Mobile-first responsive design
- Minimal steps to reservation
- Clear pricing and availability
- Trust signals (SSL, secure payment, cancellation policy)

### URL Structure

```
sandboxhotel.com/book              → Availability search
sandboxhotel.com/book/rooms         → Room type selection
sandboxhotel.com/book/details       → Guest details form
sandboxhotel.com/book/payment       → Payment (if enabled)
sandboxhotel.com/book/confirm       → Confirmation page
sandboxhotel.com/booking/[code]     → Booking management (view/modify/cancel)
```

### Tech Stack (Booking Engine Specific)

- **Server Components** for SEO and fast initial load
- **Progressive enhancement** for form submissions
- **Optimistic inventory checks** with server validation
- **Session-based hold system** (15-minute expiry)
- **Stripe Elements** or **Omise** for Thailand-friendly payments
- **Email confirmations** via Resend or SendGrid

---

## 2. Public Booking Flow

### Step 1: Availability Search

**URL:** `/book`

**Input:**
- Check-in date (date picker, min: today)
- Check-out date (date picker, min: check-in + 1 night)
- Room type (optional pre-filter)
- Guests (adults, children with ages)

**Server Action: `searchAvailability`**
- Query `RoomDateInventory` for date range
- Filter by `availableCount > 0`
- Calculate pricing (base rate × nights + extra guest fees)
- Return available room types with:
  - Name, description, max occupancy
  - Total price (tax-inclusive)
  - Photos
  - Amenities

**Output:**
- Available room types displayed as cards
- Price per night + total
- "Select" button → Step 2

**Validation:**
- Check-in ≥ today
- Check-out > check-in
- Date range ≤ 90 days
- No blackout dates in range

---

### Step 2: Room Type Selection

**URL:** `/book/rooms?checkIn=...&checkOut=...&adults=...&children=...`

**Display:**
- Room type cards (image, name, size, amenities, occupancy, price)
- Availability indicator ("3 rooms left" or "Limited availability")
- Clear CTA: "Book Now"

**Server Action: `selectRoomType`**
- Create temporary `BookingHold` record (15-minute expiry)
- Lock inventory (decrement `availableCount` in `RoomDateInventory`)
- Store hold in session + database
- Redirect to Step 3

**Inventory Safety:**
- Use PostgreSQL `SELECT FOR UPDATE` to prevent race conditions
- Hold expires after 15 minutes → auto-release inventory
- Cron job cleans expired holds every 5 minutes

---

### Step 3: Guest Details

**URL:** `/book/details?holdId=...`

**Form Fields:**
- First name (required)
- Last name (required)
- Email (required)
- Phone (required, Thailand format)
- Nationality (optional, dropdown)
- Special requests (textarea, optional)
- Arrival time (optional, time picker)
- Source attribution (hidden, captured from UTM params)

**Server Action: `submitGuestDetails`**
- Validate hold is still active
- Create or update `Guest` record (upsert by email)
- Store details in hold
- Redirect to Step 4 (payment) OR Step 5 (confirmation if manual-confirm mode)

**Validation:**
- Email format check
- Phone number format (Thailand mobile)
- Names not empty

---

### Step 4: Payment (Optional)

**URL:** `/book/payment?holdId=...`

**Display:**
- Booking summary (room, dates, guests, price)
- Payment options:
  - **Full payment** (recommended)
  - **Deposit only** (50% or fixed amount, configurable)
  - **Pay at hotel** (if enabled in settings)
- Stripe/Omise payment form
- Trust signals (SSL badge, cancellation policy link)

**Server Action: `processPayment`**
- Validate hold is still active
- Create Stripe/Omise payment intent
- On success:
  - Create `Reservation` (status: `CONFIRMED`)
  - Create `Folio` with payment entry
  - Release hold (convert to confirmed reservation)
  - Send confirmation email
  - Redirect to confirmation page

**Server Action: `skipPayment` (if manual-confirm mode)**
- Create `Reservation` (status: `PENDING_APPROVAL`)
- No payment required
- Staff must manually approve/assign in dashboard
- Send "booking request received" email

**Inventory Safety:**
- Hold prevents double-booking during payment
- If payment fails, hold remains active (14 minutes left)
- If hold expires during payment, show "session expired, please restart"

---

### Step 5: Confirmation Page

**URL:** `/book/confirm?code=[CONFIRMATION_CODE]`

**Display:**
- "Booking Confirmed!" message
- Confirmation code (large, bold)
- Booking details (room type, dates, guests, price)
- Payment status ("Paid" / "Deposit paid" / "Pay at hotel")
- Check-in instructions
- Hotel contact info
- Links:
  - View booking (`/booking/[code]`)
  - Modify booking
  - Cancel booking
  - Add to calendar (ics download)

**Email Confirmation:**
- Subject: "Booking Confirmed — Sandbox Hotel — [Confirmation Code]"
- Include all details above
- PDF receipt (if payment made)
- Link to booking management page

---

## 3. Booking Hold Architecture

### Purpose

**Prevent double-booking during guest checkout process** (typically 3–5 minutes, but allow up to 15 minutes for slow users).

### Data Model

```prisma
model BookingHold {
  id              String    @id @default(cuid())
  sessionId       String    @unique
  propertyId      String
  roomTypeId      String
  checkIn         DateTime
  checkOut        DateTime
  adults          Int
  children        Json      // [{age: 4}, {age: 9}]
  guestData       Json?     // Stores guest form data
  sourceAttribution Json?   // UTM params, referrer
  status          HoldStatus @default(ACTIVE)
  expiresAt       DateTime
  convertedToReservationId String? @unique
  createdAt       DateTime  @default(now())
  
  @@index([expiresAt, status])
  @@index([sessionId])
}

enum HoldStatus {
  ACTIVE
  CONVERTED
  EXPIRED
  CANCELLED
}
```

### Hold Lifecycle

```
1. User searches availability → No hold yet
2. User selects room type → Create ACTIVE hold (15-minute expiry)
   → Decrement RoomDateInventory.availableCount
3. User fills guest details → Update hold with guestData
4. User completes payment → Hold status = CONVERTED
   → Create Reservation
   → Inventory already decremented
5. Hold expires (15 minutes) → Hold status = EXPIRED
   → Increment RoomDateInventory.availableCount (release)
```

### Server Actions

**`createHold(roomTypeId, checkIn, checkOut, adults, children)`**
```typescript
async function createHold(data: HoldInput): Promise<Hold> {
  return await db.$transaction(async (tx) => {
    // 1. Check availability
    const inventory = await tx.roomDateInventory.findMany({
      where: {
        roomTypeId: data.roomTypeId,
        date: { gte: data.checkIn, lt: data.checkOut },
        availableCount: { gt: 0 }
      }
    });
    
    if (inventory.length !== dateDiff(data.checkIn, data.checkOut)) {
      throw new Error('Room type not available for selected dates');
    }
    
    // 2. Decrement inventory (lock for hold)
    await tx.roomDateInventory.updateMany({
      where: {
        roomTypeId: data.roomTypeId,
        date: { gte: data.checkIn, lt: data.checkOut }
      },
      data: {
        availableCount: { decrement: 1 }
      }
    });
    
    // 3. Create hold
    const hold = await tx.bookingHold.create({
      data: {
        sessionId: generateSessionId(),
        propertyId: data.propertyId,
        roomTypeId: data.roomTypeId,
        checkIn: data.checkIn,
        checkOut: data.checkOut,
        adults: data.adults,
        children: data.children,
        status: 'ACTIVE',
        expiresAt: addMinutes(new Date(), 15)
      }
    });
    
    return hold;
  });
}
```

**`releaseExpiredHolds()` (cron job, every 5 minutes)**
```typescript
async function releaseExpiredHolds() {
  const expiredHolds = await db.bookingHold.findMany({
    where: {
      status: 'ACTIVE',
      expiresAt: { lt: new Date() }
    }
  });
  
  for (const hold of expiredHolds) {
    await db.$transaction(async (tx) => {
      // 1. Increment inventory (release)
      await tx.roomDateInventory.updateMany({
        where: {
          roomTypeId: hold.roomTypeId,
          date: { gte: hold.checkIn, lt: hold.checkOut }
        },
        data: {
          availableCount: { increment: 1 }
        }
      });
      
      // 2. Mark hold as expired
      await tx.bookingHold.update({
        where: { id: hold.id },
        data: { status: 'EXPIRED' }
      });
    });
  }
}
```

---

## 4. Booking Confirmation Logic

### Auto-Confirm Mode (Default)

**When payment is received OR "pay at hotel" is selected:**

```typescript
async function confirmBooking(holdId: string, paymentData?: PaymentData) {
  return await db.$transaction(async (tx) => {
    const hold = await tx.bookingHold.findUnique({
      where: { id: holdId },
      include: { roomType: true }
    });
    
    if (!hold || hold.status !== 'ACTIVE') {
      throw new Error('Hold is no longer valid');
    }
    
    if (isAfter(new Date(), hold.expiresAt)) {
      throw new Error('Hold has expired');
    }
    
    // 1. Create guest
    const guest = await tx.guest.upsert({
      where: { email: hold.guestData.email },
      create: {
        firstName: hold.guestData.firstName,
        lastName: hold.guestData.lastName,
        email: hold.guestData.email,
        phone: hold.guestData.phone,
        nationality: hold.guestData.nationality
      },
      update: {
        phone: hold.guestData.phone
      }
    });
    
    // 2. Create reservation
    const reservation = await tx.reservation.create({
      data: {
        confirmationCode: generateConfirmationCode(),
        propertyId: hold.propertyId,
        guestId: guest.id,
        roomTypeId: hold.roomTypeId,
        checkIn: hold.checkIn,
        checkOut: hold.checkOut,
        adults: hold.adults,
        children: hold.children,
        status: 'CONFIRMED',
        source: hold.sourceAttribution?.source || 'DIRECT',
        specialRequests: hold.guestData.specialRequests,
        estimatedArrival: hold.guestData.arrivalTime
      }
    });
    
    // 3. Create folio
    const totalAmount = calculateTotalAmount(hold);
    const folio = await tx.folio.create({
      data: {
        reservationId: reservation.id,
        guestId: guest.id,
        status: 'OPEN'
      }
    });
    
    // 4. Post accommodation charge
    await tx.folioCharge.create({
      data: {
        folioId: folio.id,
        type: 'ACCOMMODATION',
        description: `${hold.roomType.name} - ${formatDateRange(hold.checkIn, hold.checkOut)}`,
        amount: totalAmount,
        quantity: 1,
        date: new Date()
      }
    });
    
    // 5. Post payment if provided
    if (paymentData) {
      await tx.folioPayment.create({
        data: {
          folioId: folio.id,
          method: paymentData.method,
          amount: paymentData.amount,
          reference: paymentData.transactionId,
          status: 'COMPLETED',
          processedAt: new Date()
        }
      });
    }
    
    // 6. Mark hold as converted
    await tx.bookingHold.update({
      where: { id: holdId },
      data: {
        status: 'CONVERTED',
        convertedToReservationId: reservation.id
      }
    });
    
    // 7. Audit log
    await tx.auditLog.create({
      data: {
        entityType: 'RESERVATION',
        entityId: reservation.id,
        action: 'CREATED',
        userId: 'SYSTEM',
        details: {
          source: 'BOOKING_ENGINE',
          holdId: holdId,
          paymentReceived: !!paymentData
        }
      }
    });
    
    // Note: Inventory already decremented when hold was created
    
    return { reservation, folio };
  });
}
```

### Manual-Confirm Mode

**When property settings have `requireManualApproval: true`:**

- Reservation created with status: `PENDING_APPROVAL`
- Staff receives notification in dashboard
- Staff reviews, assigns room, approves
- Only then does reservation become `CONFIRMED`
- Email sent to guest: "Your booking request is under review"
- Follow-up email when approved: "Your booking is confirmed"

---

## 5. Cancellation & Modification Workflows

### Guest-Initiated Cancellation

**URL:** `/booking/[code]/cancel`

**Flow:**
1. Guest enters confirmation code + email (verification)
2. System displays booking details
3. Guest confirms cancellation
4. Server action: `requestCancellation(confirmationCode, email, reason)`

**Server Action:**
```typescript
async function requestCancellation(code: string, email: string, reason?: string) {
  return await db.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({
      where: { confirmationCode: code },
      include: { guest: true, folio: true }
    });
    
    if (!reservation || reservation.guest.email !== email) {
      throw new Error('Booking not found');
    }
    
    if (reservation.status === 'CANCELLED') {
      throw new Error('Booking already cancelled');
    }
    
    if (reservation.status === 'CHECKED_IN' || reservation.status === 'CHECKED_OUT') {
      throw new Error('Cannot cancel active or completed bookings');
    }
    
    const daysUntilCheckIn = differenceInDays(reservation.checkIn, new Date());
    const cancellationPolicy = getCancellationPolicy(daysUntilCheckIn);
    
    // Update reservation
    await tx.reservation.update({
      where: { id: reservation.id },
      data: {
        status: 'CANCELLED',
        cancellationReason: reason,
        cancelledAt: new Date(),
        cancelledBy: 'GUEST'
      }
    });
    
    // Release inventory
    await tx.roomDateInventory.updateMany({
      where: {
        roomTypeId: reservation.roomTypeId,
        date: { gte: reservation.checkIn, lt: reservation.checkOut }
      },
      data: {
        availableCount: { increment: 1 }
      }
    });
    
    // Release assigned room if any
    if (reservation.assignedRoomId) {
      await tx.room.update({
        where: { id: reservation.assignedRoomId },
        data: { currentReservation: null }
      });
    }
    
    // Calculate refund
    const refundAmount = calculateRefund(reservation.folio, cancellationPolicy);
    
    if (refundAmount > 0) {
      // Create refund request (requires staff approval)
      await tx.refundRequest.create({
        data: {
          folioId: reservation.folio.id,
          amount: refundAmount,
          reason: `Guest cancellation: ${reason}`,
          status: 'PENDING'
        }
      });
    }
    
    // Audit log
    await tx.auditLog.create({
      data: {
        entityType: 'RESERVATION',
        entityId: reservation.id,
        action: 'CANCELLED',
        userId: 'GUEST',
        details: {
          reason,
          refundAmount,
          cancellationPolicy
        }
      }
    });
    
    return { refundAmount, cancellationPolicy };
  });
}
```

**Cancellation Policy Logic:**
```typescript
function getCancellationPolicy(daysUntilCheckIn: number) {
  if (daysUntilCheckIn >= 7) {
    return { refundPercentage: 100, fee: 0 };
  } else if (daysUntilCheckIn >= 3) {
    return { refundPercentage: 50, fee: 0 };
  } else if (daysUntilCheckIn >= 1) {
    return { refundPercentage: 0, fee: 0 };
  } else {
    return { refundPercentage: 0, fee: 0 }; // Same-day: no refund
  }
}
```

**Email Confirmation:**
- Subject: "Booking Cancelled — Sandbox Hotel"
- Include refund information and timeline
- Provide contact for questions

---

### Guest-Initiated Modification

**URL:** `/booking/[code]/modify`

**Supported Modifications:**
- Check-in date change
- Check-out date change
- Guest count change (if within room capacity)
- Special requests update

**NOT Supported (requires staff contact):**
- Room type change
- Name change

**Flow:**
1. Guest enters confirmation code + email
2. Display current booking
3. Modification form (new dates, guest count)
4. Check availability for new dates
5. Show price difference (if any)
6. Confirm modification
7. Server action: `requestModification(confirmationCode, email, changes)`

**Server Action:**
```typescript
async function requestModification(code: string, email: string, changes: ModificationData) {
  return await db.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({
      where: { confirmationCode: code },
      include: { guest: true, folio: true }
    });
    
    if (!reservation || reservation.guest.email !== email) {
      throw new Error('Booking not found');
    }
    
    if (reservation.status !== 'CONFIRMED') {
      throw new Error('Cannot modify this booking');
    }
    
    // Check new date availability
    const newCheckIn = changes.checkIn || reservation.checkIn;
    const newCheckOut = changes.checkOut || reservation.checkOut;
    
    const available = await checkAvailability(
      reservation.roomTypeId,
      newCheckIn,
      newCheckOut,
      reservation.id // Exclude current reservation
    );
    
    if (!available) {
      throw new Error('Room type not available for new dates');
    }
    
    // Release old inventory
    await tx.roomDateInventory.updateMany({
      where: {
        roomTypeId: reservation.roomTypeId,
        date: { gte: reservation.checkIn, lt: reservation.checkOut }
      },
      data: {
        availableCount: { increment: 1 }
      }
    });
    
    // Lock new inventory
    await tx.roomDateInventory.updateMany({
      where: {
        roomTypeId: reservation.roomTypeId,
        date: { gte: newCheckIn, lt: newCheckOut }
      },
      data: {
        availableCount: { decrement: 1 }
      }
    });
    
    // Calculate price difference
    const oldTotal = calculateTotalAmount(reservation);
    const newTotal = calculateTotalAmount({
      ...reservation,
      checkIn: newCheckIn,
      checkOut: newCheckOut,
      adults: changes.adults || reservation.adults,
      children: changes.children || reservation.children
    });
    
    const priceDifference = newTotal - oldTotal;
    
    // Update reservation
    await tx.reservation.update({
      where: { id: reservation.id },
      data: {
        checkIn: newCheckIn,
        checkOut: newCheckOut,
        adults: changes.adults || reservation.adults,
        children: changes.children || reservation.children
      }
    });
    
    // Adjust folio if price changed
    if (priceDifference !== 0) {
      await tx.folioCharge.create({
        data: {
          folioId: reservation.folio.id,
          type: 'ADJUSTMENT',
          description: 'Booking modification adjustment',
          amount: priceDifference,
          quantity: 1,
          date: new Date()
        }
      });
    }
    
    // Audit log
    await tx.auditLog.create({
      data: {
        entityType: 'RESERVATION',
        entityId: reservation.id,
        action: 'MODIFIED',
        userId: 'GUEST',
        details: {
          oldDates: `${reservation.checkIn} - ${reservation.checkOut}`,
          newDates: `${newCheckIn} - ${newCheckOut}`,
          priceDifference
        }
      }
    });
    
    return { reservation, priceDifference };
  });
}
```

**Email Confirmation:**
- Subject: "Booking Modified — Sandbox Hotel"
- Show old vs new details
- Show price adjustment (if any)
- Payment link if additional payment required

---

## 6. Payment & Deposit Architecture

### Payment Methods

```prisma
enum PaymentMethod {
  CASH
  CREDIT_CARD
  BANK_TRANSFER
  ONLINE_STRIPE
  ONLINE_OMISE
  THIRD_PARTY_OTA
}
```

### Payment Status

```prisma
enum PaymentStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
  REFUNDED
  PARTIALLY_REFUNDED
}
```

### Deposit Policy (Configurable per Property)

```prisma
model PropertySettings {
  id                    String   @id @default(cuid())
  propertyId            String   @unique
  depositRequired       Boolean  @default(true)
  depositType           DepositType @default(PERCENTAGE)
  depositAmount         Float    @default(50) // 50% or fixed THB amount
  requireManualApproval Boolean  @default(false)
  allowPayAtHotel       Boolean  @default(true)
}

enum DepositType {
  PERCENTAGE  // e.g., 50% of total
  FIXED       // e.g., 1000 THB
  FIRST_NIGHT // First night's charge
}
```

### Payment Flow (Online)

**Stripe Integration:**

```typescript
async function createPaymentIntent(holdId: string, amount: number) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(amount * 100), // Convert to cents
    currency: 'thb',
    metadata: {
      holdId,
      propertyId: 'sandbox-hotel'
    }
  });
  
  return paymentIntent.client_secret;
}

// Webhook handler
async function handleStripeWebhook(event: Stripe.Event) {
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const holdId = paymentIntent.metadata.holdId;
    
    await confirmBooking(holdId, {
      method: 'ONLINE_STRIPE',
      amount: paymentIntent.amount / 100,
      transactionId: paymentIntent.id
    });
  }
}
```

---

## 7. Cashier Architecture

### Purpose

**Single interface for all financial operations during a guest's stay:**
- View folio
- Post charges
- Collect payments
- Issue receipts/invoices
- Track deposit vs balance due

### Access Control

**Roles with cashier access:**
- Admin (full access)
- Manager (full access)
- Cashier (all except void/reversal)
- Front Desk (view only, post charges, collect payment)

### Cashier Dashboard

**Location:** `/dashboard/cashier`

**Sections:**
1. **Pending Payments** (reservations with balance due)
2. **Recent Transactions** (last 24 hours)
3. **Deposit Tracking** (confirmed reservations with no deposit)
4. **Refund Queue** (pending refund approvals)
5. **Cash Drawer** (if property uses cash management)

### Folio Sidebar (Quick Access)

**Trigger:** Click any reservation → Opens side panel with folio

**Tabs:**
- Summary (balance due, paid, charges, payments)
- Charges
- Payments
- Audit Log

---

## 8. Folio Lifecycle

### Data Model

```prisma
model Folio {
  id              String        @id @default(cuid())
  reservationId   String        @unique
  reservation     Reservation   @relation(fields: [reservationId], references: [id])
  guestId         String
  guest           Guest         @relation(fields: [guestId], references: [id])
  status          FolioStatus   @default(OPEN)
  charges         FolioCharge[]
  payments        FolioPayment[]
  balanceDue      Float         @default(0) // Computed field
  totalCharges    Float         @default(0) // Computed field
  totalPayments   Float         @default(0) // Computed field
  closedAt        DateTime?
  closedBy        String?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  
  @@index([status])
  @@index([guestId])
}

enum FolioStatus {
  OPEN
  CLOSED
  SETTLED
}

model FolioCharge {
  id              String      @id @default(cuid())
  folioId         String
  folio           Folio       @relation(fields: [folioId], references: [id])
  type            ChargeType
  description     String
  amount          Float
  quantity        Int         @default(1)
  date            DateTime    @default(now())
  voidedAt        DateTime?
  voidedBy        String?
  voidReason      String?
  postedBy        String
  createdAt       DateTime    @default(now())
  
  @@index([folioId])
  @@index([date])
}

enum ChargeType {
  ACCOMMODATION
  EXTRA_GUEST
  MINIBAR
  LAUNDRY
  RESTAURANT
  SPA
  PARKING
  TELEPHONE
  DAMAGE
  OTHER
  ADJUSTMENT
}

model FolioPayment {
  id              String        @id @default(cuid())
  folioId         String
  folio           Folio         @relation(fields: [folioId], references: [id])
  method          PaymentMethod
  amount          Float
  reference       String?       // Transaction ID, check number, etc.
  status          PaymentStatus @default(COMPLETED)
  processedBy     String
  processedAt     DateTime      @default(now())
  voidedAt        DateTime?
  voidedBy        String?
  voidReason      String?
  refundedAmount  Float         @default(0)
  createdAt       DateTime      @default(now())
  
  @@index([folioId])
  @@index([processedAt])
}
```

### Folio Lifecycle States

```
1. Reservation created → Folio status: OPEN
   - Initial accommodation charge posted
   - Deposit payment (if paid online)

2. Guest checked in → Folio remains OPEN
   - Additional charges posted during stay
   - Payments collected as needed

3. Guest checks out → Folio status: CLOSED
   - Final charges posted (minibar, damages, etc.)
   - Final payment collected
   - Receipt/invoice generated

4. All payments collected → Folio status: SETTLED
   - Balance due = 0
   - No further charges allowed
   - Folio archived
```

### Computed Balance

**Always calculated in real-time:**

```typescript
function calculateBalance(folio: Folio): FolioBalance {
  const totalCharges = folio.charges
    .filter(c => !c.voidedAt)
    .reduce((sum, c) => sum + (c.amount * c.quantity), 0);
  
  const totalPayments = folio.payments
    .filter(p => !p.voidedAt)
    .reduce((sum, p) => sum + p.amount - p.refundedAmount, 0);
  
  const balanceDue = totalCharges - totalPayments;
  
  return {
    totalCharges,
    totalPayments,
    balanceDue,
    isPaid: balanceDue <= 0
  };
}
```

---

## 9. Cashier Operations

### Post Charge

**UI:** Folio sidebar → Charges tab → "+ Add Charge" button

**Form:**
- Charge type (dropdown: minibar, laundry, restaurant, etc.)
- Description (text input)
- Amount (number input)
- Quantity (number input, default: 1)
- Date (date picker, default: today)

**Server Action:**
```typescript
async function postCharge(folioId: string, data: ChargeData, userId: string) {
  return await db.$transaction(async (tx) => {
    const folio = await tx.folio.findUnique({
      where: { id: folioId }
    });
    
    if (folio.status === 'SETTLED') {
      throw new Error('Cannot post charge to settled folio');
    }
    
    const charge = await tx.folioCharge.create({
      data: {
        folioId,
        type: data.type,
        description: data.description,
        amount: data.amount,
        quantity: data.quantity,
        date: data.date,
        postedBy: userId
      }
    });
    
    // Audit log
    await tx.auditLog.create({
      data: {
        entityType: 'FOLIO_CHARGE',
        entityId: charge.id,
        action: 'CREATED',
        userId,
        details: {
          folioId,
          type: data.type,
          amount: data.amount * data.quantity
        }
      }
    });
    
    return charge;
  });
}
```

---

### Collect Payment

**UI:** Folio sidebar → Payments tab → "+ Collect Payment" button

**Form:**
- Payment method (dropdown: cash, credit card, bank transfer)
- Amount (number input, default: balance due)
- Reference (text input, optional: transaction ID, check number)

**Server Action:**
```typescript
async function collectPayment(folioId: string, data: PaymentData, userId: string) {
  return await db.$transaction(async (tx) => {
    const folio = await tx.folio.findUnique({
      where: { id: folioId },
      include: { charges: true, payments: true }
    });
    
    if (folio.status === 'SETTLED') {
      throw new Error('Folio already settled');
    }
    
    const payment = await tx.folioPayment.create({
      data: {
        folioId,
        method: data.method,
        amount: data.amount,
        reference: data.reference,
        status: 'COMPLETED',
        processedBy: userId,
        processedAt: new Date()
      }
    });
    
    // Check if fully paid
    const balance = calculateBalance({
      ...folio,
      payments: [...folio.payments, payment]
    });
    
    if (balance.balanceDue <= 0 && folio.status === 'CLOSED') {
      await tx.folio.update({
        where: { id: folioId },
        data: { status: 'SETTLED' }
      });
    }
    
    // Audit log
    await tx.auditLog.create({
      data: {
        entityType: 'FOLIO_PAYMENT',
        entityId: payment.id,
        action: 'CREATED',
        userId,
        details: {
          folioId,
          method: data.method,
          amount: data.amount
        }
      }
    });
    
    return payment;
  });
}
```

---

### Void / Reversal

**Permission required:** Manager or Admin only

**UI:** Charge or payment row → "⋮" menu → "Void"

**Form:**
- Reason (required, text input)
- Manager override password (if not manager/admin)

**Server Action:**
```typescript
async function voidCharge(chargeId: string, reason: string, userId: string) {
  return await db.$transaction(async (tx) => {
    const charge = await tx.folioCharge.findUnique({
      where: { id: chargeId },
      include: { folio: true }
    });
    
    if (charge.voidedAt) {
      throw new Error('Charge already voided');
    }
    
    if (charge.folio.status === 'SETTLED') {
      throw new Error('Cannot void charge on settled folio');
    }
    
    await tx.folioCharge.update({
      where: { id: chargeId },
      data: {
        voidedAt: new Date(),
        voidedBy: userId,
        voidReason: reason
      }
    });
    
    // Audit log
    await tx.auditLog.create({
      data: {
        entityType: 'FOLIO_CHARGE',
        entityId: chargeId,
        action: 'VOIDED',
        userId,
        details: {
          originalAmount: charge.amount,
          reason
        }
      }
    });
    
    return charge;
  });
}

// Similar for voidPayment()
```

---

## 10. Invoice & Receipt Generation

### Receipt (Payment Confirmation)

**Trigger:** After payment collected

**Format:** PDF

**Contents:**
- Sandbox Hotel header (logo, address, tax ID)
- Receipt number (unique, sequential)
- Date/time of payment
- Guest name
- Reservation confirmation code
- Payment method
- Amount paid
- Remaining balance (if any)
- Footer: "This is not a tax invoice"

**Server Action:**
```typescript
import { generatePDF } from '@/lib/pdf'; // Using react-pdf or puppeteer

async function generateReceipt(paymentId: string): Promise<Buffer> {
  const payment = await db.folioPayment.findUnique({
    where: { id: paymentId },
    include: {
      folio: {
        include: {
          reservation: true,
          guest: true
        }
      }
    }
  });
  
  const balance = calculateBalance(payment.folio);
  
  return generatePDF({
    template: 'receipt',
    data: {
      receiptNumber: formatReceiptNumber(payment.id),
      date: payment.processedAt,
      guestName: `${payment.folio.guest.firstName} ${payment.folio.guest.lastName}`,
      confirmationCode: payment.folio.reservation.confirmationCode,
      paymentMethod: payment.method,
      amountPaid: payment.amount,
      remainingBalance: balance.balanceDue
    }
  });
}
```

---

### Invoice (Tax Invoice)

**Trigger:** On check-out or guest request

**Format:** PDF

**Contents:**
- Sandbox Hotel header (logo, address, tax ID)
- Invoice number (unique, sequential)
- Date of issue
- Guest name and address (if provided)
- Itemized charges:
  - Accommodation (dates, room type, nights, rate per night)
  - Extra guest charges
  - Minibar / restaurant / other charges
- Subtotal
- Tax breakdown (if applicable)
- Total
- Payments received
- Balance due
- Footer: Tax invoice declaration, company registration

**Server Action:**
```typescript
async function generateInvoice(folioId: string): Promise<Buffer> {
  const folio = await db.folio.findUnique({
    where: { id: folioId },
    include: {
      reservation: true,
      guest: true,
      charges: { where: { voidedAt: null } },
      payments: { where: { voidedAt: null } }
    }
  });
  
  const balance = calculateBalance(folio);
  
  const itemizedCharges = folio.charges.map(c => ({
    description: c.description,
    quantity: c.quantity,
    unitPrice: c.amount,
    total: c.amount * c.quantity
  }));
  
  return generatePDF({
    template: 'invoice',
    data: {
      invoiceNumber: formatInvoiceNumber(folio.id),
      issueDate: new Date(),
      guestName: `${folio.guest.firstName} ${folio.guest.lastName}`,
      guestAddress: folio.guest.address,
      checkIn: folio.reservation.checkIn,
      checkOut: folio.reservation.checkOut,
      confirmationCode: folio.reservation.confirmationCode,
      charges: itemizedCharges,
      subtotal: balance.totalCharges,
      tax: 0, // Thai hotels often show tax-inclusive pricing
      total: balance.totalCharges,
      paymentsReceived: balance.totalPayments,
      balanceDue: balance.balanceDue
    }
  });
}
```

---

## 11. Financial Permission Model

### Role-Based Access Control (RBAC)

```typescript
const cashierPermissions = {
  'ADMIN': [
    'folio:view',
    'folio:post_charge',
    'folio:collect_payment',
    'folio:void_charge',
    'folio:void_payment',
    'folio:issue_refund',
    'folio:close_folio',
    'folio:reopen_folio'
  ],
  'MANAGER': [
    'folio:view',
    'folio:post_charge',
    'folio:collect_payment',
    'folio:void_charge',
    'folio:void_payment',
    'folio:issue_refund',
    'folio:close_folio'
  ],
  'CASHIER': [
    'folio:view',
    'folio:post_charge',
    'folio:collect_payment',
    'folio:close_folio'
  ],
  'FRONT_DESK': [
    'folio:view',
    'folio:post_charge',
    'folio:collect_payment'
  ],
  'HOUSEKEEPING': []
};
```

### Permission Checks

```typescript
function requirePermission(permission: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.session.user;
    
    if (!user) {
      throw new UnauthorizedError('Not authenticated');
    }
    
    const userPermissions = cashierPermissions[user.role] || [];
    
    if (!userPermissions.includes(permission)) {
      throw new ForbiddenError(`Missing permission: ${permission}`);
    }
    
    next();
  };
}

// Usage in API routes
app.post('/api/folio/void-charge', requirePermission('folio:void_charge'), voidChargeHandler);
```

---

## 12. Source Attribution

### Purpose

**Track where bookings come from for marketing analysis:**
- Direct website
- Google search
- Facebook ads
- Email campaign
- OTA (if manual entry)

### Data Capture

**Automatic (from booking engine):**
- UTM parameters (utm_source, utm_medium, utm_campaign)
- Referrer URL
- Landing page
- User agent (desktop/mobile)

**Manual (from staff):**
- Walk-in
- Phone booking
- Email booking
- Booking.com / Agoda / Airbnb

### Data Model

```prisma
model Reservation {
  // ... other fields
  source              BookingSource @default(DIRECT)
  sourceAttribution   Json?         // Stores UTM params, referrer, etc.
}

enum BookingSource {
  DIRECT
  GOOGLE
  FACEBOOK
  EMAIL
  WALK_IN
  PHONE
  OTA_BOOKING_COM
  OTA_AGODA
  OTA_AIRBNB
  OTHER
}
```

### Capture Logic (Booking Engine)

```typescript
function captureSourceAttribution(req: Request): SourceAttribution {
  const utm = {
    source: req.query.utm_source as string,
    medium: req.query.utm_medium as string,
    campaign: req.query.utm_campaign as string,
    term: req.query.utm_term as string,
    content: req.query.utm_content as string
  };
  
  const referrer = req.headers.referer;
  const userAgent = req.headers['user-agent'];
  
  return {
    utm,
    referrer,
    userAgent,
    landingPage: req.url,
    timestamp: new Date()
  };
}
```

---

## 13. Schema Additions

### New Tables

```prisma
// Booking hold system
model BookingHold {
  id                        String      @id @default(cuid())
  sessionId                 String      @unique
  propertyId                String
  roomTypeId                String
  checkIn                   DateTime
  checkOut                  DateTime
  adults                    Int
  children                  Json
  guestData                 Json?
  sourceAttribution         Json?
  status                    HoldStatus  @default(ACTIVE)
  expiresAt                 DateTime
  convertedToReservationId  String?     @unique
  createdAt                 DateTime    @default(now())
  
  @@index([expiresAt, status])
  @@index([sessionId])
}

enum HoldStatus {
  ACTIVE
  CONVERTED
  EXPIRED
  CANCELLED
}

// Folio system
model Folio {
  id              String        @id @default(cuid())
  reservationId   String        @unique
  reservation     Reservation   @relation(fields: [reservationId], references: [id])
  guestId         String
  guest           Guest         @relation(fields: [guestId], references: [id])
  status          FolioStatus   @default(OPEN)
  charges         FolioCharge[]
  payments        FolioPayment[]
  closedAt        DateTime?
  closedBy        String?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  
  @@index([status])
  @@index([guestId])
}

enum FolioStatus {
  OPEN
  CLOSED
  SETTLED
}

model FolioCharge {
  id              String      @id @default(cuid())
  folioId         String
  folio           Folio       @relation(fields: [folioId], references: [id], onDelete: Cascade)
  type            ChargeType
  description     String
  amount          Float
  quantity        Int         @default(1)
  date            DateTime    @default(now())
  voidedAt        DateTime?
  voidedBy        String?
  voidReason      String?
  postedBy        String
  createdAt       DateTime    @default(now())
  
  @@index([folioId])
  @@index([date])
}

enum ChargeType {
  ACCOMMODATION
  EXTRA_GUEST
  MINIBAR
  LAUNDRY
  RESTAURANT
  SPA
  PARKING
  TELEPHONE
  DAMAGE
  OTHER
  ADJUSTMENT
}

model FolioPayment {
  id              String        @id @default(cuid())
  folioId         String
  folio           Folio         @relation(fields: [folioId], references: [id], onDelete: Cascade)
  method          PaymentMethod
  amount          Float
  reference       String?
  status          PaymentStatus @default(COMPLETED)
  processedBy     String
  processedAt     DateTime      @default(now())
  voidedAt        DateTime?
  voidedBy        String?
  voidReason      String?
  refundedAmount  Float         @default(0)
  createdAt       DateTime      @default(now())
  
  @@index([folioId])
  @@index([processedAt])
}

enum PaymentMethod {
  CASH
  CREDIT_CARD
  DEBIT_CARD
  BANK_TRANSFER
  ONLINE_STRIPE
  ONLINE_OMISE
  THIRD_PARTY_OTA
}

enum PaymentStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
  REFUNDED
  PARTIALLY_REFUNDED
}

// Refund requests
model RefundRequest {
  id              String        @id @default(cuid())
  folioId         String
  folio           Folio         @relation(fields: [folioId], references: [id])
  amount          Float
  reason          String
  status          RefundStatus  @default(PENDING)
  requestedAt     DateTime      @default(now())
  approvedBy      String?
  approvedAt      DateTime?
  processedAt     DateTime?
  
  @@index([status])
}

enum RefundStatus {
  PENDING
  APPROVED
  REJECTED
  PROCESSED
}

// Property settings
model PropertySettings {
  id                    String      @id @default(cuid())
  propertyId            String      @unique
  property              Property    @relation(fields: [propertyId], references: [id])
  depositRequired       Boolean     @default(true)
  depositType           DepositType @default(PERCENTAGE)
  depositAmount         Float       @default(50)
  requireManualApproval Boolean     @default(false)
  allowPayAtHotel       Boolean     @default(true)
  cancellationPolicy    Json        // Structured policy rules
  bookingEngine         Json        // Config for public booking
  createdAt             DateTime    @default(now())
  updatedAt             DateTime    @updatedAt
}

enum DepositType {
  PERCENTAGE
  FIXED
  FIRST_NIGHT
}
```

### Updated Tables

```prisma
model Reservation {
  // Add these fields to existing model
  source              BookingSource @default(DIRECT)
  sourceAttribution   Json?
  cancellationReason  String?
  cancelledAt         DateTime?
  cancelledBy         String?      // 'GUEST' or userId
  folio               Folio?
}

enum BookingSource {
  DIRECT
  GOOGLE
  FACEBOOK
  EMAIL
  WALK_IN
  PHONE
  OTA_BOOKING_COM
  OTA_AGODA
  OTA_AIRBNB
  OTHER
}

model Guest {
  // Add this field
  folios              Folio[]
}
```

---

## 14. Service Architecture

### Domain Structure

```
src/
├── domains/
│   ├── booking-engine/
│   │   ├── actions/
│   │   │   ├── search-availability.ts
│   │   │   ├── create-hold.ts
│   │   │   ├── confirm-booking.ts
│   │   │   ├── request-cancellation.ts
│   │   │   └── request-modification.ts
│   │   ├── services/
│   │   │   ├── availability-service.ts
│   │   │   ├── hold-service.ts
│   │   │   ├── pricing-service.ts
│   │   │   └── email-service.ts
│   │   ├── utils/
│   │   │   ├── validation.ts
│   │   │   └── formatting.ts
│   │   └── types.ts
│   │
│   ├── cashier/
│   │   ├── actions/
│   │   │   ├── post-charge.ts
│   │   │   ├── collect-payment.ts
│   │   │   ├── void-charge.ts
│   │   │   └── void-payment.ts
│   │   ├── services/
│   │   │   ├── folio-service.ts
│   │   │   ├── payment-service.ts
│   │   │   └── invoice-service.ts
│   │   └── types.ts
│   │
│   └── payments/
│       ├── providers/
│       │   ├── stripe-provider.ts
│       │   └── omise-provider.ts
│       ├── services/
│       │   ├── payment-processor.ts
│       │   └── refund-processor.ts
│       └── types.ts
```

### Key Services

**`availability-service.ts`**
```typescript
export class AvailabilityService {
  async checkAvailability(
    roomTypeId: string,
    checkIn: Date,
    checkOut: Date,
    excludeReservationId?: string
  ): Promise<boolean> {
    // Query inventory for all dates in range
    // Return true if all dates have availableCount > 0
  }
  
  async getAvailableRoomTypes(
    propertyId: string,
    checkIn: Date,
    checkOut: Date,
    guests: { adults: number; children: number[] }
  ): Promise<RoomTypeAvailability[]> {
    // Return list of available room types with pricing
  }
}
```

**`hold-service.ts`**
```typescript
export class HoldService {
  async createHold(data: HoldInput): Promise<Hold> {
    // Transaction: check availability, decrement inventory, create hold
  }
  
  async releaseExpiredHolds(): Promise<number> {
    // Cron job: find expired holds, increment inventory, mark as expired
  }
  
  async convertHoldToReservation(holdId: string, paymentData?: PaymentData): Promise<Reservation> {
    // Create reservation, create folio, mark hold as converted
  }
}
```

**`folio-service.ts`**
```typescript
export class FolioService {
  async calculateBalance(folioId: string): Promise<FolioBalance> {
    // Sum charges (non-voided), sum payments (non-voided), return balance
  }
  
  async postCharge(folioId: string, data: ChargeData, userId: string): Promise<FolioCharge> {
    // Create charge, audit log
  }
  
  async collectPayment(folioId: string, data: PaymentData, userId: string): Promise<FolioPayment> {
    // Create payment, check if settled, audit log
  }
  
  async closeFolio(folioId: string, userId: string): Promise<Folio> {
    // Mark folio as closed, prevent new charges
  }
}
```

**`invoice-service.ts`**
```typescript
export class InvoiceService {
  async generateReceipt(paymentId: string): Promise<Buffer> {
    // Generate PDF receipt
  }
  
  async generateInvoice(folioId: string): Promise<Buffer> {
    // Generate PDF invoice
  }
  
  async emailInvoice(folioId: string): Promise<void> {
    // Generate invoice, send via email
  }
}
```

---

## 15. API Routes

### Booking Engine (Public)

```
POST   /api/booking/search-availability
POST   /api/booking/create-hold
PATCH  /api/booking/hold/:id/update-guest-data
POST   /api/booking/confirm
POST   /api/booking/payment-intent
POST   /api/booking/webhooks/stripe

GET    /api/booking/:confirmationCode (with email verification)
POST   /api/booking/:confirmationCode/cancel
POST   /api/booking/:confirmationCode/modify
```

### Cashier (Protected)

```
GET    /api/cashier/dashboard
GET    /api/cashier/pending-payments
GET    /api/cashier/recent-transactions

GET    /api/folio/:id
POST   /api/folio/:id/charge
POST   /api/folio/:id/payment
POST   /api/folio/:id/close
POST   /api/folio/charge/:chargeId/void
POST   /api/folio/payment/:paymentId/void

GET    /api/invoice/:folioId
POST   /api/invoice/:folioId/email
GET    /api/receipt/:paymentId
```

---

## 16. Cron Jobs

```typescript
// Run every 5 minutes
export async function releaseExpiredHoldsJob() {
  const holdService = new HoldService();
  const count = await holdService.releaseExpiredHolds();
  console.log(`Released ${count} expired holds`);
}

// Run every hour
export async function checkPendingReservationsJob() {
  // Find PENDING_APPROVAL reservations > 24 hours old
  // Send reminder to staff
}

// Run daily at 00:00
export async function generateDailyFinancialReportJob() {
  // Aggregate payments, charges, refunds
  // Email to admin/manager
}
```

---

## 17. Testing Strategy

### Unit Tests (Vitest)

```typescript
// availability-service.test.ts
describe('AvailabilityService', () => {
  it('should return available room types for date range', async () => {
    // Test availability logic
  });
  
  it('should exclude unavailable dates', async () => {
    // Test date range with partial availability
  });
});

// folio-service.test.ts
describe('FolioService', () => {
  it('should calculate balance correctly', async () => {
    // Test charge + payment = balance
  });
  
  it('should not allow charges on settled folio', async () => {
    // Test business rule enforcement
  });
});
```

### Integration Tests (Playwright)

```typescript
// booking-flow.spec.ts
test('complete booking flow', async ({ page }) => {
  await page.goto('/book');
  await page.fill('[name="checkIn"]', '2024-06-01');
  await page.fill('[name="checkOut"]', '2024-06-03');
  await page.click('button:has-text("Search")');
  
  await page.click('button:has-text("Book Now")');
  
  await page.fill('[name="firstName"]', 'John');
  await page.fill('[name="lastName"]', 'Doe');
  await page.fill('[name="email"]', 'john@example.com');
  await page.fill('[name="phone"]', '0812345678');
  await page.click('button:has-text("Continue")');
  
  // ... payment flow
  
  await expect(page.locator('h1:has-text("Booking Confirmed")')).toBeVisible();
});
```

---

## 18. Acceptance Criteria

### Booking Engine

- [ ] Guest can search availability for any date range
- [ ] Available room types display with accurate pricing
- [ ] Hold system prevents double-booking during checkout
- [ ] Expired holds release inventory automatically
- [ ] Guest receives confirmation email with PDF receipt
- [ ] Confirmation page displays booking details and management links
- [ ] Guest can cancel booking (with refund calculation)
- [ ] Guest can modify dates (if available)
- [ ] Source attribution captured for all bookings
- [ ] Mobile-responsive on all screen sizes

### Cashier / Folio

- [ ] Staff can view all open folios
- [ ] Staff can post charges to folio
- [ ] Staff can collect payments (cash, card, transfer)
- [ ] Balance calculates correctly (charges - payments)
- [ ] Manager can void charges/payments with reason
- [ ] Folio closes on check-out
- [ ] Folio settles when balance = 0
- [ ] Receipt generated on payment
- [ ] Invoice generated on check-out
- [ ] All transactions auditable

### Financial Safety

- [ ] No double-booking possible (database constraints)
- [ ] All inventory mutations are transactional
- [ ] Payment state consistent with reservation status
- [ ] Voided charges/payments excluded from balance
- [ ] Refunds require approval
- [ ] Permission checks enforce role-based access

---

## 19. Future Enhancements (Out of Scope v1)

- Multi-currency support
- Split folio (separate charges for multiple guests)
- City ledger (corporate account billing)
- Gift certificates / vouchers
- Package deals (room + breakfast + spa)
- Dynamic pricing (yield management)
- Channel manager integration (2-way sync with OTAs)
- Payment plan (pay in installments)
- Loyalty points / rewards program

---

## Summary

This architecture delivers:

✅ **Simple, stable, mobile-friendly booking engine**  
✅ **Inventory-safe hold system**  
✅ **Clean cancellation & modification flows**  
✅ **Straightforward cashier operations**  
✅ **Auditable financial trail**  
✅ **Production-ready folio lifecycle**  
✅ **Permission-controlled operations**  
✅ **Clean modular codebase**

**Zero unnecessary complexity. Zero double-booking risk. Zero friction for guests.**

This is operationally simple, financially trustworthy, and built to scale.
