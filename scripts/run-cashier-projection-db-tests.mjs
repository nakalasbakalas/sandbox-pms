/* global console, process */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { assertSafeE2EDatabase, redactDatabaseUrl } from './db-safety.mjs'

const e2eDatabaseUrl = assertSafeE2EDatabase()
process.env.DATABASE_URL = e2eDatabaseUrl

const { createPrismaClient } = await import('../server/prisma-client.mjs')
const { listCashierFolios } = await import('../server/pms-service.mjs')
const prisma = createPrismaClient()
const suffix = randomUUID().replaceAll('-', '').slice(0, 12)

async function createFixture(label, amounts) {
  const property = await prisma.property.create({
    data: {
      code: `CASHIER_${label}_${suffix}`.toUpperCase(),
      name: `Cashier Projection ${label}`,
      currency: label === 'A' ? 'THB' : 'USD',
      taxRate: 0,
      taxRateBasisPoints: 0,
      extraGuestFee: 200,
      extraGuestFeeSatang: 20_000n,
      childFee: 100,
      childFeeSatang: 10_000n,
    },
  })
  const roomType = await prisma.roomType.create({
    data: {
      propertyId: property.id,
      code: `CASHIER_${label}`,
      name: `Cashier room ${label}`,
      baseRate: 100,
      baseRateSatang: 10_000n,
      standardOcc: 2,
      maxOccupancy: 2,
    },
  })
  const room = await prisma.room.create({
    data: {
      propertyId: property.id,
      roomTypeId: roomType.id,
      number: `C-${label}-1`,
      floor: 1,
      operationalStatus: 'AVAILABLE',
      currentStatus: 'VACANT_CLEAN',
      notes: 'must-not-leak',
    },
  })
  const guest = await prisma.guest.create({
    data: {
      propertyId: property.id,
      firstName: 'Cashier',
      lastName: `Guest ${label}`,
      email: `cashier-${label}-${suffix}@example.test`,
      phone: '+66999999999',
      idNumber: `ID-${label}-${suffix}`,
    },
  })
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      confirmationCode: `CASHIER-${label}-${suffix}`,
      guestId: guest.id,
      roomTypeId: roomType.id,
      assignedRoomId: room.id,
      checkIn: new Date('2031-01-02T00:00:00.000Z'),
      checkOut: new Date('2031-01-04T00:00:00.000Z'),
      status: 'CONFIRMED',
      adults: 2,
      children: 0,
      childAges: [],
      ratePerNight: Number(amounts.totalSatang / 2n) / 100,
      ratePerNightSatang: amounts.totalSatang / 2n,
      totalAmount: Number(amounts.totalSatang) / 100,
      totalAmountSatang: amounts.totalSatang,
      depositAmount: 0,
      depositAmountSatang: 0n,
      source: 'DIRECT',
    },
  })
  const folio = await prisma.folio.create({
    data: {
      reservationId: reservation.id,
      subtotal: Number(amounts.subtotalSatang) / 100,
      subtotalSatang: amounts.subtotalSatang,
      tax: Number(amounts.taxSatang) / 100,
      taxSatang: amounts.taxSatang,
      total: Number(amounts.totalSatang) / 100,
      totalSatang: amounts.totalSatang,
      paid: Number(amounts.paidSatang) / 100,
      paidSatang: amounts.paidSatang,
      balance: Number(amounts.balanceSatang) / 100,
      balanceSatang: amounts.balanceSatang,
    },
  })
  await prisma.charge.create({
    data: {
      propertyId: property.id,
      folioId: folio.id,
      idempotencyKey: `cashier-charge:${label}:${suffix}`,
      intentFingerprint: `cashier-charge:${label}:${suffix}`,
      date: reservation.checkIn,
      description: `Projection charge ${label}`,
      category: 'ROOM',
      amount: Number(amounts.subtotalSatang) / 100,
      amountSatang: amounts.subtotalSatang,
      quantity: 1,
      total: Number(amounts.subtotalSatang) / 100,
      totalSatang: amounts.subtotalSatang,
      createdBy: 'Cashier DB test',
    },
  })
  if (amounts.paidSatang > 0n) {
    await prisma.payment.create({
      data: {
        propertyId: property.id,
        folioId: folio.id,
        amount: Number(amounts.paidSatang) / 100,
        amountSatang: amounts.paidSatang,
        method: 'CARD',
        idempotencyKey: `cashier-payment:${label}:${suffix}`,
        reference: `CARD-${label}-${suffix}`,
        referenceFingerprint: `cashier-payment-ref:${label}:${suffix}`,
        notes: 'must-not-leak',
        processedBy: 'Cashier DB test',
      },
    })
  }
  return { property, roomType, room, guest, reservation, folio }
}

console.log(`Cashier projection DB target: ${redactDatabaseUrl(e2eDatabaseUrl)}`)
const fixtureA = await createFixture('A', {
  subtotalSatang: 12_345n,
  taxSatang: 0n,
  totalSatang: 12_345n,
  paidSatang: 4_500n,
  balanceSatang: 7_845n,
})
const fixtureB = await createFixture('B', {
  subtotalSatang: 9_999n,
  taxSatang: 0n,
  totalSatang: 9_999n,
  paidSatang: 0n,
  balanceSatang: 9_999n,
})

try {
  const actorA = { id: `cashier-a-${suffix}`, propertyId: fixtureA.property.id, role: 'CASHIER' }
  const projectionA = await listCashierFolios(prisma, actorA)
  assert.deepEqual(projectionA.property, {
    id: fixtureA.property.id,
    name: fixtureA.property.name,
    currency: 'THB',
  })
  assert.equal(projectionA.folios.length, 1, 'property A sees only its own folio')
  assert.equal(projectionA.folios[0].id, fixtureA.folio.id)
  assert.equal(projectionA.folios[0].subtotalSatang, '12345')
  assert.equal(projectionA.folios[0].paidSatang, '4500')
  assert.equal(projectionA.folios[0].balanceSatang, '7845')
  assert.equal(projectionA.folios[0].charges[0].unitPriceSatang, '12345')
  assert.equal(projectionA.folios[0].payments[0].amountSatang, '4500')
  const serializedA = JSON.stringify(projectionA)
  for (const forbidden of ['must-not-leak', 'email', 'phone', 'idNumber', 'notes', 'amount"', 'total"']) {
    assert.equal(serializedA.includes(forbidden), false, `projection does not expose ${forbidden}`)
  }
  assert.equal(serializedA.includes(fixtureB.folio.id), false, 'a forged cross-property folio identifier never enters the property A projection')

  const actorB = { id: `cashier-b-${suffix}`, propertyId: fixtureB.property.id, role: 'CASHIER' }
  const projectionB = await listCashierFolios(prisma, actorB)
  assert.equal(projectionB.folios.length, 1, 'property B sees only its own folio')
  assert.equal(projectionB.folios[0].id, fixtureB.folio.id)
  assert.equal(JSON.stringify(projectionB).includes(fixtureA.folio.id), false, 'property B cannot read property A folio data')

  await prisma.folio.update({ where: { id: fixtureA.folio.id }, data: { balanceSatang: null } })
  await assert.rejects(
    listCashierFolios(prisma, actorA),
    { statusCode: 503 },
    'missing satang data fails closed instead of falling back to float authority',
  )
} finally {
  const propertyIds = [fixtureA.property.id, fixtureB.property.id]
  await prisma.payment.deleteMany({ where: { propertyId: { in: propertyIds } } })
  await prisma.charge.deleteMany({ where: { propertyId: { in: propertyIds } } })
  await prisma.folio.deleteMany({ where: { reservation: { propertyId: { in: propertyIds } } } })
  await prisma.reservation.deleteMany({ where: { propertyId: { in: propertyIds } } })
  await prisma.guest.deleteMany({ where: { propertyId: { in: propertyIds } } })
  await prisma.room.deleteMany({ where: { propertyId: { in: propertyIds } } })
  await prisma.roomType.deleteMany({ where: { propertyId: { in: propertyIds } } })
  await prisma.property.deleteMany({ where: { id: { in: propertyIds } } })
  await prisma.$disconnect()
}

console.log('Cashier projection DB tests passed.')
