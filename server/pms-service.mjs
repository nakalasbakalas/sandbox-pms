import {
  SANDBOX_RULES,
  activeReservationStatuses,
  calculateStayPricing,
  checkedInRoomStatus,
  dateFromKey,
  getBangkokDateKey,
  isSellableRoomNumber,
  normalizePaymentMethod,
  roundMoney,
  roomStatusForHousekeeping,
  stayDates,
  validateStayInput,
  PmsValidationError,
} from './pms-domain.mjs'
import { canPerformAction } from './rbac.mjs'

const reservationInclude = {
  guest: true,
  roomType: true,
  assignedRoom: true,
  folio: {
    include: {
      charges: true,
      payments: true,
    },
  },
}

function actorName(actor) {
  return actor?.name || actor?.email || actor?.id || 'System'
}

function normalizeNullableString(value) {
  const trimmed = String(value || '').trim()
  return trimmed || null
}

function canUseOverride(actor, permission) {
  return canPerformAction(actor, permission)
}

function requireOverride(actor, permission, reason, label) {
  if (!canUseOverride(actor, permission)) {
    throw new PmsValidationError(`${label} requires manager or admin permission.`, 403)
  }
  if (!normalizeNullableString(reason)) {
    throw new PmsValidationError(`${label} requires a reason.`)
  }
}

function isReadyRoomStatus(status) {
  return status === 'VACANT_CLEAN' || status === 'INSPECTED'
}

function isOccupiedRoomStatus(status) {
  return status === 'OCCUPIED' || status === 'OCCUPIED_CLEAN' || status === 'OCCUPIED_DIRTY'
}

function hasGuestIdentity(guest) {
  return Boolean(normalizeNullableString(guest?.nationality) && normalizeNullableString(guest?.idNumber))
}

function validateReservationDateForCheckIn(reservation, options) {
  const todayKey = getBangkokDateKey(new Date())
  const checkInKey = getBangkokDateKey(reservation.checkIn)
  const checkOutKey = getBangkokDateKey(reservation.checkOut)
  if (todayKey >= checkInKey && todayKey < checkOutKey) return
  if (options.allowDateOverride) {
    requireOverride(options.actor, 'override:check-in', options.overrideReason, 'Date override')
    return
  }
  throw new PmsValidationError('This reservation is not within the allowed check-in date range.')
}

function nextDateKey(key) {
  const date = dateFromKey(key)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

async function getProperty(tx) {
  const property = await tx.property.findUnique({ where: { code: SANDBOX_RULES.propertyCode } })
  if (!property) {
    throw new PmsValidationError('Sandbox Hotel property is not seeded yet.', 503)
  }
  return property
}

async function getUserBySession(tx, session) {
  if (!session?.sub) return null
  return tx.user.findFirst({
    where: {
      id: session.sub,
      active: true,
    },
  })
}

async function createAudit(tx, actor, action, entityType, entityId, changes = undefined) {
  return tx.auditLog.create({
    data: {
      userId: actor?.id || 'system',
      action,
      entityType,
      entityId,
      changes,
    },
  })
}

async function createReservationLog(tx, reservationId, action, actor, data = {}) {
  return tx.reservationLog.create({
    data: {
      reservationId,
      action,
      fromStatus: data.fromStatus,
      toStatus: data.toStatus,
      changes: data.changes,
      notes: data.notes,
      performedBy: actorName(actor),
    },
  })
}

async function createRoomStatusLog(tx, room, toStatus, actor, notes) {
  return tx.roomStatusLog.create({
    data: {
      roomId: room.id,
      fromStatus: room.currentStatus,
      toStatus,
      changedBy: actorName(actor),
      notes,
    },
  })
}

function validateGuestInput(guest) {
  if (!guest?.firstName?.trim() || !guest?.lastName?.trim()) {
    throw new PmsValidationError('Guest first and last name are required.')
  }
  if (guest.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email)) {
    throw new PmsValidationError('Enter a valid guest email address.')
  }
  return {
    firstName: guest.firstName.trim(),
    lastName: guest.lastName.trim(),
    email: guest.email?.trim() || null,
    phone: guest.phone?.trim() || null,
    nationality: guest.nationality?.trim() || null,
    idType: guest.idType?.trim() || null,
    idNumber: guest.idNumber?.trim() || null,
    vipStatus: Boolean(guest.vipStatus),
    notes: guest.notes?.trim() || null,
  }
}

async function ensureRoomTypeCapacity(tx, propertyId, roomTypeId, checkInKey, checkOutKey, excludeReservationId) {
  const sellableRooms = await tx.room.count({
    where: {
      propertyId,
      roomTypeId,
      operationalStatus: 'AVAILABLE',
      number: { notIn: SANDBOX_RULES.nonSellableRooms },
    },
  })

  if (sellableRooms < 1) {
    throw new PmsValidationError('No sellable rooms are configured for this room type.')
  }

  for (const dateKey of stayDates(checkInKey, checkOutKey)) {
    const reserved = await tx.reservation.count({
      where: {
        propertyId,
        roomTypeId,
        id: excludeReservationId ? { not: excludeReservationId } : undefined,
        status: { in: activeReservationStatuses() },
        checkIn: { lt: dateFromKey(nextDateKey(dateKey)) },
        checkOut: { gt: dateFromKey(dateKey) },
      },
    })

    if (reserved >= sellableRooms) {
      throw new PmsValidationError(`No ${sellableRooms > 1 ? 'rooms are' : 'room is'} available for ${dateKey}.`)
    }
  }
}

async function validateRoomAssignable(tx, reservation, roomId) {
  const room = await tx.room.findUnique({
    where: { id: roomId },
    include: { roomType: true },
  })

  if (!room) throw new PmsValidationError('Selected room was not found.', 404)
  if (!isSellableRoomNumber(room.number)) {
    throw new PmsValidationError(`Room ${room.number} is non-sellable and cannot be assigned.`)
  }
  if (room.operationalStatus === 'BLOCKED') {
    throw new PmsValidationError(`Room ${room.number} is blocked and cannot be assigned.`)
  }
  if (room.operationalStatus === 'OUT_OF_SERVICE') {
    throw new PmsValidationError(`Room ${room.number} is out of service and cannot be assigned.`)
  }
  if (room.roomTypeId !== reservation.roomTypeId) {
    throw new PmsValidationError(`Room ${room.number} does not match the reservation room type.`)
  }
  if (['OCCUPIED', 'OCCUPIED_CLEAN', 'OCCUPIED_DIRTY'].includes(room.currentStatus) && room.currentReservation !== reservation.id) {
    throw new PmsValidationError(`Room ${room.number} is occupied and cannot be assigned.`)
  }

  const overlappingReservation = await tx.reservation.findFirst({
    where: {
      id: { not: reservation.id },
      assignedRoomId: room.id,
      status: { in: activeReservationStatuses() },
      checkIn: { lt: reservation.checkOut },
      checkOut: { gt: reservation.checkIn },
    },
  })
  if (overlappingReservation) {
    throw new PmsValidationError(`Room ${room.number} already has a reservation for the selected dates.`)
  }

  const inventoryConflict = await tx.roomDateInventory.findFirst({
    where: {
      roomId: room.id,
      reservationId: { not: reservation.id },
      date: {
        in: stayDates(reservation.checkIn, reservation.checkOut).map(dateFromKey),
      },
      status: { in: ['RESERVED', 'HELD', 'BLOCKED', 'OUT_OF_SERVICE'] },
    },
  })
  if (inventoryConflict) {
    throw new PmsValidationError(`Room ${room.number} is not available on ${getBangkokDateKey(inventoryConflict.date)}.`)
  }

  return room
}

async function reserveRoomDates(tx, propertyId, reservationId, roomId, checkIn, checkOut) {
  await tx.roomDateInventory.deleteMany({
    where: { reservationId },
  })

  for (const dateKey of stayDates(checkIn, checkOut)) {
    await tx.roomDateInventory.upsert({
      where: {
        roomId_date: {
          roomId,
          date: dateFromKey(dateKey),
        },
      },
      update: {
        propertyId,
        reservationId,
        status: 'RESERVED',
      },
      create: {
        propertyId,
        roomId,
        reservationId,
        date: dateFromKey(dateKey),
        status: 'RESERVED',
      },
    })
  }
}

async function recomputeFolio(tx, folioId) {
  const [charges, payments] = await Promise.all([
    tx.charge.findMany({ where: { folioId, void: false } }),
    tx.payment.findMany({ where: { folioId } }),
  ])
  const subtotal = roundMoney(charges.reduce((sum, charge) => sum + charge.total, 0))
  const paid = roundMoney(payments.reduce((sum, payment) => sum + payment.amount, 0))
  const balance = roundMoney(subtotal - paid)

  return tx.folio.update({
    where: { id: folioId },
    data: {
      subtotal,
      tax: 0,
      total: subtotal,
      paid,
      balance,
      status: balance <= 0 ? 'CLOSED' : 'OPEN',
    },
    include: {
      charges: true,
      payments: true,
      reservation: {
        include: {
          guest: true,
          roomType: true,
          assignedRoom: true,
        },
      },
    },
  })
}

async function recordPaymentInTransaction(tx, folioId, input, actor) {
  const amount = Number(input?.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PmsValidationError('Payment amount must be greater than zero.')
  }
  const method = normalizePaymentMethod(input.method)
  const folio = await tx.folio.findUnique({ where: { id: folioId } })
  if (!folio) throw new PmsValidationError('Folio was not found.', 404)
  if (amount > folio.balance && !input.allowOverpayment) {
    throw new PmsValidationError('Payment cannot exceed the remaining balance.')
  }

  const payment = await tx.payment.create({
    data: {
      folioId: folio.id,
      amount: roundMoney(amount),
      method,
      reference: normalizeNullableString(input.reference),
      notes: normalizeNullableString(input.notes),
      processedBy: actorName(actor),
    },
  })
  const updatedFolio = await recomputeFolio(tx, folio.id)
  await createAudit(tx, actor, 'PAYMENT_CREATED', 'payment', payment.id, { folioId: folio.id, amount: payment.amount, method })
  return { payment, folio: updatedFolio }
}

export async function authenticateUser(prisma, email, password) {
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user?.active) return null

  const { verifyPassword } = await import('./security.mjs')
  if (!verifyPassword(password, user.passwordHash)) return null

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() },
  })

  return user
}

export async function getAuthenticatedUser(prisma, session) {
  return getUserBySession(prisma, session)
}

export async function listReservations(prisma) {
  return prisma.reservation.findMany({
    include: reservationInclude,
    orderBy: [{ checkIn: 'asc' }, { createdAt: 'desc' }],
  })
}

export async function updateReservation(prisma, reservationId, input, actor) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: reservationInclude,
    })
    if (!current) throw new PmsValidationError('Reservation was not found.', 404)
    if (['CHECKED_OUT', 'CANCELLED', 'NO_SHOW'].includes(current.status)) {
      throw new PmsValidationError('Completed or cancelled reservations cannot be edited.')
    }

    const property = await getProperty(tx)
    let roomTypeId = current.roomTypeId
    if (input.roomTypeCode || input.roomType) {
      const roomType = await tx.roomType.findFirst({
        where: {
          propertyId: property.id,
          code: input.roomTypeCode || input.roomType,
        },
      })
      if (!roomType) throw new PmsValidationError('Selected room type was not found.')
      roomTypeId = roomType.id
    }

    const checkIn = input.checkIn ?? current.checkIn
    const checkOut = input.checkOut ?? current.checkOut
    const ratePerNight = input.ratePerNight ?? current.ratePerNight
    const adults = input.adults ?? current.adults
    const children = input.children ?? current.children
    const childAges = input.childAges ?? current.childAges
    const { checkInKey, checkOutKey } = validateStayInput({ checkIn, checkOut })
    const pricing = calculateStayPricing({ checkIn, checkOut, ratePerNight, adults, childAges })

    await ensureRoomTypeCapacity(tx, property.id, roomTypeId, checkInKey, checkOutKey, current.id)

    let assignedRoomId = current.assignedRoomId
    if (assignedRoomId) {
      const assignedRoom = await tx.room.findUnique({ where: { id: assignedRoomId } })
      if (!assignedRoom || assignedRoom.roomTypeId !== roomTypeId) {
        assignedRoomId = null
      } else {
        const candidate = { ...current, roomTypeId, checkIn: dateFromKey(checkInKey), checkOut: dateFromKey(checkOutKey) }
        await validateRoomAssignable(tx, candidate, assignedRoomId)
      }
    }

    const updated = await tx.reservation.update({
      where: { id: current.id },
      data: {
        roomTypeId,
        assignedRoomId,
        checkIn: dateFromKey(checkInKey),
        checkOut: dateFromKey(checkOutKey),
        adults: Number(adults),
        children: Number(children || 0),
        childAges: Array.isArray(childAges) ? childAges.map(Number) : [],
        ratePerNight: Number(ratePerNight),
        totalAmount: pricing.total,
        depositAmount: roundMoney(pricing.total * 0.3),
        source: input.source || current.source,
        channelRef: input.channelRef ?? current.channelRef,
        notes: input.notes ?? current.notes,
        specialRequests: input.specialRequests ?? current.specialRequests,
      },
      include: reservationInclude,
    })

    if (assignedRoomId) {
      await reserveRoomDates(tx, property.id, current.id, assignedRoomId, checkInKey, checkOutKey)
    } else {
      await tx.roomDateInventory.deleteMany({ where: { reservationId: current.id } })
    }

    if (current.folio) {
      const roomCharge = await tx.charge.findFirst({
        where: { folioId: current.folio.id, category: 'ROOM', void: false },
        orderBy: { createdAt: 'asc' },
      })
      if (roomCharge) {
        await tx.charge.update({
          where: { id: roomCharge.id },
          data: {
            date: dateFromKey(checkInKey),
            amount: Number(ratePerNight),
            quantity: pricing.nights,
            total: pricing.total,
          },
        })
      }
      await recomputeFolio(tx, current.folio.id)
    }

    await createReservationLog(tx, current.id, 'MODIFIED', actor, { changes: input })
    await createAudit(tx, actor, 'MODIFIED', 'reservation', current.id, input)
    return updated
  })
}

export async function listRooms(prisma) {
  const property = await getProperty(prisma)
  return prisma.room.findMany({
    where: { propertyId: property.id },
    include: { roomType: true },
    orderBy: [{ floor: 'asc' }, { number: 'asc' }],
  })
}

export async function listGuests(prisma) {
  return prisma.guest.findMany({
    include: {
      reservations: {
        include: {
          roomType: true,
          assignedRoom: true,
          folio: true,
        },
        orderBy: [{ checkIn: 'desc' }],
      },
    },
    orderBy: [{ updatedAt: 'desc' }, { lastName: 'asc' }, { firstName: 'asc' }],
  })
}

export async function createReservation(prisma, input, actor) {
  return prisma.$transaction(async (tx) => {
    const property = await getProperty(tx)
    const { checkInKey, checkOutKey } = validateStayInput(input)
    const pricing = calculateStayPricing(input)

    const roomType = await tx.roomType.findFirst({
      where: {
        propertyId: property.id,
        code: input.roomTypeCode || input.roomType || 'TWIN',
      },
    })
    if (!roomType) throw new PmsValidationError('Selected room type was not found.')

    await ensureRoomTypeCapacity(tx, property.id, roomType.id, checkInKey, checkOutKey)

    const guestData = validateGuestInput(input.guest)
    const guest = await tx.guest.create({ data: guestData })

    const reservation = await tx.reservation.create({
      data: {
        propertyId: property.id,
        confirmationCode: input.confirmationCode || `SBX-${Date.now()}`,
        guestId: guest.id,
        roomTypeId: roomType.id,
        checkIn: dateFromKey(checkInKey),
        checkOut: dateFromKey(checkOutKey),
        status: input.status || 'CONFIRMED',
        adults: Number(input.adults),
        children: Number(input.children || 0),
        childAges: Array.isArray(input.childAges) ? input.childAges.map(Number) : [],
        ratePerNight: Number(input.ratePerNight),
        totalAmount: pricing.total,
        depositAmount: roundMoney(pricing.total * 0.3),
        depositPaid: false,
        source: input.source || 'DIRECT',
        channelRef: input.channelRef || null,
        notes: input.notes || null,
        specialRequests: input.specialRequests || null,
      },
      include: reservationInclude,
    })

    let assignedReservation = reservation
    if (input.assignedRoomId) {
      const room = await validateRoomAssignable(tx, reservation, input.assignedRoomId)
      await reserveRoomDates(tx, property.id, reservation.id, room.id, checkInKey, checkOutKey)
      assignedReservation = await tx.reservation.update({
        where: { id: reservation.id },
        data: { assignedRoomId: room.id },
        include: reservationInclude,
      })
      await createReservationLog(tx, reservation.id, 'ASSIGNED_ROOM', actor, { changes: { roomNumber: room.number } })
    }

    const folio = await tx.folio.create({
      data: {
        reservationId: reservation.id,
        subtotal: pricing.total,
        tax: 0,
        total: pricing.total,
        paid: 0,
        balance: pricing.total,
      },
    })

    await tx.charge.create({
      data: {
        folioId: folio.id,
        date: dateFromKey(checkInKey),
        description: `${roomType.name} ${pricing.nights} night${pricing.nights === 1 ? '' : 's'}`,
        category: 'ROOM',
        amount: Number(input.ratePerNight),
        quantity: pricing.nights,
        total: pricing.total,
        createdBy: actorName(actor),
      },
    })

    await createReservationLog(tx, reservation.id, 'CREATED', actor, { toStatus: assignedReservation.status })
    await createAudit(tx, actor, 'CREATED', 'reservation', reservation.id, { confirmationCode: reservation.confirmationCode })

    return tx.reservation.findUnique({
      where: { id: reservation.id },
      include: reservationInclude,
    })
  })
}

export async function createWalkInCheckIn(prisma, input, actor) {
  return prisma.$transaction(async (tx) => {
    const property = await getProperty(tx)
    const { checkInKey, checkOutKey } = validateStayInput(input)
    const pricing = calculateStayPricing(input)
    const roomType = await tx.roomType.findFirst({
      where: {
        propertyId: property.id,
        code: input.roomTypeCode || input.roomType || 'TWIN',
      },
    })
    if (!roomType) throw new PmsValidationError('Selected room type was not found.')

    await ensureRoomTypeCapacity(tx, property.id, roomType.id, checkInKey, checkOutKey)

    const guestData = validateGuestInput(input.guest)
    if (!hasGuestIdentity(guestData)) {
      if (input.recordIdentityLater) {
        requireOverride(actor, 'override:check-in', input.recordIdentityLaterReason || input.overrideReason, 'Record-later identity override')
      } else {
        throw new PmsValidationError('Record guest nationality and ID/passport number before walk-in check-in.')
      }
    }
    const guest = await tx.guest.create({ data: guestData })

    const reservation = await tx.reservation.create({
      data: {
        propertyId: property.id,
        confirmationCode: input.confirmationCode || `SBX-WI-${Date.now()}`,
        guestId: guest.id,
        roomTypeId: roomType.id,
        checkIn: dateFromKey(checkInKey),
        checkOut: dateFromKey(checkOutKey),
        status: 'CONFIRMED',
        adults: Number(input.adults),
        children: Number(input.children || 0),
        childAges: Array.isArray(input.childAges) ? input.childAges.map(Number) : [],
        ratePerNight: Number(input.ratePerNight),
        totalAmount: pricing.total,
        depositAmount: roundMoney(pricing.total * 0.3),
        depositPaid: false,
        source: 'WALK_IN',
        channelRef: null,
        notes: input.notes || null,
        specialRequests: input.specialRequests || null,
      },
      include: reservationInclude,
    })

    const candidateRoom = input.assignedRoomId
      ? await tx.room.findUnique({ where: { id: input.assignedRoomId }, include: { roomType: true } })
      : await tx.room.findFirst({
          where: {
            propertyId: property.id,
            roomTypeId: roomType.id,
            operationalStatus: 'AVAILABLE',
            currentReservation: null,
            currentStatus: { in: ['VACANT_CLEAN', 'INSPECTED'] },
            number: { notIn: SANDBOX_RULES.nonSellableRooms },
          },
          include: { roomType: true },
          orderBy: [{ floor: 'asc' }, { number: 'asc' }],
        })

    if (!candidateRoom) throw new PmsValidationError('No clean available room is ready for this walk-in.')
    const room = await validateRoomAssignable(tx, reservation, candidateRoom.id)
    if (!isReadyRoomStatus(room.currentStatus)) {
      throw new PmsValidationError(`Room ${room.number} must be clean or inspected before walk-in check-in.`)
    }

    await reserveRoomDates(tx, property.id, reservation.id, room.id, checkInKey, checkOutKey)
    await tx.reservation.update({
      where: { id: reservation.id },
      data: { assignedRoomId: room.id },
    })

    const folio = await tx.folio.create({
      data: {
        reservationId: reservation.id,
        subtotal: pricing.total,
        tax: 0,
        total: pricing.total,
        paid: 0,
        balance: pricing.total,
      },
    })

    await tx.charge.create({
      data: {
        folioId: folio.id,
        date: dateFromKey(checkInKey),
        description: `${roomType.name} ${pricing.nights} night${pricing.nights === 1 ? '' : 's'}`,
        category: 'ROOM',
        amount: Number(input.ratePerNight),
        quantity: pricing.nights,
        total: pricing.total,
        createdBy: actorName(actor),
      },
    })
    await recomputeFolio(tx, folio.id)

    if (input.payment?.amount) {
      await recordPaymentInTransaction(tx, folio.id, input.payment, actor)
    }
    const settledFolio = await tx.folio.findUnique({ where: { id: folio.id } })
    const remainingBalance = roundMoney(settledFolio?.balance || 0)
    if (remainingBalance > 0) {
      if (input.allowPayLater) {
        requireOverride(actor, 'override:check-in', input.payLaterReason || input.overrideReason, 'Pay-later walk-in check-in')
      } else {
        throw new PmsValidationError('Collect or override the amount due before walk-in check-in.')
      }
    }

    const toStatus = checkedInRoomStatus(room.currentStatus)
    const roomUpdate = await tx.room.updateMany({
      where: {
        id: room.id,
        currentReservation: null,
        currentStatus: { in: ['VACANT_CLEAN', 'INSPECTED'] },
      },
      data: {
        currentStatus: toStatus,
        currentReservation: reservation.id,
      },
    })
    if (roomUpdate.count !== 1) {
      throw new PmsValidationError(`Room ${room.number} changed state before walk-in could complete. Refresh and try again.`, 409)
    }

    await tx.reservation.update({
      where: { id: reservation.id },
      data: {
        status: 'CHECKED_IN',
        actualCheckIn: new Date(),
      },
    })

    await createRoomStatusLog(tx, room, toStatus, actor, 'Walk-in check-in completed')
    await createReservationLog(tx, reservation.id, 'CREATED', actor, { toStatus: 'CONFIRMED', changes: { source: 'WALK_IN' } })
    await createReservationLog(tx, reservation.id, 'ASSIGNED_ROOM', actor, { changes: { roomNumber: room.number } })
    await createReservationLog(tx, reservation.id, 'CHECKED_IN', actor, {
      fromStatus: 'CONFIRMED',
      toStatus: 'CHECKED_IN',
      notes: input.overrideReason || input.additionalNotes || undefined,
      changes: { roomId: room.id, roomNumber: room.number, source: 'WALK_IN' },
    })
    await createAudit(tx, actor, 'WALK_IN_CHECKED_IN', 'reservation', reservation.id, {
      roomId: room.id,
      roomNumber: room.number,
      previousState: { reservationStatus: 'NEW', roomStatus: room.currentStatus },
      newState: { reservationStatus: 'CHECKED_IN', roomStatus: toStatus },
      overrideReason: input.overrideReason || input.payLaterReason || input.recordIdentityLaterReason || null,
    })

    return tx.reservation.findUnique({
      where: { id: reservation.id },
      include: reservationInclude,
    })
  })
}

export async function assignRoom(prisma, reservationId, roomId, actor) {
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({ where: { id: reservationId } })
    if (!reservation) throw new PmsValidationError('Reservation was not found.', 404)
    if (['CANCELLED', 'NO_SHOW', 'CHECKED_OUT'].includes(reservation.status)) {
      throw new PmsValidationError('Only active reservations can be assigned a room.')
    }

    const property = await getProperty(tx)
    const room = await validateRoomAssignable(tx, reservation, roomId)
    await reserveRoomDates(tx, property.id, reservation.id, room.id, reservation.checkIn, reservation.checkOut)

    const updated = await tx.reservation.update({
      where: { id: reservation.id },
      data: { assignedRoomId: room.id },
      include: reservationInclude,
    })
    await createReservationLog(tx, reservation.id, 'ASSIGNED_ROOM', actor, { changes: { roomNumber: room.number } })
    await createAudit(tx, actor, 'ASSIGNED_ROOM', 'reservation', reservation.id, { roomId: room.id, roomNumber: room.number })
    return updated
  })
}

export async function checkInReservation(prisma, reservationId, actor, options = {}) {
  return prisma.$transaction(async (tx) => {
    let reservation = await tx.reservation.findUnique({ where: { id: reservationId }, include: reservationInclude })
    if (!reservation) throw new PmsValidationError('Reservation was not found.', 404)
    if (!['CONFIRMED', 'PENDING'].includes(reservation.status)) {
      throw new PmsValidationError('Only confirmed or pending reservations can be checked in.')
    }
    if (!reservation.assignedRoomId) {
      throw new PmsValidationError('Assign a room before checking in this reservation.')
    }

    validateReservationDateForCheckIn(reservation, { ...options, actor })

    const totalGuests = Number(reservation.adults || 0) + Number(reservation.children || 0)
    if (totalGuests > SANDBOX_RULES.maxOccupancy) {
      throw new PmsValidationError(`Maximum occupancy is ${SANDBOX_RULES.maxOccupancy} guests per room.`)
    }

    const guestUpdates = {}
    if (options.guest?.nationality !== undefined) guestUpdates.nationality = normalizeNullableString(options.guest.nationality)
    if (options.guest?.idType !== undefined) guestUpdates.idType = normalizeNullableString(options.guest.idType)
    if (options.guest?.idNumber !== undefined) guestUpdates.idNumber = normalizeNullableString(options.guest.idNumber)
    if (options.guest?.phone !== undefined) guestUpdates.phone = normalizeNullableString(options.guest.phone)
    if (options.guest?.email !== undefined) guestUpdates.email = normalizeNullableString(options.guest.email)
    if (Object.keys(guestUpdates).length > 0) {
      const guest = await tx.guest.update({
        where: { id: reservation.guestId },
        data: guestUpdates,
      })
      reservation = { ...reservation, guest }
      await createAudit(tx, actor, 'MODIFIED', 'guest', reservation.guestId, guestUpdates)
    }

    if (!hasGuestIdentity(reservation.guest)) {
      if (options.recordIdentityLater) {
        requireOverride(actor, 'override:check-in', options.recordIdentityLaterReason || options.overrideReason, 'Record-later identity override')
      } else {
        throw new PmsValidationError('Record guest nationality and ID/passport number before check-in.')
      }
    }

    if (options.payment?.amount) {
      if (!reservation.folio?.id) throw new PmsValidationError('Reservation folio was not found.')
      await recordPaymentInTransaction(tx, reservation.folio.id, options.payment, actor)
      reservation = await tx.reservation.findUnique({ where: { id: reservationId }, include: reservationInclude })
    }

    const remainingBalance = roundMoney(reservation.folio?.balance || 0)
    if (remainingBalance > 0) {
      if (options.allowPayLater) {
        requireOverride(actor, 'override:check-in', options.payLaterReason || options.overrideReason, 'Pay-later check-in')
      } else {
        throw new PmsValidationError('Collect or override the amount due before check-in.')
      }
    }

    const room = await validateRoomAssignable(tx, reservation, reservation.assignedRoomId)
    if (isOccupiedRoomStatus(room.currentStatus)) {
      throw new PmsValidationError(`Room ${room.number} is occupied and cannot be checked in.`)
    }
    if (!isReadyRoomStatus(room.currentStatus)) {
      if (options.allowRoomReadinessOverride) {
        requireOverride(actor, 'override:check-in', options.overrideReason, 'Room readiness override')
      } else {
        throw new PmsValidationError(`Room ${room.number} must be clean or inspected before check-in.`)
      }
    }

    const toStatus = checkedInRoomStatus(room.currentStatus)
    await createRoomStatusLog(tx, room, toStatus, actor, 'Check-in completed')

    const roomWhere = {
      id: room.id,
      currentReservation: null,
      currentStatus: options.allowRoomReadinessOverride
        ? { notIn: ['OCCUPIED', 'OCCUPIED_CLEAN', 'OCCUPIED_DIRTY'] }
        : { in: ['VACANT_CLEAN', 'INSPECTED'] },
    }
    const roomUpdate = await tx.room.updateMany({
      where: roomWhere,
      data: {
        currentStatus: toStatus,
        currentReservation: reservation.id,
      },
    })
    if (roomUpdate.count !== 1) {
      throw new PmsValidationError(`Room ${room.number} changed state before check-in could complete. Refresh and try again.`, 409)
    }

    const reservationUpdate = await tx.reservation.updateMany({
      where: { id: reservation.id, status: { in: ['CONFIRMED', 'PENDING'] } },
      data: {
        status: 'CHECKED_IN',
        actualCheckIn: new Date(),
      },
    })
    if (reservationUpdate.count !== 1) {
      throw new PmsValidationError('Reservation changed state before check-in could complete. Refresh and try again.', 409)
    }

    await createReservationLog(tx, reservation.id, 'CHECKED_IN', actor, {
      fromStatus: reservation.status,
      toStatus: 'CHECKED_IN',
      notes: options.overrideReason || options.additionalNotes || undefined,
      changes: {
        roomId: room.id,
        roomNumber: room.number,
        overrides: {
          roomReadiness: Boolean(options.allowRoomReadinessOverride),
          date: Boolean(options.allowDateOverride),
          payLater: Boolean(options.allowPayLater),
          recordIdentityLater: Boolean(options.recordIdentityLater),
        },
      },
    })
    await createAudit(tx, actor, 'CHECKED_IN', 'reservation', reservation.id, {
      roomId: room.id,
      roomNumber: room.number,
      previousState: { reservationStatus: reservation.status, roomStatus: room.currentStatus },
      newState: { reservationStatus: 'CHECKED_IN', roomStatus: toStatus },
      overrideReason: options.overrideReason || options.payLaterReason || options.recordIdentityLaterReason || null,
      overrides: {
        roomReadiness: Boolean(options.allowRoomReadinessOverride),
        date: Boolean(options.allowDateOverride),
        payLater: Boolean(options.allowPayLater),
        recordIdentityLater: Boolean(options.recordIdentityLater),
      },
    })
    return tx.reservation.findUnique({
      where: { id: reservation.id },
      include: reservationInclude,
    })
  })
}

export async function checkOutReservation(prisma, reservationId, actor, options = {}) {
  return prisma.$transaction(async (tx) => {
    let reservation = await tx.reservation.findUnique({ where: { id: reservationId }, include: reservationInclude })
    if (!reservation) throw new PmsValidationError('Reservation was not found.', 404)
    if (reservation.status !== 'CHECKED_IN') {
      throw new PmsValidationError('Only checked-in reservations can be checked out.')
    }
    if (!reservation.assignedRoomId || !reservation.assignedRoom) {
      throw new PmsValidationError('Checked-in reservation is missing its assigned room.')
    }

    if (options.payment?.amount) {
      if (!reservation.folio?.id) throw new PmsValidationError('Reservation folio was not found.')
      await recordPaymentInTransaction(tx, reservation.folio.id, options.payment, actor)
      reservation = await tx.reservation.findUnique({ where: { id: reservationId }, include: reservationInclude })
    }

    const remainingBalance = roundMoney(reservation.folio?.balance || 0)
    if (remainingBalance > 0) {
      if (options.allowUnpaidOverride) {
        requireOverride(actor, 'override:check-out', options.overrideReason, 'Unpaid checkout override')
      } else {
        throw new PmsValidationError('Collect or override the remaining balance before checkout.')
      }
    }

    const room = reservation.assignedRoom
    await createRoomStatusLog(tx, room, 'VACANT_DIRTY', actor, 'Checkout completed; room sent to housekeeping')

    const roomUpdate = await tx.room.updateMany({
      where: {
        id: room.id,
        OR: [
          { currentReservation: reservation.id },
          { currentReservation: null },
        ],
      },
      data: {
        currentStatus: 'VACANT_DIRTY',
        currentReservation: null,
      },
    })
    if (roomUpdate.count !== 1) {
      throw new PmsValidationError(`Room ${room.number} changed state before checkout could complete. Refresh and try again.`, 409)
    }

    const reservationUpdate = await tx.reservation.updateMany({
      where: { id: reservation.id, status: 'CHECKED_IN' },
      data: {
        status: 'CHECKED_OUT',
        actualCheckOut: new Date(),
      },
    })
    if (reservationUpdate.count !== 1) {
      throw new PmsValidationError('Reservation has already been checked out or changed state. Refresh and try again.', 409)
    }

    if (reservation.folio?.id) {
      await tx.folio.update({
        where: { id: reservation.folio.id },
        data: { status: 'CLOSED' },
      })
    }

    await createReservationLog(tx, reservation.id, 'CHECKED_OUT', actor, {
      fromStatus: reservation.status,
      toStatus: 'CHECKED_OUT',
      notes: options.overrideReason || options.additionalNotes || undefined,
      changes: {
        roomId: room.id,
        roomNumber: room.number,
        markedRoomStatus: 'VACANT_DIRTY',
        folioClosed: Boolean(reservation.folio?.id),
        overrides: {
          unpaidBalance: Boolean(options.allowUnpaidOverride),
        },
      },
    })
    await createAudit(tx, actor, 'CHECKED_OUT', 'reservation', reservation.id, {
      roomId: room.id,
      roomNumber: room.number,
      previousState: { reservationStatus: reservation.status, roomStatus: room.currentStatus, balance: remainingBalance },
      newState: { reservationStatus: 'CHECKED_OUT', roomStatus: 'VACANT_DIRTY' },
      overrideReason: options.overrideReason || null,
      overrides: {
        unpaidBalance: Boolean(options.allowUnpaidOverride),
      },
      housekeepingHandoff: {
        roomId: room.id,
        status: 'VACANT_DIRTY',
        priorityTurnover: false,
      },
    })
    return tx.reservation.findUnique({
      where: { id: reservation.id },
      include: reservationInclude,
    })
  })
}

export async function cancelReservation(prisma, reservationId, actor, status = 'CANCELLED', notes = undefined) {
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({ where: { id: reservationId } })
    if (!reservation) throw new PmsValidationError('Reservation was not found.', 404)
    if (!['CANCELLED', 'NO_SHOW'].includes(status)) {
      throw new PmsValidationError('Cancellation status must be CANCELLED or NO_SHOW.')
    }
    if (reservation.status === 'CHECKED_IN') {
      throw new PmsValidationError('Checked-in reservations must be checked out before cancellation.')
    }

    await tx.roomDateInventory.deleteMany({ where: { reservationId } })
    const updated = await tx.reservation.update({
      where: { id: reservation.id },
      data: { status, notes: notes || reservation.notes },
      include: reservationInclude,
    })
    await createReservationLog(tx, reservation.id, status === 'NO_SHOW' ? 'NO_SHOW' : 'CANCELLED', actor, {
      fromStatus: reservation.status,
      toStatus: status,
      notes,
    })
    await createAudit(tx, actor, status, 'reservation', reservation.id, { notes })
    return updated
  })
}

export async function updateHousekeepingStatus(prisma, roomId, cleanStatus, actor, notes = undefined) {
  return prisma.$transaction(async (tx) => {
    const room = await tx.room.findUnique({ where: { id: roomId }, include: { roomType: true } })
    if (!room) throw new PmsValidationError('Room was not found.', 404)
    if (!['DIRTY', 'CLEANING', 'CLEAN', 'INSPECTED', 'MAINTENANCE'].includes(cleanStatus)) {
      throw new PmsValidationError('Select a valid housekeeping status.')
    }

    const operationalStatus = cleanStatus === 'MAINTENANCE' ? 'OUT_OF_SERVICE' : room.operationalStatus
    const toStatus = cleanStatus === 'MAINTENANCE'
      ? 'VACANT_DIRTY'
      : roomStatusForHousekeeping(room.currentStatus, cleanStatus)

    await createRoomStatusLog(tx, room, toStatus, actor, notes)
    const updated = await tx.room.update({
      where: { id: room.id },
      data: {
        currentStatus: toStatus,
        operationalStatus,
        notes: notes || room.notes,
      },
      include: { roomType: true },
    })
    await createAudit(tx, actor, 'HOUSEKEEPING_STATUS_UPDATED', 'room', room.id, { cleanStatus, toStatus })
    return updated
  })
}

export async function createPayment(prisma, input, actor) {
  return prisma.$transaction(async (tx) => {
    const folio = await tx.folio.findUnique({
      where: { id: input.folioId },
      include: {
        reservation: true,
      },
    })
    if (!folio) throw new PmsValidationError('Folio was not found.', 404)
    return recordPaymentInTransaction(tx, folio.id, input, actor)
  })
}

export async function createCharge(prisma, input, actor) {
  return prisma.$transaction(async (tx) => {
    const folio = await tx.folio.findUnique({ where: { id: input.folioId } })
    if (!folio) throw new PmsValidationError('Folio was not found.', 404)
    if (folio.status !== 'OPEN') {
      throw new PmsValidationError('Charges can only be posted to an open folio.')
    }

    const amount = Number(input.amount)
    const quantity = Number(input.quantity || 1)
    const description = normalizeNullableString(input.description)
    const category = String(input.category || 'OTHER').toUpperCase()
    const validCategories = ['ROOM', 'EXTRA_GUEST', 'CHILD', 'CAFE', 'MINIBAR', 'LAUNDRY', 'DAMAGE', 'OTHER']

    if (!description) throw new PmsValidationError('Charge description is required.')
    if (!validCategories.includes(category)) throw new PmsValidationError('Select a valid charge category.')
    if (!Number.isFinite(amount) || amount <= 0) throw new PmsValidationError('Charge amount must be greater than zero.')
    if (!Number.isInteger(quantity) || quantity < 1) throw new PmsValidationError('Charge quantity must be at least 1.')

    const charge = await tx.charge.create({
      data: {
        folioId: folio.id,
        date: input.date ? dateFromKey(getBangkokDateKey(input.date)) : dateFromKey(getBangkokDateKey(new Date())),
        description,
        category,
        amount: roundMoney(amount),
        quantity,
        total: roundMoney(amount * quantity),
        createdBy: actorName(actor),
      },
    })
    const updatedFolio = await recomputeFolio(tx, folio.id)
    await createAudit(tx, actor, 'CHARGE_CREATED', 'charge', charge.id, { folioId: folio.id, amount: charge.amount, quantity, category })
    return { charge, folio: updatedFolio }
  })
}

export async function createGuest(prisma, input, actor) {
  const guest = await prisma.guest.create({ data: validateGuestInput(input) })
  await createAudit(prisma, actor, 'CREATED', 'guest', guest.id)
  return guest
}

export async function updateGuest(prisma, guestId, input, actor) {
  const data = validateGuestInput(input)
  const guest = await prisma.guest.update({ where: { id: guestId }, data })
  await createAudit(prisma, actor, 'MODIFIED', 'guest', guest.id)
  return guest
}

export async function getTodayData(prisma) {
  const property = await getProperty(prisma)
  const todayKey = getBangkokDateKey(new Date())
  const today = dateFromKey(todayKey)
  const tomorrow = dateFromKey(nextDateKey(todayKey))
  const [rooms, arrivals, departures, inHouse, unpaidFolios] = await Promise.all([
    prisma.room.findMany({ where: { propertyId: property.id }, include: { roomType: true }, orderBy: [{ floor: 'asc' }, { number: 'asc' }] }),
    prisma.reservation.count({ where: { propertyId: property.id, status: { in: ['PENDING', 'CONFIRMED'] }, checkIn: { gte: today, lt: tomorrow } } }),
    prisma.reservation.count({ where: { propertyId: property.id, status: 'CHECKED_IN', checkOut: { gte: today, lt: tomorrow } } }),
    prisma.reservation.count({ where: { propertyId: property.id, status: 'CHECKED_IN' } }),
    prisma.folio.count({ where: { balance: { gt: 0 } } }),
  ])

  return {
    hotelDate: todayKey,
    arrivals,
    departures,
    inHouse,
    unpaidFolios,
    roomsTotal: rooms.length,
    roomsSellable: rooms.filter((room) => isSellableRoomNumber(room.number)).length,
    roomsDirty: rooms.filter((room) => room.currentStatus === 'VACANT_DIRTY' || room.currentStatus === 'OCCUPIED_DIRTY').length,
    roomsReady: rooms.filter((room) => room.operationalStatus === 'AVAILABLE' && ['VACANT_CLEAN', 'INSPECTED'].includes(room.currentStatus)).length,
  }
}

export async function getFrontDeskBoard(prisma) {
  const property = await getProperty(prisma)
  const [rooms, reservations] = await Promise.all([
    prisma.room.findMany({
      where: { propertyId: property.id },
      include: { roomType: true },
      orderBy: [{ floor: 'asc' }, { number: 'asc' }],
    }),
    prisma.reservation.findMany({
      where: { propertyId: property.id, status: { in: activeReservationStatuses() } },
      include: reservationInclude,
      orderBy: [{ checkIn: 'asc' }],
    }),
  ])

  return { property, rooms, reservations }
}
