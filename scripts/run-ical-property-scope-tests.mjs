/* global console, URL */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
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
const importUrlRemovalSql = await readFile(
  new URL('../prisma/migrations/20260719100000_remove_raw_ical_import_urls/migration.sql', import.meta.url),
  'utf8',
)
assert.match(importUrlRemovalSql, /"config" - 'importUrl'/, 'the migration removes legacy raw provider import URLs')
assert.match(importUrlRemovalSql, /"syncEnabled" = false/, 'the migration disables the unsupported inbound iCal path')

const context = { propertyId: 'property-1', actor: { id: 'admin-1', role: 'ADMIN' } }
const rotationContext = { ...context, idempotencyKey: 'ical-rotation:11111111-1111-4111-8111-111111111111' }
const audits = []
const events = []
const mutationAttempts = []
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
  $executeRawUnsafe: async () => 1,
}
prisma.$transaction = async (callback) => callback(prisma)

const listed = await listIcalFeedChannels(prisma, context, 'https://pms.example.test')
assert.equal(listed.length, 1)
assert.equal(lastChannelWhere.propertyId, context.propertyId)
assert.equal(listed[0].exportFeedUrl, undefined, 'normal channel listings never disclose the bearer feed URL')
assert.equal(listed[0].importUrl, undefined, 'normal channel listings never disclose the private provider import URL')
assert.equal(channels[0].config.exportToken, legacyToken, 'normal list requests do not mutate legacy rows')

const configuredContext = { ...context, idempotencyKey: 'ical-configure:33333333-3333-4333-8333-333333333333' }
const configuredInput = {
  provider: 'booking-com', exportFileName: 'booking.ics',
  reason: 'Configure the reviewed Booking.com export feed.',
}
const configured = await configureIcalFeedChannel(prisma, configuredContext, configuredInput, 'https://pms.example.test')
assert.equal(configured.provider, 'BOOKING_COM')
assert.equal(channels[0].propertyId, context.propertyId)
assert.equal(configured.exportFeedUrl, undefined, 'ordinary configuration updates do not re-expose an existing token')
assert.equal(configured.importUrl, undefined, 'configuration responses do not expose the private provider import URL')
assert.equal(channels[0].config.exportToken, undefined, 'a controlled configuration write never persists a legacy raw export token')
assert.match(channels[0].config.exportTokenHash, /^[A-Za-z0-9_-]{40,}$/)
assert.equal(audits.at(-1).propertyId, context.propertyId)
assert.equal(audits.at(-1).changes.providerWrite, false)
assert.equal(events.at(-1).propertyId, context.propertyId)
const configureAuditCount = audits.length
const replayedConfiguration = await configureIcalFeedChannel(prisma, configuredContext, configuredInput, 'https://pms.example.test')
const { idempotentReplay: configurationWasReplay, ...replayedConfigurationPayload } = replayedConfiguration
assert.equal(configurationWasReplay, true)
assert.deepEqual(replayedConfigurationPayload, configured, 'same non-issuance configuration intent replays the original result')
assert.equal(audits.length, configureAuditCount, 'configuration replay adds no duplicate audit evidence')

const preserved = await configureIcalFeedChannel(prisma, {
  ...context,
  idempotencyKey: 'ical-rename:44444444-4444-4444-8444-444444444444',
}, {
  provider: 'booking-com', exportFileName: 'booking-renamed.ics',
  reason: 'Rename the PMS export calendar.',
}, 'https://pms.example.test')
assert.equal(preserved.exportFileName, 'booking-renamed.ics')
const filenamePreserved = await configureIcalFeedChannel(prisma, {
  ...context,
  idempotencyKey: 'ical-refresh:55555555-5555-4555-8555-555555555555',
}, {
  provider: 'booking-com',
  reason: 'Refresh the export feed without renaming it.',
}, 'https://pms.example.test')
assert.equal(filenamePreserved.exportFileName, 'booking-renamed.ics', 'omitting exportFileName preserves the existing filename')

const weakKeyContext = { ...context, idempotencyKey: 'aaaaaaaaaaaaaaaa' }
const weakKeyIssue = await configureIcalFeedChannel(prisma, weakKeyContext, {
  provider: 'agoda',
  reason: 'Prove guarded derivation uses backend protection.',
}, 'https://pms.example.test')
const weakKeyToken = new URL(weakKeyIssue.exportFeedUrl).pathname.split('/').pop().replace(/\.ics$/, '')
const publicInputOnlyToken = createHash('sha256')
  .update(`sandbox-ical-token-v1\0${context.propertyId}\0AGODA\0${weakKeyContext.idempotencyKey}`)
  .digest('base64url')
assert.notEqual(
  weakKeyToken,
  publicInputOnlyToken,
  'a weak-but-valid idempotency key cannot reproduce the issued bearer without the backend HMAC secret',
)
await deactivateIcalFeedChannel(
  prisma,
  { ...context, idempotencyKey: 'ical-disable-agoda:88888888-8888-4888-8888-888888888888' },
  'agoda',
  'https://pms.example.test',
  { reason: 'Disable the second calendar for superseded replay proof.' },
)
await assert.rejects(
  configureIcalFeedChannel(prisma, weakKeyContext, {
    provider: 'agoda',
    reason: 'Prove guarded derivation uses backend protection.',
  }, 'https://pms.example.test'),
  (error) => error.statusCode === 409 && /superseded/.test(error.message),
  'an issuance retry after disable returns a truthful superseded conflict',
)

const disableContext = { ...context, idempotencyKey: 'ical-disable:66666666-6666-4666-8666-666666666666' }
const disableInput = { reason: 'Disable the calendar while the provider mapping is reviewed.' }
const disabled = await deactivateIcalFeedChannel(
  prisma,
  disableContext,
  'booking-com',
  'https://pms.example.test',
  disableInput,
)
assert.equal(disabled.provider, 'BOOKING_COM')
assert.equal(channels[0].active, false)
assert.equal(audits.at(-1).action, 'ICAL_CHANNEL_DISABLED')
const disableAuditCount = audits.length
assert.deepEqual(
  await deactivateIcalFeedChannel(prisma, disableContext, 'booking-com', 'https://pms.example.test', disableInput),
  disabled,
  'same disable intent replays the original result',
)
assert.equal(audits.length, disableAuditCount, 'disable replay adds no duplicate audit evidence')

channels[0].active = true
const publicFeed = await getIcalFeedByToken(prisma, legacyToken, new Date('2026-07-17T00:00:00Z'))
assert.equal(publicFeed.fileName, 'booking-renamed.ics')
assert.match(publicFeed.contents, /BEGIN:VCALENDAR/)

const auditCountBeforeRotation = audits.length
const rotated = await configureIcalFeedChannel(prisma, rotationContext, {
  provider: 'booking-com', exportFileName: 'booking.ics', rotateToken: true,
  reason: 'Rotate the public calendar bearer after a controlled access review.',
}, 'https://pms.example.test')
assert.match(rotated.exportFeedUrl, /^https:\/\/pms\.example\.test\/ical\/[A-Za-z0-9_-]+\.ics$/)
assert.equal(channels[0].config.exportToken, undefined, 'rotation persists only the token hash')
const rotatedToken = new URL(rotated.exportFeedUrl).pathname.split('/').pop().replace(/\.ics$/, '')
const graceFeed = await getIcalFeedByToken(prisma, legacyToken)
assert.equal(graceFeed.fileName, 'booking.ics', 'the previous export token remains valid during rotation recovery')
await assert.rejects(
  getIcalFeedByToken(prisma, legacyToken, new Date(Date.now() + 16 * 60 * 1_000)),
  { statusCode: 404 },
)
const rotatedFeed = await getIcalFeedByToken(prisma, rotatedToken, new Date('2026-07-17T00:00:00Z'))
assert.equal(rotatedFeed.fileName, 'booking.ics')
const replayedRotation = await configureIcalFeedChannel(prisma, rotationContext, {
  provider: 'booking-com', exportFileName: 'booking.ics', rotateToken: true,
  reason: 'Rotate the public calendar bearer after a controlled access review.',
}, 'https://pms.example.test')
assert.equal(replayedRotation.exportFeedUrl, rotated.exportFeedUrl, 'the same issuance key deterministically replays the original bearer URL')
assert.equal(replayedRotation.idempotentReplay, true)
assert.equal(audits.length, auditCountBeforeRotation + 1, 'an issuance replay does not duplicate audit evidence')
const laterRotation = await configureIcalFeedChannel(prisma, {
  ...context,
  idempotencyKey: 'ical-rotation:77777777-7777-4777-8777-777777777777',
}, {
  provider: 'booking-com', exportFileName: 'booking.ics', rotateToken: true,
  reason: 'Rotate the calendar again for superseding retry proof.',
}, 'https://pms.example.test')
assert.notEqual(laterRotation.exportFeedUrl, rotated.exportFeedUrl)
const replayedEarlierRotation = await configureIcalFeedChannel(prisma, rotationContext, {
  provider: 'booking-com', exportFileName: 'booking.ics', rotateToken: true,
  reason: 'Rotate the public calendar bearer after a controlled access review.',
}, 'https://pms.example.test')
assert.equal(
  replayedEarlierRotation.exportFeedUrl,
  rotated.exportFeedUrl,
  'retrying rotation A after rotation B replays A instead of rotating a third time',
)
channels[0].config.graceExportTokenHashes = channels[0].config.graceExportTokenHashes.map((candidate) => ({
  ...candidate,
  validUntil: new Date(Date.now() - 1_000).toISOString(),
}))
await assert.rejects(
  configureIcalFeedChannel(prisma, rotationContext, {
    provider: 'booking-com', exportFileName: 'booking.ics', rotateToken: true,
    reason: 'Rotate the public calendar bearer after a controlled access review.',
  }, 'https://pms.example.test'),
  (error) => error.statusCode === 409 && /superseded/.test(error.message),
  'rotation A cannot replay a successful but unusable URL after rotation B grace expires',
)
await assert.rejects(
  configureIcalFeedChannel(prisma, rotationContext, {
    provider: 'booking-com', exportFileName: 'different.ics', rotateToken: true,
    reason: 'Attempt to reuse the token operation key for a different request.',
  }, 'https://pms.example.test'),
  { statusCode: 409 },
)

const relisted = await listIcalFeedChannels(prisma, context, 'https://pms.example.test')
assert.equal(relisted[0].exportFeedUrl, undefined, 'the issued URL is not returned by later list requests')
assert.equal(relisted[0].importUrl, undefined, 'the private provider URL is not returned by later list requests')

await assert.rejects(listIcalFeedChannels(prisma, {}, 'https://pms.example.test'), { statusCode: 403 })
await assert.rejects(
  configureIcalFeedChannel(
    prisma,
    {
      propertyId: 'property-other',
      actor: { id: 'admin-other' },
      idempotencyKey: 'missing-property:22222222-2222-4222-8222-222222222222',
    },
    { provider: 'agoda', reason: 'Attempt configuration for a missing property.' },
    'https://pms.example.test',
  ),
  { statusCode: 503 },
)
await assert.rejects(
  configureIcalFeedChannel(
    prisma,
    context,
    { provider: 'booking-com', importUrl: 'http://provider.example.test/calendar.ics', reason: 'Reject an insecure import URL.' },
    'https://pms.example.test',
  ),
  /Unrecognized key/,
)
await assert.rejects(
  configureIcalFeedChannel(
    prisma,
    context,
    { provider: 'booking-com', reason: 'Reject credential-shaped input.', credentials: { token: 'secret' } },
    'https://pms.example.test',
  ),
  /Unrecognized key/,
)
await assert.rejects(
  configureIcalFeedChannel(
    prisma,
    context,
    { provider: 'booking-com', reason: 'password=must-not-persist' },
    'https://pms.example.test',
  ),
  /must not contain URLs, credentials, or direct-contact values/,
)
await assert.rejects(
  configureIcalFeedChannel(
    prisma,
    context,
    { provider: 'booking-com', reason: 'token=opaqueBearerSecret' },
    'https://pms.example.test',
  ),
  /must not contain URLs, credentials, or direct-contact values/,
)
await assert.rejects(
  deactivateIcalFeedChannel(
    prisma,
    context,
    'booking-com',
    'https://pms.example.test',
    { reason: 'https://provider.example/calendar.ics?sig=opaqueBearerSecret' },
  ),
  /must not contain URLs, credentials, or direct-contact values/,
)

console.log('iCal property-scope tests passed.')
