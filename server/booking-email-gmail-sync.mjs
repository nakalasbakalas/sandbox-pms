import { randomUUID } from 'node:crypto'

const DEFAULT_MAILBOX = 'booking@sandboxhotel.com'
const DEFAULT_PROPERTY_CODE = 'SANDBOX'
const DEFAULT_GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const DEFAULT_HISTORY_PAGE_SIZE = 500
const DEFAULT_MESSAGE_PAGE_SIZE = 50
const DEFAULT_RECONCILIATION_LIMIT = 1_000
const DEFAULT_INGEST_CHUNK_SIZE = 25
const DEFAULT_LEASE_MS = 2 * 60_000
const DEFAULT_RETRY_BASE_MS = 30_000
const DEFAULT_RETRY_MAX_MS = 5 * 60_000
const DEFAULT_DELIVERY_MAX_ATTEMPTS = 8
const DEFAULT_DELIVERY_CLAIM_TIMEOUT_MS = 15 * 60_000
const DEFAULT_WATCH_RENEW_AFTER_MS = 24 * 60 * 60_000
const DEFAULT_WATCH_RENEW_MARGIN_MS = 48 * 60 * 60_000
const MAX_PUBSUB_DATA_BYTES = 8_192
const MAX_GMAIL_MESSAGE_TEXT_CHARS = 500_000
const MAX_GMAIL_MIME_PARTS = 200
const MAX_GMAIL_MIME_DEPTH = 20
const MAX_GMAIL_HISTORY_PAGES = 100
const MAX_GMAIL_HISTORY_MESSAGE_IDS = 5_000

export const BOOKING_EMAIL_SYSTEM_ACTOR = Object.freeze({
  id: 'system:booking-email-sync',
  username: 'booking-email-sync',
  role: 'SYSTEM',
  name: 'Booking Email Sync',
})

export class BookingEmailSyncError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined)
    this.name = 'BookingEmailSyncError'
    this.code = options.code || 'BOOKING_EMAIL_SYNC_ERROR'
    this.statusCode = Number(options.statusCode || 500)
    this.retryable = options.retryable !== false
  }
}

function nullableString(value) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function configuredPropertyWhere(options = {}) {
  return {
    property: {
      is: {
        code: nullableString(options.propertyCode) || DEFAULT_PROPERTY_CODE,
      },
    },
  }
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, maximum)
}

function nonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function envEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function dateOrNull(value) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function nowDate(options = {}) {
  const value = typeof options.now === 'function' ? options.now() : Date.now()
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function historyId(value, label = 'Gmail history id') {
  const normalized = nullableString(value)
  if (!normalized || !/^\d+$/.test(normalized)) {
    throw new BookingEmailSyncError(`${label} is missing or invalid.`, {
      code: 'INVALID_GMAIL_HISTORY_ID',
      statusCode: 400,
      retryable: false,
    })
  }
  return normalized
}

function compareHistoryIds(left, right) {
  const normalizedLeft = historyId(left)
  const normalizedRight = historyId(right)
  return BigInt(normalizedLeft) < BigInt(normalizedRight)
    ? -1
    : BigInt(normalizedLeft) > BigInt(normalizedRight)
      ? 1
      : 0
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeLogger(logger = console) {
  return {
    info: typeof logger?.info === 'function' ? logger.info.bind(logger) : () => undefined,
    warn: typeof logger?.warn === 'function' ? logger.warn.bind(logger) : () => undefined,
    error: typeof logger?.error === 'function' ? logger.error.bind(logger) : () => undefined,
  }
}

export function redactBookingEmailSyncError(error) {
  return String(error?.message || error || 'Booking email synchronization failed.')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
    .replace(/\b(access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization[_-]?code|password|secret|token)\b\s*[:=]\s*[^&\s,;}"']+/gi, '$1=[redacted]')
    .replace(/\bya29\.[A-Za-z0-9._-]+/g, 'ya29.[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redacted]')
    .replace(/(\/messages\/)[A-Za-z0-9_-]+/gi, '$1[id redacted]')
    .replace(/([?&](?:q|pageToken|startHistoryId)=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 500)
}

export function bookingEmailPubSubConfig(env = process.env) {
  const mailbox = String(env.BOOKING_EMAIL_PRIMARY_MAILBOX || DEFAULT_MAILBOX).trim().toLowerCase()
  const topicName = nullableString(env.BOOKING_EMAIL_GMAIL_PUBSUB_TOPIC)
  const subscription = nullableString(env.BOOKING_EMAIL_GMAIL_PUBSUB_SUBSCRIPTION)
  const audience = nullableString(env.BOOKING_EMAIL_GMAIL_PUBSUB_AUDIENCE)
  const serviceAccountEmail = nullableString(env.BOOKING_EMAIL_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL)?.toLowerCase() || null
  const configured = Boolean(topicName && subscription && audience && serviceAccountEmail && mailbox)
  const enabled = envEnabled(env.BOOKING_EMAIL_GMAIL_PUBSUB_ENABLED)
  const missing = []
  if (!topicName) missing.push('BOOKING_EMAIL_GMAIL_PUBSUB_TOPIC')
  if (!subscription) missing.push('BOOKING_EMAIL_GMAIL_PUBSUB_SUBSCRIPTION')
  if (!audience) missing.push('BOOKING_EMAIL_GMAIL_PUBSUB_AUDIENCE')
  if (!serviceAccountEmail) missing.push('BOOKING_EMAIL_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL')
  if (!mailbox) missing.push('BOOKING_EMAIL_PRIMARY_MAILBOX')

  return {
    enabled,
    configured,
    ready: enabled && configured,
    mailbox,
    topicName,
    subscription,
    audience,
    serviceAccountEmail,
    userId: nullableString(env.BOOKING_EMAIL_GMAIL_USER_ID || env.GMAIL_USER_ID) || 'me',
    gmailScope: nullableString(env.BOOKING_EMAIL_GMAIL_SCOPES || env.GMAIL_SCOPES) || DEFAULT_GMAIL_SCOPE,
    missing,
  }
}

function bearerToken(authorization) {
  const match = String(authorization || '').match(/^Bearer\s+([^\s]+)$/i)
  if (!match) {
    throw new BookingEmailSyncError('Authenticated Pub/Sub push is required.', {
      code: 'PUBSUB_AUTH_REQUIRED',
      statusCode: 401,
      retryable: false,
    })
  }
  return match[1]
}

async function defaultVerifyIdToken(idToken, audience) {
  const { OAuth2Client } = await import('google-auth-library')
  const client = new OAuth2Client()
  const ticket = await client.verifyIdToken({ idToken, audience })
  return ticket.getPayload()
}

/**
 * Verifies the Google-signed OIDC token used by an authenticated Pub/Sub push
 * subscription. Callers may inject verifyIdToken for deterministic tests.
 */
export async function verifyBookingEmailPubSubRequest(options = {}) {
  const config = options.config || bookingEmailPubSubConfig(options.env)
  if (!config.ready) {
    throw new BookingEmailSyncError('Booking email Pub/Sub is not configured.', {
      code: 'PUBSUB_NOT_CONFIGURED',
      statusCode: 503,
    })
  }

  const token = bearerToken(options.authorization || options.request?.headers?.authorization)
  let claims
  try {
    claims = await (options.verifyIdToken || defaultVerifyIdToken)(token, config.audience)
  } catch (error) {
    throw new BookingEmailSyncError('Pub/Sub identity token verification failed.', {
      code: 'PUBSUB_AUTH_INVALID',
      statusCode: 401,
      retryable: false,
      cause: error,
    })
  }

  const issuer = nullableString(claims?.iss)
  const email = nullableString(claims?.email)?.toLowerCase()
  const emailVerified = claims?.email_verified === true || claims?.email_verified === 'true'
  const audiences = Array.isArray(claims?.aud) ? claims.aud.map(String) : [String(claims?.aud || '')]
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(issuer || '')) {
    throw new BookingEmailSyncError('Pub/Sub identity token issuer is invalid.', {
      code: 'PUBSUB_AUTH_ISSUER_INVALID',
      statusCode: 403,
      retryable: false,
    })
  }
  if (!emailVerified || email !== config.serviceAccountEmail) {
    throw new BookingEmailSyncError('Pub/Sub identity token service account is not authorized.', {
      code: 'PUBSUB_AUTH_SERVICE_ACCOUNT_INVALID',
      statusCode: 403,
      retryable: false,
    })
  }
  if (!audiences.includes(config.audience)) {
    throw new BookingEmailSyncError('Pub/Sub identity token audience is invalid.', {
      code: 'PUBSUB_AUTH_AUDIENCE_INVALID',
      statusCode: 403,
      retryable: false,
    })
  }

  return {
    authenticated: true,
    serviceAccountEmail: email,
    subject: nullableString(claims?.sub),
  }
}

function decodeBase64UrlJson(value) {
  const encoded = nullableString(value)
  if (!encoded || Buffer.byteLength(encoded, 'utf8') > MAX_PUBSUB_DATA_BYTES) {
    throw new BookingEmailSyncError('Pub/Sub notification data is missing or too large.', {
      code: 'PUBSUB_DATA_INVALID',
      statusCode: 400,
      retryable: false,
    })
  }
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch (error) {
    throw new BookingEmailSyncError('Pub/Sub notification data is invalid.', {
      code: 'PUBSUB_DATA_INVALID',
      statusCode: 400,
      retryable: false,
      cause: error,
    })
  }
}

/**
 * Strictly extracts the wrapped Pub/Sub delivery and Gmail history cursor.
 * The returned object contains operational identifiers but no email content.
 */
export function decodeBookingEmailPubSubEnvelope(envelope, options = {}) {
  const config = options.config || bookingEmailPubSubConfig(options.env)
  if (!isPlainObject(envelope) || !isPlainObject(envelope.message)) {
    throw new BookingEmailSyncError('Pub/Sub request body is invalid.', {
      code: 'PUBSUB_ENVELOPE_INVALID',
      statusCode: 400,
      retryable: false,
    })
  }

  const subscription = nullableString(envelope.subscription)
  const pubsubMessageId = nullableString(envelope.message.messageId || envelope.message.message_id)
  if (!subscription || subscription !== config.subscription) {
    throw new BookingEmailSyncError('Pub/Sub subscription is not authorized.', {
      code: 'PUBSUB_SUBSCRIPTION_INVALID',
      statusCode: 403,
      retryable: false,
    })
  }
  if (!pubsubMessageId || pubsubMessageId.length > 200) {
    throw new BookingEmailSyncError('Pub/Sub message id is invalid.', {
      code: 'PUBSUB_MESSAGE_ID_INVALID',
      statusCode: 400,
      retryable: false,
    })
  }

  const data = decodeBase64UrlJson(envelope.message.data)
  const emailAddress = nullableString(data?.emailAddress)?.toLowerCase()
  if (!emailAddress || emailAddress !== config.mailbox) {
    throw new BookingEmailSyncError('Gmail notification mailbox is not authorized.', {
      code: 'PUBSUB_MAILBOX_INVALID',
      statusCode: 403,
      retryable: false,
    })
  }

  return {
    pubsubMessageId,
    subscription,
    emailAddress,
    notificationHistoryId: historyId(data?.historyId, 'Gmail notification history id'),
    publishedAt: dateOrNull(envelope.message.publishTime || envelope.message.publish_time),
  }
}

async function fetchJsonWithRetry(url, request, options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  const attempts = positiveInteger(options.attempts, 3, 5)
  const sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const random = options.random || Math.random

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response
    try {
      response = await fetchImpl(url, request)
    } catch (error) {
      if (attempt >= attempts) {
        throw new BookingEmailSyncError('Gmail API request could not be completed.', {
          code: 'GMAIL_NETWORK_ERROR',
          statusCode: 502,
          cause: error,
        })
      }
      await sleep(Math.round(250 * 2 ** (attempt - 1) + random() * 250))
      continue
    }

    const payload = await response.json().catch(() => ({}))
    if (response.ok) return payload
    if (response.status === 404 && new URL(String(url)).pathname.endsWith('/history')) {
      throw new BookingEmailSyncError('Stored Gmail history cursor is no longer valid.', {
        code: 'GMAIL_HISTORY_STALE',
        statusCode: 404,
      })
    }

    const retryable = response.status === 429 || response.status >= 500
    if (!retryable || attempt >= attempts) {
      throw new BookingEmailSyncError(redactBookingEmailSyncError(payload?.error?.message || `Gmail API request failed with status ${response.status}.`), {
        code: response.status === 401 || response.status === 403 ? 'GMAIL_AUTH_ERROR' : 'GMAIL_API_ERROR',
        statusCode: response.status,
        retryable,
      })
    }

    const retryAfterSeconds = Number(response.headers.get('retry-after'))
    const backoff = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1_000
      : 500 * 2 ** (attempt - 1) + random() * 500
    await sleep(Math.min(Math.round(backoff), 10_000))
  }

  throw new BookingEmailSyncError('Gmail API retry budget was exhausted.', { code: 'GMAIL_RETRY_EXHAUSTED' })
}

function gmailAuthorization(token) {
  const accessToken = nullableString(token)
  if (!accessToken) {
    throw new BookingEmailSyncError('Gmail OAuth access token is unavailable.', {
      code: 'GMAIL_AUTH_UNAVAILABLE',
      statusCode: 503,
    })
  }
  return {
    authorization: `Bearer ${accessToken}`,
    accept: 'application/json',
  }
}

function gmailUserId(options, config) {
  return encodeURIComponent(nullableString(options.userId) || config.userId || 'me')
}

async function gmailAccessToken(options, config) {
  if (typeof options.getAccessToken !== 'function') {
    throw new BookingEmailSyncError('A backend Gmail OAuth token resolver is required.', {
      code: 'GMAIL_TOKEN_RESOLVER_REQUIRED',
      statusCode: 503,
    })
  }
  return options.getAccessToken({ env: options.env || process.env, config })
}

function headerValue(message, name) {
  const target = String(name).toLowerCase()
  return message?.payload?.headers?.find((header) => String(header?.name || '').toLowerCase() === target)?.value || ''
}

function decodeGmailBody(data, maximumChars = MAX_GMAIL_MESSAGE_TEXT_CHARS) {
  if (!data || maximumChars <= 0) return ''
  try {
    const encoded = String(data).slice(0, Math.ceil(maximumChars * 1.5) + 8)
    return Buffer.from(encoded, 'base64url').toString('utf8').slice(0, maximumChars)
  } catch {
    return ''
  }
}

function collectMimeText(part, output = { plain: [], html: [], characters: 0, parts: 0 }, depth = 0) {
  if (!part || depth > MAX_GMAIL_MIME_DEPTH || output.parts >= MAX_GMAIL_MIME_PARTS || output.characters >= MAX_GMAIL_MESSAGE_TEXT_CHARS) return output
  output.parts += 1
  const mimeType = String(part.mimeType || '').toLowerCase()
  const body = decodeGmailBody(part.body?.data, MAX_GMAIL_MESSAGE_TEXT_CHARS - output.characters)
  if (body && (mimeType === 'text/plain' || mimeType === 'text/html')) {
    output[mimeType === 'text/plain' ? 'plain' : 'html'].push(body)
    output.characters += body.length
  }
  for (const child of part.parts || []) {
    collectMimeText(child, output, depth + 1)
    if (output.parts >= MAX_GMAIL_MIME_PARTS || output.characters >= MAX_GMAIL_MESSAGE_TEXT_CHARS) break
  }
  return output
}

function htmlToConservativeText(value) {
  return String(value || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

function gmailMessageToEvent(message, options = {}) {
  const parts = collectMimeText(message?.payload)
  const plainText = parts.plain.join('\n').trim()
  const rawText = (plainText || htmlToConservativeText(parts.html.join('\n')) || String(message?.snippet || '').trim())
    .slice(0, MAX_GMAIL_MESSAGE_TEXT_CHARS)
  const internalDate = Number(message?.internalDate)
  const receivedAt = Number.isFinite(internalDate) && internalDate > 0
    ? new Date(internalDate).toISOString()
    : dateOrNull(headerValue(message, 'date'))?.toISOString() || new Date(options.now?.() || Date.now()).toISOString()

  return {
    sourceMessageId: nullableString(message?.id),
    threadId: nullableString(message?.threadId),
    sender: nullableString(headerValue(message, 'from')) || 'Unknown sender',
    recipient: nullableString(headerValue(message, 'to')),
    subject: nullableString(headerValue(message, 'subject')) || '(no subject)',
    receivedAt,
    rawText,
    snippet: nullableString(message?.snippet),
    rawEmailUrl: message?.id ? `https://mail.google.com/mail/u/0/#inbox/${message.id}` : null,
    rawHeaders: {
      messageId: nullableString(headerValue(message, 'message-id')),
      date: nullableString(headerValue(message, 'date')),
      deliveredTo: nullableString(headerValue(message, 'delivered-to')),
      replyTo: nullableString(headerValue(message, 'reply-to')),
      authenticationResults: nullableString(headerValue(message, 'authentication-results')),
      arcAuthenticationResults: nullableString(headerValue(message, 'arc-authentication-results')),
    },
    gmailLabelIds: Array.isArray(message?.labelIds) ? message.labelIds.filter((value) => typeof value === 'string').slice(0, 25) : [],
    ingestMethod: options.ingestMethod || 'PUSH',
  }
}

async function fetchFullGmailMessage(messageId, context) {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/${context.userId}/messages/${encodeURIComponent(messageId)}`)
  url.searchParams.set('format', 'full')
  return fetchJsonWithRetry(url, {
    headers: gmailAuthorization(context.token),
  }, context)
}

async function prepareGmailEvents(messageIds, context) {
  const events = []
  let inspected = 0
  for (const messageId of messageIds) {
    const message = await fetchFullGmailMessage(messageId, context)
    inspected += 1
    if (inspected % 10 === 0 && context.prisma && context.lease && context.source?.id) {
      await extendSourceLease(context.prisma, context.source.id, context.lease, context)
    }
    const labels = new Set(Array.isArray(message?.labelIds) ? message.labelIds : [])
    if (labels.has('SPAM') || labels.has('TRASH')) continue

    let event = gmailMessageToEvent(message, {
      ingestMethod: context.ingestMethod,
      now: context.now,
    })
    if (!event.sourceMessageId) {
      throw new BookingEmailSyncError('Gmail returned a message without an id.', { code: 'GMAIL_MESSAGE_INVALID' })
    }

    if (typeof context.prepareMessage === 'function') {
      const prepared = await context.prepareMessage({ message, event, source: context.source })
      if (prepared === null || prepared?.accepted === false) continue
      if (prepared?.event) {
        event = { ...event, ...prepared.event }
      } else {
        const overrides = { ...(prepared || {}) }
        delete overrides.accepted
        event = { ...event, ...overrides }
      }
    }

    // Transport can only ingest review events. Provider verification is audit
    // metadata and never grants authority to mutate PMS state here.
    event.status = 'NEEDS_REVIEW'
    event.ingestMethod = context.ingestMethod
    event.verification = isPlainObject(event.verification)
      ? event.verification
      : { status: 'UNVERIFIED', reasons: ['provider_verifier_not_configured'] }
    events.push(event)
  }
  return events
}

async function ingestReviewOnly(events, context) {
  if (events.length === 0) return { eventsIngested: 0, batches: 0 }
  if (typeof context.ingestEvents !== 'function') {
    throw new BookingEmailSyncError('A review-only booking email ingestion function is required.', {
      code: 'BOOKING_EMAIL_INGESTER_REQUIRED',
      statusCode: 503,
    })
  }

  const chunkSize = positiveInteger(context.ingestChunkSize, DEFAULT_INGEST_CHUNK_SIZE, 100)
  let batches = 0
  for (let offset = 0; offset < events.length; offset += chunkSize) {
    const chunk = events.slice(offset, offset + chunkSize)
    await context.ingestEvents(context.prisma, {
      sourceId: context.source.id,
      events: chunk,
      reviewOnly: true,
      ingestMethod: context.ingestMethod,
    }, context.actor || BOOKING_EMAIL_SYSTEM_ACTOR)
    batches += 1
    await extendSourceLease(context.prisma, context.source.id, context.lease, context)
  }
  return { eventsIngested: events.length, batches }
}

function sourceDelegate(prisma) {
  if (!prisma?.bookingEmailSource) {
    throw new BookingEmailSyncError('BookingEmailSource Prisma delegate is unavailable.', {
      code: 'BOOKING_EMAIL_SCHEMA_UNAVAILABLE',
      statusCode: 503,
    })
  }
  return prisma.bookingEmailSource
}

function deliveryDelegate(prisma) {
  if (!prisma?.bookingEmailPushDelivery) {
    throw new BookingEmailSyncError('BookingEmailPushDelivery Prisma delegate is unavailable.', {
      code: 'BOOKING_EMAIL_PUSH_SCHEMA_UNAVAILABLE',
      statusCode: 503,
    })
  }
  return prisma.bookingEmailPushDelivery
}

async function findGmailSource(prisma, options = {}) {
  const delegate = sourceDelegate(prisma)
  if (options.sourceId) {
    const source = await delegate.findFirst({
      where: { id: options.sourceId, ...configuredPropertyWhere(options) },
    })
    if (!source || source.enabled === false || source.provider !== 'GMAIL') {
      throw new BookingEmailSyncError('Enabled Gmail booking email source was not found.', {
        code: 'BOOKING_EMAIL_SOURCE_NOT_FOUND',
        statusCode: 404,
        retryable: false,
      })
    }
    return source
  }

  const mailbox = String(options.mailbox || bookingEmailPubSubConfig(options.env).mailbox).trim().toLowerCase()
  const source = await delegate.findFirst({
    where: { provider: 'GMAIL', enabled: true, mailbox, ...configuredPropertyWhere(options) },
    orderBy: { createdAt: 'asc' },
  })
  if (!source) {
    throw new BookingEmailSyncError('Enabled Gmail booking email source was not found.', {
      code: 'BOOKING_EMAIL_SOURCE_NOT_FOUND',
      statusCode: 503,
    })
  }
  return source
}

async function acquireSourceLease(prisma, sourceId, options = {}) {
  const owner = nullableString(options.leaseOwner) || `booking-email:${randomUUID()}`
  const now = nowDate(options)
  const leaseMs = positiveInteger(options.leaseMs, DEFAULT_LEASE_MS, 15 * 60_000)
  const until = new Date(now.getTime() + leaseMs)
  const result = await sourceDelegate(prisma).updateMany({
    where: {
      id: sourceId,
      OR: [
        { syncLeaseUntil: null },
        { syncLeaseUntil: { lt: now } },
        { syncLeaseOwner: owner },
      ],
    },
    data: { syncLeaseOwner: owner, syncLeaseUntil: until },
  })
  return result.count === 1 ? { owner, until } : null
}

async function extendSourceLease(prisma, sourceId, lease, options = {}) {
  const now = nowDate(options)
  const leaseMs = positiveInteger(options.leaseMs, DEFAULT_LEASE_MS, 15 * 60_000)
  const result = await sourceDelegate(prisma).updateMany({
    where: { id: sourceId, syncLeaseOwner: lease.owner },
    data: { syncLeaseUntil: new Date(now.getTime() + leaseMs) },
  })
  if (result.count !== 1) {
    throw new BookingEmailSyncError('Booking email synchronization lease was lost.', {
      code: 'BOOKING_EMAIL_LEASE_LOST',
      statusCode: 409,
    })
  }
}

async function releaseSourceLease(prisma, sourceId, lease) {
  await sourceDelegate(prisma).updateMany({
    where: { id: sourceId, syncLeaseOwner: lease.owner },
    data: { syncLeaseOwner: null, syncLeaseUntil: null },
  }).catch(() => undefined)
}

async function recordSourceFailure(prisma, sourceId, lease, error, options = {}) {
  const message = redactBookingEmailSyncError(error)
  await sourceDelegate(prisma).updateMany({
    where: { id: sourceId, syncLeaseOwner: lease.owner },
    data: {
      lastError: message,
      lastErrorAt: nowDate(options),
      consecutiveFailures: { increment: 1 },
      syncLeaseOwner: null,
      syncLeaseUntil: null,
    },
  }).catch(() => undefined)
  return message
}

async function commitSourceCursor(prisma, source, lease, nextCursor, options = {}) {
  const now = nowDate(options)
  const where = {
    id: source.id,
    syncLeaseOwner: lease.owner,
    lastSyncCursor: source.lastSyncCursor ?? null,
  }
  const result = await sourceDelegate(prisma).updateMany({
    where,
    data: {
      lastSyncCursor: historyId(nextCursor),
      lastSyncAt: now,
      lastReconciledAt: now,
      lastError: null,
      lastErrorAt: null,
      consecutiveFailures: 0,
      syncLeaseOwner: null,
      syncLeaseUntil: null,
    },
  })
  if (result.count !== 1) {
    throw new BookingEmailSyncError('Booking email cursor changed during synchronization.', {
      code: 'BOOKING_EMAIL_CURSOR_CONFLICT',
      statusCode: 409,
    })
  }
}

async function listHistoryMessageIds(source, context) {
  const startCursor = historyId(source.lastSyncCursor, 'Stored Gmail history cursor')
  const messageIds = new Set()
  let pageToken = null
  let latestHistoryId = startCursor
  let pageCount = 0

  do {
    if (pageCount >= MAX_GMAIL_HISTORY_PAGES) {
      throw new BookingEmailSyncError('Gmail history exceeded the bounded page limit; the cursor was not advanced.', {
        code: 'GMAIL_HISTORY_PAGE_LIMIT',
        statusCode: 409,
        retryable: false,
      })
    }
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/${context.userId}/history`)
    url.searchParams.set('startHistoryId', startCursor)
    url.searchParams.set('historyTypes', 'messageAdded')
    url.searchParams.set('labelId', 'INBOX')
    url.searchParams.set('maxResults', String(positiveInteger(context.historyPageSize, DEFAULT_HISTORY_PAGE_SIZE, 500)))
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const payload = await fetchJsonWithRetry(url, { headers: gmailAuthorization(context.token) }, context)
    for (const item of payload.history || []) {
      for (const addition of item.messagesAdded || []) {
        const id = nullableString(addition?.message?.id)
        if (id) messageIds.add(id)
        if (messageIds.size > MAX_GMAIL_HISTORY_MESSAGE_IDS) {
          throw new BookingEmailSyncError('Gmail history exceeded the bounded message limit; the cursor was not advanced.', {
            code: 'GMAIL_HISTORY_MESSAGE_LIMIT',
            statusCode: 409,
            retryable: false,
          })
        }
      }
    }
    if (payload.historyId) latestHistoryId = historyId(payload.historyId)
    pageToken = nullableString(payload.nextPageToken)
    pageCount += 1
    await extendSourceLease(context.prisma, source.id, context.lease, context)
  } while (pageToken)

  return { messageIds: [...messageIds], latestHistoryId }
}

async function listReconciliationMessageIds(source, context) {
  const query = nullableString(context.reconciliationQuery || source.query)
  if (!query) {
    throw new BookingEmailSyncError('A bounded Gmail reconciliation query is required.', {
      code: 'GMAIL_RECONCILIATION_QUERY_REQUIRED',
      statusCode: 503,
    })
  }

  const limit = positiveInteger(context.reconciliationLimit, DEFAULT_RECONCILIATION_LIMIT, 5_000)
  const messageIds = []
  let pageToken = null
  let truncated = false
  do {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/${context.userId}/messages`)
    url.searchParams.set('q', query)
    url.searchParams.set('maxResults', String(Math.min(DEFAULT_MESSAGE_PAGE_SIZE, limit - messageIds.length)))
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const payload = await fetchJsonWithRetry(url, { headers: gmailAuthorization(context.token) }, context)
    for (const message of payload.messages || []) {
      const id = nullableString(message?.id)
      if (id && !messageIds.includes(id)) messageIds.push(id)
      if (messageIds.length >= limit) break
    }
    pageToken = nullableString(payload.nextPageToken)
    truncated = Boolean(pageToken && messageIds.length >= limit)
    await extendSourceLease(context.prisma, source.id, context.lease, context)
  } while (pageToken && messageIds.length < limit)

  if (truncated) {
    throw new BookingEmailSyncError('Gmail reconciliation exceeded its bounded message limit; the cursor was not advanced.', {
      code: 'GMAIL_RECONCILIATION_LIMIT',
      statusCode: 409,
      retryable: false,
    })
  }
  return messageIds
}

async function currentGmailHistoryId(context) {
  const payload = await fetchJsonWithRetry(
    `https://gmail.googleapis.com/gmail/v1/users/${context.userId}/profile`,
    { headers: gmailAuthorization(context.token) },
    context,
  )
  return historyId(payload.historyId, 'Gmail profile history id')
}

async function reconcileUnderLease(source, context) {
  // Capture the high-water cursor before listing. Messages arriving after this
  // point remain visible to the subsequent history sync from this cursor.
  const baselineHistoryId = await currentGmailHistoryId(context)
  const messageIds = await listReconciliationMessageIds(source, context)
  const events = await prepareGmailEvents(messageIds, { ...context, source, ingestMethod: 'RECONCILIATION' })
  const ingestion = await ingestReviewOnly(events, { ...context, source, ingestMethod: 'RECONCILIATION' })
  await commitSourceCursor(context.prisma, source, context.lease, baselineHistoryId, context)
  return {
    mode: 'full_reconciliation',
    previousCursor: source.lastSyncCursor || null,
    nextCursor: baselineHistoryId,
    messagesFetched: messageIds.length,
    ...ingestion,
  }
}

async function syncHistoryUnderLease(source, context) {
  if (!source.lastSyncCursor) return reconcileUnderLease(source, context)
  if (context.targetHistoryId && compareHistoryIds(context.targetHistoryId, source.lastSyncCursor) <= 0) {
    await releaseSourceLease(context.prisma, source.id, context.lease)
    return {
      mode: 'coalesced',
      previousCursor: source.lastSyncCursor,
      nextCursor: source.lastSyncCursor,
      messagesFetched: 0,
      eventsIngested: 0,
      batches: 0,
    }
  }

  let listed
  try {
    listed = await listHistoryMessageIds(source, context)
  } catch (error) {
    if (error?.code === 'GMAIL_HISTORY_STALE') return reconcileUnderLease(source, context)
    throw error
  }
  const events = await prepareGmailEvents(listed.messageIds, { ...context, source, ingestMethod: 'PUSH' })
  const ingestion = await ingestReviewOnly(events, { ...context, source, ingestMethod: 'PUSH' })
  await commitSourceCursor(context.prisma, source, context.lease, listed.latestHistoryId, context)
  return {
    mode: 'history',
    previousCursor: source.lastSyncCursor,
    nextCursor: listed.latestHistoryId,
    messagesFetched: listed.messageIds.length,
    ...ingestion,
  }
}

function syncContext(prisma, source, lease, options = {}) {
  const config = options.config || bookingEmailPubSubConfig(options.env)
  return {
    ...options,
    prisma,
    source,
    lease,
    config,
    actor: options.actor || BOOKING_EMAIL_SYSTEM_ACTOR,
    logger: safeLogger(options.logger),
    userId: gmailUserId(options, config),
    now: options.now || (() => Date.now()),
  }
}

export async function syncBookingEmailHistory(prisma, options = {}) {
  const source = await findGmailSource(prisma, options)
  const lease = await acquireSourceLease(prisma, source.id, options)
  if (!lease) return { skipped: true, reason: 'lease_unavailable', eventsIngested: 0 }

  const context = syncContext(prisma, source, lease, options)
  try {
    context.token = await gmailAccessToken(options, context.config)
    const result = await syncHistoryUnderLease(source, context)
    return { skipped: false, sourceId: source.id, ...result }
  } catch (error) {
    const message = await recordSourceFailure(prisma, source.id, lease, error, context)
    context.logger.error('Booking email history synchronization failed:', message)
    throw error
  }
}

export async function reconcileBookingEmailSource(prisma, options = {}) {
  const source = await findGmailSource(prisma, options)
  const lease = await acquireSourceLease(prisma, source.id, options)
  if (!lease) return { skipped: true, reason: 'lease_unavailable', eventsIngested: 0 }
  const context = syncContext(prisma, source, lease, options)
  try {
    context.token = await gmailAccessToken(options, context.config)
    const result = await reconcileUnderLease(source, context)
    return { skipped: false, sourceId: source.id, ...result }
  } catch (error) {
    const message = await recordSourceFailure(prisma, source.id, lease, error, context)
    context.logger.error('Booking email reconciliation failed:', message)
    throw error
  }
}

function watchRenewalDue(source, now, options = {}) {
  if (options.force) return true
  const renewedAt = dateOrNull(source.watchRenewedAt)
  const expiresAt = dateOrNull(source.watchExpiresAt)
  const renewAfterMs = positiveInteger(options.watchRenewAfterMs, DEFAULT_WATCH_RENEW_AFTER_MS)
  const renewMarginMs = positiveInteger(options.watchRenewMarginMs, DEFAULT_WATCH_RENEW_MARGIN_MS)
  if (!renewedAt || !expiresAt) return true
  return now.getTime() - renewedAt.getTime() >= renewAfterMs || expiresAt.getTime() - now.getTime() <= renewMarginMs
}

export async function renewBookingEmailWatch(prisma, options = {}) {
  const config = options.config || bookingEmailPubSubConfig(options.env)
  if (!config.ready) return { skipped: true, reason: 'pubsub_not_configured' }
  const source = await findGmailSource(prisma, options)
  const now = nowDate(options)
  if (!watchRenewalDue(source, now, options)) {
    return { skipped: true, reason: 'not_due', expiresAt: dateOrNull(source.watchExpiresAt)?.toISOString() || null }
  }

  const lease = await acquireSourceLease(prisma, source.id, options)
  if (!lease) return { skipped: true, reason: 'lease_unavailable' }
  const context = syncContext(prisma, source, lease, options)
  try {
    const token = await gmailAccessToken(options, config)
    const response = await fetchJsonWithRetry(
      `https://gmail.googleapis.com/gmail/v1/users/${context.userId}/watch`,
      {
        method: 'POST',
        headers: { ...gmailAuthorization(token), 'content-type': 'application/json' },
        body: JSON.stringify({
          topicName: config.topicName,
          labelIds: ['INBOX'],
          labelFilterBehavior: 'INCLUDE',
        }),
      },
      context,
    )
    const watchHistoryId = historyId(response.historyId, 'Gmail watch history id')
    const expirationMilliseconds = Number(response.expiration)
    if (!Number.isFinite(expirationMilliseconds) || expirationMilliseconds <= now.getTime()) {
      throw new BookingEmailSyncError('Gmail watch expiration is invalid.', { code: 'GMAIL_WATCH_RESPONSE_INVALID' })
    }

    const updated = await sourceDelegate(prisma).updateMany({
      where: { id: source.id, syncLeaseOwner: lease.owner },
      data: {
        watchHistoryId,
        watchExpiresAt: new Date(expirationMilliseconds),
        watchRenewedAt: now,
        lastError: null,
        lastErrorAt: null,
        consecutiveFailures: 0,
        syncLeaseOwner: null,
        syncLeaseUntil: null,
      },
    })
    if (updated.count !== 1) {
      throw new BookingEmailSyncError('Booking email synchronization lease was lost during watch renewal.', {
        code: 'BOOKING_EMAIL_LEASE_LOST',
        statusCode: 409,
      })
    }
    return {
      skipped: false,
      sourceId: source.id,
      expiresAt: new Date(expirationMilliseconds).toISOString(),
      watchHistoryId,
    }
  } catch (error) {
    const message = await recordSourceFailure(prisma, source.id, lease, error, context)
    context.logger.error('Booking email Gmail watch renewal failed:', message)
    throw error
  }
}

/**
 * Persists a verified Pub/Sub delivery before the HTTP handler acknowledges it.
 * Duplicate Pub/Sub message ids never reset an existing delivery's state.
 */
export async function recordBookingEmailPushDelivery(prisma, delivery, options = {}) {
  const source = await findGmailSource(prisma, { ...options, mailbox: delivery.emailAddress })
  const now = nowDate(options)
  let created = false
  let record

  const persist = async (tx) => {
    const createResult = await deliveryDelegate(tx).createMany({
      data: [{
        sourceId: source.id,
        pubsubMessageId: delivery.pubsubMessageId,
        subscription: delivery.subscription,
        notificationHistoryId: historyId(delivery.notificationHistoryId),
        emailAddress: delivery.emailAddress,
        publishedAt: delivery.publishedAt || null,
        status: 'PENDING',
        attempts: 0,
        availableAt: now,
        lastError: null,
      }],
      skipDuplicates: true,
    })
    created = createResult.count === 1
    record = await deliveryDelegate(tx).findUnique({ where: { pubsubMessageId: delivery.pubsubMessageId } })
    await sourceDelegate(tx).update({ where: { id: source.id }, data: { lastPushAt: now } })
  }

  if (typeof prisma.$transaction === 'function') await prisma.$transaction(persist)
  else await persist(prisma)
  return { accepted: true, duplicate: !created, sourceId: source.id, deliveryId: record?.id || null }
}

function deliveryRetryAt(attempts, options = {}) {
  const base = positiveInteger(options.retryBaseMs, DEFAULT_RETRY_BASE_MS)
  const maximum = positiveInteger(options.retryMaxMs, DEFAULT_RETRY_MAX_MS)
  const random = options.random || Math.random
  const delay = Math.min(maximum, base * 2 ** Math.max(0, attempts - 1))
  return new Date(nowDate(options).getTime() + Math.round(delay * (0.75 + random() * 0.5)))
}

export function bookingEmailDeliveryAttemptPolicy(input = {}, options = {}) {
  const attempts = nonNegativeInteger(input.attempts)
  const maxAttempts = positiveInteger(
    input.maxAttempts ?? options.deliveryMaxAttempts,
    DEFAULT_DELIVERY_MAX_ATTEMPTS,
    100,
  )
  const retryable = input.retryable === undefined
    ? input.error?.retryable !== false
    : input.retryable !== false
  const exhausted = attempts >= maxAttempts
  const terminal = !retryable || exhausted
  const terminalReason = !retryable ? 'non_retryable' : exhausted ? 'attempts_exhausted' : null

  return {
    attempts,
    maxAttempts,
    retryable,
    exhausted,
    terminal,
    terminalReason,
    // BookingEmailPushDelivery.availableAt is intentionally non-null in the
    // existing schema. Terminal rows consume their attempt budget instead, so
    // they remain FAILED and visible but cannot satisfy the claim predicate.
    persistedAttempts: terminal ? maxAttempts : attempts,
    nextAttemptAt: terminal ? null : deliveryRetryAt(attempts, options),
  }
}

async function markDeliveryComplete(prisma, deliveryId, status, now) {
  await deliveryDelegate(prisma).update({
    where: { id: deliveryId },
    data: { status, completedAt: now, claimedAt: null, lastError: null },
  })
}

export async function processPendingBookingEmailDeliveries(prisma, options = {}) {
  const now = nowDate(options)
  const limit = positiveInteger(options.deliveryLimit, 20, 100)
  const maxAttempts = positiveInteger(options.deliveryMaxAttempts, DEFAULT_DELIVERY_MAX_ATTEMPTS, 100)
  const claimTimeoutMs = positiveInteger(options.deliveryClaimTimeoutMs, DEFAULT_DELIVERY_CLAIM_TIMEOUT_MS, 60 * 60_000)
  const staleClaimBefore = new Date(now.getTime() - claimTimeoutMs)
  const claimable = [
    { status: 'PENDING', attempts: { lt: maxAttempts }, availableAt: { lte: now } },
    {
      status: 'FAILED',
      attempts: { lt: maxAttempts },
      availableAt: { lte: now },
      NOT: { lastError: { startsWith: '[terminal:' } },
    },
    { status: 'PROCESSING', claimedAt: { lt: staleClaimBefore } },
  ]
  const candidates = await deliveryDelegate(prisma).findMany({
    where: { OR: claimable },
    orderBy: [{ publishedAt: 'asc' }, { createdAt: 'asc' }],
    take: limit,
  })
  const summary = { checked: candidates.length, processed: 0, coalesced: 0, failed: 0, eventsIngested: 0 }
  const blockedSources = new Set()

  for (const candidate of candidates) {
    if (blockedSources.has(candidate.sourceId)) continue
    const claim = await deliveryDelegate(prisma).updateMany({
      where: {
        id: candidate.id,
        OR: claimable,
      },
      data: { status: 'PROCESSING', claimedAt: now, attempts: { increment: 1 }, lastError: null },
    })
    if (claim.count !== 1) continue

    try {
      const source = await sourceDelegate(prisma).findFirst({
        where: { id: candidate.sourceId, ...configuredPropertyWhere(options) },
      })
      if (!source || source.enabled === false) {
        await markDeliveryComplete(prisma, candidate.id, 'COALESCED', now)
        summary.coalesced += 1
        continue
      }
      if (source.lastSyncCursor && compareHistoryIds(candidate.notificationHistoryId, source.lastSyncCursor) <= 0) {
        await markDeliveryComplete(prisma, candidate.id, 'COALESCED', now)
        summary.coalesced += 1
        continue
      }

      const result = await syncBookingEmailHistory(prisma, {
        ...options,
        sourceId: source.id,
        targetHistoryId: candidate.notificationHistoryId,
      })
      if (result.skipped) {
        await deliveryDelegate(prisma).update({
          where: { id: candidate.id },
          // A source lease collision means no delivery attempt ran. Restore the
          // prior count so routine overlap cannot exhaust the retry budget.
          data: {
            status: 'PENDING',
            claimedAt: null,
            attempts: nonNegativeInteger(candidate.attempts),
            availableAt: deliveryRetryAt(Math.max(1, nonNegativeInteger(candidate.attempts)), options),
          },
        })
        blockedSources.add(candidate.sourceId)
        continue
      }
      await markDeliveryComplete(prisma, candidate.id, result.mode === 'coalesced' ? 'COALESCED' : 'SUCCEEDED', now)
      if (result.mode === 'coalesced') summary.coalesced += 1
      else summary.processed += 1
      summary.eventsIngested += Number(result.eventsIngested || 0)
    } catch (error) {
      const message = redactBookingEmailSyncError(error)
      const policy = bookingEmailDeliveryAttemptPolicy({
        attempts: nonNegativeInteger(candidate.attempts) + 1,
        maxAttempts,
        error,
      }, options)
      const lastError = policy.terminal
        ? `[terminal:${policy.terminalReason}; attempts=${policy.attempts}/${policy.maxAttempts}] ${message.slice(0, 400)}`
        : message
      await deliveryDelegate(prisma).update({
        where: { id: candidate.id },
        data: {
          status: 'FAILED',
          claimedAt: null,
          attempts: policy.persistedAttempts,
          lastError,
          // Terminal rows are excluded by attempts < maxAttempts. Keep the
          // required storage field bounded without representing it as a retry.
          availableAt: policy.nextAttemptAt || now,
        },
      })
      safeLogger(options.logger).error('Booking email push delivery processing failed:', lastError)
      summary.failed += 1
      blockedSources.add(candidate.sourceId)
    }
  }

  return summary
}

/**
 * One bounded maintenance run for a Render cron job. It renews due watches,
 * drains durable push deliveries, then reconciles each enabled Gmail source.
 */
export async function runBookingEmailMaintenance(prisma, options = {}) {
  const sources = await sourceDelegate(prisma).findMany({
    where: { provider: 'GMAIL', enabled: true, ...configuredPropertyWhere(options) },
    orderBy: { createdAt: 'asc' },
  })
  const summary = {
    sourcesChecked: sources.length,
    watchesRenewed: 0,
    deliveriesProcessed: 0,
    deliveriesCoalesced: 0,
    deliveryFailures: 0,
    reconciliationsSucceeded: 0,
    reconciliationFailures: 0,
    eventsIngested: 0,
    errors: [],
  }

  for (const source of sources) {
    try {
      const watch = await renewBookingEmailWatch(prisma, { ...options, sourceId: source.id })
      if (!watch.skipped) summary.watchesRenewed += 1
    } catch (error) {
      summary.errors.push(redactBookingEmailSyncError(error))
    }
  }

  try {
    const deliveries = await processPendingBookingEmailDeliveries(prisma, options)
    summary.deliveriesProcessed += deliveries.processed
    summary.deliveriesCoalesced += deliveries.coalesced
    summary.deliveryFailures += deliveries.failed
    summary.eventsIngested += deliveries.eventsIngested
  } catch (error) {
    summary.deliveryFailures += 1
    summary.errors.push(redactBookingEmailSyncError(error))
  }

  for (const source of sources) {
    try {
      const result = await syncBookingEmailHistory(prisma, { ...options, sourceId: source.id })
      if (!result.skipped) {
        summary.reconciliationsSucceeded += 1
        summary.eventsIngested += Number(result.eventsIngested || 0)
      }
    } catch (error) {
      summary.reconciliationFailures += 1
      summary.errors.push(redactBookingEmailSyncError(error))
    }
  }

  summary.errors = [...new Set(summary.errors)].slice(0, 10)
  return summary
}
