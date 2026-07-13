import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { URL } from 'node:url'

test('database seed reconciles known legacy booking queries without replacing owner-customized queries', async () => {
  const source = await readFile(new URL('../prisma/seed.ts', import.meta.url), 'utf8')
  const seedFunction = source.match(/async function seedBookingEmailSource[\s\S]*?\r?\n}\r?\n\r?\nasync function seedRoomTypes/)?.[0]

  assert.ok(seedFunction, 'seedBookingEmailSource must remain inspectable')
  const updateBlock = seedFunction.match(/update:\s*\{([\s\S]*?)\r?\n\s*},\r?\n\s*create:/)?.[1]
  assert.ok(updateBlock, 'booking-email seed update block must remain inspectable')
  assert.match(seedFunction, /bookingEmailSource\.findUnique\(\{ where }\)/)
  assert.match(seedFunction, /bookingEmailSourceReconciliationQuery\(existing\?\.query, mailbox\)/)
  assert.match(updateBlock, /query,/)
  assert.match(seedFunction, /create:\s*\{[\s\S]*?query:\s*approvedBookingEmailProviderQuery\(\)/)
  assert.doesNotMatch(
    updateBlock,
    /approvedBookingEmailProviderQuery\(\)/,
  )
})
