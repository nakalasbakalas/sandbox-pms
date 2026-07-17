/* global console */
import assert from 'node:assert/strict'
import {
  createChannelMapping,
  deleteChannelMapping,
  listChannelMappings,
  updateChannelMapping,
} from '../server/channel-mapping-service.mjs'

const context = { propertyId: 'property-1', actor: { id: 'admin-1', role: 'ADMIN' } }
const mappings = []
const audits = []
const events = []
const tx = {
  channel: { findFirst: async ({ where }) => where.id === 'channel-1' && where.propertyId === context.propertyId ? { id: 'channel-1' } : null },
  roomType: { findFirst: async ({ where }) => where.id === 'type-1' && where.propertyId === context.propertyId ? { id: 'type-1' } : null },
  room: { count: async ({ where }) => where.propertyId === context.propertyId && where.roomTypeId === 'type-1' ? where.id.in.filter((id) => ['room-1', 'room-2'].includes(id)).length : 0 },
  channelMapping: {
    findMany: async () => [...mappings],
    findFirst: async ({ where }) => mappings.find((mapping) => mapping.id === where.id && where.channel.propertyId === context.propertyId) || null,
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
  auditLog: { create: async ({ data }) => (audits.push(data), data) },
  domainEvent: { create: async ({ data }) => (events.push(data), data) },
}
const prisma = { ...tx, $transaction: async (callback) => callback(tx) }

const created = await createChannelMapping(prisma, context, {
  channelId: 'channel-1', externalRoomTypeId: 'EXT-TWIN', externalRoomTypeName: 'External Twin',
  roomTypeId: 'type-1', roomIds: ['room-1', 'room-2'], active: true,
  reason: 'Map the certified external room category.',
})
assert.equal(created.roomIds.length, 2)
assert.equal((await listChannelMappings(prisma, context)).length, 1)
assert.equal(audits[0].propertyId, context.propertyId)
assert.equal(events[0].metadata.providerWrite, false)

await assert.rejects(
  createChannelMapping(prisma, context, {
    channelId: 'channel-1', externalRoomTypeId: 'BAD', externalRoomTypeName: 'Bad', roomTypeId: 'type-1',
    roomIds: ['room-1'], reason: 'Reject unknown fields.', credentials: { token: 'secret' },
  }),
  /Unrecognized key/,
)
await assert.rejects(
  updateChannelMapping(prisma, context, created.id, { roomIds: ['room-1', 'foreign-room'], reason: 'Attempt a forged room mapping.' }),
  (error) => error.statusCode === 404,
)

const updated = await updateChannelMapping(prisma, context, created.id, { active: false, reason: 'Pause the mapping during review.' })
assert.equal(updated.active, false)
const deleted = await deleteChannelMapping(prisma, context, created.id, { reason: 'Remove the retired mapping.' })
assert.equal(deleted.id, created.id)
assert.equal(mappings.length, 0)
assert.equal(audits.at(-1).action, 'CHANNEL_MAPPING_DELETED')

console.log('Channel mapping persistence tests passed.')
