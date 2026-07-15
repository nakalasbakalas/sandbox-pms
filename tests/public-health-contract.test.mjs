import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import test from 'node:test'

test('public deep-health source contract exposes bounded database status without configuration inventory', async () => {
  const source = await readFile(new URL('../server/index.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function databaseStatus(deep)')
  const end = source.indexOf('\nfunction forbiddenPath(', start)
  assert.notEqual(start, -1, 'databaseStatus must remain available to the public health handler')
  assert.notEqual(end, -1, 'health handler boundary must remain discoverable')

  const publicHealthSource = source.slice(start, end)
  assert.match(publicHealthSource, /async function healthPayload\(deep = false\)/)
  assert.match(publicHealthSource, /database\s*[,}]/)
  assert.doesNotMatch(
    publicHealthSource,
    /\b(?:writeMode|environment|integrations|missingConfiguration)\b/,
  )
  assert.doesNotMatch(publicHealthSource, /\bmissing[A-Za-z]*\s*:/)
  assert.doesNotMatch(publicHealthSource, /process\.env\.(?:SESSION_SECRET|BOOKING_EMAIL_[A-Z0-9_]+|GMAIL_[A-Z0-9_]+)/)
})
