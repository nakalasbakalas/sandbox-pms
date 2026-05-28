/* global console, process */
import assert from 'node:assert/strict'
import { canPerformAction, canViewRoute } from '../server/rbac.mjs'
import {
  calculateStayPricing,
  isSellableRoomNumber,
  normalizePaymentMethod,
  reservationsOverlap,
  roomStatusForHousekeeping,
  PmsValidationError,
} from '../server/pms-domain.mjs'

const admin = { id: 'e2e-admin', role: 'ADMIN', email: 'admin@sandboxhotel.co.th' }
const frontDesk = { id: 'e2e-front-desk', role: 'FRONT_DESK', email: 'frontdesk@sandboxhotel.co.th' }
const housekeeping = { id: 'e2e-housekeeping', role: 'HOUSEKEEPING', email: 'housekeeping@sandboxhotel.co.th' }

assert.equal(canViewRoute(admin, 'user-management'), true, 'admin can view user management')
assert.equal(canViewRoute(frontDesk, 'user-management'), false, 'front desk cannot view user management')
assert.equal(canPerformAction(frontDesk, 'check-in:guest'), true, 'front desk can check in guests')
assert.equal(canPerformAction(frontDesk, 'override:check-in'), false, 'front desk cannot override check-in blockers')
assert.equal(canPerformAction(admin, 'override:check-out'), true, 'admin can override checkout blockers')
assert.equal(canPerformAction(housekeeping, 'process:payment'), false, 'housekeeping cannot process payments')
assert.equal(isSellableRoomNumber('201'), true, 'room 201 is sellable')
assert.equal(isSellableRoomNumber('216'), false, 'room 216 is non-sellable')
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
assert.equal(pricing.total, 3400, 'extra adult fee is charged for each night')

if (!process.env.DATABASE_URL || process.env.PMS_E2E_MUTATE_DB !== '1') {
  console.log('E2E contract checks passed.')
  console.log('Database-mutating workflow e2e skipped. Set DATABASE_URL and PMS_E2E_MUTATE_DB=1 against a disposable/staging database to run live workflow e2e.')
  process.exit(0)
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
      number: { notIn: ['216', '316'] },
      roomType: { code: 'TWIN' },
      operationalStatus: 'AVAILABLE',
    },
    include: { roomType: true },
    orderBy: { number: 'asc' },
  })
  assert.ok(twinRoom, 'a sellable twin room must exist')

  const reservation = await createReservation(prisma, {
    guest: {
      firstName: 'E2E',
      lastName: `Guest ${Date.now()}`,
      email: `e2e-${Date.now()}@sandboxhotel.co.th`,
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
