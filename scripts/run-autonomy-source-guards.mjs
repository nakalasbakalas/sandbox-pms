/* global console, URL */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const files = await Promise.all([
  'contracts.mjs',
  'policy-engine.mjs',
  'action-planner.mjs',
  'distributed-lock.mjs',
  'retry-policy.mjs',
  'shadow-service.mjs',
].map(async (name) => ({
  name,
  source: await readFile(new URL(`../server/autonomy/${name}`, import.meta.url), 'utf8'),
})))

for (const { name, source } of files) {
  assert.doesNotMatch(
    source,
    /ota-adapters|ops-worker-client|booking-com\.mjs|platform-skeleton|playwright|puppeteer/i,
    `${name} has no provider execution or browser dependency`,
  )
  assert.doesNotMatch(
    source,
    /\b(OPENAI_API_KEY|BOOKING_PASSWORD|AGODA_PASSWORD|TRIP_PASSWORD|EXPEDIA_PASSWORD)\b/,
    `${name} has no provider credential dependency`,
  )
}

const service = files.find((file) => file.name === 'shadow-service.mjs').source
assert.match(service, /mode:\s*'SHADOW_NOOP'/, 'shadow service records only SHADOW_NOOP action evidence')
assert.match(service, /providerRequestSent:\s*false/g, 'shadow service explicitly records that no provider request was sent')
assert.doesNotMatch(
  service,
  /tx\.(reservation|payment|charge|rateCalendar|roomDateInventory)\.(create|update|delete|upsert)/,
  'shadow service cannot mutate authoritative booking, finance, rate, or inventory rows',
)

const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const migration = await readFile(new URL('../prisma/migrations/20260718120000_autonomy_shadow_foundation/migration.sql', import.meta.url), 'utf8')
assert.match(
  schema,
  /credentials\s+Json\s+@default\("\{\}"\)\s+@ignore/,
  'new Prisma clients ignore the rollback-only legacy credential column',
)
assert.doesNotMatch(
  migration,
  /DROP COLUMN\s+"credentials"/i,
  'autonomy migration does not break old-app rollback by dropping the legacy column',
)
assert.match(
  migration,
  /ADD CONSTRAINT "Channel_credentials_must_be_empty"[\s\S]*?CHECK \("credentials" = '\{\}'::jsonb\)/,
  'autonomy migration constrains the legacy credential column to an empty object',
)
for (const { name, source } of files) {
  assert.doesNotMatch(
    source,
    /(?:channel|data)\??\.credentials\b|credentials\s*:/i,
    `${name} does not read or write the rollback-only Channel.credentials field`,
  )
}

console.log('Autonomy shadow no-provider/no-operational-write source guards passed.')
