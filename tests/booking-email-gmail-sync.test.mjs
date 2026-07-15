import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'
import { URL } from 'node:url'

import {
  bookingEmailDeliveryAttemptPolicy,
  bookingEmailPubSubConfig,
  decodeBookingEmailPubSubEnvelope,
  processPendingBookingEmailDeliveries,
  recordBookingEmailPushDelivery,
  renewBookingEmailWatch,
  syncBookingEmailHistory,
  verifyBookingEmailPubSubRequest,
} from '../server/booking-email-gmail-sync.mjs'

const pubsubEnv = {
  BOOKING_EMAIL_GMAIL_PUBSUB_ENABLED: 'true',
  BOOKING_EMAIL_GMAIL_PUBSUB_TOPIC: 'projects/example/topics/booking-email',
  BOOKING_EMAIL_GMAIL_PUBSUB_SUBSCRIPTION: 'projects/example/subscriptions/booking-email',
  BOOKING_EMAIL_GMAIL_PUBSUB_AUDIENCE: 'https://pms.example.test/api/booking-email/gmail/push',
  BOOKING_EMAIL_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL: 'pubsub@example.iam.gserviceaccount.com',
  BOOKING_EMAIL_PRIMARY_MAILBOX: 'booking@sandboxhotel.com',
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => payload,
  }
}

function gmailResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => payload,
  }
}

test('authenticated Pub/Sub envelope is restricted to the configured mailbox and subscription', async () => {
  const config = bookingEmailPubSubConfig(pubsubEnv)
  const identity = await verifyBookingEmailPubSubRequest({
    authorization: 'Bearer test-token',
    config,
    verifyIdToken: async (token, audience) => {
      assert.equal(token, 'test-token')
      assert.equal(audience, config.audience)
      return {
        iss: 'https://accounts.google.com',
        aud: config.audience,
        email: config.serviceAccountEmail,
        email_verified: true,
        sub: 'service-account-subject',
      }
    },
  })
  assert.equal(identity.authenticated, true)

  const notification = {
    emailAddress: config.mailbox,
    historyId: '90071992547409931234',
  }
  const decoded = decodeBookingEmailPubSubEnvelope({
    subscription: config.subscription,
    message: {
      messageId: 'pubsub-message-1',
      publishTime: '2026-07-13T04:00:00.000Z',
      data: Buffer.from(JSON.stringify(notification)).toString('base64url'),
    },
  }, { config })

  assert.equal(decoded.emailAddress, config.mailbox)
  assert.equal(decoded.notificationHistoryId, notification.historyId)
})

test('Pub/Sub OIDC rejects missing, unverifiable, or mis-scoped identities', async () => {
  const config = bookingEmailPubSubConfig(pubsubEnv)
  await assert.rejects(
    () => verifyBookingEmailPubSubRequest({ config, authorization: '' }),
    (error) => error?.code === 'PUBSUB_AUTH_REQUIRED' && error?.statusCode === 401,
  )
  await assert.rejects(
    () => verifyBookingEmailPubSubRequest({
      config,
      authorization: 'Bearer bad-signature',
      verifyIdToken: async () => { throw new Error('signature rejected token=must-not-surface') },
    }),
    (error) => error?.code === 'PUBSUB_AUTH_INVALID' && error?.statusCode === 401,
  )

  const validClaims = {
    iss: 'https://accounts.google.com',
    aud: config.audience,
    email: config.serviceAccountEmail,
    email_verified: true,
    sub: 'service-account-subject',
  }
  const invalidClaims = [
    [{ ...validClaims, iss: 'https://issuer.invalid' }, 'PUBSUB_AUTH_ISSUER_INVALID'],
    [{ ...validClaims, aud: 'https://other.example.test/push' }, 'PUBSUB_AUTH_AUDIENCE_INVALID'],
    [{ ...validClaims, email: 'other@example.iam.gserviceaccount.com' }, 'PUBSUB_AUTH_SERVICE_ACCOUNT_INVALID'],
    [{ ...validClaims, email_verified: false }, 'PUBSUB_AUTH_SERVICE_ACCOUNT_INVALID'],
  ]
  for (const [claims, expectedCode] of invalidClaims) {
    await assert.rejects(
      () => verifyBookingEmailPubSubRequest({
        config,
        authorization: 'Bearer structurally-valid-token',
        verifyIdToken: async () => claims,
      }),
      (error) => error?.code === expectedCode && error?.statusCode === 403,
    )
  }
})

test('Pub/Sub envelope rejects malformed wrappers and cross-mailbox deliveries', () => {
  const config = bookingEmailPubSubConfig(pubsubEnv)
  const validData = Buffer.from(JSON.stringify({
    emailAddress: config.mailbox,
    historyId: '12345678901234567890',
  })).toString('base64url')
  const envelope = ({ message = {}, ...overrides } = {}) => ({
    subscription: config.subscription,
    message: {
      messageId: 'pubsub-envelope-negative',
      publishTime: '2026-07-13T04:00:00.000Z',
      data: validData,
      ...message,
    },
    ...overrides,
  })

  const cases = [
    [{}, 'PUBSUB_ENVELOPE_INVALID'],
    [envelope({ subscription: 'projects/example/subscriptions/other' }), 'PUBSUB_SUBSCRIPTION_INVALID'],
    [envelope({ message: { messageId: '' } }), 'PUBSUB_MESSAGE_ID_INVALID'],
    [envelope({ message: { data: Buffer.from('not-json').toString('base64url') } }), 'PUBSUB_DATA_INVALID'],
    [envelope({ message: { data: 'x'.repeat(8_193) } }), 'PUBSUB_DATA_INVALID'],
    [envelope({ message: { data: Buffer.from(JSON.stringify({ emailAddress: 'other@example.com', historyId: '123' })).toString('base64url') } }), 'PUBSUB_MAILBOX_INVALID'],
    [envelope({ message: { data: Buffer.from(JSON.stringify({ emailAddress: config.mailbox, historyId: 'not-a-number' })).toString('base64url') } }), 'INVALID_GMAIL_HISTORY_ID'],
  ]
  for (const [candidate, expectedCode] of cases) {
    assert.throws(
      () => decodeBookingEmailPubSubEnvelope(candidate, { config }),
      (error) => error?.code === expectedCode && error?.retryable === false,
    )
  }
})

test('durable Pub/Sub insert is idempotent and duplicate delivery does not reset state', async () => {
  const source = {
    id: 'source-1',
    provider: 'GMAIL',
    enabled: true,
    mailbox: 'booking@sandboxhotel.com',
  }
  const rows = new Map()
  let sourcePushUpdates = 0
  const prisma = {
    bookingEmailSource: {
      findFirst: async () => source,
      update: async () => {
        sourcePushUpdates += 1
        return source
      },
    },
    bookingEmailPushDelivery: {
      createMany: async ({ data }) => {
        const row = data[0]
        if (rows.has(row.pubsubMessageId)) return { count: 0 }
        rows.set(row.pubsubMessageId, { id: 'delivery-1', ...row })
        return { count: 1 }
      },
      findUnique: async ({ where }) => rows.get(where.pubsubMessageId) || null,
    },
    $transaction: async (callback) => callback(prisma),
  }
  const delivery = {
    pubsubMessageId: 'pubsub-message-1',
    subscription: 'projects/example/subscriptions/booking-email',
    notificationHistoryId: '12345678901234567890',
    emailAddress: source.mailbox,
    publishedAt: new Date('2026-07-13T04:00:00.000Z'),
  }

  const first = await recordBookingEmailPushDelivery(prisma, delivery, { now: () => new Date('2026-07-13T04:00:01.000Z') })
  rows.get(delivery.pubsubMessageId).status = 'FAILED'
  rows.get(delivery.pubsubMessageId).attempts = 3
  const duplicate = await recordBookingEmailPushDelivery(prisma, delivery, { now: () => new Date('2026-07-13T04:00:02.000Z') })

  assert.equal(first.duplicate, false)
  assert.equal(duplicate.duplicate, true)
  assert.equal(rows.get(delivery.pubsubMessageId).status, 'FAILED')
  assert.equal(rows.get(delivery.pubsubMessageId).attempts, 3)
  assert.equal(sourcePushUpdates, 2)
})

test('Gmail push source lookup is restricted to the configured SANDBOX property', async () => {
  let sourceWhere = null
  const prisma = {
    bookingEmailSource: {
      findFirst: async ({ where }) => {
        sourceWhere = where
        return null
      },
    },
  }

  await assert.rejects(
    () => recordBookingEmailPushDelivery(prisma, {
      pubsubMessageId: 'pubsub-foreign-property',
      subscription: pubsubEnv.BOOKING_EMAIL_GMAIL_PUBSUB_SUBSCRIPTION,
      notificationHistoryId: '123',
      emailAddress: pubsubEnv.BOOKING_EMAIL_PRIMARY_MAILBOX,
      publishedAt: new Date('2026-07-13T04:00:00.000Z'),
    }),
    (error) => error?.code === 'BOOKING_EMAIL_SOURCE_NOT_FOUND',
  )
  assert.equal(sourceWhere.property.is.code, 'SANDBOX')
})

test('history reconciliation can only call the PMS ingester in review-only mode', async () => {
  const source = {
    id: 'source-1',
    provider: 'GMAIL',
    enabled: true,
    mailbox: 'booking@sandboxhotel.com',
    query: 'from:booking.com',
    lastSyncCursor: null,
    createdAt: new Date('2026-07-13T00:00:00.000Z'),
  }
  let ingestedInput = null
  const prisma = {
    bookingEmailSource: {
      findFirst: async () => source,
      findUnique: async () => source,
      updateMany: async () => ({ count: 1 }),
    },
  }
  const fetchImpl = async (requestUrl) => {
    const url = new URL(String(requestUrl))
    if (url.pathname.endsWith('/profile')) return jsonResponse({ historyId: '10000000000000000001' })
    if (url.pathname.endsWith('/messages') && url.searchParams.has('q')) {
      return jsonResponse({ messages: [{ id: 'gmail-message-1' }] })
    }
    if (url.pathname.endsWith('/messages/gmail-message-1')) {
      return jsonResponse({
        id: 'gmail-message-1',
        threadId: 'thread-1',
        internalDate: String(Date.parse('2026-07-13T03:00:00.000Z')),
        labelIds: ['INBOX'],
        snippet: 'Booking notification',
        payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'From', value: 'Booking.com <noreply@booking.com>' },
            { name: 'To', value: 'booking@sandboxhotel.com' },
            { name: 'Subject', value: 'New booking' },
          ],
          body: { data: Buffer.from(`New reservation pending review ${'x'.repeat(600_000)}`).toString('base64url') },
        },
      })
    }
    throw new Error(`Unexpected Gmail test URL: ${url}`)
  }

  const result = await syncBookingEmailHistory(prisma, {
    sourceId: source.id,
    getAccessToken: async () => 'test-access-token',
    fetchImpl,
    ingestEvents: async (_db, input) => {
      ingestedInput = input
      return { events: input.events }
    },
    now: () => new Date('2026-07-13T04:00:00.000Z'),
    logger: { info() {}, warn() {}, error() {} },
  })

  assert.equal(result.mode, 'full_reconciliation')
  assert.equal(result.eventsIngested, 1)
  assert.equal(ingestedInput.reviewOnly, true)
  assert.equal(ingestedInput.events[0].status, 'NEEDS_REVIEW')
  assert.equal(ingestedInput.events[0].ingestMethod, 'RECONCILIATION')
  assert.equal(ingestedInput.events[0].rawText.length, 500_000, 'Gmail MIME text is capped before it reaches parser or persistence')
})

test('delivery processing reclaims an abandoned PROCESSING claim after the timeout', async () => {
  const now = new Date('2026-07-13T04:00:00.000Z')
  const candidate = {
    id: 'delivery-1',
    sourceId: 'source-disabled',
    pubsubMessageId: 'pubsub-message-stale',
    notificationHistoryId: '200',
    publishedAt: new Date('2026-07-13T03:00:00.000Z'),
    status: 'PROCESSING',
    claimedAt: new Date('2026-07-13T03:30:00.000Z'),
    attempts: 1,
    createdAt: new Date('2026-07-13T03:00:00.000Z'),
  }
  let claimWhere = null
  let completion = null
  const prisma = {
    bookingEmailPushDelivery: {
      findMany: async ({ where }) => {
        assert.equal(where.OR[2].status, 'PROCESSING')
        assert.deepEqual(where.OR[2].claimedAt.lt, new Date('2026-07-13T03:45:00.000Z'))
        return [candidate]
      },
      updateMany: async ({ where }) => {
        claimWhere = where
        return { count: 1 }
      },
      update: async ({ data }) => {
        completion = data
        return { ...candidate, ...data }
      },
    },
    bookingEmailSource: {
      findFirst: async () => ({ id: candidate.sourceId, enabled: false }),
      findUnique: async () => ({ id: candidate.sourceId, enabled: false }),
    },
  }

  const summary = await processPendingBookingEmailDeliveries(prisma, {
    now: () => now,
    deliveryClaimTimeoutMs: 15 * 60_000,
    logger: { info() {}, warn() {}, error() {} },
  })

  assert.equal(claimWhere.id, candidate.id)
  assert.equal(claimWhere.OR[2].status, 'PROCESSING')
  assert.equal(completion.status, 'COALESCED')
  assert.equal(summary.coalesced, 1)
})

test('delivery attempt policy exposes no next attempt for permanent or exhausted failures', () => {
  const now = new Date('2026-07-13T04:00:00.000Z')
  const retry = bookingEmailDeliveryAttemptPolicy({ attempts: 1, retryable: true, maxAttempts: 3 }, {
    now: () => now,
    random: () => 0,
  })
  assert.equal(retry.terminal, false)
  assert.ok(retry.nextAttemptAt instanceof Date)

  const permanent = bookingEmailDeliveryAttemptPolicy({ attempts: 1, retryable: false, maxAttempts: 3 }, { now: () => now })
  assert.equal(permanent.terminal, true)
  assert.equal(permanent.terminalReason, 'non_retryable')
  assert.equal(permanent.persistedAttempts, 3)
  assert.equal(permanent.nextAttemptAt, null)

  const exhausted = bookingEmailDeliveryAttemptPolicy({ attempts: 3, retryable: true, maxAttempts: 3 }, { now: () => now })
  assert.equal(exhausted.terminal, true)
  assert.equal(exhausted.terminalReason, 'attempts_exhausted')
  assert.equal(exhausted.nextAttemptAt, null)
})

test('delivery drain leaves foreign-property notifications untouched', async () => {
  let candidateWhere = null
  let claimCalled = false
  const prisma = {
    bookingEmailPushDelivery: {
      findMany: async ({ where }) => {
        candidateWhere = where
        return []
      },
      updateMany: async () => {
        claimCalled = true
        return { count: 1 }
      },
    },
  }

  const summary = await processPendingBookingEmailDeliveries(prisma, {
    propertyCode: 'SANDBOX',
    now: () => new Date('2026-07-13T04:00:00.000Z'),
  })

  assert.equal(candidateWhere.source.is.property.is.code, 'SANDBOX')
  assert.deepEqual(candidateWhere.OR[2].attempts, { lt: 8 })
  assert.equal(claimCalled, false)
  assert.deepEqual(summary, { checked: 0, processed: 0, coalesced: 0, failed: 0, eventsIngested: 0 })
})

test('permanent and max-attempt Gmail delivery failures remain visible but are no longer claimable', async () => {
  const now = new Date('2026-07-13T04:00:00.000Z')

  for (const failure of [
    { name: 'permanent', priorAttempts: 0, retryable: false, reason: 'non_retryable' },
    { name: 'exhausted', priorAttempts: 2, retryable: true, reason: 'attempts_exhausted' },
  ]) {
    const candidate = {
      id: `delivery-${failure.name}`,
      sourceId: 'source-terminal',
      pubsubMessageId: `message-${failure.name}`,
      notificationHistoryId: '200',
      publishedAt: now,
      status: failure.priorAttempts ? 'FAILED' : 'PENDING',
      claimedAt: null,
      attempts: failure.priorAttempts,
      availableAt: new Date(0),
      createdAt: now,
    }
    const source = {
      id: candidate.sourceId,
      provider: 'GMAIL',
      enabled: true,
      mailbox: 'booking@sandboxhotel.com',
      lastSyncCursor: '100',
      consecutiveFailures: 0,
      syncLeaseOwner: null,
    }
    let claimWhere = null
    let failedUpdate = null
    const prisma = {
      bookingEmailPushDelivery: {
        findMany: async ({ where }) => {
          claimWhere = where
          return [candidate]
        },
        updateMany: async () => ({ count: 1 }),
        update: async ({ data }) => {
          failedUpdate = data
          return { ...candidate, ...data }
        },
      },
      bookingEmailSource: {
        findFirst: async () => source,
        findUnique: async () => source,
        updateMany: async () => ({ count: 1 }),
      },
    }
    const oauthError = new Error(`OAuth ${failure.name} token=must-not-surface`)
    oauthError.retryable = failure.retryable

    const summary = await processPendingBookingEmailDeliveries(prisma, {
      now: () => now,
      deliveryMaxAttempts: 3,
      getAccessToken: async () => { throw oauthError },
      logger: { info() {}, warn() {}, error() {} },
    })

    assert.deepEqual(claimWhere.OR[0].attempts, { lt: 3 })
    assert.deepEqual(claimWhere.OR[1].NOT, { lastError: { startsWith: '[terminal:' } })
    assert.equal(summary.failed, 1)
    assert.equal(failedUpdate.status, 'FAILED')
    assert.equal(failedUpdate.attempts, 3)
    assert.equal(failedUpdate.availableAt.toISOString(), now.toISOString())
    assert.match(failedUpdate.lastError, new RegExp(`terminal:${failure.reason}`))
    assert.doesNotMatch(failedUpdate.lastError, /must-not-surface/)
  }
})

test('Gmail watch renewal skips healthy watches and rejects an invalid renewal response', async () => {
  const config = bookingEmailPubSubConfig(pubsubEnv)
  const now = new Date('2026-07-13T04:00:00.000Z')
  const healthySource = {
    id: 'source-watch-healthy',
    provider: 'GMAIL',
    enabled: true,
    mailbox: config.mailbox,
    watchRenewedAt: new Date('2026-07-13T03:30:00.000Z'),
    watchExpiresAt: new Date('2026-07-18T04:00:00.000Z'),
  }
  let healthyMutationCalled = false
  const healthyResult = await renewBookingEmailWatch({
    bookingEmailSource: {
      findFirst: async () => healthySource,
      findUnique: async () => healthySource,
      updateMany: async () => {
        healthyMutationCalled = true
        return { count: 1 }
      },
    },
  }, {
    sourceId: healthySource.id,
    config,
    now: () => now,
    getAccessToken: async () => { throw new Error('healthy watch must not request an OAuth token') },
  })
  assert.deepEqual(healthyResult, {
    skipped: true,
    reason: 'not_due',
    expiresAt: healthySource.watchExpiresAt.toISOString(),
  })
  assert.equal(healthyMutationCalled, false)

  const dueSource = {
    ...healthySource,
    id: 'source-watch-invalid',
    watchRenewedAt: null,
    watchExpiresAt: null,
    consecutiveFailures: 0,
  }
  let failureRecorded = null
  const duePrisma = {
    bookingEmailSource: {
      findFirst: async () => dueSource,
      findUnique: async () => dueSource,
      updateMany: async ({ data }) => {
        if (data.consecutiveFailures) failureRecorded = data
        if (data.syncLeaseOwner) dueSource.syncLeaseOwner = data.syncLeaseOwner
        return { count: 1 }
      },
    },
  }
  await assert.rejects(
    () => renewBookingEmailWatch(duePrisma, {
      sourceId: dueSource.id,
      config,
      now: () => now,
      getAccessToken: async () => 'test-access-token',
      fetchImpl: async () => jsonResponse({
        historyId: '500',
        expiration: String(now.getTime() - 1),
      }),
      logger: { info() {}, warn() {}, error() {} },
    }),
    (error) => error?.code === 'GMAIL_WATCH_RESPONSE_INVALID',
  )
  assert.deepEqual(failureRecorded?.consecutiveFailures, { increment: 1 })
  assert.equal(failureRecorded?.syncLeaseOwner, null)
  assert.match(failureRecorded?.lastError || '', /watch expiration is invalid/i)
})

test('due Gmail watch renewal uses the configured topic and records its new high-water cursor', async () => {
  const config = bookingEmailPubSubConfig(pubsubEnv)
  const now = new Date('2026-07-13T04:00:00.000Z')
  const expiresAt = new Date('2026-07-20T04:00:00.000Z')
  const source = {
    id: 'source-watch-due',
    provider: 'GMAIL',
    enabled: true,
    mailbox: config.mailbox,
    watchRenewedAt: null,
    watchExpiresAt: null,
  }
  let watchUpdate = null
  const prisma = {
    bookingEmailSource: {
      findFirst: async () => source,
      findUnique: async () => source,
      updateMany: async ({ data }) => {
        if (data.syncLeaseOwner) source.syncLeaseOwner = data.syncLeaseOwner
        if (data.watchHistoryId) watchUpdate = data
        return { count: 1 }
      },
    },
  }
  const result = await renewBookingEmailWatch(prisma, {
    sourceId: source.id,
    config,
    now: () => now,
    getAccessToken: async () => 'test-access-token',
    fetchImpl: async (requestUrl, request) => {
      assert.equal(String(requestUrl).endsWith('/watch'), true)
      assert.equal(request.method, 'POST')
      assert.deepEqual(JSON.parse(request.body), {
        topicName: config.topicName,
        labelIds: ['INBOX'],
        labelFilterBehavior: 'INCLUDE',
      })
      return jsonResponse({ historyId: '90071992547409931235', expiration: String(expiresAt.getTime()) })
    },
    logger: { info() {}, warn() {}, error() {} },
  })

  assert.equal(result.skipped, false)
  assert.equal(result.watchHistoryId, '90071992547409931235')
  assert.equal(result.expiresAt, expiresAt.toISOString())
  assert.equal(watchUpdate.watchHistoryId, result.watchHistoryId)
  assert.equal(watchUpdate.watchExpiresAt.toISOString(), result.expiresAt)
  assert.equal(watchUpdate.watchRenewedAt.toISOString(), now.toISOString())
  assert.equal(watchUpdate.syncLeaseOwner, null)
})

test('expired Gmail history cursor falls back to bounded reconciliation before committing a new cursor', async () => {
  const source = {
    id: 'source-stale-history',
    provider: 'GMAIL',
    enabled: true,
    mailbox: 'booking@sandboxhotel.com',
    query: 'from:booking.com newer_than:30d',
    lastSyncCursor: '100',
    consecutiveFailures: 0,
  }
  const requests = []
  let committedCursor = null
  const prisma = {
    bookingEmailSource: {
      findFirst: async () => source,
      findUnique: async () => source,
      updateMany: async ({ data }) => {
        if (data.syncLeaseOwner) source.syncLeaseOwner = data.syncLeaseOwner
        if (data.lastSyncCursor) {
          committedCursor = data.lastSyncCursor
        }
        return { count: 1 }
      },
    },
  }
  const result = await syncBookingEmailHistory(prisma, {
    sourceId: source.id,
    getAccessToken: async () => 'test-access-token',
    fetchImpl: async (requestUrl) => {
      const url = new URL(String(requestUrl))
      requests.push(url.pathname)
      if (url.pathname.endsWith('/history')) {
        return gmailResponse(404, { error: { message: 'History record no longer available.' } })
      }
      if (url.pathname.endsWith('/profile')) return jsonResponse({ historyId: '500' })
      if (url.pathname.endsWith('/messages')) return jsonResponse({ messages: [] })
      throw new Error(`Unexpected recovery URL: ${url}`)
    },
    ingestEvents: async () => { throw new Error('empty reconciliation must not call the ingester') },
    logger: { info() {}, warn() {}, error() {} },
  })

  assert.equal(result.mode, 'full_reconciliation')
  assert.equal(result.previousCursor, '100')
  assert.equal(result.nextCursor, '500')
  assert.equal(result.eventsIngested, 0)
  assert.equal(committedCursor, '500')
  assert.deepEqual(requests.map((path) => path.split('/').at(-1)), ['history', 'profile', 'messages'])
})

test('out-of-order Pub/Sub cursors at or behind the committed Gmail cursor are coalesced without OAuth work', async () => {
  const source = {
    id: 'source-out-of-order',
    provider: 'GMAIL',
    enabled: true,
    mailbox: 'booking@sandboxhotel.com',
    lastSyncCursor: '500',
  }
  const candidates = [
    {
      id: 'delivery-newer-created',
      sourceId: source.id,
      pubsubMessageId: 'message-older-cursor',
      notificationHistoryId: '498',
      publishedAt: new Date('2026-07-13T03:00:00.000Z'),
      status: 'PENDING',
      attempts: 0,
      createdAt: new Date('2026-07-13T03:05:00.000Z'),
    },
    {
      id: 'delivery-older-created',
      sourceId: source.id,
      pubsubMessageId: 'message-equal-cursor',
      notificationHistoryId: '500',
      publishedAt: new Date('2026-07-13T03:01:00.000Z'),
      status: 'PENDING',
      attempts: 0,
      createdAt: new Date('2026-07-13T03:02:00.000Z'),
    },
  ]
  const completionOrder = []
  const prisma = {
    bookingEmailPushDelivery: {
      findMany: async ({ orderBy }) => {
        assert.deepEqual(orderBy, [{ publishedAt: 'asc' }, { createdAt: 'asc' }])
        return candidates
      },
      updateMany: async () => ({ count: 1 }),
      update: async ({ where, data }) => {
        if (data.status === 'COALESCED') completionOrder.push(where.id)
        return { ...candidates.find((candidate) => candidate.id === where.id), ...data }
      },
    },
    bookingEmailSource: {
      findFirst: async () => source,
      findUnique: async () => source,
    },
  }
  const summary = await processPendingBookingEmailDeliveries(prisma, {
    getAccessToken: async () => { throw new Error('stale deliveries must not request OAuth') },
    logger: { info() {}, warn() {}, error() {} },
  })

  assert.equal(summary.checked, 2)
  assert.equal(summary.coalesced, 2)
  assert.equal(summary.processed, 0)
  assert.equal(summary.eventsIngested, 0)
  assert.deepEqual(completionOrder, candidates.map((candidate) => candidate.id))
})

test('history traversal stops before an unbounded Gmail page chain can advance the cursor', async () => {
  const source = {
    id: 'source-history-limit',
    provider: 'GMAIL',
    enabled: true,
    mailbox: 'booking@sandboxhotel.com',
    lastSyncCursor: '100',
    consecutiveFailures: 0,
  }
  let historyRequests = 0
  let ingesterCalled = false
  const prisma = {
    bookingEmailSource: {
      findFirst: async () => source,
      findUnique: async () => source,
      updateMany: async () => ({ count: 1 }),
    },
  }

  await assert.rejects(
    () => syncBookingEmailHistory(prisma, {
      sourceId: source.id,
      getAccessToken: async () => 'test-access-token',
      fetchImpl: async (requestUrl) => {
        const url = new URL(String(requestUrl))
        assert.equal(url.pathname.endsWith('/history'), true)
        historyRequests += 1
        return jsonResponse({
          historyId: String(100 + historyRequests),
          history: [],
          nextPageToken: `page-${historyRequests}`,
        })
      },
      ingestEvents: async () => {
        ingesterCalled = true
      },
      logger: { info() {}, warn() {}, error() {} },
    }),
    (error) => error?.code === 'GMAIL_HISTORY_PAGE_LIMIT',
  )

  assert.equal(historyRequests, 100)
  assert.equal(ingesterCalled, false, 'bounded history failure must occur before ingestion or cursor commit')
})
