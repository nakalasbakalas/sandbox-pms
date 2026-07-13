import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'
import { URL } from 'node:url'

import {
  bookingEmailPubSubConfig,
  decodeBookingEmailPubSubEnvelope,
  processPendingBookingEmailDeliveries,
  recordBookingEmailPushDelivery,
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
        assert.equal(where.OR[1].status, 'PROCESSING')
        assert.deepEqual(where.OR[1].claimedAt.lt, new Date('2026-07-13T03:45:00.000Z'))
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
      findUnique: async () => ({ id: candidate.sourceId, enabled: false }),
    },
  }

  const summary = await processPendingBookingEmailDeliveries(prisma, {
    now: () => now,
    deliveryClaimTimeoutMs: 15 * 60_000,
    logger: { info() {}, warn() {}, error() {} },
  })

  assert.equal(claimWhere.id, candidate.id)
  assert.equal(claimWhere.OR[1].status, 'PROCESSING')
  assert.equal(completion.status, 'COALESCED')
  assert.equal(summary.coalesced, 1)
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
