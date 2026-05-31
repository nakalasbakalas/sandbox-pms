/* global console, process */
import assert from 'node:assert/strict'
import { assertSafeE2EDatabase } from './db-safety.mjs'
import { loadEnvDefaults } from './env-utils.mjs'
import { prepareE2EDatabase } from './prepare-e2e-db.mjs'
import { canPerformAction, canViewRoute } from '../server/rbac.mjs'
import {
  calculateStayPricing,
  isSellableRoomNumber,
  normalizePaymentMethod,
  reservationsOverlap,
  roomStatusForHousekeeping,
  PmsValidationError,
} from '../server/pms-domain.mjs'

loadEnvDefaults()

const runDbWorkflow = process.argv.includes('--db') || process.env.npm_lifecycle_event === 'test:e2e:db'

const admin = { id: 'e2e-admin', role: 'ADMIN', email: 'admin@property.test' }
const manager = { id: 'e2e-manager', role: 'MANAGER', email: 'manager@property.test' }
const frontDesk = { id: 'e2e-front-desk', role: 'FRONT_DESK', email: 'frontdesk@property.test' }
const housekeeping = { id: 'e2e-housekeeping', role: 'HOUSEKEEPING', email: 'housekeeping@property.test' }

assert.equal(canViewRoute(admin, 'user-management'), true, 'admin can view user management')
assert.equal(canViewRoute(frontDesk, 'user-management'), false, 'front desk cannot view user management')
assert.equal(canViewRoute(frontDesk, 'channels'), false, 'front desk cannot view channel management')
assert.equal(canViewRoute(manager, 'channels'), true, 'manager can view channel management')
assert.equal(canViewRoute(housekeeping, 'tablet-housekeeping'), true, 'housekeeping can view tablet housekeeping')
assert.equal(canViewRoute(frontDesk, 'does-not-exist'), false, 'unknown routes are denied by default')
assert.equal(canPerformAction(frontDesk, 'check-in:guest'), true, 'front desk can check in guests')
assert.equal(canPerformAction(frontDesk, 'override:check-in'), false, 'front desk cannot override check-in blockers')
assert.equal(canPerformAction(admin, 'override:check-out'), true, 'admin can override checkout blockers')
assert.equal(canPerformAction(manager, 'edit:rates'), true, 'manager server permissions match rate UI access')
assert.equal(canPerformAction(frontDesk, 'send:guest-messages'), true, 'front desk server permissions match guest messaging UI access')
assert.equal(canPerformAction(housekeeping, 'process:payment'), false, 'housekeeping cannot process payments')
assert.equal(isSellableRoomNumber('201'), true, 'room 201 is sellable')
assert.equal(isSellableRoomNumber('216'), true, 'sellability is driven by room configuration, not a fixed room-number list')
assert.equal(isSellableRoomNumber(''), false, 'blank room numbers are not sellable')
assert.equal(reservationsOverlap('2026-05-27', '2026-05-29', '2026-05-29', '2026-05-30'), false, 'same-day turnover is allowed')
assert.equal(reservationsOverlap('2026-05-27', '2026-05-30', '2026-05-29', '2026-05-31'), true, 'overlapping stays are rejected')
assert.equal(roomStatusForHousekeeping('OCCUPIED_CLEAN', 'DIRTY'), 'OCCUPIED_DIRTY', 'occupied dirty status is preserved')
assert.equal(roomStatusForHousekeeping('VACANT_DIRTY', 'INSPECTED'), 'INSPECTED', 'inspection status is represented')
assert.equal(normalizePaymentMethod('CARD'), 'CARD', 'card payment method is accepted')
assert.equal(normalizePaymentMethod('promptpay'), 'BANK_TRANSFER', 'PromptPay maps to bank transfer for folio posting')
assert.throws(() => normalizePaymentMethod('negative-test-method'), PmsValidationError, 'invalid payment methods are rejected')

const pricing = calculateStayPricing({
  checkIn: '2026-05-27',
  checkOut: '2026-05-29',
  adults: 3,
  childAges: [],
  ratePerNight: 1500,
})
assert.equal(pricing.total, 3600, 'extra adult fee is charged for each night')
assert.equal(
  assertSafeE2EDatabase({
    ALLOW_DB_E2E: 'true',
    E2E_DATABASE_URL: 'postgresql://sandbox:sandbox@localhost:55432/sandbox_hotel_e2e?schema=public',
  }),
  'postgresql://sandbox:sandbox@localhost:55432/sandbox_hotel_e2e?schema=public',
  'E2E DB guard allows explicit disposable databases',
)
assert.throws(
  () => assertSafeE2EDatabase({
    ALLOW_DB_E2E: 'true',
    E2E_DATABASE_URL: 'postgresql://user:pass@db.internal:5432/sandbox_hotel_pms?schema=public',
  }),
  /production-like marker/,
  'E2E DB guard blocks production-like database names',
)
assert.throws(
  () => assertSafeE2EDatabase({
    ALLOW_DB_E2E: 'false',
    E2E_DATABASE_URL: 'postgresql://sandbox:sandbox@localhost:55432/sandbox_hotel_e2e?schema=public',
  }),
  /ALLOW_DB_E2E=true/,
  'E2E DB guard requires explicit opt-in',
)

if (!runDbWorkflow) {
  console.log('E2E contract checks passed.')
  console.log('Database-mutating workflow e2e not requested. Run npm run test:e2e:db with ALLOW_DB_E2E=true and E2E_DATABASE_URL set to a disposable/staging database.')
  process.exit(0)
}

let e2eDatabaseUrl
try {
  e2eDatabaseUrl = assertSafeE2EDatabase()
  await prepareE2EDatabase()
  process.env.DATABASE_URL = e2eDatabaseUrl
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

const { PrismaClient } = await import('@prisma/client')
const {
  assignRoom,
  cancelReservation,
  checkInReservation,
  checkOutReservation,
  createReservation,
} = await import('../server/pms-service.mjs')

const prisma = new PrismaClient()

try {
  const twinRoom = await prisma.room.findFirst({
    where: {
      roomType: { code: 'TWIN' },
      operationalStatus: 'AVAILABLE',
      currentStatus: { in: ['VACANT_CLEAN', 'INSPECTED'] },
    },
    include: { roomType: true },
    orderBy: { number: 'asc' },
  })
  assert.ok(twinRoom, 'a sellable twin room must exist')

  const reservation = await createReservation(prisma, {
    guest: {
      firstName: 'E2E',
      lastName: `Guest ${Date.now()}`,
      email: `e2e-${Date.now()}@property.test`,
    },
    roomTypeCode: 'TWIN',
    checkIn: '2027-01-10',
    checkOut: '2027-01-12',
    adults: 2,
    children: 0,
    childAges: [],
    ratePerNight: 1500,
    source: 'DIRECT',
  }, admin)

  const assigned = await assignRoom(prisma, reservation.id, twinRoom.id, frontDesk)
  assert.equal(assigned.assignedRoomId, twinRoom.id, 'room assignment persists')

  const checkedIn = await checkInReservation(prisma, reservation.id, admin, {
    allowDateOverride: true,
    overrideReason: 'Disposable database workflow test uses future stay dates.',
    guest: {
      nationality: 'Thai',
      idNumber: 'E2E-ID',
      idType: 'ID',
    },
    payment: {
      amount: assigned.folio.balance,
      method: 'CASH',
    },
  })
  assert.equal(checkedIn.status, 'CHECKED_IN', 'check-in persists')
  assert.equal(checkedIn.folio.balance, 0, 'check-in payment settles folio')

  const checkedOut = await checkOutReservation(prisma, reservation.id, frontDesk)
  assert.equal(checkedOut.status, 'CHECKED_OUT', 'check-out persists')

  await cancelReservation(prisma, reservation.id, admin, 'CANCELLED', 'E2E cleanup marker').catch(() => undefined)
  console.log('Database workflow e2e passed.')
} finally {
  await prisma.$disconnect()
}
