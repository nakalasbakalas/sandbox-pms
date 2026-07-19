/* global console, URL */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  AutonomyDistributedLockError,
  buildAutonomyLockKey,
  withAutonomyDistributedLock,
} from '../server/autonomy/distributed-lock.mjs'
import {
  SHADOW_RETRY_SCOPE,
  classifyShadowRetry,
  normalizeShadowRetryPolicy,
  shadowRetryDelayMs,
} from '../server/autonomy/retry-policy.mjs'

function lockFixture({ acquired = true, queryError = null } = {}) {
  const calls = []
  const tx = {
    $queryRaw: async (strings, ...values) => {
      calls.push({ sql: strings.join('?'), values })
      if (queryError) throw queryError
      return [{ acquired }]
    },
  }
  const prisma = {
    $transaction: async (callback, options) => {
      calls.push({ transactionOptions: options })
      return callback(tx)
    },
  }
  return { prisma, tx, calls }
}

const lockKey = buildAutonomyLockKey({
  propertyId: 'property-1',
  job: 'booking-email',
  source: 'source-1',
})
assert.equal(
  lockKey,
  'sandbox-pms:autonomy-shadow:v1:property-1:booking-email:source-1',
  'lock keys are deterministic and property/job/source scoped',
)
assert.throws(
  () => buildAutonomyLockKey({ propertyId: 'property-1; DROP TABLE', job: 'booking-email' }),
  (error) => error instanceof AutonomyDistributedLockError && error.code === 'AUTONOMY_LOCK_INPUT_INVALID',
  'lock parts reject SQL-shaped input',
)

const acquiredFixture = lockFixture()
let callbackTx = null
const acquiredResult = await withAutonomyDistributedLock(
  acquiredFixture.prisma,
  { propertyId: 'property-1', job: 'booking-email', source: 'source-1' },
  async (tx) => {
    callbackTx = tx
    return { imported: 2 }
  },
)
assert.equal(acquiredResult.acquired, true)
assert.equal(acquiredResult.skipped, false)
assert.deepEqual(acquiredResult.value, { imported: 2 })
assert.equal(callbackTx, acquiredFixture.tx, 'callback receives the same transaction that owns the advisory lock')
assert.match(acquiredFixture.calls[1].sql, /pg_try_advisory_xact_lock/)
assert.deepEqual(acquiredFixture.calls[1].values, [lockKey], 'the lock key is a bound value, never a SQL identifier')
assert.equal(acquiredFixture.calls[0].transactionOptions.isolationLevel, 'Serializable')

const unavailableFixture = lockFixture({ acquired: false })
let unavailableCallbackRan = false
const unavailableResult = await withAutonomyDistributedLock(
  unavailableFixture.prisma,
  { propertyId: 'property-1', job: 'hourly-cycle' },
  async () => {
    unavailableCallbackRan = true
  },
)
assert.deepEqual(unavailableResult, {
  acquired: false,
  skipped: true,
  reason: 'lock_unavailable',
})
assert.equal(unavailableCallbackRan, false, 'unavailable locks fail closed without running work')

const queryFailureFixture = lockFixture({
  queryError: new Error('password=database-secret host=private.example'),
})
await assert.rejects(
  withAutonomyDistributedLock(
    queryFailureFixture.prisma,
    { propertyId: 'property-1', job: 'booking-email' },
    async () => null,
  ),
  (error) => (
    error instanceof AutonomyDistributedLockError
    && error.code === 'AUTONOMY_LOCK_TRANSACTION_FAILED'
    && !error.message.includes('database-secret')
    && !error.message.includes('private.example')
  ),
  'database failures are converted to a generic sanitized infrastructure error',
)

const callbackFailureFixture = lockFixture()
await assert.rejects(
  withAutonomyDistributedLock(
    callbackFailureFixture.prisma,
    { propertyId: 'property-1', job: 'booking-email' },
    async () => {
      throw new Error('Bearer secret-provider-token')
    },
  ),
  (error) => (
    error instanceof AutonomyDistributedLockError
    && error.code === 'AUTONOMY_LOCK_CALLBACK_FAILED'
    && !error.message.includes('secret-provider-token')
  ),
  'callback failures do not leak provider details',
)

const retryPolicy = normalizeShadowRetryPolicy({
  maxAttempts: 99,
  baseDelayMs: 500,
  maxDelayMs: 2_000,
})
assert.equal(retryPolicy.scope, SHADOW_RETRY_SCOPE)
assert.equal(retryPolicy.maxAttempts, 10, 'retry attempts are capped at ten')
assert.equal(shadowRetryDelayMs(1, retryPolicy), 500)
assert.equal(shadowRetryDelayMs(2, retryPolicy), 1_000)
assert.equal(shadowRetryDelayMs(3, retryPolicy), 2_000)
assert.equal(shadowRetryDelayMs(10, retryPolicy), 2_000, 'exponential delay is capped')

assert.deepEqual(
  classifyShadowRetry({ status: 429 }, { attempt: 1, policy: { maxAttempts: 3 } }),
  {
    scope: SHADOW_RETRY_SCOPE,
    attempt: 1,
    maxAttempts: 3,
    retryable: true,
    exhausted: false,
    shouldRetry: true,
    nextDelayMs: 1_000,
    reason: 'retryable_status',
    statusCode: 429,
    errorCode: null,
  },
)
assert.equal(
  classifyShadowRetry({ code: 'ETIMEDOUT' }, { attempt: 2, policy: { maxAttempts: 3 } }).reason,
  'retryable_network_error',
)
const exhausted = classifyShadowRetry({ statusCode: 503 }, { attempt: 3, policy: { maxAttempts: 3 } })
assert.equal(exhausted.exhausted, true)
assert.equal(exhausted.shouldRetry, false)
assert.equal(exhausted.nextDelayMs, null)
const invalidRequest = classifyShadowRetry({ status: 400 }, { attempt: 1 })
assert.equal(invalidRequest.retryable, false)
assert.equal(invalidRequest.reason, 'non_retryable')
assert.equal(classifyShadowRetry(new Error('token=secret'), { attempt: 1 }).retryable, false)

const retrySource = await readFile(new URL('../server/autonomy/retry-policy.mjs', import.meta.url), 'utf8')
assert.doesNotMatch(retrySource, /\bsetTimeout\b|\bsleep\b/, 'retry policy contains no timing or execution loop')
assert.doesNotMatch(retrySource, /ota-adapters|ops-worker|provider-webhooks/, 'retry policy is isolated from provider execution')

console.log('Autonomy shadow infrastructure tests passed.')
