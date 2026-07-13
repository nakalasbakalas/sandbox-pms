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

function createMutationFixture(eventType) {
  const property = {
    id: 'property-channel-test',
    code: 'SANDBOX',
    name: 'SANDBOX HOTEL',
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
    maxOccupancy: 3,
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
    totalAmount: 3_000,
    depositAmount: 900,
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
    parsedDetails: eventType === 'MODIFICATION'
      ? { checkIn: integrationDateKey(2), checkOut: integrationDateKey(5), amount: 4_500, currency: 'THB' }
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
  const connectionQueries = []
  const externalReferenceQueries = []
  const providerScopedLegacyQueries = []

  const withReservationRelations = () => ({ ...reservation, roomType, folio: null })
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
    bookingEmailEvent: {
      findUnique: async ({ where }) => (where?.id === event.id ? withEventRelations() : null),
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
    connectionQueries,
    externalReferenceQueries,
    providerScopedLegacyQueries,
    externalReferenceKey,
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
  reason: 'Cancellation confirmed in the Trip.com Extranet.',
}, actor)
assert.equal(approvedCancellation.status, 'PROCESSED', 'approved booking-email cancellations are marked processed')
assert.equal(cancellation.reservation.status, 'CANCELLED', 'provider-scoped booking-email cancellation cancels the matched reservation')
assert.match(cancellation.reservation.notes, /Keep the original guest and operations note/, 'cancellation preserves existing reservation notes')
assert.match(cancellation.reservation.notes, /Cancellation reason:/, 'cancellation appends the audited operational reason')
assert.deepEqual(
  cancellation.externalReferenceQueries,
  [cancellation.externalReferenceKey],
  'booking-email matching checks the provider-scoped external reference before any fuzzy fallback',
)
assert.equal(cancellation.providerScopedLegacyQueries.length, 0, 'an exact provider reference match avoids legacy or fuzzy matching')
assert.deepEqual(
  cancellation.connectionQueries[0].providerCode.in,
  ['booking_com', 'agoda', 'trip_com'],
  'approved cancellations reconcile every manual OTA, including the source provider',
)

const cancellationWithoutReason = createMutationFixture('CANCELLATION')
await assert.rejects(
  () => approveBookingEmailEvent(cancellationWithoutReason.prisma, cancellationWithoutReason.event.id, {}, actor),
  /operational reason/i,
  'booking-email cancellation approval requires a backend-enforced operational reason',
)

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
