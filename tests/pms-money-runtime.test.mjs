import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildChargeMoneyFields,
  buildChargeMoneyFieldsFromSatang,
  buildFolioMoneyFields,
  calculateStayMoney,
  completeInitialSetup,
  createCharge,
  createPayment,
  createWalkInCheckIn,
  checkInReservation,
  checkOutReservation,
  parseBookingEmailDetails,
  reversePayment,
  voidCharge,
  withAuthoritativeStayTotal,
} from '../server/pms-service.mjs'
import { dateFromKey, getBangkokDateKey, validateStayInput } from '../server/pms-domain.mjs'

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

test('Lite stay pricing accepts MoneySatang as the write authority and rejects conflicting legacy THB', () => {
  const priced = calculateStayMoney({
    checkIn: '2026-08-01',
    checkOut: '2026-08-03',
    ratePerNightSatang: 75_001,
    adults: 2,
    childAges: [],
  })
  assert.equal(priced.ratePerNightSatang, 75_001)
  assert.equal(priced.roomSubtotalSatang, 150_002)
  assert.equal(priced.totalSatang, 150_002)
  assert.throws(() => calculateStayMoney({
    checkIn: '2026-08-01',
    checkOut: '2026-08-02',
    ratePerNightSatang: 75_001,
    ratePerNight: 750,
    adults: 2,
    childAges: [],
  }), /do not match/i)
  assert.throws(() => calculateStayMoney({
    checkIn: '2026-08-01',
    checkOut: '2026-08-02',
    ratePerNightSatang: 750.01,
    adults: 2,
    childAges: [],
  }), /fractional satang/i)
  assert.throws(() => calculateStayMoney({
    checkIn: '2026-08-01',
    checkOut: '2026-08-02',
    ratePerNightSatang: 75_000,
    adults: 2,
    children: 1,
    childAges: [],
  }), /one age for every child/i)
  assert.throws(() => calculateStayMoney({
    checkIn: '2026-08-01',
    checkOut: '2026-08-02',
    ratePerNightSatang: 75_000,
    adults: 2,
    children: 1,
    childAges: [''],
  }), /one age for every child/i)
})

test('OTA-reported stay total remains exact and supersedes local occupancy supplements', () => {
  const localPricing = calculateStayMoney({
    checkIn: '2026-08-01',
    checkOut: '2026-08-04',
    ratePerNightSatang: 150_000,
    adults: 3,
    children: 1,
    childAges: [8],
    standardOccupancy: 2,
    maxOccupancy: 4,
    extraGuestFeePerNight: 300,
    childSharingFeePerNight: 200,
  })
  assert.equal(localPricing.totalSatang, 600_000)

  const providerPricing = withAuthoritativeStayTotal(localPricing, 450_000)
  assert.equal(providerPricing.total, 4_500)
  assert.equal(providerPricing.totalSatang, 450_000)
  assert.equal(providerPricing.roomSubtotalSatang, 450_000)
  assert.equal(providerPricing.extraGuestFeeSatang, 0)
  assert.equal(providerPricing.childFeeSatang, 0)
  assert.equal(providerPricing.depositAmountSatang, 135_000)
  assert.throws(() => withAuthoritativeStayTotal(localPricing, 450_000.5), /fractional satang/i)
})

test('booking-email money parsing preserves amount semantics and never invents currency', () => {
  const totalAfterPayment = parseBookingEmailDetails({
    subject: 'New booking confirmed TRIP-1001',
    rawText: 'Guest: Test Guest Booking reference: TRIP-1001 Check-in: 2026-08-01 Check-out: 2026-08-03 Room type: Twin Amount paid: THB 700 Total amount: THB 3000',
  })
  assert.equal(totalAfterPayment.eventType, 'NEW_BOOKING')
  assert.equal(totalAfterPayment.details.amount, 3_000)
  assert.equal(totalAfterPayment.details.amountKind, 'STAY_TOTAL')
  assert.equal(totalAfterPayment.details.currency, 'THB')

  const depositOnly = parseBookingEmailDetails({
    subject: 'New booking confirmed TRIP-1002',
    rawText: 'Guest: Test Guest Booking reference: TRIP-1002 Check-in: 2026-08-01 Check-out: 2026-08-03 Room type: Twin Deposit amount: THB 500',
  })
  assert.equal(depositOnly.details.amount, 500)
  assert.equal(depositOnly.details.amountKind, 'DEPOSIT')
  assert.match(depositOnly.reviewReason, /explicit stay total/i)

  const missingCurrency = parseBookingEmailDetails({
    subject: 'New booking confirmed TRIP-1003',
    rawText: 'Guest: Test Guest Booking reference: TRIP-1003 Check-in: 2026-08-01 Check-out: 2026-08-03 Room type: Twin Total: 100',
  })
  assert.equal(missingCurrency.details.amount, 100)
  assert.equal(missingCurrency.details.amountKind, 'STAY_TOTAL')
  assert.equal(missingCurrency.details.currency, undefined)
  assert.match(missingCurrency.reviewReason, /amount currency/i)

  for (const rawText of [
    'Guest: Test Guest Booking reference: TRIP-1003A Check-in: 2026-08-01 Check-out: 2026-08-03 Room type: Twin Total amount: 4500 for one night',
    'Guest: Test Guest Booking reference: TRIP-1003B Check-in: 2026-08-01 Check-out: 2026-08-03 Room type: Twin Total amount: 4500 and prepaid',
    'Guest: Test Guest Booking reference: TRIP-1003C Check-in: 2026-08-01 Check-out: 2026-08-03 Room type: Twin Total amount: 4500 all taxes included',
    'Guest: Test Guest Booking reference: TRIP-1003D Check-in: 2026-08-01 Check-out: 2026-08-03 Room type: Twin Total amount: 4500 try our breakfast',
    'Guest: Test Guest Booking reference: TRIP-1003E Check-in: 2026-08-01 Check-out: 2026-08-03 Room type: Twin Total amount: 4500 mad deal',
  ]) {
    const ordinaryWordAfterAmount = parseBookingEmailDetails({ subject: 'New booking confirmed', rawText })
    assert.equal(ordinaryWordAfterAmount.details.currency, undefined)
    assert.match(ordinaryWordAfterAmount.reviewReason, /amount currency/i)
  }

  const payment = parseBookingEmailDetails({
    subject: 'Payment received TRIP-1004',
    rawText: 'Booking reference: TRIP-1004 Total amount: THB 3000 Amount received: THB 700 Payment received.',
  })
  assert.equal(payment.eventType, 'PAYMENT_NOTICE')
  assert.equal(payment.details.amount, 700)
  assert.equal(payment.details.amountKind, 'PAYMENT')

  const hyphenatedReference = parseBookingEmailDetails({
    subject: 'Booking modification TRIP-REF-1001',
    rawText: 'Booking reference: TRIP-REF-1001 Check-in: 2026-08-01 Check-out: 2026-08-03 Room type: Twin Total amount: THB 3000',
  })
  assert.equal(hyphenatedReference.channelRef, 'TRIP-REF-1001')

  for (const separator of ['–', '—']) {
    const rangedStay = parseBookingEmailDetails({
      subject: 'New booking confirmed TRIP-RANGE',
      rawText: `Guest: Range Guest Booking reference: TRIP-RANGE Stay dates: 2026-08-01 ${separator} 2026-08-03 Room type: Twin Total amount: THB 3000`,
    })
    assert.equal(rangedStay.details.checkIn, '2026-08-01')
    assert.equal(rangedStay.details.checkOut, '2026-08-03')
  }
})

test('calendar date validation rejects rollover dates and preserves real leap days', () => {
  assert.equal(dateFromKey('2028-02-29').toISOString().slice(0, 10), '2028-02-29')
  assert.equal(getBangkokDateKey('2028-02-29'), '2028-02-29')

  for (const invalidDate of ['2026-02-29', '2026-02-31', '2026-04-31', '2026-13-01', '2026-00-10']) {
    assert.throws(() => dateFromKey(invalidDate), /real calendar date/i)
    assert.throws(() => getBangkokDateKey(invalidDate), /real calendar date/i)
  }

  assert.throws(() => validateStayInput({
    checkIn: '2026-02-31',
    checkOut: '2026-03-05',
  }), /real calendar date/i)

  const invalidEmailDate = parseBookingEmailDetails({
    subject: 'New booking confirmed TRIP-BAD-DATE',
    rawText: 'Guest: Date Guest Booking reference: TRIP-BAD-DATE Check-in: 2026-02-31 Check-out: 2026-03-05 Room type: Twin Total amount: THB 3000',
  })
  assert.equal(invalidEmailDate.details.checkIn, undefined)
  assert.match(invalidEmailDate.reviewReason, /stay dates/i)
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

  const reversed = buildFolioMoneyFields(charges, [
    { amount: 107, amountSatang: 10_700, entryKind: 'PAYMENT' },
    { amount: -20, amountSatang: -2_000, entryKind: 'REVERSAL' },
  ], { taxSatang: 700 })
  assert.equal(reversed.paidSatang, 8_700)
  assert.equal(reversed.balanceSatang, 2_000)
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

function createLedgerPrisma({ charges, initialBalanceSatang, reservationStatus = 'CHECKED_IN', depositAmountSatang = 500, taxSatang = 0 }) {
  const payments = []
  const reservationLogs = []
  const transactionOptions = []
  let reservation = {
    id: 'reservation-money-test',
    status: reservationStatus,
    depositAmount: depositAmountSatang / 100,
    depositAmountSatang,
    depositPaid: false,
  }
  let folio = {
    id: 'folio-money-test',
    status: 'OPEN',
    tax: taxSatang / 100,
    taxSatang,
    balance: initialBalanceSatang / 100,
    balanceSatang: initialBalanceSatang,
  }
  const tx = {
    folio: {
      async findUnique() { return folio },
      async update({ data }) {
        folio = { ...folio, ...data }
        return { ...folio, charges, payments, reservation }
      },
    },
    reservation: {
      async update({ data }) {
        reservation = { ...reservation, ...data }
        return reservation
      },
    },
    reservationLog: {
      async create({ data }) {
        const log = { id: `reservation-log-${reservationLogs.length + 1}`, ...data }
        reservationLogs.push(log)
        return log
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
    reservationLogs,
    transactionOptions,
    get folio() { return folio },
    get reservation() { return reservation },
    prisma: {
      async $transaction(callback, options) {
        transactionOptions.push(options)
        return callback(tx)
      },
    },
  }
}

function createMutableMoneyLedger({
  charges: initialCharges = [],
  payments: initialPayments = [],
  folioStatus = 'OPEN',
  reservationStatus = 'CHECKED_IN',
  depositAmountSatang = 0,
  depositPaid = false,
  taxSatang = 0,
} = {}) {
  const charges = initialCharges.map((charge) => ({ void: false, ...charge }))
  const payments = initialPayments.map((payment) => ({ entryKind: 'PAYMENT', ...payment }))
  const audits = []
  const transactionOptions = []
  let reservation = {
    id: 'reservation-mutable-money',
    status: reservationStatus,
    depositAmount: depositAmountSatang / 100,
    depositAmountSatang,
    depositPaid,
  }
  const initialMoney = buildFolioMoneyFields(charges, payments, { taxSatang })
  let folio = {
    id: 'folio-mutable-money',
    status: folioStatus,
    ...initialMoney,
  }
  const snapshotFolio = () => ({ ...folio, charges, payments, reservation: { ...reservation } })
  const tx = {
    folio: {
      async findUnique() { return snapshotFolio() },
      async update({ data }) {
        folio = { ...folio, ...data }
        return snapshotFolio()
      },
    },
    reservation: {
      async update({ data }) {
        reservation = { ...reservation, ...data }
        return { ...reservation }
      },
    },
    reservationLog: { async create({ data }) { return { id: 'reservation-log-money', ...data } } },
    payment: {
      async findUnique({ where }) {
        if (where.id) return payments.find((payment) => payment.id === where.id) || null
        if (where.clientRequestId) return payments.find((payment) => payment.clientRequestId === where.clientRequestId) || null
        if (where.referenceFingerprint) return payments.find((payment) => payment.referenceFingerprint === where.referenceFingerprint) || null
        if (where.sourceEmailEventId) return payments.find((payment) => payment.sourceEmailEventId === where.sourceEmailEventId) || null
        return null
      },
      async findMany({ where } = {}) {
        return where?.reversesPaymentId
          ? payments.filter((payment) => payment.reversesPaymentId === where.reversesPaymentId && payment.entryKind === where.entryKind)
          : payments
      },
      async create({ data }) {
        const payment = { id: `mutable-payment-${payments.length + 1}`, ...data }
        payments.push(payment)
        return payment
      },
    },
    charge: {
      async findUnique({ where }) {
        if (where.id) return charges.find((charge) => charge.id === where.id) || null
        if (where.clientRequestId) return charges.find((charge) => charge.clientRequestId === where.clientRequestId) || null
        if (where.voidRequestId) return charges.find((charge) => charge.voidRequestId === where.voidRequestId) || null
        return null
      },
      async findMany({ where } = {}) {
        return where?.void === false ? charges.filter((charge) => !charge.void) : charges
      },
      async create({ data }) {
        const charge = { id: `mutable-charge-${charges.length + 1}`, void: false, ...data }
        charges.push(charge)
        return charge
      },
      async update({ where, data }) {
        const charge = charges.find((candidate) => candidate.id === where.id)
        Object.assign(charge, data)
        return charge
      },
    },
    auditLog: {
      async create({ data }) {
        const audit = { id: `mutable-audit-${audits.length + 1}`, ...data }
        audits.push(audit)
        return audit
      },
    },
  }
  return {
    charges,
    payments,
    audits,
    transactionOptions,
    get folio() { return folio },
    get reservation() { return reservation },
    prisma: {
      async $transaction(callback, options) {
        transactionOptions.push(options)
        return callback(tx)
      },
    },
  }
}

test('central payment writer dual-writes multiple partial payments and settles exact balance while folio stays open until checkout', async () => {
  const ledger = createLedgerPrisma({
    charges: [{ id: 'charge-room', total: 10.01, totalSatang: 1_001, void: false }],
    initialBalanceSatang: 1_001,
  })

  await assert.rejects(
    () => createPayment(ledger.prisma, {
      folioId: 'folio-money-test',
      amountSatang: 100,
      method: 'CASH',
      sourceEmailEventId: 'forged-booking-email-event',
    }, actor),
    /cannot set internal booking-email provenance/i,
  )
  assert.equal(ledger.payments.length, 0)

  const partial = await createPayment(ledger.prisma, {
    folioId: 'folio-money-test',
    amount: '3.33',
    method: 'CASH',
  }, actor)
  assert.equal(partial.folio.reservation.depositPaid, false)
  assert.equal(ledger.reservationLogs.length, 0)
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
  assert.equal(settled.folio.status, 'OPEN')
  assert.equal(ledger.reservation.depositPaid, true)
  assert.equal(settled.depositBecamePaid, true)
  assert.equal(ledger.reservationLogs.length, 1)
  assert.equal(ledger.reservationLogs[0].action, 'DEPOSIT_PAID')
  assert.equal(ledger.transactionOptions.every((options) => options?.isolationLevel === 'Serializable'), true)
})

test('Lite payment writer accepts integer MoneySatang without a Float input', async () => {
  const ledger = createLedgerPrisma({
    charges: [{ id: 'charge-room', total: 10.01, totalSatang: 1_001, void: false }],
    initialBalanceSatang: 1_001,
  })
  const settled = await createPayment(ledger.prisma, {
    folioId: 'folio-money-test',
    amountSatang: 1_001,
    method: 'CASH',
  }, actor)
  assert.equal(ledger.payments[0].amount, 10.01)
  assert.equal(ledger.payments[0].amountSatang, 1_001)
  assert.equal(settled.folio.balanceSatang, 0)
  assert.equal(ledger.reservation.depositPaid, true)
})

test('payments do not mark a zero-deposit reservation as deposit paid', async () => {
  const ledger = createLedgerPrisma({
    charges: [{ id: 'charge-room', total: 10, totalSatang: 1_000, void: false }],
    initialBalanceSatang: 1_000,
    depositAmountSatang: 0,
  })
  const result = await createPayment(ledger.prisma, {
    folioId: 'folio-money-test',
    amountSatang: 500,
    method: 'CASH',
  }, actor)
  assert.equal(result.folio.reservation.depositPaid, false)
  assert.equal(ledger.reservation.depositPaid, false)
  assert.equal(ledger.reservationLogs.length, 0)
})

test('folio recompute preserves stored tax when a payment changes the ledger', async () => {
  const ledger = createLedgerPrisma({
    charges: [{ id: 'charge-room', total: 10, totalSatang: 1_000, void: false }],
    taxSatang: 70,
    initialBalanceSatang: 1_070,
  })

  const result = await createPayment(ledger.prisma, {
    folioId: 'folio-money-test',
    amountSatang: 100,
    method: 'CASH',
  }, actor)

  assert.equal(result.folio.taxSatang, 70)
  assert.equal(result.folio.totalSatang, 1_070)
  assert.equal(result.folio.balanceSatang, 970)
})

test('public embedded payments cannot forge booking-email provenance before transaction work starts', async () => {
  let transactionCalls = 0
  const prisma = {
    async $transaction() {
      transactionCalls += 1
      throw new Error('transaction should not start')
    },
  }
  const forgedPayment = { amountSatang: 100, method: 'CASH', sourceEmailEventId: 'forged-email-event' }

  await assert.rejects(
    () => createWalkInCheckIn(prisma, { payment: forgedPayment }, actor),
    /cannot set internal booking-email provenance/i,
  )
  await assert.rejects(
    () => checkInReservation(prisma, 'reservation-money-test', actor, { payment: forgedPayment }),
    /cannot set internal booking-email provenance/i,
  )
  await assert.rejects(
    () => checkOutReservation(prisma, 'reservation-money-test', actor, { payment: forgedPayment }),
    /cannot set internal booking-email provenance/i,
  )
  assert.equal(transactionCalls, 0)
})

test('payment writer rejects overpayment even when a public caller requests an override flag', async () => {
  const ledger = createLedgerPrisma({
    charges: [{ id: 'charge-room', total: 10.01, totalSatang: 1_001, void: false }],
    initialBalanceSatang: 1_001,
  })
  await assert.rejects(
    () => createPayment(ledger.prisma, {
      folioId: 'folio-money-test',
      amountSatang: 1_002,
      method: 'CASH',
      allowOverpayment: true,
    }, actor),
    /cannot exceed the remaining balance/i,
  )
  assert.equal(ledger.payments.length, 0)
})

test('settling an overridden unpaid checkout closes its previously open folio', async () => {
  const ledger = createLedgerPrisma({
    charges: [{ id: 'charge-room', total: 12.34, totalSatang: 1_234, void: false }],
    initialBalanceSatang: 1_234,
    reservationStatus: 'CHECKED_OUT',
  })
  const settled = await createPayment(ledger.prisma, {
    folioId: 'folio-money-test',
    amountSatang: 1_234,
    method: 'CASH',
  }, actor)
  assert.equal(settled.folio.balanceSatang, 0)
  assert.equal(settled.folio.status, 'CLOSED')
})

test('checkout fails closed when the checked-in reservation folio is missing', async () => {
  let roomUpdates = 0
  const reservation = {
    id: 'reservation-missing-folio',
    propertyId: 'property-money-test',
    roomTypeId: 'room-type-money-test',
    status: 'CHECKED_IN',
    assignedRoomId: 'room-missing-folio',
    assignedRoom: {
      id: 'room-missing-folio',
      number: '102',
      currentStatus: 'OCCUPIED_CLEAN',
      currentReservation: 'reservation-missing-folio',
    },
    folio: null,
  }
  const tx = {
    reservation: { findUnique: async () => reservation },
    room: {
      updateMany: async () => {
        roomUpdates += 1
        return { count: 1 }
      },
    },
  }
  const prisma = { async $transaction(callback) { return callback(tx) } }

  await assert.rejects(
    () => checkOutReservation(prisma, reservation.id, actor),
    (error) => error?.statusCode === 409 && /folio is repaired/i.test(error.message),
  )
  assert.equal(roomUpdates, 0)
})

test('checkout rejects a negative folio instead of treating a credit as exact settlement', async () => {
  let roomUpdates = 0
  const reservation = {
    id: 'reservation-negative-folio',
    propertyId: 'property-money-test',
    roomTypeId: 'room-type-money-test',
    status: 'CHECKED_IN',
    assignedRoomId: 'room-negative-folio',
    assignedRoom: {
      id: 'room-negative-folio',
      number: '101',
      currentStatus: 'OCCUPIED_CLEAN',
      currentReservation: 'reservation-negative-folio',
    },
    folio: {
      id: 'folio-negative-folio',
      status: 'OPEN',
      balance: -1,
      balanceSatang: -100,
    },
  }
  const tx = {
    reservation: { findUnique: async () => reservation },
    room: {
      updateMany: async () => {
        roomUpdates += 1
        return { count: 1 }
      },
    },
  }
  const prisma = { async $transaction(callback) { return callback(tx) } }

  await assert.rejects(
    () => checkOutReservation(prisma, reservation.id, actor),
    (error) => error?.statusCode === 409 && /negative folio balance/i.test(error.message),
  )
  assert.equal(roomUpdates, 0)
})

test('incidental charge writer derives Float rollback values from authoritative satang', async () => {
  const charges = []
  const transactionOptions = []
  let folio = { id: 'folio-charge-test', status: 'OPEN', tax: 0, taxSatang: 0, balance: 0, balanceSatang: 0 }
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
  const prisma = {
    async $transaction(callback, options) {
      transactionOptions.push(options)
      return callback(tx)
    },
  }

  await assert.rejects(
    () => createCharge(prisma, {
      folioId: 'folio-charge-test',
      amountSatang: 100,
      quantity: 1,
      description: 'Forged email-linked charge',
      category: 'OTHER',
      sourceEmailEventId: 'forged-booking-email-event',
    }, actor),
    /cannot set internal booking-email provenance/i,
  )
  assert.equal(charges.length, 0)

  await assert.rejects(
    () => createCharge(prisma, {
      folioId: 'folio-charge-test',
      amountSatang: 100,
      quantity: 1,
      description: 'Forged second room charge',
      category: 'ROOM',
    }, actor),
    /room charges are managed by the reservation service/i,
  )
  assert.equal(charges.length, 0)

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
  assert.equal(transactionOptions.every((options) => options?.isolationLevel === 'Serializable'), true)
})

test('charge helper preserves explicit reservation totals while dual-writing room-rate fields', () => {
  assert.deepEqual(buildChargeMoneyFields('750.005', 2, '1800.005'), {
    amount: 750.01,
    amountSatang: 75_001,
    total: 1_800.01,
    totalSatang: 180_001,
  })
})

test('Lite charge helper derives rollback THB only from integer MoneySatang', () => {
  assert.deepEqual(buildChargeMoneyFieldsFromSatang(75_001, 2, 180_001), {
    amount: 750.01,
    amountSatang: 75_001,
    total: 1_800.01,
    totalSatang: 180_001,
  })
  assert.throws(() => buildChargeMoneyFieldsFromSatang(75_000.5, 1), /fractional satang/i)
})

test('payment and charge client request ids replay exact writes and reject conflicting reuse', async () => {
  const ledger = createMutableMoneyLedger({
    charges: [{ id: 'room-charge-idempotency', category: 'ROOM', description: 'Room', amount: 10, amountSatang: 1_000, quantity: 1, total: 10, totalSatang: 1_000 }],
  })

  const paymentInput = {
    folioId: 'folio-mutable-money',
    amountSatang: 400,
    method: 'CASH',
    notes: 'First installment',
    clientRequestId: 'payment-request-1',
  }
  const createdPayment = await createPayment(ledger.prisma, paymentInput, actor)
  const replayedPayment = await createPayment(ledger.prisma, paymentInput, actor)
  assert.equal(createdPayment.replayed, false)
  assert.equal(replayedPayment.replayed, true)
  assert.equal(replayedPayment.payment.id, createdPayment.payment.id)
  assert.equal(ledger.payments.length, 1)
  await assert.rejects(
    () => createPayment(ledger.prisma, { ...paymentInput, amountSatang: 300 }, actor),
    (error) => error?.statusCode === 409 && /different details/i.test(error.message),
  )

  const chargeInput = {
    folioId: 'folio-mutable-money',
    amountSatang: 250,
    quantity: 2,
    description: 'Laundry',
    category: 'LAUNDRY',
    date: '2026-07-15',
    clientRequestId: 'charge-request-1',
  }
  const createdCharge = await createCharge(ledger.prisma, chargeInput, actor)
  const replayedCharge = await createCharge(ledger.prisma, chargeInput, actor)
  assert.equal(createdCharge.replayed, false)
  assert.equal(replayedCharge.replayed, true)
  assert.equal(replayedCharge.charge.id, createdCharge.charge.id)
  assert.equal(ledger.charges.length, 2)
  await assert.rejects(
    () => createCharge(ledger.prisma, { ...chargeInput, description: 'Minibar' }, actor),
    (error) => error?.statusCode === 409 && /different details/i.test(error.message),
  )
  assert.equal(ledger.transactionOptions.every((options) => options?.isolationLevel === 'Serializable'), true)
})

test('payment reversal writes immutable signed rows, bounds cumulative reversals, and replays exactly', async () => {
  const ledger = createMutableMoneyLedger({
    charges: [{ id: 'room-charge-reversal', category: 'ROOM', description: 'Room', amount: 10, amountSatang: 1_000, quantity: 1, total: 10, totalSatang: 1_000 }],
    payments: [{ id: 'payment-original', folioId: 'folio-mutable-money', amount: 10, amountSatang: 1_000, method: 'CASH', processedBy: 'Cashier' }],
    folioStatus: 'CLOSED',
    reservationStatus: 'CHECKED_OUT',
    depositAmountSatang: 800,
    depositPaid: true,
    taxSatang: 70,
  })

  const partialInput = { amountSatang: 400, reason: 'Guest refund correction', clientRequestId: 'reversal-request-1' }
  const partial = await reversePayment(ledger.prisma, 'payment-original', partialInput, actor)
  const replay = await reversePayment(ledger.prisma, 'payment-original', partialInput, actor)
  assert.equal(partial.payment.entryKind, 'REVERSAL')
  assert.equal(partial.payment.amountSatang, -400)
  assert.equal(partial.payment.amount, -4)
  assert.equal(partial.payment.reversesPaymentId, 'payment-original')
  assert.equal(partial.folio.taxSatang, 70)
  assert.equal(partial.folio.paidSatang, 600)
  assert.equal(partial.folio.balanceSatang, 470)
  assert.equal(partial.folio.status, 'OPEN')
  assert.equal(partial.folio.reservation.depositPaid, false)
  assert.equal(replay.replayed, true)
  assert.equal(ledger.payments.length, 2)
  await assert.rejects(
    () => reversePayment(ledger.prisma, 'payment-original', { ...partialInput, amountSatang: 300 }, actor),
    (error) => error?.statusCode === 409 && /different details/i.test(error.message),
  )
  await assert.rejects(
    () => reversePayment(ledger.prisma, 'payment-original', { amountSatang: 601, reason: 'Too much refund' }, actor),
    (error) => error?.statusCode === 409 && /cannot exceed/i.test(error.message),
  )

  const full = await reversePayment(ledger.prisma, 'payment-original', { reason: 'Refund remaining amount', clientRequestId: 'reversal-request-2' }, actor)
  assert.equal(full.payment.amountSatang, -600)
  assert.equal(full.folio.paidSatang, 0)
  await assert.rejects(
    () => reversePayment(ledger.prisma, 'payment-original', { amountSatang: 1, reason: 'No balance remains' }, actor),
    (error) => error?.statusCode === 409 && /fully reversed/i.test(error.message),
  )
  assert.equal(ledger.audits.filter((audit) => audit.action === 'PAYMENT_REVERSED').length, 2)
})

test('payment reversal enforces refund permission and a nonblank operational reason', async () => {
  const ledger = createMutableMoneyLedger({
    payments: [{ id: 'payment-rbac', folioId: 'folio-mutable-money', amount: 1, amountSatang: 100, method: 'CASH' }],
  })
  await assert.rejects(
    () => reversePayment(ledger.prisma, 'payment-rbac', { reason: 'Manager request' }, { ...actor, role: 'MANAGER' }),
    (error) => error?.statusCode === 403 && /refund:payment/i.test(error.message),
  )
  await assert.rejects(
    () => reversePayment(ledger.prisma, 'payment-rbac', { reason: '  ' }, actor),
    /operational reason/i,
  )
  assert.equal(ledger.transactionOptions.length, 0)
})

test('elevated charge void is audited, idempotent, tax-preserving, and reopens an unsettled checked-out folio', async () => {
  const ledger = createMutableMoneyLedger({
    charges: [{ id: 'charge-to-void', category: 'MINIBAR', description: 'Minibar', amount: 5, amountSatang: 500, quantity: 1, total: 5, totalSatang: 500 }],
    payments: [{ id: 'payment-for-void', folioId: 'folio-mutable-money', amount: 5.7, amountSatang: 570, method: 'CASH' }],
    folioStatus: 'CLOSED',
    reservationStatus: 'CHECKED_OUT',
    taxSatang: 70,
  })
  const input = { reason: 'Duplicate minibar posting', clientRequestId: 'void-request-1' }
  const result = await voidCharge(ledger.prisma, 'charge-to-void', input, actor)
  const replay = await voidCharge(ledger.prisma, 'charge-to-void', input, actor)
  assert.equal(result.charge.void, true)
  assert.equal(result.charge.voidReason, input.reason)
  assert.equal(result.charge.voidRequestId, input.clientRequestId)
  assert.ok(result.charge.voidedAt instanceof Date)
  assert.equal(result.charge.voidedBy, actor.name)
  assert.equal(result.folio.subtotalSatang, 0)
  assert.equal(result.folio.taxSatang, 70)
  assert.equal(result.folio.balanceSatang, -500)
  assert.equal(result.folio.status, 'OPEN')
  assert.equal(replay.replayed, true)
  assert.equal(ledger.audits.filter((audit) => audit.action === 'CHARGE_VOIDED').length, 1)
  await assert.rejects(
    () => voidCharge(ledger.prisma, 'charge-to-void', { ...input, reason: 'Different reason' }, actor),
    (error) => error?.statusCode === 409 && /different details/i.test(error.message),
  )
  await assert.rejects(
    () => voidCharge(ledger.prisma, 'charge-to-void', input, { ...actor, role: 'FRONT_DESK' }),
    (error) => error?.statusCode === 403 && /manager or administrator/i.test(error.message),
  )
})
