/* global console */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const messaging = (await readFile('src/components/messaging/CommunicationCenterView.tsx', 'utf8')).replaceAll('\r\n', '\n')
const attempts = (await readFile('src/lib/durable-attempt-key.ts', 'utf8')).replaceAll('\r\n', '\n')
const service = (await readFile('server/messaging-service.mjs', 'utf8')).replaceAll('\r\n', '\n')
const server = (await readFile('server/index.mjs', 'utf8')).replaceAll('\r\n', '\n')

const serverStart = messaging.indexOf('function ServerCommunicationCenterView()')
const demoStart = messaging.indexOf('function DemoCommunicationCenterView()')
assert.ok(serverStart >= 0 && demoStart > serverStart, 'Messaging keeps a distinct server component.')
const serverMessaging = messaging.slice(serverStart, demoStart)

assert.match(attempts, /\| 'message-draft'/, 'message drafts are an allowlisted durable-attempt operation')
assert.match(attempts, /'message-draft',/, 'message drafts can create an opaque durable attempt key')
assert.match(attempts, /JSON\.stringify\(\{ version: 1, fingerprint, key \}/, 'attempt storage contains only the version, one-way fingerprint, and opaque key')
assert.doesNotMatch(attempts, /localStorage/, 'attempt storage never retains messaging material beyond the browser tab')
assert.match(serverMessaging, /operation: 'message-draft'/, 'server messaging identifies each draft as one logical durable attempt')
assert.match(serverMessaging, /entityId: 'messaging-new-draft'/, 'draft attempt storage uses a fixed non-PII entity slot')
assert.match(serverMessaging, /durableAttemptKeys\.getOrCreate\(attempt\)/, 'an ambiguous draft retry reuses its opaque idempotency key')
assert.match(serverMessaging, /headers: \{ 'x-idempotency-key': idempotencyKey \}/, 'the durable key reaches the request-context idempotency contract')
assert.match(serverMessaging, /JSON\.stringify\(\{ \.\.\.requestBody, idempotencyKey \}\)/, 'the draft service receives the same replay key')
assert.match(serverMessaging, /await refresh\(\)\n\s+await durableAttemptKeys\.confirmSuccess\(attempt\)/, 'a draft attempt is retired only after authoritative read-back succeeds')
assert.match(serverMessaging, /version !== refreshVersion\.current[\s\S]{0,140}throw new Error\('Authoritative Messaging read-back was superseded\.'\)/, 'superseded or unmounted read-back rejects instead of clearing a durable attempt')
assert.doesNotMatch(messaging, /draftIdempotencyKey/, 'compose state does not own a reload-unsafe draft idempotency key')
assert.match(service, /requireCreateIdempotencyKey\(context\?\.idempotencyKey\)/, 'message drafts require the request-context idempotency key')
assert.match(service, /input\.idempotencyKey !== requestKey/, 'message drafts reject conflicting body and header keys')
assert.match(service, /pg_advisory_xact_lock/, 'concurrent same-key message drafts serialize in PostgreSQL')
assert.match(server, /recipientType === 'GUEST'[\s\S]{0,120}'send:guest-messages'/, 'guest drafts require guest-message authority')
assert.match(server, /recipientType === 'STAFF' \|\| recipientType === 'GROUP'[\s\S]{0,120}'send:staff-messages'/, 'staff and group drafts require staff-message authority')

console.log('Messaging server-authority durable-attempt source tests passed.')
