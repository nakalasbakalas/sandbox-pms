/* global console, URL */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  configureIcalFeedChannel,
  deactivateIcalFeedChannel,
  getIcalFeedByToken,
  hashIcalFeedToken,
  listIcalFeedChannels,
} from '../server/ical-feed.mjs'

const legacyToken = 'valid_public_feed_token_1234'
const expectedLegacyTokenHash = 'P6ZUSkQHQGF-3Id2nr1u-HFkdE6u3_9O8Mkxt6kg6SY'
assert.equal(
  hashIcalFeedToken(legacyToken),
  expectedLegacyTokenHash,
  'the application token digest remains the documented SHA-256 base64url value',
)

const tokenMigrationSql = await readFile(
  new URL('../prisma/migrations/20260717141000_ical_token_hash_backfill/migration.sql', import.meta.url),
  'utf8',
)
assert.doesNotMatch(tokenMigrationSql, /CREATE EXTENSION/, 'the migration uses PostgreSQL built-in SHA-256 without extension privileges')
assert.equal(
  [...tokenMigrationSql.matchAll(/UPDATE "Channel"/g)].length,
  1,
  'raw-token removal and digest persistence must remain one atomic row update',
)
assert.match(tokenMigrationSql, /"config" - 'exportToken'/)
assert.match(tokenMigrationSql, /'exportTokenHash'/)
assert.match(
  tokenMigrationSql,
  /sha256\(convert_to\("config"->>'exportToken', 'UTF8'\)\)/,
  'the migration hashes the exact UTF-8 token bytes with SHA-256',
)
assert.match(tokenMigrationSql, /translate\([\s\S]*'\+\/',[\s\S]*'-_'/)
assert.match(tokenMigrationSql, /rtrim\([\s\S]*'='/)
assert.doesNotMatch(
  tokenMigrationSql,
  /jsonb_build_object\(\s*'exportToken'\s*,/,
  'the migration must never write a raw bearer token back to JSON',
)

const context = { propertyId: 'property-1', actor: { id: 'admin-1', role: 'ADMIN' } }
const channels = [{
  id: 'channel-1', propertyId: context.propertyId, provider: 'BOOKING_COM', name: 'Booking.com', active: true,
  config: { exportToken: legacyToken, exportFileName: 'booking.ics' }, mappings: [],
}]
let lastChannelWhere
const prisma = {
  property: { findUnique: async ({ where }) => where.id === context.propertyId ? { id: context.propertyId } : null },
  channel: {
    findMany: async ({ where }) => {
      lastChannelWhere = where
      return channels.filter((channel) => (!where.propertyId || channel.propertyId === where.propertyId) && (!where.active || channel.active))
    },
    findFirst: async ({ where }) => channels.find((channel) => channel.propertyId === where.propertyId && channel.provider === where.provider) || null,
    update: async ({ where, data }) => {
      const channel = channels.find((item) => item.id === where.id)
      Object.assign(channel, data)
      return { ...channel, mappings: channel.mappings || [] }
    },
    create: async ({ data }) => {
      const channel = { id: `channel-${channels.length + 1}`, mappings: [], ...data }
      channels.push(channel)
      return channel
    },
  },
  reservation: { findMany: async ({ where }) => {
    assert.equal(where.propertyId, context.propertyId)
    return []
  } },
}

const listed = await listIcalFeedChannels(prisma, context, 'https://pms.example.test')
assert.equal(listed.length, 1)
assert.equal(lastChannelWhere.propertyId, context.propertyId)
assert.equal(listed[0].exportFeedUrl, undefined, 'normal channel listings never disclose the bearer feed URL')
assert.equal(channels[0].config.exportToken, undefined, 'legacy raw tokens are removed during bounded migration')
assert.match(channels[0].config.exportTokenHash, /^[A-Za-z0-9_-]{40,}$/)

const configured = await configureIcalFeedChannel(prisma, context, {
  provider: 'booking-com', importUrl: 'https://provider.example.test/calendar.ics', exportFileName: 'booking.ics',
}, 'https://pms.example.test')
assert.equal(configured.provider, 'BOOKING_COM')
assert.equal(channels[0].propertyId, context.propertyId)
assert.equal(configured.exportFeedUrl, undefined, 'ordinary configuration updates do not re-expose an existing token')

const disabled = await deactivateIcalFeedChannel(prisma, context, 'booking-com', 'https://pms.example.test')
assert.equal(disabled.provider, 'BOOKING_COM')
assert.equal(channels[0].active, false)

channels[0].active = true
const publicFeed = await getIcalFeedByToken(prisma, legacyToken, new Date('2026-07-17T00:00:00Z'))
assert.equal(publicFeed.fileName, 'booking.ics')
assert.match(publicFeed.contents, /BEGIN:VCALENDAR/)

const rotated = await configureIcalFeedChannel(prisma, context, {
  provider: 'booking-com', exportFileName: 'booking.ics', rotateToken: true,
}, 'https://pms.example.test')
assert.match(rotated.exportFeedUrl, /^https:\/\/pms\.example\.test\/ical\/[A-Za-z0-9_-]+\.ics$/)
assert.equal(channels[0].config.exportToken, undefined, 'rotation persists only the token hash')
const rotatedToken = new URL(rotated.exportFeedUrl).pathname.split('/').pop().replace(/\.ics$/, '')
await assert.rejects(getIcalFeedByToken(prisma, legacyToken), { statusCode: 404 })
const rotatedFeed = await getIcalFeedByToken(prisma, rotatedToken, new Date('2026-07-17T00:00:00Z'))
assert.equal(rotatedFeed.fileName, 'booking.ics')

const relisted = await listIcalFeedChannels(prisma, context, 'https://pms.example.test')
assert.equal(relisted[0].exportFeedUrl, undefined, 'the issued URL is not returned by later list requests')

await assert.rejects(listIcalFeedChannels(prisma, {}, 'https://pms.example.test'), { statusCode: 403 })
await assert.rejects(
  configureIcalFeedChannel(prisma, { propertyId: 'property-other' }, { provider: 'agoda' }, 'https://pms.example.test'),
  { statusCode: 503 },
)

console.log('iCal property-scope tests passed.')
