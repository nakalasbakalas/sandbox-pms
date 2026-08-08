import { canPerformAction, normalizeRole } from './rbac.mjs'

const GUEST_CONTACT_ROLES = new Set(['ADMIN', 'MANAGER', 'FRONT_DESK'])
const RESERVATION_DETAIL_ROLES = new Set(['ADMIN', 'MANAGER', 'FRONT_DESK'])

export function maskSensitiveValue(value) {
  const text = String(value || '').trim()
  if (!text) return null
  if (text.length <= 4) return '••••'
  return `${'•'.repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`
}

function roleOf(actor) {
  return normalizeRole(actor?.role)
}

function canViewGuestContact(actor) {
  return GUEST_CONTACT_ROLES.has(roleOf(actor)) && canPerformAction(actor, 'view:guests')
}

function canViewReservationDetail(actor) {
  return RESERVATION_DETAIL_ROLES.has(roleOf(actor)) && canPerformAction(actor, 'view:reservations')
}

function canViewFinance(actor) {
  return canPerformAction(actor, 'view:cashier')
    || canPerformAction(actor, 'post:charges')
    || canPerformAction(actor, 'process:payment')
}

function projectRoomType(roomType) {
  if (!roomType) return null
  return {
    id: roomType.id,
    code: roomType.code,
    name: roomType.name,
    standardOcc: roomType.standardOcc,
    maxOccupancy: roomType.maxOccupancy,
  }
}

function projectAssignedRoom(room) {
  if (!room) return null
  return {
    id: room.id,
    number: room.number,
    floor: room.floor,
    currentStatus: room.currentStatus,
    operationalStatus: room.operationalStatus,
  }
}

function projectCharge(charge) {
  return {
    id: charge.id,
    folioId: charge.folioId,
    date: charge.date,
    category: charge.category,
    description: charge.description,
    amount: charge.amount,
    amountSatang: charge.amountSatang,
    quantity: charge.quantity,
    total: charge.total,
    totalSatang: charge.totalSatang,
    void: charge.void,
    createdBy: charge.createdBy,
    createdAt: charge.createdAt,
    updatedAt: charge.updatedAt,
  }
}

function projectPayment(payment) {
  return {
    id: payment.id,
    folioId: payment.folioId,
    amount: payment.amount,
    amountSatang: payment.amountSatang,
    method: payment.method,
    receivedAt: payment.receivedAt,
    processedBy: payment.processedBy,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  }
}

function projectFolio(folio, actor, { includeTransactions = true } = {}) {
  if (!folio || !canViewFinance(actor)) return null
  return {
    id: folio.id,
    reservationId: folio.reservationId,
    subtotal: folio.subtotal,
    subtotalSatang: folio.subtotalSatang,
    tax: folio.tax,
    taxSatang: folio.taxSatang,
    total: folio.total,
    totalSatang: folio.totalSatang,
    paid: folio.paid,
    paidSatang: folio.paidSatang,
    balance: folio.balance,
    balanceSatang: folio.balanceSatang,
    status: folio.status,
    ...(includeTransactions ? {
      charges: Array.isArray(folio.charges) ? folio.charges.map(projectCharge) : [],
      payments: Array.isArray(folio.payments) ? folio.payments.map(projectPayment) : [],
    } : {}),
    createdAt: folio.createdAt,
    updatedAt: folio.updatedAt,
  }
}

export function projectPaymentMutationResponse(result) {
  const payment = result?.payment ?? {}
  const folio = result?.folio ?? {}
  return {
    payment: {
      id: payment.id ?? null,
      folioId: payment.folioId ?? null,
      amount: payment.amount ?? null,
      amountSatang: payment.amountSatang ?? null,
      method: payment.method ?? null,
      reference: maskSensitiveValue(payment.reference),
      processedBy: payment.processedBy ?? null,
      createdAt: payment.createdAt ?? null,
    },
    folio: {
      id: folio.id ?? null,
      reservationId: folio.reservationId ?? null,
      subtotal: folio.subtotal ?? 0,
      subtotalSatang: folio.subtotalSatang ?? 0,
      tax: folio.tax ?? 0,
      taxSatang: folio.taxSatang ?? 0,
      total: folio.total ?? 0,
      totalSatang: folio.totalSatang ?? 0,
      paid: folio.paid ?? 0,
      paidSatang: folio.paidSatang ?? 0,
      balance: folio.balance ?? 0,
      balanceSatang: folio.balanceSatang ?? 0,
      status: folio.status ?? null,
      createdAt: folio.createdAt ?? null,
      updatedAt: folio.updatedAt ?? null,
    },
  }
}

export function projectGuestResponse(guest, actor, options = {}) {
  if (!guest) return null
  const canViewContact = canViewGuestContact(actor)
  return {
    id: guest.id,
    propertyId: guest.propertyId,
    firstName: guest.firstName,
    lastName: guest.lastName,
    vipStatus: Boolean(guest.vipStatus),
    ...(canViewContact ? {
      email: guest.email,
      phone: guest.phone,
      nationality: guest.nationality,
      idType: guest.idType,
      identityRecorded: Boolean(guest.idNumber),
      blacklisted: Boolean(guest.blacklisted),
      notes: guest.notes,
    } : {}),
    ...(options.includeReservations ? {
      reservations: Array.isArray(guest.reservations)
        ? guest.reservations.map((reservation) => projectReservationResponse(reservation, actor, { includeGuest: false }))
        : [],
    } : {}),
    createdAt: guest.createdAt,
    updatedAt: guest.updatedAt,
    ...(guest.idempotentReplay === true ? { idempotentReplay: true } : {}),
  }
}

export function projectReservationResponse(reservation, actor, options = {}) {
  if (!reservation) return null
  const canViewDetail = canViewReservationDetail(actor)
  const finance = canViewFinance(actor)
  return {
    id: reservation.id,
    confirmationCode: reservation.confirmationCode,
    propertyId: reservation.propertyId,
    guestId: reservation.guestId,
    roomTypeId: reservation.roomTypeId,
    assignedRoomId: reservation.assignedRoomId,
    checkIn: reservation.checkIn,
    checkOut: reservation.checkOut,
    actualCheckIn: reservation.actualCheckIn,
    actualCheckOut: reservation.actualCheckOut,
    status: reservation.status,
    adults: reservation.adults,
    children: reservation.children,
    childAges: reservation.childAges,
    source: reservation.source,
    sourceEmailEventId: reservation.sourceEmailEventId,
    ...(canViewDetail ? {
      channelRef: reservation.channelRef,
      notes: reservation.notes,
      specialRequests: reservation.specialRequests,
    } : {}),
    ...(finance ? {
      ratePerNight: reservation.ratePerNight,
      ratePerNightSatang: reservation.ratePerNightSatang,
      totalAmount: reservation.totalAmount,
      totalAmountSatang: reservation.totalAmountSatang,
      depositAmount: reservation.depositAmount,
      depositAmountSatang: reservation.depositAmountSatang,
      depositPaid: Boolean(reservation.depositPaid),
      folio: projectFolio(reservation.folio, actor),
    } : {}),
    ...(options.includeGuest === false ? {} : { guest: projectGuestResponse(reservation.guest, actor) }),
    roomType: projectRoomType(reservation.roomType),
    assignedRoom: projectAssignedRoom(reservation.assignedRoom),
    createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt,
    ...(reservation.idempotentReplay === true ? { idempotentReplay: true } : {}),
  }
}

function projectStringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : undefined
}

export function projectBookingEmailEventResponse(event, actor) {
  const details = event?.parsedDetails && typeof event.parsedDetails === 'object' && !Array.isArray(event.parsedDetails)
    ? event.parsedDetails
    : {}
  const decision = event?.automationDecision && typeof event.automationDecision === 'object' && !Array.isArray(event.automationDecision)
    ? event.automationDecision
    : {}

  if (roleOf(actor) === 'CASHIER' || !['ADMIN', 'MANAGER', 'FRONT_DESK'].includes(roleOf(actor))) {
    return {
      id: event?.id,
      receivedAt: event?.receivedAt,
      eventType: event?.eventType,
      status: event?.status,
      amount: event?.amount,
      currency: event?.currency,
      paymentStatus: event?.paymentStatus,
      reservationId: event?.reservationId,
      reservationConfirmation: event?.reservationConfirmation,
      parsedDetails: {
        amount: details.amount,
        currency: details.currency,
        paymentStatus: details.paymentStatus,
        paymentMethod: details.paymentMethod,
        paymentReference: maskSensitiveValue(details.paymentReference),
      },
    }
  }
  return {
    id: event?.id,
    sourceId: event?.sourceId,
    sourceName: event?.sourceName,
    source: event?.source,
    sender: event?.sender,
    subject: event?.subject,
    receivedAt: event?.receivedAt,
    eventType: event?.eventType,
    status: event?.status,
    channelRef: event?.channelRef,
    guestName: event?.guestName,
    checkIn: event?.checkIn,
    checkOut: event?.checkOut,
    roomType: event?.roomType,
    amount: event?.amount,
    currency: event?.currency,
    paymentStatus: event?.paymentStatus,
    confidence: event?.confidence,
    proposedAction: event?.proposedAction,
    completedAction: event?.completedAction,
    reviewReason: event?.reviewReason,
    errorReason: event?.errorReason,
    reservationId: event?.reservationId,
    reservationConfirmation: event?.reservationConfirmation,
    duplicateOfEventId: event?.duplicateOfEventId,
    automationDecision: {
      version: decision.version,
      stage: decision.stage,
      confidence: decision.confidence,
      corroborationCount: decision.corroborationCount,
      corroboratingEventIds: projectStringArray(decision.corroboratingEventIds),
      conflictingFields: projectStringArray(decision.conflictingFields),
      blockers: projectStringArray(decision.blockers),
      provider: decision.provider,
      channelMappingIds: projectStringArray(decision.channelMappingIds),
      resolvedRoomTypeId: decision.resolvedRoomTypeId,
      resolvedRoomTypeCode: decision.resolvedRoomTypeCode,
      assignedRoomId: decision.assignedRoomId,
      reservationId: decision.reservationId,
      duplicateOfEventId: decision.duplicateOfEventId,
      evaluatedAt: decision.evaluatedAt,
    },
    managerReviewNotifiedAt: event?.managerReviewNotifiedAt,
    parsedDetails: {
      guestName: details.guestName,
      guestEmail: details.guestEmail,
      guestPhone: details.guestPhone,
      checkIn: details.checkIn,
      checkOut: details.checkOut,
      roomType: details.roomType,
      externalRoomType: details.externalRoomType,
      adults: details.adults,
      children: details.children,
      childAges: Array.isArray(details.childAges) ? details.childAges.filter(Number.isInteger) : undefined,
      amount: details.amount,
      currency: details.currency,
      paymentStatus: details.paymentStatus,
      paymentMethod: details.paymentMethod,
      paymentReference: maskSensitiveValue(details.paymentReference),
      specialRequests: details.specialRequests,
      notes: details.notes,
      channelRef: details.channelRef,
      confirmationCode: details.confirmationCode,
    },
    createdAt: event?.createdAt,
    updatedAt: event?.updatedAt,
  }
}

function projectBookingEmailSource(source) {
  return {
    id: source?.id,
    name: source?.name,
    provider: source?.provider,
    enabled: source?.enabled,
    mailbox: source?.mailbox,
    lastSyncAt: source?.lastSyncAt,
    lastError: source?.lastError,
    autoProcessSafeEvents: source?.autoProcessSafeEvents,
    reviewThreshold: source?.reviewThreshold,
  }
}

function projectBookingEmailStatus(status) {
  const credential = status?.credentialStatus || {}
  const connection = credential.connectionTest || {}
  const workspace = status?.workspaceJson || {}
  const automation = status?.automation || {}
  return {
    configured: status?.configured,
    credentialMode: status?.credentialMode,
    credentialStatus: {
      gmailOauthClientConfigured: credential.gmailOauthClientConfigured,
      refreshTokenConfigured: credential.refreshTokenConfigured,
      accessTokenConfigured: credential.accessTokenConfigured,
      targetMailboxConfigured: credential.targetMailboxConfigured,
      targetMailbox: credential.targetMailbox,
      userId: credential.userId,
      scopes: projectStringArray(credential.scopes),
      missing: projectStringArray(credential.missing),
      remediation: credential.remediation,
      connectionTest: {
        checked: connection.checked,
        status: connection.status,
        message: connection.message,
        authenticatedMailbox: connection.authenticatedMailbox,
        targetMailboxMatchesAuthenticatedAccount: connection.targetMailboxMatchesAuthenticatedAccount,
      },
    },
    lastSyncAt: status?.lastSyncAt,
    workspaceJson: {
      requested: workspace.requested,
      configured: workspace.configured,
      folderConfigured: workspace.folderConfigured,
      driveScopeConfigured: workspace.driveScopeConfigured,
      requireForAutonomy: workspace.requireForAutonomy,
      missing: projectStringArray(workspace.missing),
    },
    needsReview: status?.needsReview,
    processedToday: status?.processedToday,
    errors: status?.errors,
    ignored: status?.ignored,
    automation: {
      version: automation.version,
      requested: automation.requested,
      configured: automation.configured,
      operationalMutationsEnabled: automation.operationalMutationsEnabled,
      autoAssignRooms: automation.autoAssignRooms,
      notifyManager: automation.notifyManager,
      requireAuthenticationResults: automation.requireAuthenticationResults,
      requireCorroboration: automation.requireCorroboration,
      requireWorkspaceJson: automation.requireWorkspaceJson,
      workspaceJsonConfigured: automation.workspaceJsonConfigured,
      minimumConfidence: automation.minimumConfidence,
      trustedSenderDomainCount: automation.trustedSenderDomainCount,
      missing: projectStringArray(automation.missing),
    },
    sources: Array.isArray(status?.sources) ? status.sources.map(projectBookingEmailSource) : [],
    message: status?.message,
  }
}

export function projectBookingEmailSyncHttpResponse(result, actor) {
  return {
    status: projectBookingEmailStatus(result?.status),
    events: Array.isArray(result?.events)
      ? result.events.map((event) => projectBookingEmailEventResponse(event, actor))
      : [],
  }
}
