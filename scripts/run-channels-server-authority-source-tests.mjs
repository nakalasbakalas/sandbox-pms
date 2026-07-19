/* global console */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const wrapperSource = (await readFile('src/components/channels/ChannelsView.tsx', 'utf8')).replaceAll('\r\n', '\n')
const serverSource = (await readFile('src/components/channels/ServerChannelsView.tsx', 'utf8')).replaceAll('\r\n', '\n')
const icalSource = (await readFile('server/ical-feed.mjs', 'utf8')).replaceAll('\r\n', '\n')
const operationalReasonSource = (await readFile('server/operational-reason.mjs', 'utf8')).replaceAll('\r\n', '\n')
const mappingSource = (await readFile('server/channel-mapping-service.mjs', 'utf8')).replaceAll('\r\n', '\n')
const mutationIdempotencySource = (await readFile('server/channel-mutation-idempotency.mjs', 'utf8')).replaceAll('\r\n', '\n')
const capabilitiesSource = (await readFile('server/capability-service.mjs', 'utf8')).replaceAll('\r\n', '\n')
const importRemovalMigration = (await readFile('prisma/migrations/20260719100000_remove_raw_ical_import_urls/migration.sql', 'utf8')).replaceAll('\r\n', '\n')

assert.match(wrapperSource, /if \(SERVER_API_ENABLED\) return <ServerChannelsView \/>/, 'server mode uses the dedicated authoritative Channels workspace')
assert.match(wrapperSource, /return <DemoChannelsView \/>/, 'browser-backed channel tools remain isolated to explicit demo mode')

assert.doesNotMatch(serverSource, /useKV|localStorage|sessionStorage|@github\/spark/, 'server Channels never reads browser-backed operational state')
assert.doesNotMatch(serverSource, /InventorySyncPanel|InventoryCalendar|RateParityPanel|RatePushPanel/, 'server Channels does not import simulated provider tools')
assert.match(serverSource, /Promise\.all\(\[[\s\S]*?\/api\/channels\/ical[\s\S]*?\/api\/channels\/mappings[\s\S]*?\/api\/settings\/room-setup[\s\S]*?\/api\/system\/capabilities/, 'server Channels loads one authoritative API snapshot')
assert.match(serverSource, /setSnapshot\(null\)[\s\S]*?setLoadError/, 'a failed authoritative load clears all displayed operational state')
assert.match(serverSource, /No browser-backed channel state is being shown and all writes are blocked/, 'the failure state is explicit and fail closed')
assert.match(serverSource, /hasPermission\('manage:channels'\)/, 'server channel mutations are visibly permission-gated')
assert.match(serverSource, /Rate push, real-time inventory sync, provider performance, sync logs, and browser reservation imports are unavailable/, 'unsupported provider functions are capability-gated instead of simulated')
assert.match(serverSource, /reason: configurationReason\.trim\(\)/, 'iCal configuration requires an operational reason')
assert.match(serverSource, /headers: \{ 'x-idempotency-key': configurationIdempotencyKey \}/, 'iCal configuration retains one retry key per visible intent')
assert.ok(
  [...serverSource.matchAll(/headers: \{ 'x-idempotency-key': idempotencyKeyFor\(intent\) \}/g)].length >= 4,
  'disable and every mapping mutation send retained idempotency keys',
)
assert.match(serverSource, /do not write to the provider/, 'mapping descriptions state that no provider write occurs')
assert.doesNotMatch(serverSource, /importUrl|Provider import URL/, 'the server UI does not collect or display private provider import URLs')

assert.doesNotMatch(icalSource, /importUrl:\s*config\.importUrl/, 'normal iCal responses do not return the private provider URL')
assert.doesNotMatch(icalSource, /config\.importUrl\s*=/, 'the service never stores a raw provider import URL')
assert.match(icalSource, /delete config\.importUrl/, 'controlled writes remove any legacy raw provider URL')
assert.match(icalSource, /configureIcalSchema[\s\S]*?\.strict\(\)/, 'iCal configuration rejects unknown fields')
assert.match(operationalReasonSource, /Operational reason must not contain URLs, credentials, or direct-contact values/, 'shared evidence validation rejects URLs, credential-shaped values, and direct-contact values')
assert.match(icalSource, /operationalReasonForEvidence\(parsed\.reason\)/, 'iCal audit evidence is sanitized again at the persistence boundary')
assert.match(mappingSource, /operationalReasonSchema/, 'channel mappings reuse the shared operational-reason policy')
assert.match(mappingSource, /beginChannelMutation/, 'channel mapping writes claim a property-scoped mutation attempt')
assert.match(mutationIdempotencySource, /propertyId_idempotencyKey/, 'channel mutation attempts are property scoped')
assert.match(mutationIdempotencySource, /different mutation/, 'changed intent with one channel key fails closed')
assert.doesNotMatch(icalSource, /async function migrateLegacyRawToken/, 'normal iCal reads never mutate legacy token rows')
assert.match(icalSource, /graceExportTokenHashes/, 'export token rotation retains a bounded hash-only recovery window')
assert.match(icalSource, /pg_advisory_xact_lock/, 'concurrent first-time channel configuration is serialized per property and provider')
assert.match(icalSource, /beginChannelMutation\(tx, context, 'CONFIGURE_ICAL_CHANNEL'/, 'token issuance uses the global property-scoped channel mutation ledger')
assert.match(icalSource, /idempotentReplay: true/, 'token issuance replays the original deterministic bearer for the same request key')
assert.match(icalSource, /delete storedPayload\.exportFeedUrl/, 'the mutation ledger never persists the raw export bearer URL')
assert.match(importRemovalMigration, /"config" - 'importUrl'/, 'deploy migration removes legacy raw provider import URLs')
assert.match(importRemovalMigration, /"syncEnabled" = false/, 'deploy migration disables unsupported inbound iCal sync')
assert.match(icalSource, /ICAL_EXPORT_TOKEN_ROTATED/, 'token rotation creates explicit audit and event evidence')
assert.match(icalSource, /ICAL_CHANNEL_DISABLED/, 'channel disablement creates explicit audit and event evidence')
assert.match(icalSource, /providerWrite: false/, 'iCal configuration evidence cannot be mistaken for provider acknowledgement')

assert.match(capabilitiesSource, /ical: capability\('manual'[\s\S]*?writeMode: 'review-gated'[\s\S]*?providerProof: false/, 'the registry keeps iCal manual and provider-unproven')
assert.match(capabilitiesSource, /ota: capability\([\s\S]*?providerProof: false/, 'the registry never manufactures OTA provider proof')

console.log('Channels server-authority source tests passed.')
