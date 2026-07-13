import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildChargeMoneyFields,
  buildFolioMoneyFields,
  calculateStayMoney,
  completeInitialSetup,
  createCharge,
  createPayment,
} from '../server/pms-service.mjs'

const actor = {
  id: 'admin-money-test',
  name: 'Money Test Admin',
  role: 'ADMIN',
}

test('stay pricing rounds inputs to satang before multi-night, occupancy, child, and deposit arithmetic', () => {
  assert.deepEqual(calculateStayMoney({
    checkIn: '2026-08-01',
    checkOut: '2026-08-02',
    ratePerNight: '750',
    adults: 2,
    childAges: [],
  }), {
    nights: 1,
    ratePerNight: 750,
    ratePerNightSatang: 75_000,
    roomSubtotal: 750,
    roomSubtotalSatang: 75_000,
    extraGuestFee: 0,
    extraGuestFeeSatang: 0,
    childFee: 0,
    childFeeSatang: 0,
    total: 750,
    totalSatang: 75_000,
    depositAmount: 225,
    depositAmountSatang: 22_500,
  })

  const multiNight = calculateStayMoney({
    checkIn: '2026-08-01',
    checkOut: '2026-08-03',
    ratePerNight: '750.005',
    adults: 3,
    childAges: [8],
    standardOccupancy: 2,
    maxOccupancy: 4,
    extraGuestFeePerNight: '300.005',
    childSharingFeePerNight: '100.004',
  })

  assert.equal(multiNight.ratePerNight, 750.01)
  assert.equal(multiNight.ratePerNightSatang, 75_001)
  assert.equal(multiNight.extraGuestFeeSatang, 60_002)
  assert.equal(multiNight.childFeeSatang, 20_000)
  assert.equal(multiNight.total, 2_300.04)
  assert.equal(multiNight.totalSatang, 230_004)
  assert.equal(multiNight.depositAmount, 690.01)
  assert.equal(multiNight.depositAmountSatang, 69_001)
})

test('folio arithmetic handles tax, voided charges, partial payments, multiple payments, and exact zero balance', () => {
  const charges = [
    { total: 100, totalSatang: 10_000, void: false },
    { total: 999, totalSatang: 99_900, void: true },
  ]
  const partial = buildFolioMoneyFields(charges, [
    { amount: 53.5, amountSatang: 5_350 },
  ], { taxSatang: 700 })

  assert.deepEqual(partial, {
    subtotal: 100,
    subtotalSatang: 10_000,
    tax: 7,
    taxSatang: 700,
    total: 107,
    totalSatang: 10_700,
    paid: 53.5,
    paidSatang: 5_350,
    balance: 53.5,
    balanceSatang: 5_350,
  })

  const settled = buildFolioMoneyFields(charges, [
    { amount: 53.5, amountSatang: 5_350 },
    { amount: 53.5, amountSatang: 5_350 },
  ], { taxSatang: 700 })
  assert.equal(settled.paidSatang, 10_700)
  assert.equal(settled.balance, 0)
  assert.equal(settled.balanceSatang, 0)
})

test('initial setup dual-writes property tax, fees, minimum rate, and room type base rate', async () => {
  let propertyWrite
  const roomTypeWrites = []
  const tx = {
    property: {
      async upsert(input) {
        propertyWrite = input
        return { id: 'property-money-test', ...input.create }
      },
    },
    room: {
      async deleteMany() {},
      async create({ data }) { return { id: 'room-money-test', ...data } },
    },
    roomType: {
      async deleteMany() {},
      async create({ data }) {
        roomTypeWrites.push(data)
        return { id: `room-type-${roomTypeWrites.length}`, ...data }
      },
    },
    user: {
      async create({ data }) { return { id: 'admin-money-test', ...data } },
    },
    auditLog: {
      async create({ data }) { return { id: 'audit-money-test', ...data } },
    },
  }
  const prisma = {
    property: { async findUnique() { return null } },
    user: { async count() { return 0 } },
    reservation: { async count() { return 0 } },
    guest: { async count() { return 0 } },
    folio: { async count() { return 0 } },
    payment: { async count() { return 0 } },
    charge: { async count() { return 0 } },
    async $transaction(callback) { return callback(tx) },
  }

  await completeInitialSetup(prisma, {
    property: {
      name: 'Money Test Hotel',
      address: '1 Test Road',
      city: 'Bangkok',
      country: 'Thailand',
      phone: '+66000000000',
      email: 'money@example.com',
      timeZone: 'Asia/Bangkok',
      defaultCheckIn: '14:00',
      defaultCheckOut: '11:00',
      currency: 'THB',
      taxRate: '7.125',
      extraGuestFee: '300.005',
      childFee: '100.004',
      inventoryMinimumRate: '749.995',
    },
    roomTypes: [{
      id: 'twin',
      name: 'Twin',
      baseOccupancy: 2,
      maxOccupancy: 3,
    }],
    rooms: [{
      number: '101',
      roomTypeId: 'twin',
      status: 'available',
    }],
    rates: [{ roomTypeId: 'twin', baseRate: '999.995' }],
    adminUser: {
      name: 'Money Admin',
      email: 'admin@example.com',
      password: 'Safe-test-password-123',
    },
  })

  assert.equal(propertyWrite.create.taxRate, 7.13)
  assert.equal(propertyWrite.create.taxRateBps, 713)
  assert.equal(propertyWrite.create.extraGuestFee, 300.01)
  assert.equal(propertyWrite.create.extraGuestFeeSatang, 30_001)
  assert.equal(propertyWrite.create.childFee, 100)
  assert.equal(propertyWrite.create.childFeeSatang, 10_000)
  assert.equal(propertyWrite.create.inventoryMinimumRate, 750)
  assert.equal(propertyWrite.create.inventoryMinimumRateSatang, 75_000)
  assert.equal(roomTypeWrites[0].baseRate, 1_000)
  assert.equal(roomTypeWrites[0].baseRateSatang, 100_000)
})

function createLedgerPrisma({ charges, initialBalanceSatang }) {
  const payments = []
  let folio = {
    id: 'folio-money-test',
    status: 'OPEN',
    balance: initialBalanceSatang / 100,
    balanceSatang: initialBalanceSatang,
  }
  const tx = {
    folio: {
      async findUnique() { return folio },
      async update({ data }) {
        folio = { ...folio, ...data }
        return { ...folio, charges, payments, reservation: { id: 'reservation-money-test' } }
      },
    },
    payment: {
      async findUnique() { return null },
      async create({ data }) {
        const payment = { id: `payment-${payments.length + 1}`, ...data }
        payments.push(payment)
        return payment
      },
      async findMany() { return payments },
    },
    charge: {
      async findMany() { return charges.filter((charge) => !charge.void) },
    },
    auditLog: {
      async create({ data }) { return { id: 'audit-payment-test', ...data } },
    },
  }
  return {
    payments,
    get folio() { return folio },
    prisma: {
      async $transaction(callback) { return callback(tx) },
    },
  }
}

test('central payment writer dual-writes multiple partial payments and closes at exact zero', async () => {
  const ledger = createLedgerPrisma({
    charges: [{ id: 'charge-room', total: 10.01, totalSatang: 1_001, void: false }],
    initialBalanceSatang: 1_001,
  })

  await createPayment(ledger.prisma, {
    folioId: 'folio-money-test',
    amount: '3.33',
    method: 'CASH',
  }, actor)
  const settled = await createPayment(ledger.prisma, {
    folioId: 'folio-money-test',
    amount: '6.68',
    method: 'CASH',
  }, actor)

  assert.deepEqual(ledger.payments.map(({ amount, amountSatang }) => ({ amount, amountSatang })), [
    { amount: 3.33, amountSatang: 333 },
    { amount: 6.68, amountSatang: 668 },
  ])
  assert.equal(settled.folio.paid, 10.01)
  assert.equal(settled.folio.paidSatang, 1_001)
  assert.equal(settled.folio.balance, 0)
  assert.equal(settled.folio.balanceSatang, 0)
  assert.equal(settled.folio.status, 'CLOSED')
})

test('incidental charge writer derives Float rollback values from authoritative satang', async () => {
  const charges = []
  let folio = { id: 'folio-charge-test', status: 'OPEN', balance: 0, balanceSatang: 0 }
  const tx = {
    folio: {
      async findUnique() { return folio },
      async update({ data }) {
        folio = { ...folio, ...data }
        return { ...folio, charges, payments: [], reservation: { id: 'reservation-money-test' } }
      },
    },
    charge: {
      async create({ data }) {
        const charge = { id: 'charge-incidental-test', void: false, ...data }
        charges.push(charge)
        return charge
      },
      async findMany() { return charges },
    },
    payment: { async findMany() { return [] } },
    auditLog: { async create({ data }) { return { id: 'audit-charge-test', ...data } } },
  }
  const prisma = { async $transaction(callback) { return callback(tx) } }

  const result = await createCharge(prisma, {
    folioId: 'folio-charge-test',
    amount: 0.1 + 0.2,
    quantity: 3,
    description: 'Decimal test charge',
    category: 'OTHER',
  }, actor)

  assert.equal(result.charge.amount, 0.3)
  assert.equal(result.charge.amountSatang, 30)
  assert.equal(result.charge.total, 0.9)
  assert.equal(result.charge.totalSatang, 90)
  assert.equal(result.folio.balance, 0.9)
  assert.equal(result.folio.balanceSatang, 90)
})

test('charge helper preserves explicit reservation totals while dual-writing room-rate fields', () => {
  assert.deepEqual(buildChargeMoneyFields('750.005', 2, '1800.005'), {
    amount: 750.01,
    amountSatang: 75_001,
    total: 1_800.01,
    totalSatang: 180_001,
  })
})
