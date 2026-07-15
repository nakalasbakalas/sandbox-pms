import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getBookingEmailEvent,
  getBookingEmailEvidence,
} from '../server/pms-service.mjs'

const property = {
  id: 'property-sandbox',
  code: 'SANDBOX',
  name: 'SANDBOX HOTEL',
}

const actor = {
  id: 'manager-email-evidence',
  username: 'manager.email.evidence',
  role: 'MANAGER',
}

function bookingEmailEvent(overrides = {}) {
  const now = new Date('2026-07-15T02:00:00.000Z')
  return {
    id: 'booking-email-event-privacy',
    propertyId: property.id,
    sourceId: 'booking-email-source-1',
    sourceName: 'Primary booking Gmail',
    sourceMailbox: 'booking@sandboxhotel.com',
    sourceMessageId: 'gmail-sensitive-message-id',
    sender: 'guest.private@example.test',
    subject: 'Private booking notification',
    receivedAt: now,
    eventType: 'NEW_BOOKING',
    status: 'NEEDS_REVIEW',
    confidence: 0.98,
    amount: 1_500,
    amountSatang: 150_000,
    currency: 'THB',
    rawEmailUrl: 'https://mail.google.com/mail/u/0/#inbox/gmail-sensitive-message-id',
    rawHeaders: { Authorization: 'test-only-sensitive-header' },
    rawText: 'Guest phone +66 81 234 5678 and private free-form body',
    parsedDetails: {
      guestName: 'Private Guest',
      rawHeaders: { Authorization: 'nested-test-only-sensitive-header' },
      rawText: 'Nested private email body',
    },
    legacyReadOnly: false,
    source: null,
    reservation: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function privacyPrisma(event, options = {}) {
  const state = {
    auditRows: [],
    eventWhere: null,
  }
  const prisma = {
    property: {
      findUnique: async ({ where }) => (where.code === property.code ? property : null),
    },
    bookingEmailEvent: {
      findFirst: async ({ where }) => {
        state.eventWhere = where
        if (where.id !== event.id || where.propertyId !== property.id || event.propertyId !== property.id) return null
        if (options.selectEvidence) {
          return {
            id: event.id,
            rawEmailUrl: event.rawEmailUrl,
            sourceMessageId: event.sourceMessageId,
          }
        }
        return event
      },
    },
    auditLog: {
      create: async ({ data }) => {
        state.auditRows.push(data)
        return data
      },
    },
  }
  prisma.$transaction = async (callback) => callback(prisma)
  return { prisma, state }
}

test('normal booking-email review DTO omits raw evidence, source ids, headers, and text', async () => {
  const event = bookingEmailEvent()
  const { prisma } = privacyPrisma(event)

  const response = await getBookingEmailEvent(prisma, event.id)
  const serialized = JSON.stringify(response)

  assert.equal(Object.hasOwn(response, 'rawEmailUrl'), false)
  assert.equal(Object.hasOwn(response, 'sourceEmailId'), false)
  assert.equal(Object.hasOwn(response, 'rawHeaders'), false)
  assert.equal(Object.hasOwn(response, 'rawText'), false)
  assert.equal(Object.hasOwn(response, 'parsedDetails'), false)
  assert.doesNotMatch(serialized, /gmail-sensitive-message-id/)
  assert.doesNotMatch(serialized, /should-never-leave-the-service/)
  assert.doesNotMatch(serialized, /private free-form body/i)
})

test('elevated booking-email evidence access is property-scoped and reason-gated', async () => {
  const event = bookingEmailEvent()
  const { prisma, state } = privacyPrisma(event, { selectEvidence: true })

  await assert.rejects(
    () => getBookingEmailEvidence(prisma, event.id, { reason: '   ' }, actor),
    (error) => error?.statusCode === 400 && /operational reason/i.test(error.message),
  )
  assert.equal(state.auditRows.length, 0)

  const foreignEvent = bookingEmailEvent({
    id: 'foreign-property-email-event',
    propertyId: 'property-foreign',
  })
  const foreign = privacyPrisma(foreignEvent, { selectEvidence: true })
  await assert.rejects(
    () => getBookingEmailEvidence(
      foreign.prisma,
      foreignEvent.id,
      { reason: 'Investigate a provider reconciliation mismatch.' },
      actor,
    ),
    (error) => error?.statusCode === 404 && /not found/i.test(error.message),
  )
  assert.deepEqual(foreign.state.eventWhere, {
    id: foreignEvent.id,
    propertyId: property.id,
  })
  assert.equal(foreign.state.auditRows.length, 0)
})

test('elevated booking-email evidence access audits the reason without persisting evidence PII', async () => {
  const event = bookingEmailEvent()
  const { prisma, state } = privacyPrisma(event, { selectEvidence: true })
  const reason = 'Investigate a provider reconciliation mismatch.'

  const response = await getBookingEmailEvidence(prisma, event.id, { reason }, actor)

  assert.deepEqual(response, {
    eventId: event.id,
    rawEmailUrl: event.rawEmailUrl,
    sourceEmailId: event.sourceMessageId,
  })
  assert.equal(state.auditRows.length, 1)
  assert.equal(state.auditRows[0].action, 'BOOKING_EMAIL_EVIDENCE_VIEWED')
  assert.equal(state.auditRows[0].entityType, 'bookingEmailEvent')
  assert.equal(state.auditRows[0].entityId, event.id)
  assert.equal(state.auditRows[0].changes.reason, reason)

  const persistedAudit = JSON.stringify(state.auditRows[0])
  assert.doesNotMatch(persistedAudit, /gmail-sensitive-message-id/)
  assert.doesNotMatch(persistedAudit, /guest\.private@example\.test/)
  assert.doesNotMatch(persistedAudit, /private free-form body/i)
  assert.doesNotMatch(persistedAudit, /mail\.google\.com/)
})

test('booking-email evidence access denies non-elevated staff before data access', async () => {
  const event = bookingEmailEvent()
  const { prisma, state } = privacyPrisma(event, { selectEvidence: true })

  await assert.rejects(
    () => getBookingEmailEvidence(
      prisma,
      event.id,
      { reason: 'Front desk requested a raw-email review.' },
      { id: 'front-desk-1', role: 'FRONT_DESK' },
    ),
    (error) => error?.statusCode === 403 && /view:booking-email-evidence/i.test(error.message),
  )
  assert.equal(state.eventWhere, null)
  assert.equal(state.auditRows.length, 0)
})
