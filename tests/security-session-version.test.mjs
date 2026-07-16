import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHmac } from 'node:crypto'
import process from 'node:process'
import test from 'node:test'

import { createSessionToken, verifySessionToken } from '../server/security.mjs'

const sessionSecret = 'session-version-test-secret-that-is-long-enough'
const previousSessionSecret = process.env.SESSION_SECRET
process.env.SESSION_SECRET = sessionSecret

test.after(() => {
  if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET
  else process.env.SESSION_SECRET = previousSessionSecret
})

function user(overrides = {}) {
  return {
    id: 'user-1',
    email: 'manager@example.test',
    username: 'manager',
    role: 'MANAGER',
    firstName: 'Test',
    lastName: 'Manager',
    sessionVersion: 7,
    ...overrides,
  }
}

function signPayload(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', sessionSecret).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

function decodePayload(token) {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'))
}

test('new session tokens carry the bounded user session version', () => {
  const token = createSessionToken(user())
  assert.equal(decodePayload(token).sessionVersion, 7)
  assert.equal(verifySessionToken(token)?.sessionVersion, 7)

  const maximumToken = createSessionToken(user({ sessionVersion: 2_147_483_647 }))
  assert.equal(verifySessionToken(maximumToken)?.sessionVersion, 2_147_483_647)
})

test('session version tampering invalidates the signature', () => {
  const token = createSessionToken(user())
  const [encoded, signature] = token.split('.')
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  payload.sessionVersion += 1
  const tampered = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`

  assert.equal(verifySessionToken(tampered), null)
})

test('invalid session versions fail closed unless legacy compatibility is explicit', () => {
  const base = decodePayload(createSessionToken(user()))
  const invalidVersions = [-1, 2_147_483_648, 1.5, '7', null]

  for (const sessionVersion of invalidVersions) {
    const token = signPayload({ ...base, sessionVersion })
    assert.equal(verifySessionToken(token), null)
    assert.equal(verifySessionToken(token, { allowLegacySessionVersion: true })?.sessionVersion, 0)
  }
})

test('legacy tokens without a session version require explicit compatibility', () => {
  const legacyPayload = decodePayload(createSessionToken(user()))
  delete legacyPayload.sessionVersion
  const legacyToken = signPayload(legacyPayload)

  assert.equal(verifySessionToken(legacyToken), null)
  assert.equal(verifySessionToken(legacyToken, { allowLegacySessionVersion: true })?.sessionVersion, 0)
})

test('expired versioned tokens are rejected even in legacy compatibility mode', () => {
  const expiredToken = createSessionToken(user(), { hours: -1 })

  assert.equal(verifySessionToken(expiredToken), null)
  assert.equal(verifySessionToken(expiredToken, { allowLegacySessionVersion: true }), null)
})

test('signed malformed or scalar payloads fail closed', () => {
  const malformedPayload = Buffer.from('{').toString('base64url')
  const malformedSignature = createHmac('sha256', sessionSecret).update(malformedPayload).digest('base64url')

  assert.equal(verifySessionToken(`${malformedPayload}.${malformedSignature}`), null)
  assert.equal(verifySessionToken(signPayload(null)), null)
})

test('token creation rejects out-of-range session versions', () => {
  assert.throws(
    () => createSessionToken(user({ sessionVersion: -1 })),
    /bounded non-negative integer/,
  )
  assert.throws(
    () => createSessionToken(user({ sessionVersion: 2_147_483_648 })),
    /bounded non-negative integer/,
  )
})
