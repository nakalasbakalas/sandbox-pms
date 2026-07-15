import assert from 'node:assert/strict'
import test from 'node:test'

import { approveBookingEmailEvent, parseBookingEmailDetails } from '../server/pms-service.mjs'
import { dateFromKey, getBangkokDateKey } from '../server/pms-domain.mjs'

const actor = {
  id: 'manager-provider-money',
  username: 'manager.provider.money',
  name: 'Provider Money Manager',
  role: 'MANAGER',
}

function futureDateKey(offsetDays) {
  const date = dateFromKey(getBangkokDateKey(new Date()))
  date.setUTCDate(date.getUTCDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

function createNewBookingFixture({
  amountKind = 'STAY_TOTAL',
  amountAmbiguous = false,
  eventCurrency = 'THB',
  eventType = 'NEW_BOOKING',
  parsedCurrency = eventCurrency,
} = {}) {
  const now = new Date()
  const property = {
    id: 'property-provider-money',
    code: 'SANDBOX',
    name: 'SANDBOX HOTEL',
    currency: 'THB',
    extraGuestFee: 300,
    extraGuestFeeSatang: 30_000,
    childFee: 200,
    childFeeSatang: 20_000,
  }
  const roomType = {
    id: 'room-type-provider-money',
    propertyId: property.id,
    code: 'TWIN',
    name: 'Twin Room',
    baseRate: 1_500,
    baseRateSatang: 150_000,
    standardOcc: 2,
    maxOccupancy: 4,
  }
  const source = {
    id: 'booking-email-source-provider-money',
    propertyId: property.id,
    name: 'Primary booking Gmail',
    mailbox: 'booking@sandboxhotel.com',
    provider: 'GMAIL',
  }
  const event = {
    id: 'booking-email-new-provider-money',
    propertyId: property.id,
    sourceId: source.id,
    source,
    sourceName: source.name,
    sourceMailbox: source.mailbox,
    sourceMessageId: 'gmail-new-provider-money',
    sender: 'Trip.com <notification@trip.com>',
    recipient: source.mailbox,
    subject: 'New booking TRIP-EXACT-450055',
    receivedAt: now,
    eventType,
    status: 'NEEDS_REVIEW',
    confidence: 0.99,
    channelRef: 'TRIP-EXACT-450055',
    providerCode: 'trip_com',
    externalReservationId: 'TRIP-EXACT-450055',
    amount: 4_500.55,
    amountSatang: 450_055,
    currency: eventCurrency,
    parsedDetails: {
      guestName: 'Exact Total Guest',
      checkIn: futureDateKey(10),
      checkOut: futureDateKey(13),
      roomType: 'TWIN',
      adults: 3,
      children: 1,
      childAges: [8],
      amount: 4_500.55,
      amountKind,
      ...(amountAmbiguous ? { amountAmbiguous: true } : {}),
      ...(parsedCurrency ? { currency: parsedCurrency } : {}),
    },
    reviewReason: null,
    errorReason: null,
    reservationId: null,
    processedAt: null,
    processedBy: null,
    rejectedAt: null,
    duplicateOfEventId: null,
    legacyReadOnly: false,
    createdAt: now,
    updatedAt: now,
  }

  const state = {
    guests: [],
    reservations: [],
    folios: [],
    charges: [],
    reservationLogs: [],
    audits: [],
    eventUpdates: 0,
  }

  const decorateReservation = (reservation) => {
    if (!reservation) return null
    const guest = state.guests.find((item) => item.id === reservation.guestId) || null
    const folio = state.folios.find((item) => item.reservationId === reservation.id) || null
    return {
      ...reservation,
      guest,
      roomType,
      assignedRoom: null,
      sourceEmailEvent: reservation.sourceEmailEventId === event.id ? event : null,
      folio: folio
        ? {
            ...folio,
            charges: state.charges.filter((charge) => charge.folioId === folio.id),
            payments: [],
          }
        : null,
      bookingEmailEvents: event.reservationId === reservation.id ? [event] : [],
    }
  }

  const decorateEvent = () => ({
    ...event,
    source,
    reservation: decorateReservation(state.reservations.find((item) => item.id === event.reservationId)),
  })

  const prisma = {
    property: {
      findUnique: async ({ where }) => (
        where?.id === property.id || where?.code === property.code ? property : null
      ),
    },
    roomType: {
      findFirst: async ({ where }) => (
        where?.propertyId === property.id && where?.code === roomType.code ? roomType : null
      ),
    },
    room: {
      count: async () => 5,
    },
    guest: {
      create: async ({ data }) => {
        const guest = { id: `guest-${state.guests.length + 1}`, createdAt: now, updatedAt: now, ...data }
        state.guests.push(guest)
        return guest
      },
    },
    reservation: {
      findUnique: async ({ where }) => {
        const reservation = state.reservations.find((item) => (
          (where?.id && item.id === where.id)
          || (where?.externalReferenceKey && item.externalReferenceKey === where.externalReferenceKey)
        ))
        return decorateReservation(reservation)
      },
      findFirst: async () => null,
      findMany: async ({ where = {} } = {}) => {
        if (where.providerCode || where.status?.notIn) return []
        return state.reservations
          .filter((reservation) => !where.propertyId || reservation.propertyId === where.propertyId)
          .map((reservation) => ({ checkIn: reservation.checkIn, checkOut: reservation.checkOut }))
      },
      count: async () => 0,
      create: async ({ data }) => {
        const reservation = {
          id: `reservation-${state.reservations.length + 1}`,
          assignedRoomId: null,
          depositPaid: false,
          createdAt: now,
          updatedAt: now,
          ...data,
        }
        state.reservations.push(reservation)
        return decorateReservation(reservation)
      },
    },
    folio: {
      create: async ({ data }) => {
        const folio = {
          id: `folio-${state.folios.length + 1}`,
          status: 'OPEN',
          createdAt: now,
          updatedAt: now,
          ...data,
        }
        state.folios.push(folio)
        return folio
      },
    },
    charge: {
      create: async ({ data }) => {
        const charge = {
          id: `charge-${state.charges.length + 1}`,
          void: false,
          createdAt: now,
          updatedAt: now,
          ...data,
        }
        state.charges.push(charge)
        return charge
      },
    },
    bookingEmailEvent: {
      findUnique: async ({ where }) => (where?.id === event.id ? decorateEvent() : null),
      update: async ({ where, data }) => {
        assert.equal(where.id, event.id)
        state.eventUpdates += 1
        Object.assign(event, data, { updatedAt: now })
        return decorateEvent()
      },
    },
    manualChannelConnection: {
      findMany: async () => [],
    },
    inventoryHold: {
      findMany: async () => [],
    },
    roomDateInventory: {
      findMany: async () => [],
    },
    reservationLog: {
      create: async ({ data }) => {
        state.reservationLogs.push(data)
        return data
      },
    },
    auditLog: {
      create: async ({ data }) => {
        state.audits.push(data)
        return data
      },
    },
    $transaction: async (callback) => callback(prisma),
  }

  const mutationCounts = () => ({
    guests: state.guests.length,
    reservations: state.reservations.length,
    folios: state.folios.length,
    charges: state.charges.length,
    reservationLogs: state.reservationLogs.length,
    audits: state.audits.length,
    eventUpdates: state.eventUpdates,
  })

  return { prisma, event, state, mutationCounts }
}

test('NEW_BOOKING approval persists the parser-verified inclusive provider total through reservation, folio, and room charge', async () => {
  const fixture = createNewBookingFixture()

  const approved = await approveBookingEmailEvent(fixture.prisma, fixture.event.id, {}, actor)

  assert.equal(approved.status, 'PROCESSED')
  assert.equal(fixture.state.reservations.length, 1)
  const reservation = fixture.state.reservations[0]
  assert.equal(reservation.totalAmount, 4_500.55)
  assert.equal(reservation.totalAmountSatang, 450_055)
  assert.equal(reservation.providerTotalSatang, 450_055)
  assert.equal(reservation.providerTotalCurrency, 'THB')
  assert.equal(reservation.depositAmountSatang, 135_017)
  assert.equal(reservation.sourceEmailEventId, fixture.event.id)

  assert.equal(fixture.state.folios.length, 1)
  const folio = fixture.state.folios[0]
  assert.equal(folio.subtotalSatang, 450_055)
  assert.equal(folio.totalSatang, 450_055)
  assert.equal(folio.balanceSatang, 450_055)
  assert.equal(folio.paidSatang, 0)

  assert.equal(fixture.state.charges.length, 1)
  const roomCharge = fixture.state.charges[0]
  assert.equal(roomCharge.category, 'ROOM')
  assert.equal(roomCharge.quantity, 3)
  assert.equal(roomCharge.totalSatang, 450_055)
  assert.equal(roomCharge.total, 4_500.55)
  assert.equal(fixture.event.reservationId, reservation.id)
})

for (const mode of ['link_reservation', 'apply_parsed']) {
  test(`${mode} rejects a booking-email reservation link across properties without mutations`, async () => {
    const fixture = createNewBookingFixture()
    const foreignReservation = {
      id: 'reservation-foreign-property',
      propertyId: 'property-foreign',
      confirmationCode: 'FOREIGN-1001',
      status: 'CONFIRMED',
      sourceEmailEventId: null,
      guestId: 'guest-foreign',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    fixture.state.reservations.push(foreignReservation)
    if (mode === 'apply_parsed') fixture.event.reservationId = foreignReservation.id

    await assert.rejects(
      () => approveBookingEmailEvent(fixture.prisma, fixture.event.id, {
        mode,
        ...(mode === 'link_reservation' ? { reservationId: foreignReservation.id } : {}),
      }, actor),
      /different property/i,
    )

    assert.equal(fixture.event.status, 'NEEDS_REVIEW')
    assert.equal(fixture.state.folios.length, 0)
    assert.equal(fixture.state.charges.length, 0)
    assert.equal(fixture.state.reservationLogs.length, 0)
    assert.equal(fixture.state.audits.length, 0)
    assert.equal(fixture.state.eventUpdates, 0)
  })
}

for (const status of ['CANCELLED', 'NO_SHOW']) {
  test(`booking-email linking rejects ${status.toLowerCase()} reservations`, async () => {
    const fixture = createNewBookingFixture()
    const closedReservation = {
      id: `reservation-${status.toLowerCase()}`,
      propertyId: fixture.event.propertyId,
      confirmationCode: `${status}-1001`,
      status,
      sourceEmailEventId: null,
      guestId: `guest-${status.toLowerCase()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    fixture.state.reservations.push(closedReservation)

    await assert.rejects(
      () => approveBookingEmailEvent(fixture.prisma, fixture.event.id, {
        mode: 'link_reservation',
        reservationId: closedReservation.id,
      }, actor),
      /cancelled and no-show reservations cannot be linked/i,
    )

    assert.equal(fixture.event.status, 'NEEDS_REVIEW')
    assert.equal(fixture.state.eventUpdates, 0)
  })
}

test('parser marks distinct same-kind stay totals as ambiguous review work', () => {
  const parsed = parseBookingEmailDetails({
    eventType: 'MODIFICATION',
    subject: 'Booking modification TRIP-AMBIGUOUS-TOTAL',
    rawText: [
      'Booking reference: TRIP-AMBIGUOUS-TOTAL',
      'Original total amount: THB 4,000.00',
      'New total amount: THB 4,500.55',
    ].join('\n'),
  })

  assert.equal(parsed.details.amountKind, 'STAY_TOTAL')
  assert.equal(parsed.details.amountAmbiguous, true)
  assert.match(parsed.reviewReason, /unambiguous amount/i)
})

test('parser captures a single labelled child age without inventing review work', () => {
  const parsed = parseBookingEmailDetails({
    subject: 'New booking confirmation CHILD-1001',
    rawText: 'Guest name: Jane Doe Booking reference: CHILD-1001 Check-in: 2026-08-20 Check-out: 2026-08-22 Room type: Double Adults: 2 Children: 1 Child age: 8 Total: THB 3000',
  })

  assert.equal(parsed.details.children, 1)
  assert.deepEqual(parsed.details.childAges, [8])
  assert.equal(parsed.reviewReason, null)
})

test('parser captures multiple common child-age labels', () => {
  for (const rawChildDetails of [
    'Children: 2 Children ages: 4 and 11',
    'Children: 2 (ages: 4, 11)',
    'Adults: 2 Ages of children: 4 / 11',
  ]) {
    const parsed = parseBookingEmailDetails({
      subject: 'New booking confirmation CHILD-2002',
      rawText: `Guest name: Jane Doe Booking reference: CHILD-2002 Check-in: 2026-08-20 Check-out: 2026-08-22 Room type: Double Adults: 2 ${rawChildDetails} Total: THB 3000`,
    })

    assert.equal(parsed.details.children, 2)
    assert.deepEqual(parsed.details.childAges, [4, 11])
    assert.equal(parsed.reviewReason, null)
  }
})

test('parser marks missing, mismatched, and invalid child ages as incomplete', () => {
  const complete = parseBookingEmailDetails({
    subject: 'New booking confirmation CHILD-3003',
    rawText: 'Guest name: Jane Doe Booking reference: CHILD-3003 Check-in: 2026-08-20 Check-out: 2026-08-22 Room type: Double Adults: 2 Children: 2 Child ages: 4, 11 Total: THB 3000',
  })
  const cases = [
    'Children: 1',
    'Children: 2 Child age: 4',
    'Children: 1 Child age: 18',
  ]

  for (const childDetails of cases) {
    const parsed = parseBookingEmailDetails({
      subject: 'New booking confirmation CHILD-3003',
      rawText: `Guest name: Jane Doe Booking reference: CHILD-3003 Check-in: 2026-08-20 Check-out: 2026-08-22 Room type: Double Adults: 2 ${childDetails} Total: THB 3000`,
    })
    assert.match(parsed.reviewReason || '', /one valid age for every child/i)
    assert.ok(parsed.confidence < complete.confidence)
  }
})

for (const [name, fixtureOptions, approvalInput, message] of [
  [
    'deposit-only amount',
    { amountKind: 'DEPOSIT' },
    {},
    /parser-verified as stay total/i,
  ],
  [
    'ambiguous amount',
    { amountKind: 'UNKNOWN' },
    {},
    /parser-verified as stay total/i,
  ],
  [
    'conflicting same-kind stay totals',
    { amountKind: 'STAY_TOTAL', amountAmbiguous: true },
    {},
    /multiple conflicting values/i,
  ],
  [
    'missing persisted currency',
    { eventCurrency: null, parsedCurrency: null },
    {},
    /parser-verified currency/i,
  ],
  [
    'approval currency relabel',
    { eventCurrency: 'THB', parsedCurrency: 'THB' },
    { editedDetails: { currency: 'USD' } },
    /currency cannot be relabelled/i,
  ],
  [
    'approval amount override',
    { amountKind: 'STAY_TOTAL' },
    { editedDetails: { amount: 1 } },
    /amount cannot be changed/i,
  ],
]) {
  test(`NEW_BOOKING approval rejects ${name} without creating or updating operational records`, async () => {
    const fixture = createNewBookingFixture(fixtureOptions)

    await assert.rejects(
      () => approveBookingEmailEvent(fixture.prisma, fixture.event.id, approvalInput, actor),
      message,
    )

    assert.deepEqual(fixture.mutationCounts(), {
      guests: 0,
      reservations: 0,
      folios: 0,
      charges: 0,
      reservationLogs: 0,
      audits: 0,
      eventUpdates: 0,
    })
    assert.equal(fixture.event.status, 'NEEDS_REVIEW')
    assert.equal(fixture.event.reservationId, null)
  })
}

for (const eventType of ['NEW_BOOKING', 'MODIFICATION', 'PAYMENT_NOTICE']) {
  test(`${eventType} approval cannot replace the persisted parser-verified amount`, async () => {
    const fixture = createNewBookingFixture({ eventType })

    await assert.rejects(
      () => approveBookingEmailEvent(fixture.prisma, fixture.event.id, {
        editedDetails: { amount: 1 },
      }, actor),
      /parser-verified booking email amount cannot be changed/i,
    )

    assert.deepEqual(fixture.mutationCounts(), {
      guests: 0,
      reservations: 0,
      folios: 0,
      charges: 0,
      reservationLogs: 0,
      audits: 0,
      eventUpdates: 0,
    })
    assert.equal(fixture.event.status, 'NEEDS_REVIEW')
    assert.equal(fixture.event.reservationId, null)
  })
}
