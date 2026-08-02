/* global console */
import assert from 'node:assert/strict'
import {
  createChannelMapping,
  deleteChannelMapping,
  listChannelMappingSuggestions,
  listChannelMappings,
  updateChannelMapping,
} from '../server/channel-mapping-service.mjs'

const context = { propertyId: 'property-1', actor: { id: 'admin-1', role: 'ADMIN' } }
const otherContext = { propertyId: 'property-2', actor: { id: 'admin-2', role: 'ADMIN' } }
const mutationContext = (base, key) => ({ ...base, idempotencyKey: `${key}:11111111-1111-4111-8111-111111111111` })
const channels = [
  { id: 'channel-1', propertyId: context.propertyId, provider: 'TRIP', active: true },
  { id: 'channel-2', propertyId: otherContext.propertyId, provider: 'AGODA', active: true },
]
const roomTypes = [
  { id: 'type-1', propertyId: context.propertyId, code: 'TWIN', name: 'Standard Twin' },
  { id: 'type-2', propertyId: otherContext.propertyId, code: 'DOUBLE', name: 'Standard Double' },
]
const rooms = [
  { id: 'room-1', propertyId: context.propertyId, roomTypeId: 'type-1' },
  { id: 'room-2', propertyId: context.propertyId, roomTypeId: 'type-1' },
  { id: 'room-other', propertyId: otherContext.propertyId, roomTypeId: 'type-2' },
]
const mappings = []
const audits = []
const events = []
const mutationAttempts = []
const bookingEmailEvents = [
  {
    propertyId: context.propertyId,
    sender: 'reservations@trip.com',
    sourceName: 'Primary booking Gmail',
    eventType: 'NEW_BOOKING',
    roomType: 'TWIN',
    parsedDetails: { externalRoomType: 'Standard Twin Room', roomType: 'TWIN' },
    receivedAt: new Date('2026-08-02T03:00:00.000Z'),
  },
  {
    propertyId: context.propertyId,
    sender: 'reservations@trip.com',
    sourceName: 'Primary booking Gmail',
    eventType: 'MODIFICATION',
    roomType: 'TWIN',
    parsedDetails: { externalRoomType: 'Standard Twin Room', roomType: 'TWIN' },
    receivedAt: new Date('2026-08-02T04:00:00.000Z'),
  },
  {
    propertyId: otherContext.propertyId,
    sender: 'no-reply@agoda.com',
    sourceName: 'Primary booking Gmail',
    eventType: 'NEW_BOOKING',
    roomType: 'DOUBLE',
    parsedDetails: { externalRoomType: 'Superior Double', roomType: 'DOUBLE', guestName: 'Must Not Leak' },
    receivedAt: new Date('2026-08-02T05:00:00.000Z'),
  },
]
const tx = {
  $executeRawUnsafe: async () => 1,
  channel: {
    findFirst: async ({ where }) => channels.find((channel) => channel.id === where.id && channel.propertyId === where.propertyId) || null,
    findMany: async ({ where }) => channels.filter((channel) => channel.propertyId === where.propertyId),
  },
  roomType: {
    findFirst: async ({ where }) => roomTypes.find((roomType) => roomType.id === where.id && roomType.propertyId === where.propertyId) || null,
    findMany: async ({ where }) => roomTypes.filter((roomType) => roomType.propertyId === where.propertyId),
  },
  room: { count: async ({ where }) => rooms.filter((room) => (
    room.propertyId === where.propertyId &&
    room.roomTypeId === where.roomTypeId &&
    where.id.in.includes(room.id)
  )).length },
  channelMapping: {
    findMany: async ({ where }) => mappings.filter((mapping) => channels.find((channel) => channel.id === mapping.channelId)?.propertyId === where.channel.propertyId),
    findFirst: async ({ where }) => mappings.find((mapping) => (
      mapping.id === where.id &&
      channels.find((channel) => channel.id === mapping.channelId)?.propertyId === where.channel.propertyId
    )) || null,
    create: async ({ data }) => {
      const mapping = { id: `mapping-${mappings.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data }
      mappings.push(mapping)
      return mapping
    },
    update: async ({ where, data }) => {
      const mapping = mappings.find((item) => item.id === where.id)
      Object.assign(mapping, data, { updatedAt: new Date() })
      return mapping
    },
    delete: async ({ where }) => mappings.splice(mappings.findIndex((item) => item.id === where.id), 1)[0],
  },
  bookingEmailEvent: {
    findMany: async ({ where }) => bookingEmailEvents.filter((event) => (
      event.propertyId === where.propertyId && where.eventType.in.includes(event.eventType)
    )),
  },
  auditLog: { create: async ({ data }) => (audits.push(data), data) },
  domainEvent: { create: async ({ data }) => (events.push(data), data) },
  channelMutationAttempt: {
    findUnique: async ({ where }) => mutationAttempts.find((attempt) => (
      attempt.propertyId === where.propertyId_idempotencyKey.propertyId &&
      attempt.idempotencyKey === where.propertyId_idempotencyKey.idempotencyKey
    )) || null,
    create: async ({ data }) => {
      const attempt = { id: `attempt-${mutationAttempts.length + 1}`, result: null, ...data }
      mutationAttempts.push(attempt)
      return attempt
    },
    update: async ({ where, data }) => {
      const attempt = mutationAttempts.find((item) => item.id === where.id)
      Object.assign(attempt, data)
      return attempt
    },
  },
}
const prisma = { ...tx, $transaction: async (callback) => callback(tx) }

const suggestions = await listChannelMappingSuggestions(prisma, context)
assert.equal(suggestions.length, 1, 'mapping suggestions stay property scoped and group repeated OTA labels')
assert.equal(suggestions[0].provider, 'TRIP')
assert.equal(suggestions[0].externalRoomTypeName, 'Standard Twin Room')
assert.equal(suggestions[0].observationCount, 2)
assert.equal(suggestions[0].suggestedRoomTypeId, 'type-1', 'a consistent parsed room code suggests the matching PMS room type')
assert.equal(JSON.stringify(suggestions).includes('Must Not Leak'), false, 'mapping suggestions never expose parsed guest data')
assert.equal(suggestions[0].mapped, false)

const createContext = mutationContext(context, 'create')
const createInput = {
  channelId: 'channel-1', externalRoomTypeId: 'EXT-TWIN', externalRoomTypeName: 'External Twin',
  roomTypeId: 'type-1', roomIds: ['room-1', 'room-2'], active: true,
  reason: 'Map the certified external room category.',
}
const created = await createChannelMapping(prisma, createContext, createInput)
assert.equal(created.roomIds.length, 2)
const createAuditCount = audits.length
assert.deepEqual(await createChannelMapping(prisma, createContext, createInput), created, 'same create intent replays the original mapping')
assert.equal(audits.length, createAuditCount, 'create replay adds no duplicate audit evidence')
assert.equal((await listChannelMappings(prisma, context)).length, 1)
assert.equal(audits[0].propertyId, context.propertyId)
assert.equal(events[0].metadata.providerWrite, false)
const suggestionsAfterMapping = await listChannelMappingSuggestions(prisma, context)
assert.equal(suggestionsAfterMapping[0].mapped, false, 'a different external label does not incorrectly close the suggestion')

const otherCreated = await createChannelMapping(prisma, mutationContext(otherContext, 'other-create'), {
  channelId: 'channel-2', externalRoomTypeId: 'EXT-OTHER', externalRoomTypeName: 'External Other',
  roomTypeId: 'type-2', roomIds: ['room-other'], active: true,
  reason: 'Create an isolated mapping for the second property.',
})
assert.equal((await listChannelMappings(prisma, context)).length, 1, 'property one cannot list property two mappings')
assert.equal((await listChannelMappings(prisma, otherContext)).length, 1, 'property two receives only its mapping')
await assert.rejects(
  updateChannelMapping(prisma, mutationContext(otherContext, 'foreign-update'), created.id, { active: false, reason: 'Attempt to update another property mapping.' }),
  (error) => error.statusCode === 404,
)
await assert.rejects(
  deleteChannelMapping(prisma, mutationContext(otherContext, 'foreign-delete'), created.id, { reason: 'Attempt to delete another property mapping.' }),
  (error) => error.statusCode === 404,
)

await assert.rejects(
  createChannelMapping(prisma, context, {
    channelId: 'channel-1', externalRoomTypeId: 'BAD', externalRoomTypeName: 'Bad', roomTypeId: 'type-1',
    roomIds: ['room-1'], reason: 'Reject unknown fields.', credentials: { token: 'secret' },
  }),
  /Unrecognized key/,
)
for (const unsafeReason of [
  'token=opaqueBearerSecret',
  'https://provider.example/calendar.ics?sig=opaqueBearerSecret',
  'Contact operator@example.test for the mapping.',
]) {
  await assert.rejects(
    updateChannelMapping(prisma, context, created.id, { reason: unsafeReason }),
    /must not contain URLs, credentials, or direct-contact values/,
  )
}
await assert.rejects(
  updateChannelMapping(prisma, mutationContext(context, 'forged-room'), created.id, { roomIds: ['room-1', 'foreign-room'], reason: 'Attempt a forged room mapping.' }),
  (error) => error.statusCode === 404,
)

const updateContext = mutationContext(context, 'pause')
const updateInput = { active: false, reason: 'Pause the mapping during review.' }
const updated = await updateChannelMapping(prisma, updateContext, created.id, updateInput)
assert.equal(updated.active, false)
const updateAuditCount = audits.length
assert.deepEqual(await updateChannelMapping(prisma, updateContext, created.id, updateInput), updated, 'same update intent replays')
assert.equal(audits.length, updateAuditCount, 'update replay adds no duplicate audit evidence')
await assert.rejects(
  updateChannelMapping(prisma, updateContext, created.id, { active: true, reason: 'Reuse the key for a changed mapping intent.' }),
  (error) => error.statusCode === 409,
)
const editedWhilePaused = await updateChannelMapping(prisma, mutationContext(context, 'rename'), created.id, {
  externalRoomTypeName: 'External Twin Renamed',
  reason: 'Rename the paused mapping without activating it.',
})
assert.equal(editedWhilePaused.active, false, 'editing a paused mapping preserves its explicit inactive state')
const deleteContext = mutationContext(context, 'delete')
const deleteInput = { reason: 'Remove the retired mapping.' }
const deleted = await deleteChannelMapping(prisma, deleteContext, created.id, deleteInput)
assert.equal(deleted.id, created.id)
const deleteAuditCount = audits.length
assert.deepEqual(await deleteChannelMapping(prisma, deleteContext, created.id, deleteInput), deleted, 'delete replay returns the original result after row removal')
assert.equal(audits.length, deleteAuditCount, 'delete replay adds no duplicate audit evidence')
assert.equal(mappings.length, 1)
assert.equal(mappings[0].id, otherCreated.id)
assert.equal(audits.at(-1).action, 'CHANNEL_MAPPING_DELETED')

console.log('Channel mapping persistence tests passed.')
