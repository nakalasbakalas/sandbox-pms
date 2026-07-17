/* global console */
import assert from 'node:assert/strict'
import {
  createMessageDraft,
  createMessageTemplate,
  listMessages,
} from '../server/messaging-service.mjs'

const context = {
  propertyId: 'property-1',
  idempotencyKey: 'request-draft-1',
  actor: { id: 'user-1', username: 'frontdesk', role: 'FRONT_DESK' },
}
const messages = []
const templates = []
const audits = []
const events = []

const tx = {
  guest: { findFirst: async ({ where }) => where.id === 'guest-1' && where.propertyId === context.propertyId ? { id: 'guest-1' } : null },
  userPropertyMembership: { findFirst: async () => null },
  reservation: { findFirst: async ({ where }) => where.id === 'reservation-1' && where.propertyId === context.propertyId ? { id: 'reservation-1' } : null },
  message: {
    findUnique: async ({ where }) => messages.find((message) => message.propertyId === where.propertyId_idempotencyKey.propertyId && message.idempotencyKey === where.propertyId_idempotencyKey.idempotencyKey) || null,
    findMany: async ({ where }) => messages.filter((message) => message.propertyId === where.propertyId),
    create: async ({ data }) => {
      const message = { id: `message-${messages.length + 1}`, createdAt: new Date('2026-07-17T00:00:00Z'), ...data }
      messages.push(message)
      return message
    },
  },
  messageTemplate: {
    findFirst: async ({ where }) => templates.find((template) => template.id === where.id && template.propertyId === where.propertyId && template.active) || null,
    findMany: async ({ where }) => templates.filter((template) => template.propertyId === where.propertyId),
    create: async ({ data }) => {
      const template = { id: `template-${templates.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data }
      templates.push(template)
      return template
    },
  },
  auditLog: { create: async ({ data }) => (audits.push(data), data) },
  domainEvent: { create: async ({ data }) => (events.push(data), data) },
}
const prisma = { ...tx, $transaction: async (callback) => callback(tx) }

const draftInput = {
  channel: 'EMAIL', type: 'PRE_ARRIVAL', recipientType: 'GUEST', recipientId: 'guest-1',
  recipientName: 'Test Guest', recipientContact: 'guest@example.test', reservationId: 'reservation-1',
  roomNumber: '101', subject: 'Arrival', body: 'Your draft arrival message.',
}
const created = await createMessageDraft(prisma, context, draftInput)
assert.equal(created.status, 'PENDING')
assert.equal(created.deliveryAttempted, false)
assert.equal(created.recipientName, 'Test Guest')
assert.equal(messages.length, 1)
assert.equal(audits[0].propertyId, context.propertyId)
assert.equal(events[0].eventType, 'MESSAGE_DRAFT_CREATED')

const replay = await createMessageDraft(prisma, context, draftInput)
assert.equal(replay.id, created.id)
assert.equal(messages.length, 1)
assert.equal((await listMessages(prisma, context)).length, 1)

await assert.rejects(
  createMessageDraft(prisma, context, { ...draftInput, password: 'must-not-be-accepted' }),
  /Unrecognized key/,
)
await assert.rejects(
  createMessageDraft(prisma, { ...context, idempotencyKey: 'request-draft-2' }, { ...draftInput, recipientId: 'guest-other' }),
  (error) => error.statusCode === 404,
)
await assert.rejects(
  createMessageTemplate(prisma, context, { name: 'Arrival', channel: 'EMAIL', body: 'Hello', variables: [] }),
  /reason/i,
)

const template = await createMessageTemplate(prisma, context, {
  name: 'Arrival', type: 'PRE_ARRIVAL', channel: 'EMAIL', body: 'Hello {{guestName}}', variables: ['guestName'],
  reason: 'Add the approved pre-arrival draft.',
})
assert.equal(template.propertyId, context.propertyId)
assert.equal(template.type, 'PRE_ARRIVAL')
assert.equal(audits.at(-1).action, 'MESSAGE_TEMPLATE_CREATED')

console.log('Messaging persistence tests passed.')
