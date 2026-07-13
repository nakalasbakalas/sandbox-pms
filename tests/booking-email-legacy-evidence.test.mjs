import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import test from 'node:test'

import {
  approveBookingEmailEvent,
  getBookingEmailEvent,
  rejectBookingEmailEvent,
  reprocessBookingEmailEvent,
} from '../server/pms-service.mjs'

const actor = { id: 'manager-1', name: 'Manager', role: 'MANAGER' }

test('migration archives only terminal or past email evidence and preserves unresolved active work', async () => {
  const sql = await readFile(
    new URL('../prisma/migrations/20260713120000_manual_channel_task_target_snapshot/migration.sql', import.meta.url),
    'utf8',
  )

  assert.match(
    sql,
    /ADD COLUMN "legacyReadOnly" BOOLEAN NOT NULL DEFAULT FALSE;/i,
  )
  assert.doesNotMatch(
    sql,
    /ADD COLUMN "legacyReadOnly" BOOLEAN NOT NULL DEFAULT TRUE;/i,
  )
  const archiveUpdate = sql.match(
    /UPDATE "BookingEmailEvent"\s+SET "legacyReadOnly" = TRUE\s+WHERE[\s\S]*?;/i,
  )?.[0]
  assert.ok(archiveUpdate, 'legacy archive UPDATE must exist')
  assert.match(
    archiveUpdate,
    /SET "legacyReadOnly" = TRUE\s+WHERE "status" IN \('PROCESSED', 'IGNORED'\)\s+OR "processedAt" IS NOT NULL\s+OR "rejectedAt" IS NOT NULL\s+OR \("checkOut" IS NOT NULL AND "checkOut" < CURRENT_DATE\);/i,
  )
  assert.doesNotMatch(archiveUpdate, /NEEDS_REVIEW|ERROR/i)
})

function legacyEvent() {
  const now = new Date()
  return {
    id: 'legacy-event-1',
    propertyId: 'property-1',
    sourceId: null,
    sourceName: 'Historical booking email',
    sourceMailbox: 'booking@sandboxhotel.com',
    sourceMessageId: 'legacy-message-1',
    sender: 'legacy@example.invalid',
    subject: 'Historical evidence',
    receivedAt: now,
    eventType: 'NEW_BOOKING',
    status: 'NEEDS_REVIEW',
    confidence: 1,
    amount: null,
    amountSatang: null,
    parsedDetails: {},
    processedAt: null,
    rejectedAt: null,
    legacyReadOnly: true,
    createdAt: now,
    updatedAt: now,
    source: null,
    reservation: null,
  }
}

test('legacy booking email evidence is labeled non-actionable in read responses', async () => {
  const event = legacyEvent()
  const prisma = {
    bookingEmailEvent: { findUnique: async () => event },
  }

  const response = await getBookingEmailEvent(prisma, event.id)
  assert.equal(response.legacyReadOnly, true)
  assert.equal(response.reviewActionsAllowed, false)
})

test('unresolved NEEDS_REVIEW and ERROR events preserved by the cutover remain reviewable', async () => {
  for (const [index, status] of ['NEEDS_REVIEW', 'ERROR'].entries()) {
    const event = {
      ...legacyEvent(),
      id: `active-event-${index + 1}`,
      status,
      checkOut: new Date(Date.now() + 86_400_000),
      legacyReadOnly: false,
    }
    const prisma = {
      bookingEmailEvent: { findUnique: async () => event },
    }

    const response = await getBookingEmailEvent(prisma, event.id)
    assert.equal(response.legacyReadOnly, false)
    assert.equal(response.reviewActionsAllowed, true)
  }
})

test('approve, reject, and reprocess all refuse read-only legacy booking email evidence', async () => {
  const event = legacyEvent()
  let mutationCalled = false
  const prisma = {
    bookingEmailEvent: {
      findUnique: async () => event,
      update: async () => {
        mutationCalled = true
        return event
      },
    },
    $transaction: async (callback) => callback(prisma),
  }
  const isLegacyConflict = (error) => error?.statusCode === 409 && /read-only legacy evidence/i.test(error.message)

  await assert.rejects(
    () => approveBookingEmailEvent(prisma, event.id, {}, actor),
    isLegacyConflict,
  )
  await assert.rejects(
    () => rejectBookingEmailEvent(prisma, event.id, { reason: 'Historical row must remain evidence.' }, actor),
    isLegacyConflict,
  )
  await assert.rejects(
    () => reprocessBookingEmailEvent(prisma, event.id, actor),
    isLegacyConflict,
  )
  assert.equal(mutationCalled, false)
})
