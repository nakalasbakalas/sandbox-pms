import assert from 'node:assert/strict'
import test from 'node:test'

import {
  approveBookingEmailEvent,
  ingestBookingEmailEvents,
  listBookingEmailSources,
  rejectBookingEmailEvent,
  reprocessBookingEmailEvent,
  updateBookingEmailSource,
} from '../server/pms-service.mjs'

const actor = {
  id: 'manager-property-scope',
  username: 'manager.property.scope',
  name: 'Property Scope Manager',
  role: 'MANAGER',
}

const localProperty = { id: 'property-sandbox', code: 'SANDBOX', name: 'SANDBOX HOTEL' }
const foreignPropertyId = 'property-foreign'

function propertyDelegate() {
  return {
    findUnique: async ({ where }) => (where.code === 'SANDBOX' ? localProperty : null),
  }
}

test('booking-email source list and update stay within the configured property', async () => {
  const primarySource = {
    id: 'source-primary',
    propertyId: localProperty.id,
    name: 'Primary booking Gmail',
    provider: 'GMAIL',
    mailbox: 'booking@sandboxhotel.com',
    enabled: true,
    autoProcessSafeEvents: false,
    reviewThreshold: 0.75,
  }
  let listWhere = null
  let updateCalled = false
  const prisma = {
    property: propertyDelegate(),
    bookingEmailSource: {
      findUnique: async ({ where }) => (
        where.propertyId_mailbox ? primarySource : { ...primarySource, id: 'source-foreign', propertyId: foreignPropertyId }
      ),
      upsert: async () => primarySource,
      findMany: async ({ where }) => {
        listWhere = where
        return [primarySource]
      },
      update: async () => {
        updateCalled = true
        return primarySource
      },
    },
    $transaction: async (callback) => callback(prisma),
  }

  const sources = await listBookingEmailSources(prisma)
  assert.equal(listWhere.propertyId, localProperty.id)
  assert.deepEqual(sources.map((source) => source.id), [primarySource.id])

  await assert.rejects(
    () => updateBookingEmailSource(prisma, 'source-foreign', { enabled: false }, actor),
    (error) => error?.statusCode === 404,
  )
  await assert.rejects(
    () => ingestBookingEmailEvents(prisma, { sourceId: 'source-foreign', events: [] }, actor),
    (error) => error?.statusCode === 404,
  )
  assert.equal(updateCalled, false)
})

test('booking-email approve, reject, and reprocess hide foreign-property event ids', async () => {
  const event = {
    id: 'event-foreign',
    propertyId: foreignPropertyId,
    status: 'NEEDS_REVIEW',
    processedAt: null,
    legacyReadOnly: false,
  }
  let mutationCalled = false
  const prisma = {
    property: propertyDelegate(),
    bookingEmailEvent: {
      findUnique: async () => event,
      update: async () => {
        mutationCalled = true
        return event
      },
      updateMany: async () => {
        mutationCalled = true
        return { count: 1 }
      },
    },
    $transaction: async (callback) => callback(prisma),
  }

  const actions = [
    () => approveBookingEmailEvent(prisma, event.id, {}, actor),
    () => rejectBookingEmailEvent(prisma, event.id, { reason: 'Foreign property boundary test.' }, actor),
    () => reprocessBookingEmailEvent(prisma, event.id, actor),
  ]
  for (const action of actions) {
    await assert.rejects(action, (error) => error?.statusCode === 404 && /not found/i.test(error.message))
  }
  assert.equal(mutationCalled, false)
})
