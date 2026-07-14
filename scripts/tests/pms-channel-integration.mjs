import assert from 'node:assert/strict'
import {
  approveBookingEmailEvent,
  cancelReservation,
  checkOutReservation,
  createSetupRoom,
  createReservation,
  deleteSetupRoom,
  rejectBookingEmailEvent,
  reprocessBookingEmailEvent,
  updateHousekeepingStatus,
  updateRoomOperationalStatus,
  updateReservation,
  updateSetupRoom,
} from '../../server/pms-service.mjs'
import {
  buildManualChannelExternalReferenceKey,
  reconcileManualChannelTasksInTransaction,
} from '../../server/manual-channel-service.mjs'
import { dateFromKey, getBangkokDateKey } from '../../server/pms-domain.mjs'

const actor = { id: 'manager-channel-test', username: 'manager.channel', name: 'Manager Channel', role: 'MANAGER' }
const integrationTodayKey = getBangkokDateKey(new Date())

function integrationDate(offsetDays) {
  const date = dateFromKey(integrationTodayKey)
  date.setUTCDate(date.getUTCDate() + offsetDays)
  return date
}

function integrationDateKey(offsetDays) {
  return integrationDate(offsetDays).toISOString().slice(0, 10)
}

const now = integrationDate(-1)

await assert.rejects(
  () => createReservation({}, { manualChannelContext: { sourceProviderAlreadyUpdated: true } }, actor),
  /cannot set internal integration fields/i,
  'public reservation creation cannot suppress manual OTA tasks with internal context',
)
await assert.rejects(
  () => updateReservation({}, 'reservation-test', { sourceEmailEventId: 'forged-email-event' }, actor),
  /cannot set internal integration fields/i,
  'public reservation updates cannot forge booking-email linkage',
)
await assert.rejects(
  () => createReservation({}, { status: 'CHECKED_IN' }, actor),
  /cannot set internal integration fields: status/i,
  'public reservation creation cannot forge a lifecycle status',
)
await assert.rejects(
  () => createReservation({}, { authoritativeTotalSatang: 1 }, actor),
  /cannot set internal integration fields: authoritativeTotalSatang/i,
  'public reservation creation cannot forge an OTA-authoritative total',
)

function createMutationFixture(eventType) {
  const property = {
    id: 'property-channel-test',
    code: 'SANDBOX',
    name: 'SANDBOX HOTEL',
    currency: 'THB',
    extraGuestFee: 300,
    childFee: 200,
  }
  const roomType = {
    id: 'room-type-twin',
    propertyId: property.id,
    code: 'TWIN',
    name: 'Twin Room',
    baseRate: 1_500,
    standardOcc: 2,
    maxOccupancy: 4,
  }
  const externalReservationId = 'TRIP-REF-1001'
  const externalReferenceKey = buildManualChannelExternalReferenceKey(
    property.id,
    'trip_com',
    externalReservationId,
  )
  const reservation = {
    id: 'reservation-channel-test',
    propertyId: property.id,
    confirmationCode: externalReservationId,
    guestId: 'guest-channel-test',
    guest: { id: 'guest-channel-test', firstName: 'Test', lastName: 'Guest' },
    roomTypeId: roomType.id,
    roomType,
    assignedRoomId: null,
    assignedRoom: null,
    checkIn: integrationDate(1),
    checkOut: integrationDate(3),
    status: 'CONFIRMED',
    adults: 2,
    children: 0,
    childAges: [],
    ratePerNight: 1_500,
    ratePerNightSatang: 150_000,
    totalAmount: 3_000,
    totalAmountSatang: 300_000,
    depositAmount: 900,
    depositAmountSatang: 90_000,
    depositPaid: false,
    source: 'TRIP_COM',
    channelRef: externalReservationId,
    providerCode: 'trip_com',
    externalReservationId,
    externalReferenceKey,
    sourceEmailEventId: null,
    notes: null,
    specialRequests: null,
    folio: null,
    sourceEmailEvent: null,
    bookingEmailEvents: [],
  }
  const source = {
    id: 'booking-email-source-channel-test',
    propertyId: property.id,
    name: 'Primary booking Gmail',
    mailbox: 'booking@sandboxhotel.com',
    provider: 'GMAIL',
  }
  const event = {
    id: `booking-email-${eventType.toLowerCase()}`,
    propertyId: property.id,
    sourceId: source.id,
    source,
    sourceName: source.name,
    sourceMailbox: source.mailbox,
    sourceMessageId: `gmail-${eventType.toLowerCase()}`,
    sender: 'Trip.com <notification@trip.com>',
    recipient: source.mailbox,
    subject: `${eventType} ${externalReservationId}`,
    receivedAt: now,
    eventType,
    status: 'NEEDS_REVIEW',
    confidence: 0.95,
    channelRef: externalReservationId,
    providerCode: 'trip_com',
    externalReservationId,
    amount: eventType === 'MODIFICATION' ? 4_500 : null,
    amountSatang: eventType === 'MODIFICATION' ? 450_000 : null,
    currency: 'THB',
    parsedDetails: eventType === 'MODIFICATION'
      ? {
          checkIn: integrationDateKey(2),
          checkOut: integrationDateKey(5),
          adults: 3,
          children: 1,
          childAges: [8],
          amount: 4_500,
          amountKind: 'STAY_TOTAL',
          currency: 'THB',
        }
      : { currency: 'THB' },
    reviewReason: null,
    errorReason: null,
    reservationId: null,
    processedAt: null,
    processedBy: null,
    rejectedAt: null,
    duplicateOfEventId: null,
    createdAt: now,
    updatedAt: now,
  }
  const audits = []
  const reservationLogs = []
  const payments = []
  const connectionQueries = []
  const externalReferenceQueries = []
  const providerScopedLegacyQueries = []
  let newerProcessedLifecycleEvent = null
  const folio = {
    id: 'folio-channel-test',
    reservationId: reservation.id,
    status: 'OPEN',
    subtotal: 3_000,
    subtotalSatang: 300_000,
    tax: 0,
    taxSatang: 0,
    total: 3_000,
    totalSatang: 300_000,
    paid: 0,
    paidSatang: 0,
    balance: 3_000,
    balanceSatang: 300_000,
  }
  const roomCharge = {
    id: 'charge-room-channel-test',
    folioId: folio.id,
    category: 'ROOM',
    amount: 1_500,
    amountSatang: 150_000,
    quantity: 2,
    total: 3_000,
    totalSatang: 300_000,
    void: false,
    createdAt: now,
  }

  const withReservationRelations = () => ({
    ...reservation,
    roomType,
    folio: { ...folio, charges: [roomCharge], payments },
  })
  const withEventRelations = () => ({ ...event, source, reservation: event.reservationId ? withReservationRelations() : null })

  const prisma = {
    property: {
      findUnique: async ({ where }) => (where?.id === property.id || where?.code === property.code ? property : null),
    },
    roomType: {
      findFirst: async ({ where }) => (where?.propertyId === property.id && where?.code === roomType.code ? roomType : null),
    },
    room: {
      count: async () => 5,
      findUnique: async () => null,
    },
    reservation: {
      findUnique: async ({ where }) => {
        if (where?.externalReferenceKey) {
          externalReferenceQueries.push(where.externalReferenceKey)
          return where.externalReferenceKey === reservation.externalReferenceKey ? withReservationRelations() : null
        }
        return where?.id === reservation.id ? withReservationRelations() : null
      },
      findFirst: async ({ where }) => {
        if (where?.providerCode) providerScopedLegacyQueries.push(where)
        return null
      },
      findMany: async () => (['PENDING', 'CONFIRMED', 'CHECKED_IN', 'HOLD'].includes(reservation.status)
        ? [{ checkIn: reservation.checkIn, checkOut: reservation.checkOut }]
        : []),
      count: async () => 0,
      update: async ({ where, data }) => {
        assert.equal(where.id, reservation.id)
        Object.assign(reservation, data, { updatedAt: now })
        return withReservationRelations()
      },
    },
    roomDateInventory: {
      deleteMany: async () => ({ count: 0 }),
      findMany: async () => [],
    },
    inventoryHold: {
      findMany: async () => [],
    },
    charge: {
      findMany: async () => [roomCharge],
      update: async ({ where, data }) => {
        assert.equal(where.id, roomCharge.id)
        Object.assign(roomCharge, data)
        return roomCharge
      },
    },
    payment: {
      findUnique: async ({ where }) => payments.find((payment) => (
        (where?.referenceFingerprint && payment.referenceFingerprint === where.referenceFingerprint)
        || (where?.sourceEmailEventId && payment.sourceEmailEventId === where.sourceEmailEventId)
      )) || null,
      create: async ({ data }) => {
        const payment = { id: `payment-channel-${payments.length + 1}`, ...data }
        payments.push(payment)
        return payment
      },
      findMany: async () => payments,
    },
    folio: {
      findUnique: async ({ where }) => (where?.id === folio.id ? { ...folio } : null),
      update: async ({ where, data }) => {
        assert.equal(where.id, folio.id)
        Object.assign(folio, data)
        return { ...folio, charges: [roomCharge], payments, reservation: withReservationRelations() }
      },
    },
    bookingEmailEvent: {
      findUnique: async ({ where }) => (where?.id === event.id ? withEventRelations() : null),
      findFirst: async ({ where } = {}) => {
        if (where?.reservationId === reservation.id && where?.status === 'PROCESSED') {
          return newerProcessedLifecycleEvent
        }
        return null
      },
      findMany: async () => [],
      update: async ({ where, data }) => {
        assert.equal(where.id, event.id)
        Object.assign(event, data, { updatedAt: now })
        return withEventRelations()
      },
    },
    manualChannelConnection: {
      findMany: async ({ where }) => {
        connectionQueries.push(where)
        return []
      },
    },
    reservationLog: {
      create: async ({ data }) => {
        reservationLogs.push(data)
        return data
      },
    },
    auditLog: {
      create: async ({ data }) => {
        audits.push(data)
        return data
      },
    },
    $transaction: async (callback) => callback(prisma),
  }

  return {
    prisma,
    reservation,
    event,
    audits,
    reservationLogs,
    payments,
    roomCharge,
    connectionQueries,
    externalReferenceQueries,
    providerScopedLegacyQueries,
    externalReferenceKey,
    setNewerProcessedLifecycleEvent(value) {
      newerProcessedLifecycleEvent = value
    },
  }
}

const modification = createMutationFixture('MODIFICATION')
const approvedModification = await approveBookingEmailEvent(modification.prisma, modification.event.id, {
  reservationId: modification.reservation.id,
  reason: 'Guest changed stay dates in the Trip.com Extranet.',
}, actor)
assert.equal(approvedModification.status, 'PROCESSED', 'approved booking-email modifications are marked processed')
assert.equal(modification.reservation.checkIn.toISOString().slice(0, 10), integrationDateKey(2), 'approved booking-email modifications apply the new check-in date')
assert.equal(modification.reservation.checkOut.toISOString().slice(0, 10), integrationDateKey(5), 'approved booking-email modifications apply the new check-out date')
assert.equal(modification.reservation.adults, 3, 'approved booking-email modifications apply adult occupancy')
assert.equal(modification.reservation.children, 1, 'approved booking-email modifications apply child occupancy')
assert.deepEqual(modification.reservation.childAges, [8], 'approved booking-email modifications apply child ages')
assert.equal(modification.reservation.totalAmount, 4_500, 'the provider-reported stay total is not inflated by PMS occupancy supplements')
assert.equal(modification.reservation.totalAmountSatang, 450_000, 'the provider-reported stay total is persisted in exact satang')
assert.equal(modification.reservation.depositAmountSatang, 135_000, 'the deposit is recomputed from the exact provider total')
assert.equal(modification.reservation.providerTotalSatang, 450_000, 'the exact provider total is persisted as pricing provenance')
assert.equal(modification.reservation.providerTotalCurrency, 'THB', 'provider pricing provenance stores the verified property currency')
assert.equal(modification.roomCharge.description, 'Twin Room 3 nights', 'repricing refreshes the canonical room-charge description')
assert.equal(modification.connectionQueries.length, 1, 'approved inventory-changing modifications reconcile the manual channel queue in-transaction')
assert.deepEqual(
  modification.connectionQueries[0].providerCode.in,
  ['booking_com', 'agoda', 'trip_com'],
  'approved modifications reconcile every manual OTA, including the source provider',
)
assert.equal(
  modification.audits.some((audit) => audit.action === 'BOOKING_EMAIL_MODIFIED_RESERVATION'),
  true,
  'approved booking-email modifications retain an explicit audit event',
)

const modificationWithoutReason = createMutationFixture('MODIFICATION')
await assert.rejects(
  () => approveBookingEmailEvent(modificationWithoutReason.prisma, modificationWithoutReason.event.id, {
    reservationId: modificationWithoutReason.reservation.id,
  }, actor),
  /operational reason/i,
  'booking-email modification approval requires a backend-enforced operational reason',
)

const cancellation = createMutationFixture('CANCELLATION')
cancellation.reservation.notes = 'Keep the original guest and operations note.'
const approvedCancellation = await approveBookingEmailEvent(cancellation.prisma, cancellation.event.id, {
  reservationId: cancellation.reservation.id,
  reason: 'Cancellation confirmed in the Trip.com Extranet.',
}, actor)
assert.equal(approvedCancellation.status, 'PROCESSED', 'approved booking-email cancellations are marked processed')
assert.equal(cancellation.reservation.status, 'CANCELLED', 'provider-scoped booking-email cancellation cancels the matched reservation')
assert.match(cancellation.reservation.notes, /Keep the original guest and operations note/, 'cancellation preserves existing reservation notes')
assert.match(cancellation.reservation.notes, /Cancellation reason:/, 'cancellation appends the audited operational reason')
assert.deepEqual(
  cancellation.externalReferenceQueries,
  [],
  'an explicitly linked cancellation does not rerun heuristic reservation matching',
)
assert.equal(cancellation.providerScopedLegacyQueries.length, 0, 'an exact provider reference match avoids legacy or fuzzy matching')
assert.deepEqual(
  cancellation.connectionQueries[0].providerCode.in,
  ['booking_com', 'agoda', 'trip_com'],
  'approved cancellations reconcile every manual OTA, including the source provider',
)

for (const staleEventType of ['MODIFICATION', 'CANCELLATION']) {
  const staleLifecycle = createMutationFixture(staleEventType)
  const originalCheckIn = staleLifecycle.reservation.checkIn.toISOString()
  const originalCheckOut = staleLifecycle.reservation.checkOut.toISOString()
  staleLifecycle.setNewerProcessedLifecycleEvent({
    id: `newer-${staleEventType.toLowerCase()}`,
    eventType: staleEventType === 'MODIFICATION' ? 'CANCELLATION' : 'MODIFICATION',
    receivedAt: new Date(staleLifecycle.event.receivedAt.getTime() + 60_000),
  })

  await assert.rejects(
    () => approveBookingEmailEvent(staleLifecycle.prisma, staleLifecycle.event.id, {
      reservationId: staleLifecycle.reservation.id,
      reason: 'Provider timeline review for stale lifecycle protection.',
    }, actor),
    /same-time or newer provider modification\/cancellation/i,
    `an older ${staleEventType.toLowerCase()} cannot overwrite a newer processed lifecycle event`,
  )
  assert.equal(staleLifecycle.event.status, 'NEEDS_REVIEW', 'stale lifecycle email remains review work')
  assert.equal(staleLifecycle.reservation.status, 'CONFIRMED', 'stale lifecycle email does not change reservation status')
  assert.equal(staleLifecycle.reservation.checkIn.toISOString(), originalCheckIn, 'stale lifecycle email does not change check-in')
  assert.equal(staleLifecycle.reservation.checkOut.toISOString(), originalCheckOut, 'stale lifecycle email does not change check-out')
  assert.equal(staleLifecycle.connectionQueries.length, 0, 'stale lifecycle email does not enqueue manual OTA work')
  assert.equal(staleLifecycle.audits.length, 1, 'stale lifecycle email records one durable denial audit')
  assert.equal(staleLifecycle.audits[0].action, 'BOOKING_EMAIL_LIFECYCLE_DENIED')
  assert.equal(staleLifecycle.audits[0].entityId, staleLifecycle.event.id)
  assert.equal(staleLifecycle.audits[0].changes.reasonCode, 'STALE_PROVIDER_LIFECYCLE_EVENT')
  assert.equal(staleLifecycle.audits[0].changes.reservationId, staleLifecycle.reservation.id)
  assert.equal(staleLifecycle.audits[0].changes.attemptedEventType, staleEventType)
}

const modificationCurrencyMismatch = createMutationFixture('MODIFICATION')
modificationCurrencyMismatch.event.parsedDetails.currency = 'USD'
modificationCurrencyMismatch.event.currency = 'USD'
await assert.rejects(
  () => approveBookingEmailEvent(modificationCurrencyMismatch.prisma, modificationCurrencyMismatch.event.id, {
    reservationId: modificationCurrencyMismatch.reservation.id,
    reason: 'Guest changed stay dates in the Trip.com Extranet.',
  }, actor),
  /currency USD does not match the property currency THB/i,
  'booking-email amounts in a different currency require review instead of silent conversion',
)
assert.equal(modificationCurrencyMismatch.event.status, 'NEEDS_REVIEW', 'a currency mismatch leaves the source event unprocessed')
assert.equal(modificationCurrencyMismatch.reservation.totalAmount, 3_000, 'a currency mismatch leaves the reservation total unchanged')

const paymentCurrencyMismatch = createMutationFixture('PAYMENT_NOTICE')
paymentCurrencyMismatch.event.parsedDetails = { amount: 1_000, amountKind: 'PAYMENT', currency: 'USD' }
paymentCurrencyMismatch.event.amount = 1_000
paymentCurrencyMismatch.event.amountSatang = 100_000
paymentCurrencyMismatch.event.currency = 'USD'
await assert.rejects(
  () => approveBookingEmailEvent(paymentCurrencyMismatch.prisma, paymentCurrencyMismatch.event.id, {
    reservationId: paymentCurrencyMismatch.reservation.id,
  }, actor),
  /currency USD does not match the property currency THB/i,
  'payment notices in a different currency cannot silently post to the folio',
)
assert.equal(paymentCurrencyMismatch.event.status, 'NEEDS_REVIEW', 'a payment currency mismatch remains in review')

const installmentPayments = createMutationFixture('PAYMENT_NOTICE')
installmentPayments.event.amount = 400
installmentPayments.event.amountSatang = 40_000
installmentPayments.event.parsedDetails = { amount: 400, amountKind: 'PAYMENT', currency: 'THB' }
const firstPaymentEventId = installmentPayments.event.id
await approveBookingEmailEvent(installmentPayments.prisma, firstPaymentEventId, {
  reservationId: installmentPayments.reservation.id,
}, actor)
assert.equal(installmentPayments.payments.length, 1, 'the first payment notice creates one exact payment')
assert.equal(installmentPayments.reservation.depositPaid, false, 'a partial payment below the deposit threshold stays pending')
assert.equal(installmentPayments.reservationLogs.some((log) => log.action === 'DEPOSIT_PAID'), false, 'partial payment does not falsely log deposit paid')

installmentPayments.event.id = 'booking-email-payment-notice-second'
installmentPayments.event.sourceMessageId = 'gmail-payment-notice-second'
installmentPayments.event.status = 'NEEDS_REVIEW'
installmentPayments.event.reservationId = null
installmentPayments.event.processedAt = null
installmentPayments.event.processedBy = null
installmentPayments.event.completedAction = null
installmentPayments.event.amount = 600
installmentPayments.event.amountSatang = 60_000
installmentPayments.event.parsedDetails = { amount: 600, amountKind: 'PAYMENT', currency: 'THB' }
await approveBookingEmailEvent(installmentPayments.prisma, installmentPayments.event.id, {
  reservationId: installmentPayments.reservation.id,
}, actor)
assert.equal(installmentPayments.payments.length, 2, 'a second notice for the same booking reference creates a distinct installment')
assert.notEqual(installmentPayments.payments[0].referenceFingerprint, installmentPayments.payments[1].referenceFingerprint, 'source message ids keep installment payment references distinct')
assert.equal(installmentPayments.reservation.depositPaid, true, 'cumulative payments mark the deposit paid only after reaching its threshold')
assert.equal(installmentPayments.reservationLogs.filter((log) => log.action === 'DEPOSIT_PAID').length, 1, 'deposit threshold crossing is logged exactly once')
await assert.rejects(
  () => approveBookingEmailEvent(installmentPayments.prisma, installmentPayments.event.id, {
    reservationId: installmentPayments.reservation.id,
  }, actor),
  /already been processed/i,
  'replaying the same payment notice is rejected',
)
assert.equal(installmentPayments.payments.length, 2, 'replayed notice does not create a duplicate payment')

const relabelledCurrency = createMutationFixture('MODIFICATION')
relabelledCurrency.event.currency = 'USD'
relabelledCurrency.event.parsedDetails.currency = 'USD'
await assert.rejects(
  () => approveBookingEmailEvent(relabelledCurrency.prisma, relabelledCurrency.event.id, {
    reservationId: relabelledCurrency.reservation.id,
    reason: 'A caller must not relabel a provider amount during approval.',
    editedDetails: { currency: 'THB' },
  }, actor),
  /currency cannot be relabelled/i,
  'approval input cannot relabel a persisted provider currency',
)

const duplicateRoomCharges = createMutationFixture('MODIFICATION')
duplicateRoomCharges.prisma.charge.findMany = async () => [
  { id: 'room-charge-1', category: 'ROOM', void: false },
  { id: 'room-charge-2', category: 'ROOM', void: false },
]
await assert.rejects(
  () => approveBookingEmailEvent(duplicateRoomCharges.prisma, duplicateRoomCharges.event.id, {
    reservationId: duplicateRoomCharges.reservation.id,
    reason: 'Provider supplied a new inclusive stay total.',
  }, actor),
  /exactly one active room charge/i,
  'provider repricing fails closed when a folio has multiple active room charges',
)

const increasedDepositRequirement = createMutationFixture('MODIFICATION')
increasedDepositRequirement.reservation.depositPaid = true
increasedDepositRequirement.prisma.payment.findMany = async () => [{ amount: 1_000, amountSatang: 100_000 }]
await approveBookingEmailEvent(increasedDepositRequirement.prisma, increasedDepositRequirement.event.id, {
  reservationId: increasedDepositRequirement.reservation.id,
  reason: 'Provider supplied a higher inclusive stay total.',
}, actor)
assert.equal(increasedDepositRequirement.reservation.depositPaid, false, 'repricing clears depositPaid when the new deposit threshold exceeds paid funds')

const decreasedDepositRequirement = createMutationFixture('MODIFICATION')
decreasedDepositRequirement.event.amount = 2_000
decreasedDepositRequirement.event.amountSatang = 200_000
decreasedDepositRequirement.event.parsedDetails.amount = 2_000
decreasedDepositRequirement.prisma.payment.findMany = async () => [{ amount: 1_000, amountSatang: 100_000 }]
await approveBookingEmailEvent(decreasedDepositRequirement.prisma, decreasedDepositRequirement.event.id, {
  reservationId: decreasedDepositRequirement.reservation.id,
  reason: 'Provider supplied a lower inclusive stay total.',
}, actor)
assert.equal(decreasedDepositRequirement.reservation.depositPaid, true, 'repricing marks depositPaid when paid funds meet the reduced threshold')

await updateReservation(modification.prisma, modification.reservation.id, {
  notes: 'Non-pricing follow-up note.',
}, actor)
assert.equal(modification.reservation.totalAmountSatang, 450_000, 'a later non-pricing edit preserves the persisted provider total')
assert.equal(modification.reservation.providerTotalSatang, 450_000, 'a later non-pricing edit preserves provider pricing provenance')
await assert.rejects(
  () => updateReservation(modification.prisma, modification.reservation.id, {
    checkOut: integrationDateKey(6),
  }, actor),
  /cannot change dates, room type, occupancy, or rate without a new parser-verified stay total/i,
  'a provider-priced reservation cannot be repriced by a public date edit without a new verified total',
)

const manualOtaReservation = createMutationFixture('MODIFICATION')
Object.assign(manualOtaReservation.reservation, {
  source: 'AGODA',
  channelRef: null,
  providerCode: null,
  externalReservationId: null,
  externalReferenceKey: null,
  providerTotalSatang: null,
  providerTotalCurrency: null,
  sourceEmailEventId: null,
})
await updateReservation(manualOtaReservation.prisma, manualOtaReservation.reservation.id, {
  checkOut: integrationDateKey(4),
}, actor)
assert.equal(
  manualOtaReservation.reservation.checkOut.toISOString().slice(0, 10),
  integrationDateKey(4),
  'an OTA source label without trusted provider pricing provenance remains editable',
)

const unauthorizedCancellation = createMutationFixture('CANCELLATION')
await assert.rejects(
  () => approveBookingEmailEvent(unauthorizedCancellation.prisma, unauthorizedCancellation.event.id, {
    reason: 'Front desk must not bypass cancellation authority.',
  }, { id: 'front-channel-test', username: 'front.channel', role: 'FRONT_DESK' }),
  (error) => error?.statusCode === 403 && /cancel:reservation permission/i.test(error.message),
  'booking-email cancellation approval enforces cancel permission inside the service',
)
assert.equal(unauthorizedCancellation.reservation.status, 'CONFIRMED', 'denied email cancellation leaves the reservation unchanged')

const spoofedCancellationCreate = createMutationFixture('CANCELLATION')
await assert.rejects(
  () => approveBookingEmailEvent(spoofedCancellationCreate.prisma, spoofedCancellationCreate.event.id, {
    mode: 'create_reservation',
    reason: 'A cancellation must never be retyped into reservation creation.',
  }, actor),
  /only a new-booking email can create a reservation/i,
  'approval mode cannot retype a non-booking event into a new reservation',
)

const cancellationWithoutReason = createMutationFixture('CANCELLATION')
await assert.rejects(
  () => approveBookingEmailEvent(cancellationWithoutReason.prisma, cancellationWithoutReason.event.id, {}, actor),
  /operational reason/i,
  'booking-email cancellation approval requires a backend-enforced operational reason',
)

for (const [eventType, input] of [
  ['PAYMENT_NOTICE', {}],
  ['CANCELLATION', { reason: 'Provider cancellation requires an explicitly linked reservation.' }],
  ['MODIFICATION', { reason: 'Provider modification requires an explicitly linked reservation.' }],
]) {
  const unmatchedWrite = createMutationFixture(eventType)
  await assert.rejects(
    () => approveBookingEmailEvent(unmatchedWrite.prisma, unmatchedWrite.event.id, input, actor),
    /link this .* to a reservation before applying it/i,
    `unmatched ${eventType} email cannot mutate a guest-and-date heuristic reservation`,
  )
  assert.equal(unmatchedWrite.event.status, 'NEEDS_REVIEW', `unmatched ${eventType} remains in review`)
  assert.equal(unmatchedWrite.payments.length, 0, `unmatched ${eventType} creates no payment`)
  assert.equal(unmatchedWrite.reservation.status, 'CONFIRMED', `unmatched ${eventType} does not change reservation lifecycle`)
  assert.equal(unmatchedWrite.audits.length, 0, `unmatched ${eventType} creates no mutation audit`)
}

await assert.rejects(
  () => cancelReservation(cancellation.prisma, cancellation.reservation.id, actor, 'CANCELLED'),
  /operational reason/i,
  'reservation cancellation requires a backend-enforced operational reason',
)

const staleSourceTask = {
  id: 'task-stale-source-provider',
  propertyId: 'property-channel-test',
  connectionId: 'connection-trip',
  roomTypeId: 'room-type-twin',
  stayDate: integrationDate(4),
  desiredAvailability: 1,
  confirmedAvailability: null,
  status: 'PENDING',
  revision: 1,
  activeKey: 'stale-active-key',
  createdAt: now,
}
const sourceProviderConnectionQueries = []
const sourceProviderTaskUpdates = []
const sourceProviderTaskCreates = []
const sourceProviderTx = {
  manualChannelConnection: {
    findMany: async ({ where }) => {
      sourceProviderConnectionQueries.push(where)
      return [{
        id: 'connection-trip',
        propertyId: 'property-channel-test',
        providerCode: 'trip_com',
        deliveryMode: 'MANUAL',
        enabled: true,
        mappings: [{
          id: 'mapping-trip-twin',
          roomTypeId: 'room-type-twin',
          externalRoomTypeId: 'trip-twin',
          externalRoomTypeName: 'Twin Room',
          externalRatePlanId: 'trip-standard',
          active: true,
        }],
      }]
    },
  },
  room: {
    count: async () => 5,
  },
  reservation: {
    findMany: async () => [{
      checkIn: integrationDate(3),
      checkOut: integrationDate(5),
    }],
  },
  inventoryHold: {
    findMany: async () => [],
  },
  roomDateInventory: {
    findMany: async () => [],
  },
  manualChannelTask: {
    findMany: async () => [staleSourceTask],
    update: async ({ where, data }) => {
      assert.equal(where.id, staleSourceTask.id)
      sourceProviderTaskUpdates.push(data)
      return { ...staleSourceTask, ...data }
    },
    create: async ({ data }) => {
      const task = { id: 'task-source-provider-reconciled', createdAt: now, ...data }
      sourceProviderTaskCreates.push(task)
      return task
    },
  },
  auditLog: {
    create: async ({ data }) => data,
  },
}
const sourceProviderReconciliation = await reconcileManualChannelTasksInTransaction(sourceProviderTx, {
  propertyId: 'property-channel-test',
  affected: [{ roomTypeId: 'room-type-twin', date: integrationDateKey(4) }],
  triggerType: 'BOOKING_EMAIL_MODIFICATION_APPROVED',
  sourceProviderCode: 'trip_com',
  sourceProviderAlreadyUpdated: true,
  sourceReservationId: 'reservation-channel-test',
  sourceBookingEmailEventId: 'booking-email-modification',
}, actor)
assert.deepEqual(
  sourceProviderConnectionQueries[0].providerCode.in,
  ['booking_com', 'agoda', 'trip_com'],
  'source-provider reconciliation queries every enabled manual OTA',
)
assert.equal(sourceProviderTaskUpdates[0].status, 'SUPERSEDED', 'a stale pending source-provider task is superseded')
assert.equal(sourceProviderTaskUpdates[0].activeKey, null, 'the stale source-provider task releases its active key')
assert.equal(sourceProviderTaskCreates[0].desiredAvailability, 4, 'the replacement source-provider task uses current absolute PMS availability')
assert.equal(sourceProviderTaskCreates[0].sourceProviderCode, 'trip_com', 'replacement tasks preserve source-provider metadata')
assert.equal(sourceProviderReconciliation.excludedProviderCode, null, 'source providers are never excluded from an absolute-availability queue')
assert.equal(sourceProviderReconciliation.sourceProviderAlreadyUpdated, true, 'source update state remains available for audit evidence')

const processed = createMutationFixture('MODIFICATION')
processed.event.status = 'PROCESSED'
processed.event.processedAt = now
await assert.rejects(
  () => reprocessBookingEmailEvent(processed.prisma, processed.event.id, actor),
  (error) => error?.statusCode === 409 && /cannot be reprocessed/i.test(error.message),
  'processed booking-email events cannot be reprocessed',
)
await assert.rejects(
  () => rejectBookingEmailEvent(processed.prisma, processed.event.id, { reason: 'Incorrect late rejection.' }, actor),
  (error) => error?.statusCode === 409 && /cannot be rejected/i.test(error.message),
  'processed booking-email evidence cannot be changed to ignored',
)

const verifiedReprocess = createMutationFixture('MODIFICATION')
verifiedReprocess.event.reservationId = null
verifiedReprocess.event.subject = 'Booking modification TRIP-REF-1001'
verifiedReprocess.event.rawText = 'Booking reference: TRIP-REF-1001 Check-in: 2026-08-01 Check-out: 2026-08-03 Room type: Twin Total amount: THB 3000'
verifiedReprocess.event.rawHeaders = {
  authenticationResults: 'mx.google.com; dmarc=pass header.from=trip.com',
}
await reprocessBookingEmailEvent(verifiedReprocess.prisma, verifiedReprocess.event.id, actor)
assert.equal(verifiedReprocess.event.providerCode, 'trip_com', 'reprocess retains provider identity only from immutable verified Gmail headers')
assert.equal(verifiedReprocess.event.reservationId, verifiedReprocess.reservation.id, 'reprocess recomputes an exact provider-scoped reservation match')

const unverifiedReprocess = createMutationFixture('MODIFICATION')
unverifiedReprocess.event.reservationId = unverifiedReprocess.reservation.id
unverifiedReprocess.event.providerCode = 'trip_com'
unverifiedReprocess.event.externalReservationId = 'STALE-REF'
unverifiedReprocess.event.channelRef = 'STALE-REF'
unverifiedReprocess.event.amount = 999
unverifiedReprocess.event.amountSatang = 99_900
unverifiedReprocess.event.currency = 'USD'
unverifiedReprocess.event.parsedDetails = {
  channelRef: 'STALE-REF',
  amount: 999,
  amountKind: 'STAY_TOTAL',
  currency: 'USD',
}
unverifiedReprocess.event.subject = 'Account security update'
unverifiedReprocess.event.rawText = 'Weekly performance report. No reservation action is present.'
unverifiedReprocess.event.rawHeaders = {
  authenticationResults: 'attacker.example; dmarc=pass header.from=trip.com',
}
await reprocessBookingEmailEvent(unverifiedReprocess.prisma, unverifiedReprocess.event.id, actor)
assert.equal(unverifiedReprocess.event.providerCode, null, 'reprocess clears provider identity when Gmail authentication is not verified')
assert.equal(unverifiedReprocess.event.reservationId, null, 'reprocess clears a stale reservation match instead of preserving it')
assert.equal(unverifiedReprocess.event.channelRef, null, 'reprocess clears a stale channel reference absent from immutable raw content')
assert.equal(unverifiedReprocess.event.amountSatang, null, 'reprocess clears a stale amount absent from immutable raw content')
assert.equal(unverifiedReprocess.event.currency, null, 'reprocess clears a stale currency absent from immutable raw content')

const capacityTodayKey = getBangkokDateKey(new Date())

function capacityDate(offsetDays) {
  const date = dateFromKey(capacityTodayKey)
  date.setUTCDate(date.getUTCDate() + offsetDays)
  return date
}

function capacityDateKey(offsetDays) {
  return capacityDate(offsetDays).toISOString().slice(0, 10)
}

function createCapacityFixture({
  operationalStatus = 'AVAILABLE',
  checkoutOffsetDays = 3,
  checkedIn = false,
} = {}) {
  const property = {
    id: 'property-capacity-test',
    code: 'SANDBOX',
    name: 'SANDBOX HOTEL',
    extraGuestFee: 300,
    childFee: 200,
  }
  const roomTypes = new Map([
    ['room-type-twin', {
      id: 'room-type-twin',
      propertyId: property.id,
      code: 'TWIN',
      name: 'Twin Room',
      baseRate: 1_500,
      standardOcc: 2,
      maxOccupancy: 3,
    }],
    ['room-type-double', {
      id: 'room-type-double',
      propertyId: property.id,
      code: 'DOUBLE',
      name: 'Double Room',
      baseRate: 1_800,
      standardOcc: 2,
      maxOccupancy: 3,
    }],
  ])
  const rooms = new Map()
  const room = {
    id: 'room-capacity-test',
    propertyId: property.id,
    roomTypeId: 'room-type-twin',
    number: '101',
    floor: 1,
    operationalStatus,
    currentStatus: checkedIn ? 'OCCUPIED' : 'VACANT_CLEAN',
    currentReservation: checkedIn ? 'reservation-capacity-test' : null,
    notes: null,
  }
  rooms.set(room.id, room)
  const reservation = {
    id: 'reservation-capacity-test',
    propertyId: property.id,
    confirmationCode: 'SBX-CAPACITY',
    guestId: 'guest-capacity-test',
    guest: { id: 'guest-capacity-test', firstName: 'Capacity', lastName: 'Guest' },
    roomTypeId: room.roomTypeId,
    assignedRoomId: room.id,
    checkIn: capacityDate(-2),
    checkOut: capacityDate(checkoutOffsetDays),
    actualCheckOut: null,
    status: 'CHECKED_IN',
    adults: 2,
    children: 0,
    childAges: [],
    ratePerNight: 1_500,
    totalAmount: 7_500,
    depositAmount: 2_250,
    depositPaid: true,
    source: 'DIRECT',
    channelRef: null,
    providerCode: null,
    externalReservationId: null,
    externalReferenceKey: null,
    sourceEmailEventId: null,
    notes: null,
    specialRequests: null,
    folio: null,
    sourceEmailEvent: null,
    bookingEmailEvents: [],
  }
  const availabilityQueries = []
  const connectionQueries = []
  const audits = []
  const releasedInventoryReservations = []

  const relatedRoom = (value) => value && ({
    ...value,
    roomType: roomTypes.get(value.roomTypeId),
  })
  const setupRoom = (value) => value && ({
    ...relatedRoom(value),
    assignedReservations: [],
    inventory: [],
  })
  const relatedReservation = () => ({
    ...reservation,
    roomType: roomTypes.get(reservation.roomTypeId),
    assignedRoom: relatedRoom(rooms.get(reservation.assignedRoomId)),
  })

  const prisma = {
    property: {
      findUnique: async ({ where }) => (where?.id === property.id || where?.code === property.code ? property : null),
    },
    roomType: {
      findFirst: async ({ where }) => {
        const candidate = roomTypes.get(where?.id)
        return candidate?.propertyId === where?.propertyId ? candidate : null
      },
    },
    room: {
      findUnique: async ({ where }) => relatedRoom(rooms.get(where?.id)),
      findFirst: async ({ where }) => {
        const candidate = rooms.get(where?.id)
        return candidate?.propertyId === where?.propertyId ? setupRoom(candidate) : null
      },
      count: async ({ where }) => [...rooms.values()].filter((candidate) => (
        candidate.propertyId === where?.propertyId
        && candidate.roomTypeId === where?.roomTypeId
        && candidate.operationalStatus === where?.operationalStatus
      )).length,
      create: async ({ data }) => {
        const created = {
          id: `room-created-${rooms.size + 1}`,
          currentReservation: null,
          ...data,
        }
        rooms.set(created.id, created)
        return relatedRoom(created)
      },
      update: async ({ where, data }) => {
        const current = rooms.get(where?.id)
        Object.assign(current, data)
        return relatedRoom(current)
      },
      updateMany: async ({ where, data }) => {
        const current = rooms.get(where?.id)
        if (!current) return { count: 0 }
        Object.assign(current, data)
        return { count: 1 }
      },
      delete: async ({ where }) => rooms.delete(where?.id),
    },
    reservation: {
      findUnique: async ({ where }) => (where?.id === reservation.id ? relatedReservation() : null),
      findMany: async ({ where }) => (
        where?.roomTypeId === reservation.roomTypeId
        && ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'HOLD'].includes(reservation.status)
          ? [{ checkIn: reservation.checkIn, checkOut: reservation.checkOut }]
          : []
      ),
      updateMany: async ({ where, data }) => {
        if (where?.id !== reservation.id || where?.status !== reservation.status) return { count: 0 }
        Object.assign(reservation, data)
        return { count: 1 }
      },
    },
    inventoryHold: {
      findMany: async () => [],
    },
    roomDateInventory: {
      deleteMany: async ({ where }) => {
        releasedInventoryReservations.push(where?.reservationId)
        return { count: 1 }
      },
      findMany: async ({ where }) => {
        availabilityQueries.push({
          roomTypeId: where?.room?.roomTypeId,
          dateKeys: (where?.date?.in || []).map((date) => getBangkokDateKey(date)),
        })
        return []
      },
    },
    manualChannelConnection: {
      findMany: async ({ where }) => {
        connectionQueries.push(where)
        return []
      },
    },
    roomStatusLog: {
      create: async ({ data }) => data,
    },
    reservationLog: {
      create: async ({ data }) => data,
    },
    auditLog: {
      create: async ({ data }) => {
        audits.push(data)
        return data
      },
    },
    $transaction: async (callback) => callback(prisma),
  }

  return {
    prisma,
    property,
    roomTypes,
    rooms,
    room,
    reservation,
    availabilityQueries,
    connectionQueries,
    audits,
    releasedInventoryReservations,
  }
}

function assertFutureCapacityWindow(query, roomTypeId, label) {
  assert.equal(query.roomTypeId, roomTypeId, `${label} targets the affected room type`)
  assert.equal(query.dateKeys.length, 90, `${label} uses the bounded 90-night capacity horizon`)
  assert.equal(query.dateKeys[0], capacityTodayKey, `${label} begins today in Bangkok`)
  assert.equal(query.dateKeys.at(-1), capacityDateKey(89), `${label} ends after 90 sell nights`)
  assert.equal(query.dateKeys.every((dateKey) => dateKey >= capacityTodayKey), true, `${label} never queues a past date`)
}

const earlyCheckout = createCapacityFixture({ checkedIn: true, checkoutOffsetDays: 3 })
await checkOutReservation(earlyCheckout.prisma, earlyCheckout.reservation.id, actor)
assert.deepEqual(
  earlyCheckout.releasedInventoryReservations,
  [earlyCheckout.reservation.id],
  'early checkout releases the physical room-date inventory before advertising availability',
)
assert.equal(earlyCheckout.availabilityQueries.length, 1, 'early checkout reconciles released future stay dates')
assert.deepEqual(
  earlyCheckout.availabilityQueries[0].dateKeys,
  [capacityDateKey(0), capacityDateKey(1), capacityDateKey(2)],
  'early checkout reconciles today through the night before scheduled checkout',
)

const onTimeCheckout = createCapacityFixture({ checkedIn: true, checkoutOffsetDays: 0 })
await checkOutReservation(onTimeCheckout.prisma, onTimeCheckout.reservation.id, actor)
assert.equal(onTimeCheckout.availabilityQueries.length, 0, 'on-time checkout does not queue an empty or past stay range')

const housekeepingMaintenance = createCapacityFixture()
await updateHousekeepingStatus(housekeepingMaintenance.prisma, housekeepingMaintenance.room.id, 'MAINTENANCE', actor, 'Air conditioning repair.')
assert.equal(housekeepingMaintenance.availabilityQueries.length, 1, 'housekeeping maintenance reconciles a room leaving sellable inventory')
assertFutureCapacityWindow(housekeepingMaintenance.availabilityQueries[0], 'room-type-twin', 'housekeeping maintenance')

const housekeepingNoCapacityChange = createCapacityFixture({ operationalStatus: 'OUT_OF_SERVICE' })
await updateHousekeepingStatus(housekeepingNoCapacityChange.prisma, housekeepingNoCapacityChange.room.id, 'MAINTENANCE', actor, 'Continue repair.')
assert.equal(housekeepingNoCapacityChange.availabilityQueries.length, 0, 'housekeeping maintenance skips rooms already outside sellable inventory')

const operationalRestore = createCapacityFixture({ operationalStatus: 'OUT_OF_SERVICE' })
await updateRoomOperationalStatus(operationalRestore.prisma, operationalRestore.room.id, 'AVAILABLE', actor, 'Repair verified.')
assert.equal(operationalRestore.availabilityQueries.length, 1, 'operational status reconciles a room re-entering sellable inventory')
assertFutureCapacityWindow(operationalRestore.availabilityQueries[0], 'room-type-twin', 'operational restore')

const operationalNoCapacityChange = createCapacityFixture({ operationalStatus: 'BLOCKED' })
await updateRoomOperationalStatus(operationalNoCapacityChange.prisma, operationalNoCapacityChange.room.id, 'OUT_OF_SERVICE', actor, 'Keep unavailable.')
assert.equal(operationalNoCapacityChange.availabilityQueries.length, 0, 'non-sellable operational status changes do not create queue work')

const createSellableRoom = createCapacityFixture({ operationalStatus: 'OUT_OF_SERVICE' })
await createSetupRoom(createSellableRoom.prisma, {
  roomTypeId: 'room-type-twin',
  number: '102',
  floor: 1,
  operationalStatus: 'AVAILABLE',
}, actor)
assert.equal(createSellableRoom.availabilityQueries.length, 1, 'creating a sellable setup room reconciles capacity')
assertFutureCapacityWindow(createSellableRoom.availabilityQueries[0], 'room-type-twin', 'sellable room creation')

const createNonSellableRoom = createCapacityFixture()
await createSetupRoom(createNonSellableRoom.prisma, {
  roomTypeId: 'room-type-twin',
  number: '102',
  floor: 1,
  operationalStatus: 'OUT_OF_SERVICE',
}, actor)
assert.equal(createNonSellableRoom.availabilityQueries.length, 0, 'creating a non-sellable setup room does not create queue work')

const moveSellableRoomType = createCapacityFixture()
await updateSetupRoom(moveSellableRoomType.prisma, moveSellableRoomType.room.id, {
  roomTypeId: 'room-type-double',
  number: moveSellableRoomType.room.number,
  floor: moveSellableRoomType.room.floor,
  operationalStatus: 'AVAILABLE',
  notes: 'Room type corrected.',
}, actor)
assert.equal(moveSellableRoomType.availabilityQueries.length, 2, 'moving a sellable room reconciles both old and new room types')
assert.deepEqual(
  moveSellableRoomType.availabilityQueries.map((query) => query.roomTypeId).sort(),
  ['room-type-double', 'room-type-twin'],
  'a sellable room-type move targets both capacity pools',
)
for (const query of moveSellableRoomType.availabilityQueries) {
  assertFutureCapacityWindow(query, query.roomTypeId, `room-type move ${query.roomTypeId}`)
}
assert.equal(
  moveSellableRoomType.availabilityQueries.reduce((total, query) => total + query.dateKeys.length, 0),
  180,
  'a two-room-type mutation remains below the 2,500-cell service cap',
)

const setupRoomNoCapacityChange = createCapacityFixture()
await updateSetupRoom(setupRoomNoCapacityChange.prisma, setupRoomNoCapacityChange.room.id, {
  roomTypeId: 'room-type-twin',
  number: setupRoomNoCapacityChange.room.number,
  floor: setupRoomNoCapacityChange.room.floor,
  operationalStatus: 'AVAILABLE',
  notes: 'Notes only.',
}, actor)
assert.equal(setupRoomNoCapacityChange.availabilityQueries.length, 0, 'setup edits with no capacity delta do not create queue work')

const deleteSellableRoom = createCapacityFixture()
await deleteSetupRoom(deleteSellableRoom.prisma, deleteSellableRoom.room.id, actor)
assert.equal(deleteSellableRoom.availabilityQueries.length, 1, 'deleting a sellable room reconciles its capacity pool')
assertFutureCapacityWindow(deleteSellableRoom.availabilityQueries[0], 'room-type-twin', 'sellable room deletion')

const deleteNonSellableRoom = createCapacityFixture({ operationalStatus: 'OUT_OF_SERVICE' })
await deleteSetupRoom(deleteNonSellableRoom.prisma, deleteNonSellableRoom.room.id, actor)
assert.equal(deleteNonSellableRoom.availabilityQueries.length, 0, 'deleting a non-sellable room does not create queue work')
