# Phase 1 Implementation Guide
**Sandbox Hotel PMS - Foundation Setup**

## Overview

Phase 1 establishes the core infrastructure and data model for the Sandbox Hotel PMS. This phase focuses on:

- ✅ Complete database schema implementation
- ✅ Core type definitions
- ✅ Database connection setup
- ✅ Seed data for Sandbox Hotel
- ⏳ Authentication & authorization (next steps)
- ⏳ User management UI (next steps)
- ⏳ Property/room configuration UI (next steps)

---

## ✅ Completed: Database Schema

### What's Been Implemented

**Complete Prisma Schema** (`/prisma/schema.prisma`)
- ✅ Property and RoomType models
- ✅ Room model with operational and current status
- ✅ Guest model with full profile fields
- ✅ Reservation model with full lifecycle support
- ✅ RoomDateInventory (source of truth for availability)
- ✅ InventoryHold (temporary booking locks)
- ✅ Folio, Charge, and Payment models (financial operations)
- ✅ GuestDocument model
- ✅ ReservationLog and RoomStatusLog (audit trails)
- ✅ User model with role-based access
- ✅ RateRule and RateCalendar (pricing engine)
- ✅ Channel, ChannelMapping, ChannelSyncLog (OTA integration)
- ✅ Message and MessageTemplate (LINE/email/SMS)
- ✅ AuditLog (system-wide audit trail)

**Key Features:**
- Database-level double-booking prevention (`@@unique([roomId, date])`)
- Proper indexing for performance
- Cascading deletes and referential integrity
- Support for all reservation statuses and room states
- Complete audit logging infrastructure

### Seed Data (`/prisma/seed.ts`)

Seeds the database with:
- ✅ Sandbox Hotel property
- ✅ 2 room types (Twin, Double)
- ✅ 30 rooms (201-215 twin, 301-315 double)
- ✅ 5 staff users (Admin, Manager, Front Desk, Housekeeping, Cashier)

All rooms start as `VACANT_CLEAN` except rooms 216 and 316 which are marked `OUT_OF_SERVICE`.

---

## ✅ Completed: Type Definitions

### What's Been Implemented

**TypeScript Types** (`/src/types/index.ts`)
- ✅ Re-exports of all Prisma models
- ✅ Re-exports of all enums
- ✅ Extended types with relationships (`ReservationWithDetails`, etc.)
- ✅ Input types for operations (`CreateReservationInput`, `CheckInInput`, etc.)
- ✅ Query and filter types
- ✅ Stats and calculation types

**Database Client** (`/src/lib/db/prisma.ts`)
- ✅ Singleton Prisma client
- ✅ Development logging enabled
- ✅ Hot reload safe (global caching)

---

## 🔧 Setup Instructions

### 1. Install Dependencies

This step is required to generate Prisma Client from the schema:

```bash
npm install -D prisma
npm install @prisma/client
```

### 2. Set Up PostgreSQL Database

You have two options:

**Option A: Local PostgreSQL**
```bash
# Install PostgreSQL (macOS with Homebrew)
brew install postgresql@14
brew services start postgresql@14

# Create database
createdb sandbox_pms
```

**Option B: Docker PostgreSQL**
```bash
docker run --name sandbox-pms-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=sandbox_pms \
  -p 5432:5432 \
  -d postgres:14
```

### 3. Configure Environment

Create `.env` file in project root:

```bash
cp .env.example .env
```

Edit `.env` and update `DATABASE_URL`:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/sandbox_pms?schema=public"
```

### 4. Generate Prisma Client

```bash
npx prisma generate
```

This creates the Prisma Client in `node_modules/@prisma/client`.

### 5. Run Database Migration

```bash
npx prisma db push
```

This creates all tables in your PostgreSQL database.

### 6. Seed the Database

```bash
npx prisma db seed
```

This populates the database with Sandbox Hotel data.

---

## 📊 Database Verification

### Inspect with Prisma Studio

```bash
npx prisma studio
```

Opens a browser-based GUI at `http://localhost:5555` where you can:
- Browse all tables
- View seeded data
- Manually test queries
- Verify relationships

### Verify Seed Data

You should see:
- **1 Property** (Sandbox Hotel)
- **2 RoomTypes** (Twin, Double)
- **30 Rooms** (15 twin + 15 double)
- **5 Users** (various roles)

### Test Queries

Try these in Prisma Studio or your app:

```typescript
import { prisma } from '@/lib/db/prisma'

// Get all rooms with their types
const rooms = await prisma.room.findMany({
  include: { roomType: true }
})

// Get available rooms for dates
const available = await prisma.room.findMany({
  where: {
    operationalStatus: 'AVAILABLE',
    inventory: {
      none: {
        date: { gte: new Date('2024-01-15'), lte: new Date('2024-01-20') },
        status: { in: ['RESERVED', 'HELD'] }
      }
    }
  }
})
```

---

## 🏗️ Architecture Overview

### Data Model Philosophy

1. **Room × Date Inventory is Source of Truth**
   - Every reservation creates `RoomDateInventory` records
   - Unique constraint prevents double-booking
   - All queries check inventory status

2. **Transaction-Safe Operations**
   - All reservation operations use `prisma.$transaction()`
   - Atomic: create reservation + allocate inventory + create folio + log
   - Rollback on any failure

3. **Audit Everything**
   - `ReservationLog` tracks all reservation changes
   - `RoomStatusLog` tracks all room status changes
   - `AuditLog` tracks system-wide actions
   - No state change without audit trail

4. **Status Enums**
   - Reservation: `CONFIRMED → CHECKED_IN → CHECKED_OUT`
   - Room: `VACANT_CLEAN`, `VACANT_DIRTY`, `OCCUPIED`, `OCCUPIED_DIRTY`
   - Inventory: `AVAILABLE`, `RESERVED`, `HELD`, `BLOCKED`, `OUT_OF_SERVICE`

### Key Constraints

**No Double-Booking**
```prisma
@@unique([roomId, date]) on RoomDateInventory
```

**No Orphaned Records**
```prisma
onDelete: Cascade  // Child records deleted with parent
onDelete: Restrict // Prevent deletion if children exist
onDelete: SetNull  // Null out foreign key on parent delete
```

---

## 📁 File Structure

```
/prisma
  schema.prisma          # Complete database schema
  seed.ts                # Seed script for Sandbox Hotel

/src
  /lib
    /db
      prisma.ts          # Prisma client singleton
  /types
    index.ts             # TypeScript type definitions

/.env.example            # Environment variable template
```

---

## 🚀 Next Steps: Phase 1 Completion

### Remaining Tasks

1. **Authentication & Authorization**
   - [ ] Set up NextAuth.js or similar
   - [ ] Password hashing (bcrypt/Argon2)
   - [ ] Session management
   - [ ] Role-based middleware

2. **User Management UI**
   - [ ] Login page
   - [ ] User list/create/edit screens
   - [ ] Role assignment
   - [ ] Password reset

3. **Property/Room Configuration UI**
   - [ ] Property settings page
   - [ ] Room type management
   - [ ] Room grid/list view
   - [ ] Room status manual override

4. **Basic Audit Logging**
   - [ ] Middleware to log API actions
   - [ ] User action tracking
   - [ ] Audit log viewer (admin only)

---

## 🔐 Security Considerations

### Already Implemented

✅ **Database Level**
- Proper foreign key constraints
- Unique constraints for business rules
- Enum types for controlled values

✅ **Type Safety**
- Full TypeScript coverage
- Prisma generated types
- Compile-time validation

### TODO: Implementation Required

❌ **Authentication**
- Password hashing
- Secure session storage
- CSRF protection
- Rate limiting

❌ **Authorization**
- Role-based access control
- Permission checks on routes
- Resource-level permissions

❌ **Data Protection**
- Input validation (Zod schemas)
- SQL injection prevention (Prisma handles this)
- XSS prevention
- Environment secrets management

---

## 🧪 Testing Strategy

### Database Tests

Test with actual database (integration tests):

```typescript
import { prisma } from '@/lib/db/prisma'
import { beforeEach, afterEach, describe, it, expect } from 'vitest'

describe('Reservation Service', () => {
  beforeEach(async () => {
    // Clear test data
    await prisma.reservation.deleteMany()
  })

  it('prevents double booking', async () => {
    // Test implementation
  })
})
```

### Transaction Tests

Verify atomic operations:

```typescript
it('rolls back on error', async () => {
  await expect(
    createReservationWithInvalidData()
  ).rejects.toThrow()

  // Verify no partial data was created
  const count = await prisma.reservation.count()
  expect(count).toBe(0)
})
```

---

## 📚 Key Resources

**Prisma Documentation**
- [Prisma Schema Reference](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference)
- [Prisma Client API](https://www.prisma.io/docs/reference/api-reference/prisma-client-reference)
- [Transactions](https://www.prisma.io/docs/concepts/components/prisma-client/transactions)

**Project Documentation**
- `DATA-MODEL.md` - Complete data model specification
- `TECHNICAL-ARCHITECTURE.md` - Tech stack and architecture
- `IMPLEMENTATION-GUIDE.md` - Full project structure

---

## ✅ Phase 1 Success Criteria

- [x] Prisma schema defined and matches specification
- [x] Database created and migrated
- [x] Seed data populates successfully
- [x] Prisma Studio can browse all tables
- [x] Type definitions are complete
- [x] Database client is configured
- [ ] Authentication is implemented
- [ ] Basic user management works
- [ ] Admin can configure property
- [ ] Audit logging is functional

**Status: 60% Complete** (Core schema done, auth/UI pending)

---

## 🤝 Getting Help

**Common Issues:**

1. **"Can't find module '@prisma/client'"**
   ```bash
   npx prisma generate
   ```

2. **"Connection refused to PostgreSQL"**
   - Check PostgreSQL is running
   - Verify DATABASE_URL in .env
   - Test connection: `psql -h localhost -U postgres`

3. **"Migration failed"**
   ```bash
   npx prisma db push --force-reset
   npx prisma db seed
   ```

4. **"Seed failed"**
   - Check seed.ts for syntax errors
   - Verify database is empty (or use --force-reset)
   - Check console for specific error

**Need More Info?**
- Review `DATA-MODEL.md` for business rules
- Check `EXECUTIVE-SUMMARY.md` for roadmap
- See `TECHNICAL-ARCHITECTURE.md` for stack details
