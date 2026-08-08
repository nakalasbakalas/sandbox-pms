/* global console */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import {
  viewFullPaymentReference,
  viewRawBookingEmail,
  viewReservationSensitiveIdentity,
} from '../server/pms-service.mjs'
import {
  projectBookingEmailEventResponse,
  projectGuestResponse,
  projectPaymentMutationResponse,
  projectReservationResponse,
} from '../server/pms-response-projections.mjs'
import { canPerformAction } from '../server/rbac.mjs'

const propertyA = { id: 'property-a', code: 'SANDBOX', timezone: 'Pacific/Honolulu' }
const propertyB = { id: 'property-b', code: 'OTHER', timezone: 'Asia/Bangkok' }
const propertyLocalNow = new Date('2026-08-08T03:00:00.000Z') // 2026-08-07 in Honolulu
const actors = {
  admin: { id: 'admin-a', propertyId: propertyA.id, role: 'ADMIN' },
  manager: { id: 'manager-a', propertyId: propertyA.id, role: 'MANAGER' },
  frontDesk: { id: 'front-desk-a', propertyId: propertyA.id, role: 'FRONT_DESK' },
  cashier: { id: 'cashier-a', propertyId: propertyA.id, role: 'CASHIER' },
  housekeeping: { id: 'housekeeping-a', propertyId: propertyA.id, role: 'HOUSEKEEPING' },
  cafe: { id: 'cafe-a', propertyId: propertyA.id, role: 'CAFE_STAFF' },
}
const identityReason = { reasonCode: 'CHECK_IN_VERIFICATION', reason: 'Verify TEST-ID-0001 at check-in.' }
const rawEmailReason = { reasonCode: 'PROVIDER_DISPUTE', reason: 'Review Synthetic booking email test body.' }
const paymentReason = { reasonCode: 'SETTLEMENT_RECONCILIATION', reason: 'Reconcile TEST-PAYMENT-REF-0001.' }

for (const [permission, allowedRoles] of Object.entries({
  'view:sensitive-identity': ['ADMIN', 'MANAGER', 'FRONT_DESK'],
  'view:raw-booking-email': ['ADMIN', 'MANAGER'],
  'view:full-payment-reference': ['ADMIN', 'MANAGER', 'CASHIER'],
})) {
  for (const actor of Object.values(actors)) {
    assert.equal(canPerformAction(actor, permission), allowedRoles.includes(actor.role), `${permission} follows the finish-packet role matrix for ${actor.role}`)
  }
}

function sensitiveFixture(options = {}) {
  const audits = []
  const records = {
    reservation: {
      id: 'reservation-a',
      propertyId: propertyA.id,
      status: options.reservationStatus || 'CONFIRMED',
      checkIn: new Date(options.checkIn || '2026-08-07T00:00:00.000Z'),
      checkOut: new Date(options.checkOut || '2026-08-08T00:00:00.000Z'),
      guest: {
        id: 'guest-a',
        nationality: 'TH',
        idType: 'PASSPORT',
        idNumber: 'TEST-ID-0001',
        dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
      },
    },
    event: {
      id: 'event-a',
      propertyId: propertyA.id,
      rawText: 'Synthetic booking email test body.',
      rawHeaders: {
        messageId: '<test-message@example.test>',
        date: 'Sat, 8 Aug 2026 10:00:00 +0700',
        authenticationResults: 'dkim=pass header.d=example.test',
        replyTo: 'reply@example.test',
        authorization: 'Bearer TEST-TOKEN-MUST-NOT-RETURN',
      },
    },
    payment: { id: 'payment-a', propertyId: propertyA.id, reference: 'TEST-PAYMENT-REF-0001' },
  }
  const prisma = {
    property: {
      findUnique: async ({ where }) => {
        if (where.id === propertyA.id) return propertyA
        if (where.id === propertyB.id) return propertyB
        return null
      },
    },
    reservation: {
      findFirst: async (query) => {
        assert.deepEqual(query.select, {
          id: true,
          status: true,
          checkIn: true,
          checkOut: true,
          guest: { select: { id: true, nationality: true, idType: true, idNumber: true, dateOfBirth: true } },
        }, 'identity access selects only the requested sensitive fields and access context')
        return query.where.id === records.reservation.id && query.where.propertyId === records.reservation.propertyId ? records.reservation : null
      },
    },
    bookingEmailEvent: {
      findFirst: async (query) => {
        assert.deepEqual(query.select, { id: true, rawText: true, rawHeaders: true }, 'raw email access selects only the requested evidence fields')
        return query.where.id === records.event.id && query.where.propertyId === records.event.propertyId ? records.event : null
      },
    },
    payment: {
      findFirst: async (query) => {
        assert.deepEqual(query.select, { id: true, reference: true }, 'payment reference access selects only the requested reference field')
        return query.where.id === records.payment.id && query.where.propertyId === records.payment.propertyId ? records.payment : null
      },
    },
    auditLog: {
      create: async ({ data }) => {
        if (options.failAudit) throw new Error('Synthetic audit write failure')
        audits.push(data)
        return { id: `audit-${audits.length}`, ...data }
      },
    },
  }
  prisma.$transaction = async (callback) => callback(prisma)
  return { prisma, records, audits }
}

await assert.rejects(
  viewReservationSensitiveIdentity(sensitiveFixture().prisma, 'reservation-a', identityReason, actors.cashier),
  { statusCode: 403 },
  'a role without identity permission is denied',
)
await assert.rejects(
  viewRawBookingEmail(sensitiveFixture().prisma, 'event-a', rawEmailReason, actors.frontDesk),
  { statusCode: 403 },
  'front desk cannot read raw booking email evidence',
)
await assert.rejects(
  viewFullPaymentReference(sensitiveFixture().prisma, 'payment-a', paymentReason, actors.cafe),
  { statusCode: 403 },
  'cafe staff cannot read full payment references',
)

for (const [read, id, reasonCode] of [
  [viewReservationSensitiveIdentity, 'reservation-a', 'CHECK_IN_VERIFICATION'],
  [viewRawBookingEmail, 'event-a', 'PROVIDER_DISPUTE'],
  [viewFullPaymentReference, 'payment-a', 'SETTLEMENT_RECONCILIATION'],
]) {
  await assert.rejects(read(sensitiveFixture().prisma, id, { reasonCode, reason: '   ' }, actors.admin), { statusCode: 400 }, 'sensitive access requires a non-empty JSON-body reason')
  await assert.rejects(read(sensitiveFixture().prisma, id, { reasonCode: 'UNCONTROLLED_REASON', reason: 'Operational review.' }, actors.admin), { statusCode: 400 }, 'sensitive access rejects an invalid endpoint reasonCode')
}

const foreignActor = { ...actors.admin, propertyId: propertyB.id }
for (const [read, id, input] of [
  [viewReservationSensitiveIdentity, 'reservation-a', identityReason],
  [viewRawBookingEmail, 'event-a', rawEmailReason],
  [viewFullPaymentReference, 'payment-a', paymentReason],
]) {
  await assert.rejects(read(sensitiveFixture().prisma, id, input, foreignActor), { statusCode: 404 }, 'cross-property sensitive access returns not found')
}

await assert.rejects(
  viewReservationSensitiveIdentity(sensitiveFixture({ reservationStatus: 'CHECKED_OUT' }).prisma, 'reservation-a', identityReason, actors.frontDesk, { now: propertyLocalNow }),
  { statusCode: 403 },
  'front desk identity access is limited to active check-in context',
)
await assert.rejects(
  viewReservationSensitiveIdentity(sensitiveFixture({ checkIn: '2026-08-20T00:00:00.000Z', checkOut: '2026-08-22T00:00:00.000Z' }).prisma, 'reservation-a', identityReason, actors.frontDesk, { now: propertyLocalNow }),
  { statusCode: 403 },
  'front desk cannot view identity for a far-future confirmed stay',
)
await assert.rejects(
  viewReservationSensitiveIdentity(sensitiveFixture({ checkIn: '2026-08-01T00:00:00.000Z', checkOut: '2026-08-03T00:00:00.000Z' }).prisma, 'reservation-a', identityReason, actors.frontDesk, { now: propertyLocalNow }),
  { statusCode: 403 },
  'front desk cannot view identity for a past confirmed stay',
)
await viewReservationSensitiveIdentity(
  sensitiveFixture({ reservationStatus: 'CHECKED_IN', checkIn: '2026-08-20T00:00:00.000Z', checkOut: '2026-08-22T00:00:00.000Z' }).prisma,
  'reservation-a',
  identityReason,
  actors.frontDesk,
  { now: propertyLocalNow },
)
await viewReservationSensitiveIdentity(
  sensitiveFixture({ checkIn: '2026-08-20T00:00:00.000Z', checkOut: '2026-08-22T00:00:00.000Z' }).prisma,
  'reservation-a',
  { ...identityReason, reasonCode: 'GUEST_RECORD_REVIEW' },
  actors.manager,
  { now: propertyLocalNow },
)

const identityFixture = sensitiveFixture()
const identity = await viewReservationSensitiveIdentity(identityFixture.prisma, 'reservation-a', identityReason, actors.frontDesk, { now: propertyLocalNow })
assert.deepEqual(identity, {
  reservationId: 'reservation-a',
  guestId: 'guest-a',
  identity: {
    nationality: 'TH',
    idType: 'PASSPORT',
    idNumber: 'TEST-ID-0001',
    dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
  },
}, 'identity endpoint returns only the explicit identity field set')

const rawFixture = sensitiveFixture()
const raw = await viewRawBookingEmail(rawFixture.prisma, 'event-a', rawEmailReason, actors.manager)
assert.deepEqual(Object.keys(raw).sort(), ['eventId', 'rawHeaders', 'rawText'])
assert.deepEqual(Object.keys(raw.rawHeaders).sort(), ['authenticationResults', 'date', 'messageId', 'replyTo'])
assert.equal(JSON.stringify(raw).includes('TEST-TOKEN-MUST-NOT-RETURN'), false, 'raw view excludes credential-shaped stored headers')
assert.equal('authorization' in raw.rawHeaders, false, 'raw view excludes unrelated authorization headers')

const paymentFixture = sensitiveFixture()
const payment = await viewFullPaymentReference(paymentFixture.prisma, 'payment-a', paymentReason, actors.cashier)
assert.deepEqual(payment, { paymentId: 'payment-a', reference: 'TEST-PAYMENT-REF-0001' }, 'payment endpoint returns only id and full reference')

for (const [fixture, expected] of [
  [identityFixture, { action: 'SENSITIVE_IDENTITY_VIEWED', entityType: 'reservation', entityId: 'reservation-a', fields: ['nationality', 'idType', 'idNumber', 'dateOfBirth'], reasonCode: 'CHECK_IN_VERIFICATION' }],
  [rawFixture, { action: 'RAW_BOOKING_EMAIL_VIEWED', entityType: 'bookingEmailEvent', entityId: 'event-a', fields: ['rawText', 'rawHeaders.messageId', 'rawHeaders.date', 'rawHeaders.authenticationResults', 'rawHeaders.replyTo'], reasonCode: 'PROVIDER_DISPUTE' }],
  [paymentFixture, { action: 'FULL_PAYMENT_REFERENCE_VIEWED', entityType: 'payment', entityId: 'payment-a', fields: ['reference'], reasonCode: 'SETTLEMENT_RECONCILIATION' }],
]) {
  assert.equal(fixture.audits.length, 1, 'successful sensitive access creates one audit row')
  const audit = fixture.audits[0]
  assert.equal(audit.propertyId, propertyA.id)
  assert.ok(['admin-a', 'manager-a', 'front-desk-a', 'cashier-a'].includes(audit.userId), 'audit identifies the actor')
  assert.equal(audit.action, expected.action)
  assert.equal(audit.entityType, expected.entityType)
  assert.equal(audit.entityId, expected.entityId)
  assert.deepEqual(audit.changes.fields, expected.fields)
  assert.equal(audit.changes.reasonCode, expected.reasonCode, 'audit records only the controlled reason code')
  assert.equal(audit.changes.reasonProvided, true, 'audit records that a non-empty operational reason was supplied')
  assert.equal('reason' in audit.changes, false, 'audit never persists the free-text reason')
  assert.equal(JSON.stringify(audit).includes('TEST-ID-0001'), false, 'audit contains no identity value')
  assert.equal(JSON.stringify(audit).includes('TEST-PAYMENT-REF-0001'), false, 'audit contains no payment reference value')
  assert.equal(JSON.stringify(audit).includes('Synthetic booking email test body.'), false, 'audit contains no raw email body')
}

await assert.rejects(
  viewFullPaymentReference(sensitiveFixture({ failAudit: true }).prisma, 'payment-a', paymentReason, actors.admin),
  /Synthetic audit write failure/,
  'sensitive data is not returned when its audit write fails',
)

const genericReservation = projectReservationResponse({
  ...identityFixture.records.reservation,
  confirmationCode: 'TEST-CONFIRMATION',
  guestId: identityFixture.records.reservation.guest.id,
  folio: { payments: [paymentFixture.records.payment] },
}, actors.admin)
const genericGuest = projectGuestResponse(identityFixture.records.reservation.guest, actors.admin)
assert.equal(JSON.stringify(genericReservation).includes('TEST-ID-0001'), false, 'generic reservation remains identity-redacted')
assert.equal(JSON.stringify(genericReservation).includes('TEST-PAYMENT-REF-0001'), false, 'generic reservation remains payment-reference-redacted')
assert.equal(JSON.stringify(genericGuest).includes('TEST-ID-0001'), false, 'generic guest remains identity-redacted')
const genericBookingEmail = projectBookingEmailEventResponse({
  id: 'event-a',
  rawEmailUrl: 'https://mail.example.test/raw/provider-message-id',
  sourceEmailId: 'provider-message-id',
  parsedDetails: { paymentReference: 'TEST-PAYMENT-REF-0001' },
}, actors.manager)
assert.equal(JSON.stringify(genericBookingEmail).includes('TEST-PAYMENT-REF-0001'), false, 'generic booking-email summary masks the full payment reference')
assert.match(genericBookingEmail.parsedDetails.paymentReference, /•+0001$/, 'generic booking-email summary retains only a useful reference suffix')
assert.equal('rawEmailUrl' in genericBookingEmail, false, 'generic booking-email summary cannot bypass the audited raw-view endpoint')
assert.equal('sourceEmailId' in genericBookingEmail, false, 'generic booking-email summary excludes the legacy provider message identifier')

const cashierBookingEmail = projectBookingEmailEventResponse({
  id: 'event-a',
  sourceId: 'source-provider-id',
  sourceName: 'Provider source',
  source: 'Provider',
  sender: 'guest@example.test',
  subject: 'Guest booking subject',
  receivedAt: '2026-08-08T03:00:00.000Z',
  eventType: 'PAYMENT_NOTICE',
  status: 'NEEDS_REVIEW',
  channelRef: 'PROVIDER-BOOKING-123',
  guestName: 'Synthetic Guest',
  amount: 1000,
  amountSatang: '100000',
  currency: 'THB',
  paymentStatus: 'PAID',
  reservationId: 'reservation-a',
  reservationConfirmation: 'TEST-CONFIRMATION',
  reviewReason: 'Sensitive review notes',
  automationDecision: { provider: 'BOOKING_COM', channelMappingIds: ['mapping-a'] },
  parsedDetails: {
    guestEmail: 'guest@example.test',
    guestPhone: '+66000000000',
    notes: 'Sensitive notes',
    specialRequests: 'Sensitive request',
    paymentMethod: 'BANK_TRANSFER',
    paymentReference: 'TEST-PAYMENT-REF-0001',
  },
}, actors.cashier)
for (const forbidden of ['sourceId', 'sourceName', 'source', 'sender', 'subject', 'channelRef', 'guestName', 'reviewReason', 'automationDecision']) {
  assert.equal(forbidden in cashierBookingEmail, false, `cashier booking-email projection excludes ${forbidden}`)
}
for (const forbidden of ['guestEmail', 'guestPhone', 'notes', 'specialRequests', 'channelRef', 'confirmationCode']) {
  assert.equal(forbidden in cashierBookingEmail.parsedDetails, false, `cashier parsed details exclude ${forbidden}`)
}
assert.equal(cashierBookingEmail.amount, 1000, 'cashier keeps operational payment amount')
assert.equal(cashierBookingEmail.amountSatang, '100000', 'cashier payment amount is derived from exact satang')
assert.match(cashierBookingEmail.parsedDetails.paymentReference, /•+0001$/, 'cashier sees only a masked payment-reference suffix')
assert.equal(JSON.stringify(cashierBookingEmail).includes('guest@example.test'), false)
assert.equal(JSON.stringify(cashierBookingEmail).includes('PROVIDER-BOOKING-123'), false)

const paymentMutation = projectPaymentMutationResponse({
  payment: {
    id: 'payment-a',
    folioId: 'folio-a',
    amount: 1000,
    amountSatang: '100000',
    method: 'BANK_TRANSFER',
    reference: 'TEST-PAYMENT-REF-0001',
    referenceFingerprint: 'secret-fingerprint',
    idempotencyKey: 'secret-idempotency-key',
    sourceEmailEvent: { rawText: 'raw provider evidence' },
  },
  folio: {
    id: 'folio-a',
    reservationId: 'reservation-a',
    total: 1000,
    paid: 1000,
    balance: 0,
    status: 'CLOSED',
    payments: [{ reference: 'TEST-PAYMENT-REF-0001', referenceFingerprint: 'secret-fingerprint' }],
    charges: [{ sourceEmailEvent: { rawText: 'raw provider evidence' } }],
  },
  idempotentReplay: true,
})
assert.match(paymentMutation.payment.reference, /•+0001$/, 'payment mutation masks the reference for every role')
for (const forbidden of ['referenceFingerprint', 'idempotencyKey', 'idempotentReplay', 'sourceEmailEvent', 'payments', 'charges']) {
  assert.equal(JSON.stringify(paymentMutation).includes(forbidden), false, `payment mutation omits ${forbidden}`)
}
assert.equal(JSON.stringify(paymentMutation).includes('TEST-PAYMENT-REF-0001'), false, 'payment mutation never serializes the full reference')

const indexSource = await readFile(new URL('../server/index.mjs', import.meta.url), 'utf8')
assert.match(indexSource, /const payment = projectPaymentMutationResponse\(paymentResult\)/, 'POST /api/payments uses the explicit mutation DTO')
assert.match(indexSource, /projectBookingEmailSyncHttpResponse\(result, user\)/, 'booking-email sync projection receives the authenticated actor')
const serviceSource = await readFile(new URL('../server/pms-service.mjs', import.meta.url), 'utf8')
assert.match(serviceSource, /events\.map\(\(event\) => bookingEmailEventResponse\(event, actor\)\)/, 'booking-email list projection receives the actor')
assert.match(serviceSource, /return bookingEmailEventResponse\(event, actor\)/, 'booking-email detail projection receives the actor')
assert.match(serviceSource, /events: results\.map\(\(event\) => bookingEmailEventResponse\(event, actor\)\)/, 'booking-email sync preserves the actor through its internal event projection')
const authenticatedBoundary = indexSource.indexOf('const authenticatedUser = await requireUser(request)')
for (const [routeFragment, permission] of [
  ['identity-view', 'view:sensitive-identity'],
  ['raw-view', 'view:raw-booking-email'],
  ['reference-view', 'view:full-payment-reference'],
]) {
  const routePosition = indexSource.indexOf(routeFragment)
  assert.ok(authenticatedBoundary >= 0 && routePosition > authenticatedBoundary, `${routeFragment} is behind the shared 401 authentication boundary`)
  assert.match(indexSource.slice(routePosition, routePosition + 320), /request\.method === 'POST'/, `${routeFragment} is POST-only`)
  assert.match(indexSource.slice(routePosition, routePosition + 420), new RegExp(`requirePermission\\(user, '${permission.replaceAll(':', '\\:')}'\\)`), `${routeFragment} has its explicit route permission`)
  assert.match(indexSource.slice(routePosition, routePosition + 520), /await readJson\(request\)/, `${routeFragment} reads its reason from the JSON body`)
}

console.log('Sensitive access service and route-guard tests passed.')
