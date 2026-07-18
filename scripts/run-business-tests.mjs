/* global console, process, Response, URL */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHmac } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { get as httpGet } from 'node:http'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { buildIcalFeedForChannel, buildIcalFeedUrl, normalizeIcalProvider } from '../server/ical-feed.mjs'
import { createHotelOpsScanScheduler } from '../server/ops-scheduler.mjs'
import { approveOpsAlertRecommendation, approveOpsTask, buildOpsNotificationDrafts, buildOpsScanInsights, cancelOpsTask, denyOpsTask, dismissOpsNotification, evaluateOpsPermission, evaluateOpsTaskRun, getOpsPolicy, getOpsScanPolicy, getOpsTask, hotelOpsTrendAlertFingerprint, hotelOpsAiParserStatus, hotelOpsEmailProviderStatus, listOpsApprovals, listOpsNotifications, listOpsScanSnapshots, listOpsTasks, listOpsTrendAlerts, normalizeOpsSourceChannel, parseHotelOpsCommand, parseHotelOpsCommandForSubmission, parseHotelOpsCommandWithOpenAi, readOpsNotification, resolveOpsHumanAction, resolveOpsTrendAlert, runOpsScan, runQueuedOpsTask, sendOpsEmailNotification, setEmergencyStop, submitOpsCommand, validateParsedOpsTask } from '../server/ops-service.mjs'
import { emailOpsCommandIdempotencyKey, emailOpsCommandIntakeStatus, extractEmailOpsCommandText, normalizeEmailOpsSender, parseEmailOpsCommandUserMap, processEmailOpsCommandEvents, resolveEmailOpsCommandEvent } from '../server/email-ops-intake.mjs'
import { extractLineOpsCommandText, lineOpsCommandIdempotencyKey, lineOpsCommandIntakeStatus, parseLineOpsCommandUserMap, processLineOpsCommandEvents, resolveLineOpsCommandEvent } from '../server/line-ops-intake.mjs'
import { extractWhatsAppOpsCommandText, extractWhatsAppWebhookMessages, normalizeWhatsAppOpsSender, parseWhatsAppOpsCommandUserMap, processWhatsAppOpsCommandEvents, resolveWhatsAppOpsCommandEvent, verifyWhatsAppWebhookSignature, whatsAppOpsCommandIdempotencyKey, whatsAppOpsCommandIntakeStatus, whatsAppWebhookStatus } from '../server/whatsapp-ops-intake.mjs'
import { buildOpsWorkerTaskPayload, executeOpsWorkerTask } from '../server/ops-worker-client.mjs'
import { opsWorkerConfigured, runSignedMockOtaWorkerTask, signOpsWorkerRequest, verifyOpsWorkerRequest } from '../server/ops-worker-auth.mjs'
import { createBookingComAdapter, executeBookingComTask } from '../server/ota-adapters/booking-com.mjs'
import { createOtaPlatformSkeletonAdapter, executeOtaPlatformSkeletonTask, otaPlatformSkeletonStatuses } from '../server/ota-adapters/platform-skeleton.mjs'
import { bookingEmailGmailCredentialStatus, authenticateUser, completeInitialSetup, createUser, fetchGmailEventsForSource, parseBookingEmailDetails, previewBookingEmailEvent, resolveBookingEmailGmailAccessToken, syncBookingEmail, testBookingEmailGmailConnection } from '../server/pms-service.mjs'
import { createPasswordHash } from '../server/security.mjs'
import { DATABASE_HEALTH_FAILURE_MESSAGE, databaseHealthFailure } from '../server/health-response.mjs'
import { getSystemCapabilities } from '../server/capability-service.mjs'
import { createOpenApiDocument } from '../server/openapi.mjs'
import { listDomainEvents, publicDomainEvent } from '../server/domain-events.mjs'
import { requestIdFromHeaders, resolveRequestContext } from '../server/request-context.mjs'
import { bookingEmailNoiseFixtures, bookingEmailParserFixtures } from './fixtures/booking-email-parser-fixtures.mjs'
import { approvedBookingEmailProviderQuery, primaryMailboxBookingEmailQuery } from './booking-email-query.mjs'
import { buildGmailAuthorizationUrl, exchangeAuthorizationCode, gmailOauthScopes, readGoogleOauthClientCredentials, resolveGmailOauthClient, startAuthorizationCodeListener } from './prepare-gmail-oauth-render.mjs'
import { maskLoginIdentifier, normalizeProofHost, summarizePublicUserForProof, validateDenialProbe } from './prove-auth-rbac-production.mjs'
import { assertCloudflareWafProofRequirements, buildCloudflareWafProof, isCloudflareWafProofReady, parseCloudflareEnvFileContent, summarizeRuleset, zoneNameCandidates } from './prove-cloudflare-waf-rules.mjs'
import { ensureSandboxCloudflareWafRules, sandboxCloudflareWafDesiredRules } from './ensure-cloudflare-waf-rules.mjs'

const databaseFailure = databaseHealthFailure(new Error('postgresql://user:secret@database.internal/prod'))
assert.deepEqual(databaseFailure, {
  configured: true,
  ok: false,
  error: DATABASE_HEALTH_FAILURE_MESSAGE,
}, 'deep health returns a stable sanitized database failure')
assert.equal(JSON.stringify(databaseFailure).includes('secret'), false, 'deep health does not expose raw database errors')

const apiContract = createOpenApiDocument({ serverUrl: 'https://pms.example.test' })
assert.equal(apiContract.openapi, '3.1.0', 'OpenAPI contract uses version 3.1')
assert.equal(apiContract.paths['/api/reservations'].post.security[0].cookieSession.length, 0, 'staff APIs declare cookie authentication')
assert.deepEqual(apiContract.paths['/api/auth/login'].post.security, [], 'login API remains public')
assert.equal(apiContract.paths['/api/internal/ops/worker/tasks'], undefined, 'signed internal worker routes are excluded from the staff contract')

const systemCapabilities = getSystemCapabilities({
  DIRECT_BOOKING_ENABLED: 'false',
  ACCOUNTING_V2_ENABLED: 'false',
  OTA_LIVE_WRITES_ENABLED: 'false',
})
assert.equal(systemCapabilities.sourceOfTruth, 'server', 'capability registry declares the backend source of truth')
assert.equal(systemCapabilities.operations.nightAudit.status, 'available', 'persistent night audit is presented as an operational backend capability')
assert.equal(systemCapabilities.finance.legacyFolioCharges.status, 'available', 'exact-satang legacy folio charge posting is separately capability-gated from disabled Accounting V2')
assert.equal(systemCapabilities.operations.nightAudit.writeMode, 'controlled', 'night audit writes remain controlled')
assert.equal(systemCapabilities.operations.rates.status, 'available', 'persistent rate services are presented as operational')
assert.equal(systemCapabilities.integrations.ota.writeMode, 'dry-run', 'OTA live writes remain dry-run by default')

assert.equal(requestIdFromHeaders({ 'x-request-id': 'request-1234' }), 'request-1234', 'valid request correlation IDs are preserved')
const propertyContext = await resolveRequestContext({
  property: { findUnique: async () => ({ id: 'property-1', code: 'SANDBOX' }) },
  userPropertyMembership: { findUnique: async () => ({ id: 'membership-1', role: 'MANAGER', active: true }) },
}, { id: 'user-1', role: 'FRONT_DESK' }, { requestId: 'request-1234', headers: { 'x-idempotency-key': 'attempt-1' } })
assert.equal(propertyContext.propertyId, 'property-1', 'request context is scoped to the active property')
assert.equal(propertyContext.role, 'MANAGER', 'property membership role overrides the compatibility role')
assert.equal(propertyContext.idempotencyKey, 'attempt-1', 'request context carries the mutation idempotency key')

const publicEvent = publicDomainEvent({ id: 12n, eventType: 'RESERVATION_UPDATED', aggregateType: 'reservation', aggregateId: 'res-1', createdAt: new Date('2026-07-16T00:00:00.000Z'), metadata: { guestName: 'must not leak' } })
assert.equal(JSON.stringify(publicEvent).includes('guestName'), false, 'public domain events omit metadata and PII')
const eventRows = await listDomainEvents({
  domainEvent: { findMany: async ({ where, take }) => {
    assert.equal(where.propertyId, 'property-1')
    assert.equal(where.id.gt, 10n)
    assert.equal(take, 100)
    return [{ id: 11n, eventType: 'ROOM_HOUSEKEEPING_UPDATED', aggregateType: 'room', aggregateId: 'room-1', createdAt: new Date('2026-07-16T00:00:00.000Z') }]
  } },
}, { propertyId: 'property-1', after: '10' })
assert.equal(eventRows[0].id, '11', 'domain event catch-up uses string sequence IDs')

function createOpsCommandPrismaFixture() {
  const property = {
    id: 'property-ops-test',
    code: 'SANDBOX',
    name: 'SANDBOX HOTEL',
    email: null,
    reservationAlertEmail: null,
  }
  const tasks = []
  const approvals = []
  const logs = []
  const audits = []
  const notifications = []
  const trendAlerts = []
  let stop = null
  let taskCounter = 0
  let approvalCounter = 0
  let logCounter = 0
  let auditCounter = 0
  let notificationCounter = 0

  const now = () => new Date('2026-06-30T00:00:00.000Z')
  const withTaskRelations = (task) => task ? {
    ...task,
    approvals: approvals.filter((approval) => approval.taskId === task.id),
    logs: logs.filter((log) => log.taskId === task.id),
    notifications: notifications.filter((notification) => notification.taskId === task.id),
  } : null

  const prisma = {
    property: {
      findUnique: async ({ where }) => {
        if (where?.id === property.id || where?.code === property.code) return property
        return null
      },
    },
    hotelOpsEmergencyStop: {
      findUnique: async ({ where }) => where?.propertyId === property.id ? stop : null,
      upsert: async ({ create, update }) => {
        stop = { id: 'stop-ops-test', createdAt: now(), updatedAt: now(), ...(stop || create), ...update }
        return stop
      },
    },
    hotelOpsTask: {
      findUnique: async ({ where }) => withTaskRelations(tasks.find((task) => (
        (where?.id && task.id === where.id)
        || (where?.idempotencyKey && task.idempotencyKey === where.idempotencyKey)
      ))),
      findMany: async ({ where = {}, take } = {}) => {
        const results = tasks.filter((task) => (
          (!where.propertyId || task.propertyId === where.propertyId)
          && (!where.status || task.status === where.status)
        ))
        return results.slice(0, take || results.length).map(withTaskRelations)
      },
      create: async ({ data }) => {
        const task = {
          id: `ops-task-${++taskCounter}`,
          createdAt: now(),
          updatedAt: now(),
          proofScreenshots: null,
          executionSummary: null,
          errorCode: null,
          errorMessage: null,
          ...data,
        }
        tasks.push(task)
        return withTaskRelations(task)
      },
      update: async ({ where, data }) => {
        const task = tasks.find((item) => item.id === where?.id)
        if (!task) return null
        Object.assign(task, data, { updatedAt: now() })
        return withTaskRelations(task)
      },
      updateMany: async ({ where, data }) => {
        const task = tasks.find((item) => item.id === where?.id && (!where?.status || item.status === where.status))
        if (!task) return { count: 0 }
        Object.assign(task, data, { updatedAt: now() })
        return { count: 1 }
      },
    },
    hotelOpsTaskApproval: {
      findMany: async ({ where = {} } = {}) => {
        const propertyId = where.task?.is?.propertyId
        return approvals
          .filter((approval) => {
            const task = tasks.find((item) => item.id === approval.taskId)
            return (!where.status || approval.status === where.status)
              && (!propertyId || task?.propertyId === propertyId)
          })
          .map((approval) => ({
            ...approval,
            task: withTaskRelations(tasks.find((task) => task.id === approval.taskId)),
          }))
      },
      create: async ({ data }) => {
        const approval = {
          id: `ops-approval-${++approvalCounter}`,
          status: 'PENDING',
          requestedAt: now(),
          decidedAt: null,
          decidedBy: null,
          notes: null,
          ...data,
        }
        approvals.push(approval)
        return approval
      },
      update: async ({ where, data }) => {
        const approval = approvals.find((item) => item.id === where?.id)
        if (!approval) return null
        Object.assign(approval, data)
        return approval
      },
    },
    hotelOpsTaskLog: {
      create: async ({ data }) => {
        const log = { id: `ops-log-${++logCounter}`, createdAt: now(), ...data }
        logs.push(log)
        return log
      },
    },
    auditLog: {
      create: async ({ data }) => {
        const audit = { id: `ops-audit-${++auditCounter}`, createdAt: now(), ...data }
        audits.push(audit)
        return audit
      },
    },
    hotelOpsNotification: {
      create: async ({ data }) => {
        const notification = { id: `ops-notification-${++notificationCounter}`, createdAt: now(), ...data }
        notifications.push(notification)
        return notification
      },
      findUnique: async ({ where }) => notifications.find((notification) => notification.id === where?.id) || null,
      findMany: async ({ where = {}, take } = {}) => {
        const results = notifications.filter((notification) => (
          (!where.propertyId || notification.propertyId === where.propertyId)
          && (!where.status || notification.status === where.status)
          && (!where.channel || notification.channel === where.channel)
          && (
            where.dismissedAt === undefined
            || (where.dismissedAt === null ? !notification.dismissedAt : Boolean(notification.dismissedAt))
          )
        ))
        return results.slice(0, take || results.length)
      },
      update: async ({ where, data }) => {
        const notification = notifications.find((item) => item.id === where?.id)
        if (!notification) return null
        Object.assign(notification, data)
        return notification
      },
    },
    hotelOpsTrendAlert: {
      findUnique: async ({ where }) => trendAlerts.find((alert) => alert.id === where?.id) || null,
      findMany: async ({ where = {}, take } = {}) => {
        const results = trendAlerts.filter((alert) => (
          (!where.propertyId || alert.propertyId === where.propertyId)
          && (!where.status || alert.status === where.status)
        ))
        return results.slice(0, take || results.length)
      },
      update: async ({ where, data }) => {
        const alert = trendAlerts.find((item) => item.id === where?.id)
        if (!alert) return null
        Object.assign(alert, data, { updatedAt: now() })
        return alert
      },
    },
    $transaction: async (callback) => callback(prisma),
  }

  return { prisma, property, tasks, approvals, logs, audits, notifications, trendAlerts }
}

function createBookingEmailPrismaFixture(options = {}) {
  const property = {
    id: 'property-booking-email-test',
    code: 'SANDBOX',
    name: 'SANDBOX HOTEL',
  }
  const sources = [{
    id: 'booking-source-1',
    propertyId: property.id,
    name: 'Primary booking Gmail',
    provider: 'GMAIL',
    mailbox: 'booking@sandboxhotel.com',
    enabled: true,
    autoProcessSafeEvents: Boolean(options.autoProcessSafeEvents),
    reviewThreshold: options.reviewThreshold ?? 0.85,
    query: 'to:booking@sandboxhotel.com',
    credentialsRef: null,
    lastSyncAt: null,
    lastSyncCursor: null,
    lastError: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  }]
  const events = []
  const audits = []
  const roomTypes = Array.isArray(options.roomTypes) ? options.roomTypes : []
  let eventCounter = 0

  const withEventRelations = (event) => event ? {
    ...event,
    source: sources.find((source) => source.id === event.sourceId) || null,
    reservation: null,
  } : null

  const matchesEventWhere = (event, where = {}) => {
    if (where.id && typeof where.id === 'string' && event.id !== where.id) return false
    if (where.id && typeof where.id === 'object' && where.id.not && event.id === where.id.not) return false
    if (where.propertyId && event.propertyId !== where.propertyId) return false
    if (where.sourceId !== undefined && event.sourceId !== where.sourceId) return false
    if (where.status && event.status !== where.status) return false
    if (where.eventType && event.eventType !== where.eventType) return false
    if (where.channelRef !== undefined && event.channelRef !== where.channelRef) return false
    if (where.sourceMessageId && typeof where.sourceMessageId === 'string' && event.sourceMessageId !== where.sourceMessageId) return false
    if (where.sourceMessageId?.in && !where.sourceMessageId.in.includes(event.sourceMessageId)) return false
    if (where.reservationId?.not === null && event.reservationId === null) return false
    if (where.rawText?.not === null && event.rawText === null) return false
    if (where.processedAt?.gte && !(event.processedAt instanceof Date && event.processedAt >= where.processedAt.gte)) return false
    return true
  }

  const sortEvents = (rows, orderBy = []) => {
    const entries = Array.isArray(orderBy) ? orderBy : [orderBy]
    return rows.slice().sort((left, right) => {
      for (const order of entries) {
        const [field, direction] = Object.entries(order || {})[0] || []
        if (!field) continue
        const leftValue = left[field]
        const rightValue = right[field]
        if (leftValue === rightValue) continue
        const multiplier = direction === 'asc' ? 1 : -1
        return leftValue > rightValue ? multiplier : -multiplier
      }
      return 0
    })
  }

  const prisma = {
    property: {
      findUnique: async ({ where }) => {
        if (where?.id === property.id || where?.code === property.code) return property
        return null
      },
    },
    roomType: {
      findFirst: async ({ where = {} } = {}) => roomTypes.find((roomType) => (
        (!where.propertyId || roomType.propertyId === where.propertyId)
        && (!where.code || roomType.code === where.code)
      )) || null,
    },
    reservation: {
      findFirst: async () => null,
      findUnique: async () => null,
    },
    reservationLog: {
      create: async ({ data }) => data,
    },
    auditLog: {
      create: async ({ data }) => {
        audits.push(data)
        return data
      },
    },
    bookingEmailSource: {
      findUnique: async ({ where }) => {
        if (where?.id) return sources.find((source) => source.id === where.id) || null
        if (where?.propertyId_mailbox) {
          return sources.find((source) => source.propertyId === where.propertyId_mailbox.propertyId && source.mailbox === where.propertyId_mailbox.mailbox) || null
        }
        return null
      },
      findFirst: async ({ where = {} } = {}) => sources.find((source) => (
        (!where.provider || source.provider === where.provider)
        && (where.enabled === undefined || source.enabled === where.enabled)
      )) || null,
      findMany: async ({ where = {}, orderBy = [] } = {}) => sortEvents(
        sources.filter((source) => (!where.propertyId || source.propertyId === where.propertyId)),
        orderBy,
      ),
      upsert: async ({ where, create, update }) => {
        const existing = await prisma.bookingEmailSource.findUnique({ where })
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date('2026-07-01T01:00:00.000Z') })
          return existing
        }
        const created = {
          id: create.id || `booking-source-${sources.length + 1}`,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          lastSyncCursor: null,
          lastError: null,
          credentialsRef: null,
          ...create,
        }
        sources.push(created)
        return created
      },
      update: async ({ where, data }) => {
        const source = sources.find((item) => item.id === where?.id)
        if (!source) return null
        Object.assign(source, data, { updatedAt: new Date('2026-07-01T01:00:00.000Z') })
        return source
      },
    },
    bookingEmailEvent: {
      findFirst: async ({ where = {}, orderBy = {} } = {}) => sortEvents(events.filter((event) => matchesEventWhere(event, where)), orderBy)[0] || null,
      findMany: async ({ where = {}, orderBy = [], take } = {}) => sortEvents(events.filter((event) => matchesEventWhere(event, where)), orderBy)
        .slice(0, take || events.length)
        .map(withEventRelations),
      findUnique: async ({ where }) => withEventRelations(events.find((event) => event.id === where?.id) || null),
      create: async ({ data }) => {
        const created = {
          id: `booking-event-${++eventCounter}`,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          processedAt: null,
          processedBy: null,
          rejectedAt: null,
          duplicateOfEventId: null,
          reservationId: null,
          ...data,
        }
        events.push(created)
        return withEventRelations(created)
      },
      upsert: async ({ where, create, update }) => {
        const existing = events.find((event) => (
          event.sourceId === where?.sourceId_sourceMessageId?.sourceId
          && event.sourceMessageId === where?.sourceId_sourceMessageId?.sourceMessageId
        ))
        if (!existing) return prisma.bookingEmailEvent.create({ data: create })
        Object.assign(existing, update, { updatedAt: new Date('2026-07-01T01:00:00.000Z') })
        return withEventRelations(existing)
      },
      update: async ({ where, data }) => {
        const event = events.find((item) => item.id === where?.id)
        if (!event) return null
        Object.assign(event, data, { updatedAt: new Date('2026-07-01T01:00:00.000Z') })
        return withEventRelations(event)
      },
      count: async ({ where = {} } = {}) => events.filter((event) => matchesEventWhere(event, where)).length,
    },
    $transaction: async (callback) => callback(prisma),
  }

  return { prisma, property, sources, events, audits }
}

async function importTypeScriptModule(path) {
  const source = await readFile(path, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
      isolatedModules: true,
    },
  }).outputText
  const output = transpiled
    .replaceAll("from './business-rules'", "from './business-rules.mjs'")
    .replaceAll("from './guards'", "from './guards.mjs'")
    .replaceAll("from '@/types/auth'", "from './auth.mjs'")
    .replaceAll("from '@/lib/hotel/business-rules'", "from './business-rules.mjs'")
    .replaceAll("from '@/lib/hotel/rooms'", "from './rooms.mjs'")
    .replaceAll("from '@/lib/front-desk-workflow'", "from './front-desk-workflow.mjs'")
    .replaceAll("from '@/lib/auth-mode'", "from './auth-mode.mjs'")
    .replaceAll("from '@/lib/server-auth-client'", "from './server-auth-client.mjs'")
  const tempDir = resolve('node_modules/.tmp/business-tests')
  await mkdir(tempDir, { recursive: true })
  const outputPath = resolve(tempDir, basename(path).replace(/\.(ts|tsx)$/, '.mjs'))
  await writeFile(outputPath, output, 'utf8')
  return import(`${pathToFileURL(outputPath).href}?t=${Date.now()}`)
}

const rules = await importTypeScriptModule(resolve('src/lib/hotel/business-rules.ts'))
const status = await importTypeScriptModule(resolve('src/lib/hotel/status.ts'))
await importTypeScriptModule(resolve('src/lib/hotel/rooms.ts'))
const operations = await importTypeScriptModule(resolve('src/lib/hotel/operations.ts'))
const workflow = await importTypeScriptModule(resolve('src/lib/front-desk-workflow.ts'))
await importTypeScriptModule(resolve('src/types/auth.ts'))
const assistantGuards = await importTypeScriptModule(resolve('src/lib/assistant/guards.ts'))
const assistantIntents = await importTypeScriptModule(resolve('src/lib/assistant/intents.ts'))
const assistantTools = await importTypeScriptModule(resolve('src/lib/assistant/tools.ts'))
const authMode = await importTypeScriptModule(resolve('src/lib/auth-mode.ts'))
const serverAuthClient = await importTypeScriptModule(resolve('src/lib/server-auth-client.ts'))
const hotelOpsIdempotency = await importTypeScriptModule(resolve('src/lib/hotel-ops-idempotency.ts'))
const durableAttemptKey = await importTypeScriptModule(resolve('src/lib/durable-attempt-key.ts'))
const bookingEmailCapabilities = await importTypeScriptModule(resolve('src/lib/booking-email-capabilities.ts'))
const bookingEmailWorkflow = await importTypeScriptModule(resolve('src/lib/booking-email-workflow.ts'))
const opsNotificationDisplay = await importTypeScriptModule(resolve('src/lib/ops-notification-display.ts'))
const ical = await importTypeScriptModule(resolve('src/lib/ical.ts'))
const durableAttemptKeySource = await readFile(resolve('src/lib/durable-attempt-key.ts'), 'utf8')
assert.equal(/(?:localStorage|sessionStorage)/.test(durableAttemptKeySource), false, 'server-mode attempt keys never use browser persistence')
const cashierAttemptSource = await readFile(resolve('src/components/views/CashierView.tsx'), 'utf8')
assert.match(
  cashierAttemptSource,
  /operation: 'cashier-charge'[\s\S]{0,1000}pmsApi\('\/api\/charges'[\s\S]{0,300}headers: \{ 'x-idempotency-key': idempotencyKey \}/,
  'Cashier charge submissions send the durable attempt key through the backend idempotency header contract',
)
for (const paymentSurface of [
  'src/components/front-desk/FrontDeskView.tsx',
  'src/components/views/ReservationsView.tsx',
  'src/components/board/Board.tsx',
]) {
  const source = await readFile(resolve(paymentSurface), 'utf8')
  assert.match(source, /operation: 'check-in-payment'/, `${paymentSurface} uses durable check-in payment attempts`)
  assert.match(source, /operation: 'check-out-payment'/, `${paymentSurface} uses durable check-out payment attempts`)
  assert.match(source, /durableAttemptKeys\.confirmSuccess/, `${paymentSurface} clears attempt keys only after confirmed success`)
}

const durableAttemptStorageRows = new Map()
const durableAttemptStorage = {
  getItem: (key) => durableAttemptStorageRows.get(key) ?? null,
  setItem: (key, value) => durableAttemptStorageRows.set(key, value),
  removeItem: (key) => durableAttemptStorageRows.delete(key),
}
let durableAttemptSequence = 0
const durableAttemptManager = new durableAttemptKey.DurableAttemptKeyManager({
  storage: durableAttemptStorage,
  randomId: () => `opaque-attempt-${++durableAttemptSequence}`,
})
const uncertainPaymentAttempt = {
  operation: 'cashier-payment',
  entityId: 'folio-sensitive-guest-123',
  material: {
    folioId: 'folio-sensitive-guest-123',
    amount: 1250,
    method: 'BANK_TRANSFER',
    reference: 'private-bank-reference-456',
    guestEmail: 'guest-private@example.test',
    password: 'must-never-be-persisted',
  },
}
const uncertainPaymentKey = await durableAttemptManager.getOrCreate(uncertainPaymentAttempt)
assert.equal(
  await durableAttemptManager.getOrCreate(uncertainPaymentAttempt),
  uncertainPaymentKey,
  'identical uncertain payment retries reuse the same durable attempt key',
)
assert.equal(
  await durableAttemptManager.getOrCreate({
    ...uncertainPaymentAttempt,
    material: {
      password: uncertainPaymentAttempt.material.password,
      guestEmail: uncertainPaymentAttempt.material.guestEmail,
      reference: uncertainPaymentAttempt.material.reference,
      method: uncertainPaymentAttempt.material.method,
      amount: uncertainPaymentAttempt.material.amount,
      folioId: uncertainPaymentAttempt.material.folioId,
    },
  }),
  uncertainPaymentKey,
  'material fingerprinting is stable across harmless object key ordering differences',
)
const persistedAttemptEvidence = JSON.stringify([...durableAttemptStorageRows.entries()])
for (const forbiddenValue of [
  uncertainPaymentAttempt.entityId,
  uncertainPaymentAttempt.material.reference,
  uncertainPaymentAttempt.material.guestEmail,
  uncertainPaymentAttempt.material.password,
]) {
  assert.equal(persistedAttemptEvidence.includes(forbiddenValue), false, 'attempt-key storage persists no credentials, PII, references, or raw entity identifiers')
}
assert.match(uncertainPaymentKey, /^pms-cashier-payment:opaque-attempt-\d+$/, 'attempt keys contain only an allowlisted operation and opaque nonce')

const changedPaymentAttempt = {
  ...uncertainPaymentAttempt,
  material: { ...uncertainPaymentAttempt.material, amount: 1300 },
}
const changedPaymentKey = await durableAttemptManager.getOrCreate(changedPaymentAttempt)
assert.notEqual(changedPaymentKey, uncertainPaymentKey, 'material payment input changes rotate the attempt key')
await durableAttemptManager.confirmSuccess(uncertainPaymentAttempt)
assert.equal(
  await durableAttemptManager.getOrCreate(changedPaymentAttempt),
  changedPaymentKey,
  'confirmation for an older fingerprint cannot clear a newer material attempt',
)
await durableAttemptManager.confirmSuccess(changedPaymentAttempt)
assert.notEqual(
  await durableAttemptManager.getOrCreate(changedPaymentAttempt),
  changedPaymentKey,
  'confirmed payment success clears the durable attempt key before a future submission',
)
await assert.rejects(
  durableAttemptManager.getOrCreate({
    operation: 'guest-private@example.test',
    entityId: 'folio-1',
    material: { amount: 100 },
  }),
  /Unsupported attempt operation/,
  'attempt-key storage rejects non-allowlisted operation labels that could contain PII',
)

assert.equal(rules.nightsBetween('2026-05-26', '2026-05-29'), 3, 'counts hotel nights with check-out exclusive')
assert.equal(rules.nightsBetween('2026-05-26', '2026-05-26'), 0, 'rejects zero-night stays')
assert.equal(rules.nightsBetween('2026-05-29', '2026-05-26'), 0, 'rejects negative stay ranges')
assert.equal(rules.getBangkokDateKey('2026-05-26T18:00:00.000Z'), '2026-05-27', 'hotel date keys use Asia/Bangkok')

assert.equal(
  rules.reservationsOverlap('2026-05-26', '2026-05-28', '2026-05-28', '2026-05-30'),
  false,
  'same-day check-out/check-in does not overbook',
)
assert.equal(
  rules.reservationsOverlap('2026-05-26', '2026-05-29', '2026-05-28', '2026-05-30'),
  true,
  'overlapping stay dates are detected',
)

const pricing = rules.calculateStayPricing({
  checkIn: '2026-05-26',
  checkOut: '2026-05-29',
  ratePerNight: 1000,
  adults: 3,
  childAges: [4, 8],
})
assert.equal(pricing.nights, 3)
assert.equal(pricing.roomSubtotal, 3000)
assert.equal(pricing.extraGuestFee, 900)
assert.equal(pricing.childFee, 900)
assert.equal(pricing.total, 4800)
assert.equal(pricing.taxInclusive, false)
assert.equal(pricing.isValidOccupancy, false, '3 adults plus 2 children exceeds max occupancy')

const childPricing = rules.calculateStayPricing({
  checkIn: '2026-05-26',
  checkOut: '2026-05-28',
  ratePerNight: 1500,
  adults: 2,
  childAges: [5, 8],
})
assert.equal(childPricing.childFee, 600, 'children 6-11 sharing bedding are charged per night')
assert.equal(childPricing.extraGuestFee, 0, 'child sharing fee does not double-charge as adult extra guest fee')

const invalidPricing = rules.calculateStayPricing({
  checkIn: '2026-05-26',
  checkOut: '2026-05-28',
  ratePerNight: -100,
  adults: 0,
  childAges: [-1],
})
assert.equal(invalidPricing.roomSubtotal, 0)
assert.equal(invalidPricing.warnings.includes('At least one adult is required.'), true)
assert.equal(invalidPricing.warnings.includes('Rate per night cannot be negative.'), true)

assert.deepEqual(
  rules.getRoomAssignmentDecision(
    {
      number: '201',
      status: 'VACANT_CLEAN',
      operationalStatus: 'AVAILABLE',
    },
    { checkIn: '2026-05-26', checkOut: '2026-05-27' },
  ),
  { assignable: true, reason: 'assignable' },
)

assert.deepEqual(
  rules.getRoomAssignmentDecision(
    {
      number: '201',
      status: 'OCCUPIED_CLEAN',
      operationalStatus: 'AVAILABLE',
      reservationId: 'res-1',
      checkIn: '2026-05-26',
      checkOut: '2026-05-29',
    },
    { checkIn: '2026-05-28', checkOut: '2026-05-30' },
  ),
  { assignable: false, reason: 'occupied' },
)

assert.deepEqual(
  rules.getRoomAssignmentDecision(
    {
      number: '216',
      status: 'VACANT_CLEAN',
      operationalStatus: 'OUT_OF_SERVICE',
    },
    { checkIn: '2026-05-26', checkOut: '2026-05-27' },
  ),
  { assignable: false, reason: 'out_of_order' },
)

const reservation = {
  id: 'res-1',
  status: 'CONFIRMED',
  guestName: 'Somchai Prasert',
  checkIn: '2026-05-26',
  checkOut: '2026-05-28',
  assignedRoomId: 'room-201',
  roomNumber: '201',
  totalAmount: 3000,
  paidAmount: 1000,
}

const room = {
  roomId: 'room-201',
  number: '201',
  status: 'VACANT_CLEAN',
  operationalStatus: 'AVAILABLE',
  cleanStatus: 'INSPECTED',
}

assert.equal(operations.validateRoomAssignment(reservation, room).ok, true, 'room assignment allows clean inspected sellable rooms')
assert.equal(
  operations.validateRoomAssignment(reservation, { ...room, number: '216', operationalStatus: 'OUT_OF_SERVICE' }).message,
  'Room 216 is out of order and cannot be assigned.',
  'room assignment blocks out-of-service rooms',
)
assert.equal(
  operations.validateCheckIn(reservation, room, { now: '2026-05-25T18:30:00.000Z' }).ok,
  true,
  'check-in date validation uses the Thailand hotel date',
)

const checkIn = operations.applyCheckInTransition(reservation, room, 'Front desk', '2026-05-26T08:00:00.000Z')
assert.equal(checkIn.reservation.status, 'CHECKED_IN')
assert.equal(checkIn.room.status, 'OCCUPIED_CLEAN')
assert.equal(checkIn.room.reservationId, 'res-1')

assert.equal(
  operations.validateCheckOut({ ...checkIn.reservation, balanceDue: 200 }).message,
  'Collect or override the remaining balance before checkout.',
  'checkout requires settlement or override when a balance remains',
)

const checkOut = operations.applyCheckOutTransition({ ...checkIn.reservation, balanceDue: 0 }, checkIn.room)
assert.equal(checkOut.reservation.status, 'CHECKED_OUT')
assert.equal(checkOut.room.status, 'VACANT_DIRTY')
assert.equal(checkOut.room.cleanStatus, 'DIRTY')
assert.equal(checkOut.room.reservationId, undefined)

const cleaning = operations.transitionHousekeepingStatus(checkOut.room, 'CLEANING')
assert.equal(cleaning.room.cleanStatus, 'CLEANING')
assert.equal(cleaning.room.status, 'VACANT_DIRTY')
const inspected = operations.transitionHousekeepingStatus(cleaning.room, 'INSPECTED')
assert.equal(inspected.room.cleanStatus, 'INSPECTED')
assert.equal(inspected.room.status, 'VACANT_CLEAN')

const paymentSummary = operations.summarizePayments(1000.1 + 0.2, [500.15, 500.15])
assert.equal(paymentSummary.total, 1000.3)
assert.equal(paymentSummary.paid, 1000.3)
assert.equal(paymentSummary.status, 'paid')
assert.equal(operations.validatePaymentAmount(1200, 1000).message, 'Payment cannot exceed the remaining balance.')

const readyArrival = {
  id: 'arrival-ready',
  reservationId: 'res-ready',
  confirmationCode: 'SBX-READY',
  guestName: 'Ready Guest',
  roomNumber: '201',
  assignedRoomId: 'room-201',
  roomType: 'TWIN',
  checkInTime: '14:00',
  arrivalTime: '14:00',
  checkInDate: '2026-05-26',
  checkOutDate: '2026-05-28',
  nights: 2,
  adults: 2,
  children: 0,
  status: 'READY',
  reservationStatus: 'CONFIRMED',
  roomReady: true,
  depositPaid: true,
  documentVerified: true,
  guestNationality: 'Thai',
  guestIdNumber: '123456789',
  source: 'DIRECT',
  bookedRate: 1500,
  totalAmount: 3000,
  paidAmount: 3000,
  balanceDue: 0,
  paymentStatus: 'PAID',
}

const readyRoom = {
  roomId: 'room-201',
  number: '201',
  floor: 2,
  type: 'TWIN',
  status: 'VACANT_CLEAN',
  operationalStatus: 'AVAILABLE',
  isArrivalToday: true,
  isDepartureToday: false,
  isVIP: false,
  hasIssue: false,
  needsAttention: false,
  cleanStatus: 'INSPECTED',
  depositStatus: 'PAID',
}

const expressCheckIn = workflow.buildCheckInGuards(readyArrival, readyRoom, { hotelDateKey: '2026-05-26', role: 'front-desk' })
assert.equal(expressCheckIn.isExpressReady, true, 'prepared arrival is express check-in ready')
assert.equal(workflow.getArrivalPrimaryAction(expressCheckIn, readyArrival).label, 'Express Check-In')

const noRoomArrival = { ...readyArrival, assignedRoomId: undefined, roomNumber: undefined }
const noRoomCheckIn = workflow.buildCheckInGuards(noRoomArrival, undefined, { hotelDateKey: '2026-05-26' })
assert.equal(noRoomCheckIn.blockers.some((item) => item.id === 'no_room_assigned'), true, 'check-in is blocked without assigned room')
assert.equal(workflow.getArrivalPrimaryAction(noRoomCheckIn, noRoomArrival).label, 'Assign Room')

const dirtyCheckIn = workflow.buildCheckInGuards({ ...readyArrival, roomReady: false }, { ...readyRoom, status: 'VACANT_DIRTY', cleanStatus: 'DIRTY' }, { hotelDateKey: '2026-05-26' })
assert.equal(dirtyCheckIn.blockers.some((item) => item.id === 'room_not_ready'), true, 'dirty room blocks check-in')

const occupiedCheckIn = workflow.buildCheckInGuards(readyArrival, { ...readyRoom, status: 'OCCUPIED_CLEAN', currentReservationId: 'other-res' }, { hotelDateKey: '2026-05-26' })
assert.equal(occupiedCheckIn.blockers.some((item) => item.id === 'room_occupied'), true, 'occupied room blocks check-in')

const overCapacityCheckIn = workflow.buildCheckInGuards({ ...readyArrival, adults: 4, children: 1 }, readyRoom, { hotelDateKey: '2026-05-26' })
assert.equal(overCapacityCheckIn.blockers.some((item) => item.id === 'occupancy_exceeds_max'), true, 'over-capacity arrivals are blocked')

const paymentDueArrival = { ...readyArrival, balanceDue: 1000, paidAmount: 2000, paymentStatus: 'PARTIAL' }
const paymentDueCheckIn = workflow.buildCheckInGuards(paymentDueArrival, readyRoom, { hotelDateKey: '2026-05-26' })
assert.equal(paymentDueCheckIn.blockers.some((item) => item.id === 'payment_due'), true, 'payment due blocks express check-in')
assert.equal(workflow.getArrivalPrimaryAction(paymentDueCheckIn, paymentDueArrival).label, 'Collect Payment')

const outOfServiceCheckIn = workflow.buildCheckInGuards({ ...readyArrival, roomNumber: '216', assignedRoomId: 'room-216' }, { ...readyRoom, roomId: 'room-216', number: '216', operationalStatus: 'OUT_OF_SERVICE' }, { hotelDateKey: '2026-05-26' })
assert.equal(outOfServiceCheckIn.blockers.some((item) => item.id === 'room_out_of_order'), true, 'out-of-service rooms are blocked')

const departure = {
  id: 'dep-ready',
  reservationId: 'res-ready',
  confirmationCode: 'SBX-READY',
  guestName: 'Ready Guest',
  roomNumber: '201',
  assignedRoomId: 'room-201',
  roomType: 'TWIN',
  checkOutTime: '12:00',
  checkInDate: '2026-05-26',
  checkOutDate: '2026-05-28',
  nights: 2,
  status: 'IN_HOUSE',
  reservationStatus: 'CHECKED_IN',
  balanceDue: 0,
  paidAmount: 3000,
  folioTotal: 3000,
  folioStatus: 'CLOSED',
  paymentStatus: 'PAID',
  roomStatus: 'CLEAN',
}

const expressCheckOut = workflow.buildCheckOutGuards(departure, { hotelDateKey: '2026-05-28', now: new Date('2026-05-28T03:00:00.000Z') })
assert.equal(expressCheckOut.isExpressReady, true, 'settled departure is express checkout ready before standard checkout time')
assert.equal(workflow.getDeparturePrimaryAction(expressCheckOut, departure).label, 'Express Check-Out')

const balanceDeparture = { ...departure, balanceDue: 750, paymentStatus: 'PARTIAL' }
const balanceCheckout = workflow.buildCheckOutGuards(balanceDeparture, { hotelDateKey: '2026-05-28', now: new Date('2026-05-28T03:00:00.000Z') })
assert.equal(balanceCheckout.blockers.some((item) => item.id === 'unsettled_balance'), true, 'checkout is blocked by outstanding balance')
assert.equal(workflow.getDeparturePrimaryAction(balanceCheckout, balanceDeparture).label, 'Settle Balance')

const duplicateCheckout = workflow.buildCheckOutGuards({ ...departure, status: 'CHECKED_OUT', reservationStatus: 'CHECKED_OUT' }, { hotelDateKey: '2026-05-28' })
assert.equal(duplicateCheckout.blockers.some((item) => item.id === 'already_checked_out'), true, 'duplicate checkout is blocked')

const readinessSummary = workflow.buildRoomReadinessSummary([
  readyRoom,
  { ...readyRoom, roomId: 'room-202', number: '202', cleanStatus: 'DIRTY', status: 'VACANT_DIRTY' },
  { ...readyRoom, roomId: 'room-203', number: '203', status: 'OCCUPIED_CLEAN', currentReservationId: 'res-203' },
  { ...readyRoom, roomId: 'room-216', number: '216', operationalStatus: 'OUT_OF_SERVICE' },
])
assert.equal(readinessSummary.cleanInspected, 1, 'readiness strip counts ready rooms')
assert.equal(readinessSummary.dirty, 1, 'readiness strip counts dirty rooms')
assert.equal(readinessSummary.occupied, 1, 'readiness strip counts occupied rooms')
assert.equal(readinessSummary.outOfOrder, 1, 'readiness strip counts out-of-service rooms')

assert.equal(status.getStatusDefinition('room', 'VACANT_DIRTY').label.th, 'รอทำความสะอาด')
assert.equal(status.getStatusDefinition('payment', 'PAID').label.en, 'Paid')
assert.equal(status.getStatusDefinition('reservation', 'NO_SHOW').label.th, 'ไม่มาเข้าพัก')
assert.equal(status.getStatusDefinition('room', 'BLOCKED').label.th, 'ปิดใช้งาน')

assert.equal(authMode.SERVER_AUTH_ENABLED, false, 'test environment does not enable server auth by default')
assert.equal(authMode.LOCAL_AUTH_FALLBACK_ENABLED, false, 'test environment does not enable local auth fallback by default')

const mappedUser = serverAuthClient.mapServerUser({
  id: 'user-1',
  email: 'frontdesk@property.test',
  username: 'frontdesk@property.test',
  role: 'FRONT_DESK',
  displayName: 'Front Desk',
})
assert.equal(mappedUser.email, 'frontdesk@property.test', 'server auth users are email-based')
assert.equal(mappedUser.role, 'front-desk', 'server auth users map backend roles to UI roles')

const mappedUsernameOnlyUser = serverAuthClient.mapServerUser({
  id: 'user-2',
  email: null,
  username: 'hk1',
  role: 'HOUSEKEEPING',
  displayName: 'Housekeeper 1',
})
assert.equal(mappedUsernameOnlyUser.email, null, 'server auth users can omit email')
assert.equal(mappedUsernameOnlyUser.username, 'hk1', 'server auth users use username as login identifier')
assert.equal(mappedUsernameOnlyUser.role, 'housekeeping', 'username-only server auth users map backend roles')

function userCreationPrismaFixture({ expectedUsername, userId, audits }) {
  const prisma = {
    property: { findUnique: async () => ({ id: 'property-1', code: 'SANDBOX' }) },
    user: {
      findFirst: async (query) => {
        assert.deepEqual(query.where.OR, [{ username: expectedUsername }], 'username-only user duplicate check does not require email')
        return null
      },
      create: async ({ data }) => ({ id: userId, createdAt: new Date('2026-06-30T00:00:00.000Z'), ...data }),
    },
    userPropertyMembership: { create: async ({ data }) => data },
    auditLog: { create: async ({ data }) => { audits.push(data); return data } },
    domainEvent: { create: async ({ data }) => ({ id: 1n, createdAt: new Date(), ...data }) },
    $transaction: async (callback) => callback(prisma),
  }
  return prisma
}

const createdAudits = []
const usernameOnlyUser = await createUser(userCreationPrismaFixture({
  expectedUsername: 'hk2',
  userId: 'user-hk2',
  audits: createdAudits,
}), {
  username: 'hk2',
  email: '',
  password: 'Temporary1234!',
  displayName: 'Housekeeper 2',
  role: 'housekeeping',
}, { id: 'admin-1', username: 'admin' })
assert.equal(usernameOnlyUser.username, 'hk2', 'admin can create a username-only server user')
assert.equal(usernameOnlyUser.email, null, 'username-only server user stores null email')
assert.equal(usernameOnlyUser.role, 'HOUSEKEEPING', 'username-only server user role normalizes to backend enum')
assert.equal(createdAudits[0]?.action, 'USER_CREATED', 'username-only server user creation is audited')

const nullEmailUserAudits = []
const nullEmailUser = await createUser(userCreationPrismaFixture({
  expectedUsername: 'fd3',
  userId: 'user-fd3',
  audits: nullEmailUserAudits,
}), {
  username: 'fd3',
  email: null,
  password: 'Temporary1234!',
  displayName: 'Front Desk 3',
  role: 'front-desk',
}, { id: 'admin-1', username: 'admin' })
assert.equal(nullEmailUser.username, 'fd3', 'admin UI null-email payload creates a username-only server user')
assert.equal(nullEmailUser.email, null, 'null-email server user stores null email')
assert.equal(nullEmailUser.role, 'FRONT_DESK', 'null-email server user role normalizes to backend enum')
assert.equal(nullEmailUserAudits[0]?.action, 'USER_CREATED', 'null-email server user creation is audited')

const lockoutUser = {
  id: 'lockout-user',
  username: 'frontdesk',
  email: null,
  passwordHash: createPasswordHash('ValidPassword123!'),
  firstName: 'Front',
  lastName: 'Desk',
  role: 'FRONT_DESK',
  active: true,
  failedLoginAttempts: 0,
  lockedAt: null,
}
const lockoutPrisma = {
  user: {
    findFirst: async () => ({ ...lockoutUser }),
    update: async ({ data }) => {
      Object.assign(lockoutUser, data)
      return { ...lockoutUser }
    },
  },
}
assert.equal(await authenticateUser(lockoutPrisma, 'frontdesk', 'wrong-password-1'), null, 'first failed login does not lock the account')
assert.equal(lockoutUser.failedLoginAttempts, 1, 'failed login attempt is recorded')
assert.equal(await authenticateUser(lockoutPrisma, 'frontdesk', 'wrong-password-2'), null, 'second failed login does not lock the account')
await assert.rejects(
  () => authenticateUser(lockoutPrisma, 'frontdesk', 'wrong-password-3'),
  /Account is locked/,
  'third failed login locks the account for admin reset',
)
assert.ok(lockoutUser.lockedAt instanceof Date, 'locked account records lock timestamp')
lockoutUser.lockedAt = null
lockoutUser.failedLoginAttempts = 2
const authenticatedLockoutUser = await authenticateUser(lockoutPrisma, 'frontdesk', 'ValidPassword123!')
assert.equal(authenticatedLockoutUser.username, 'frontdesk', 'successful login still works after admin clears lock')
assert.equal(lockoutUser.failedLoginAttempts, 0, 'successful login clears failed attempts')

assert.equal(maskLoginIdentifier('manager@example.com'), 'm******@e***.com', 'auth proof masks email login identifiers')
assert.equal(maskLoginIdentifier('hk1'), 'h***', 'auth proof masks username login identifiers')
assert.equal(normalizeProofHost('https://book.sandboxhotel.com/protected?x=1'), 'https://book.sandboxhotel.com', 'auth proof normalizes production proof host')
assert.equal(normalizeProofHost('http://localhost:5000'), 'http://localhost:5000', 'auth proof allows local development hosts')
assert.throws(
  () => normalizeProofHost('http://book.sandboxhotel.com'),
  /must use https/,
  'auth proof rejects non-https production hosts',
)
assert.deepEqual(
  summarizePublicUserForProof({
    username: 'frontdesk@example.com',
    email: 'frontdesk@example.com',
    displayName: 'Front Desk',
    role: 'front-desk',
    active: true,
  }),
  {
    loginIdentifierMasked: 'f********@e***.com',
    emailPresent: true,
    displayInitials: 'FD',
    role: 'FRONT-DESK',
    active: true,
  },
  'auth proof summarizes public user payload without exposing identifiers',
)
assert.deepEqual(
  validateDenialProbe({ method: 'GET', path: '/api/users', expectStatus: 403 }),
  {
    label: 'GET /api/users',
    method: 'GET',
    path: '/api/users',
    expectStatuses: [403],
    body: undefined,
  },
  'auth proof allows safe GET denial probes',
)
assert.throws(
  () => validateDenialProbe({ method: 'POST', path: '/api/payments', expectStatus: 403 }),
  /not allowed/,
  'auth proof blocks mutating denial probes unless explicitly enabled',
)
assert.throws(
  () => validateDenialProbe({ method: 'GET', path: '/api/users', expectStatus: 200 }),
  /only 401 or 403/,
  'auth proof denial probes can only expect denial statuses',
)

const cloudflareWafRulesetSummary = summarizeRuleset({
  id: 'ruleset-fixture',
  name: 'Sandbox WAF fixture',
  kind: 'zone',
  phase: 'http_ratelimit',
  version: '1',
  rules: [
    {
      id: 'rule-rate-fixture',
      description: 'Protect booking API',
      enabled: true,
      action: 'block',
      expression: '(http.host eq "book.sandboxhotel.com" and starts_with(http.request.uri.path, "/api/"))',
      ratelimit: {
        period: 60,
        requests_per_period: 100,
        mitigation_timeout: 600,
        characteristics: ['cf.colo.id', 'ip.src'],
      },
      action_parameters: { response: { content: 'fixture body that must not be printed' } },
    },
    {
      id: 'rule-challenge-fixture',
      enabled: false,
      action: 'managed_challenge',
      expression: '(http.request.uri.path contains "/admin")',
    },
  ],
}, { targetHostname: 'book.sandboxhotel.com' })
assert.equal(cloudflareWafRulesetSummary.rulesCount, 2, 'Cloudflare WAF proof summarizes ruleset rule count')
assert.equal(cloudflareWafRulesetSummary.enabledRulesCount, 1, 'Cloudflare WAF proof summarizes enabled rules')
assert.equal(cloudflareWafRulesetSummary.targetHostnameCoveredRules, 2, 'Cloudflare WAF proof treats explicit host and unscoped zone rule as target coverage')
assert.equal(cloudflareWafRulesetSummary.rules[0].ratelimit.requestsPerPeriod, 100, 'Cloudflare WAF proof summarizes rate-limit thresholds')
assert.equal(cloudflareWafRulesetSummary.rules[0].expression, 'omitted', 'Cloudflare WAF proof omits rule expressions by default')
assert.equal(cloudflareWafRulesetSummary.rules[0].actionParameters, 'omitted', 'Cloudflare WAF proof omits action parameters')
assert.equal(JSON.stringify(cloudflareWafRulesetSummary).includes('fixture body'), false, 'Cloudflare WAF proof does not include custom response body values')
assert.deepEqual(
  zoneNameCandidates('book.sandboxhotel.com'),
  ['book.sandboxhotel.com', 'sandboxhotel.com'],
  'Cloudflare WAF proof can discover parent zone names from a protected hostname',
)

const cloudflareJsonResponse = (status, payload) => new Response(JSON.stringify(payload), {
  status,
  headers: {
    'content-type': 'application/json',
  },
})
const runWithMockedCloudflareFetch = async (fetchImpl, callback) => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = fetchImpl
  try {
    return await callback()
  } finally {
    globalThis.fetch = previousFetch
  }
}

const cloudflareAccountInspectionFailureProof = await runWithMockedCloudflareFetch(async (url) => {
  const normalized = String(url).replace('https://api.cloudflare.com/client/v4', '')
  if (normalized === '/zones/zone-account-fixture') {
    return cloudflareJsonResponse(200, { result: { id: 'zone-account-fixture', name: 'book.sandboxhotel.com', status: 'active' } })
  }
  if (normalized === '/zones/zone-account-fixture/rulesets') {
    return cloudflareJsonResponse(200, {
      result: [{ id: 'zone-level-ruleset', phase: 'http_ratelimit' }],
    })
  }
  if (normalized === '/zones/zone-account-fixture/rulesets/zone-level-ruleset') {
    return cloudflareJsonResponse(200, {
      result: {
        id: 'zone-level-ruleset',
        name: 'zone-level-ruleset',
        phase: 'http_ratelimit',
        rules: [
          {
            id: 'zone-level-rule',
            ref: 'sandbox_pms_login_rate_limit',
            action: 'block',
            enabled: true,
            expression: '(http.host eq "book.sandboxhotel.com" and http.request.method eq "POST" and http.request.uri.path eq "/api/auth/login")',
            ratelimit: {
              period: 10,
              requests_per_period: 10,
              mitigation_timeout: 10,
              characteristics: ['cf.colo.id', 'ip.src'],
            },
          },
        ],
      },
    })
  }
  if (normalized === '/accounts/account-fixture/rulesets') {
    return cloudflareJsonResponse(403, { success: false, errors: [{ message: 'forbidden' }] })
  }
  return cloudflareJsonResponse(404, { success: false, errors: [{ message: 'unexpected fixture path' }] })
}, async () => buildCloudflareWafProof({
  token: 'token-fixture',
  targetZoneId: 'zone-account-fixture',
  targetAccountId: 'account-fixture',
  targetAccountInspectionRequested: true,
  targetHostname: 'book.sandboxhotel.com',
}))
assert.equal(cloudflareAccountInspectionFailureProof.summary.requireOwnerReview, true, 'Cloudflare WAF proof flags owner review when requested account inspection fails')
assert.equal(cloudflareAccountInspectionFailureProof.target.account.requested, true, 'Cloudflare WAF proof tracks requested account inspection in target.account.requested')
assert.equal(cloudflareAccountInspectionFailureProof.target.account.inspected, false, 'Cloudflare WAF proof tracks failed account inspection state as not inspected')
assert.equal(cloudflareAccountInspectionFailureProof.summary.accountInspectionRequested, true, 'Cloudflare WAF proof summary tracks requested account inspection state')
assert.equal(cloudflareAccountInspectionFailureProof.summary.accountInspectionInspected, false, 'Cloudflare WAF proof summary tracks inspected state for account-level rulesets')
assert.throws(
  () => assertCloudflareWafProofRequirements({ proof: cloudflareAccountInspectionFailureProof }),
  /Account-level inspection was requested but could not be completed/,
  'Cloudflare WAF proof requires owner review and --require-rules throws on requested account inspection failure',
)
assert.equal(cloudflareAccountInspectionFailureProof.summary.loginRateLimitRulesCount, 1, 'Cloudflare WAF proof counts an enabled login rate-limit rule')
assert.equal(cloudflareAccountInspectionFailureProof.summary.targetHostnameCoveredLoginRateLimitRules, 1, 'Cloudflare WAF proof counts login rate-limit hostname coverage')
assert.equal(isCloudflareWafProofReady({
  ...cloudflareAccountInspectionFailureProof.summary,
  accountInspectionRequested: false,
  accountInspectionInspected: false,
}), true, 'Cloudflare WAF proof is ready when an enabled login rate-limit rule covers the target hostname')

const cloudflareUnrelatedWafOnlyProof = await runWithMockedCloudflareFetch(async (url) => {
  const normalized = String(url).replace('https://api.cloudflare.com/client/v4', '')
  if (normalized === '/zones/zone-unrelated-waf-fixture') {
    return cloudflareJsonResponse(200, { result: { id: 'zone-unrelated-waf-fixture', name: 'book.sandboxhotel.com', status: 'active' } })
  }
  if (normalized === '/zones/zone-unrelated-waf-fixture/rulesets') {
    return cloudflareJsonResponse(200, {
      result: [{ id: 'unrelated-waf-ruleset', phase: 'http_request_firewall_custom' }],
    })
  }
  if (normalized === '/zones/zone-unrelated-waf-fixture/rulesets/unrelated-waf-ruleset') {
    return cloudflareJsonResponse(200, {
      result: {
        id: 'unrelated-waf-ruleset',
        name: 'Unrelated hostname-covered WAF rule',
        phase: 'http_request_firewall_custom',
        rules: [
          {
            id: 'unrelated-waf-rule',
            ref: 'sandbox_pms_common_probe_block',
            action: 'block',
            enabled: true,
            expression: '(http.host eq "book.sandboxhotel.com" and http.request.uri.path eq "/.env")',
          },
        ],
      },
    })
  }
  return cloudflareJsonResponse(404, { success: false, errors: [{ message: 'unexpected fixture path' }] })
}, async () => buildCloudflareWafProof({
  token: 'token-fixture',
  targetZoneId: 'zone-unrelated-waf-fixture',
  targetHostname: 'book.sandboxhotel.com',
}))
assert.equal(cloudflareUnrelatedWafOnlyProof.summary.rulesCount, 1, 'Cloudflare WAF proof sees unrelated WAF rules')
assert.equal(cloudflareUnrelatedWafOnlyProof.summary.targetHostnameCoveredRules, 1, 'Cloudflare WAF proof sees unrelated hostname coverage')
assert.equal(cloudflareUnrelatedWafOnlyProof.summary.loginRateLimitRulesCount, 0, 'Cloudflare WAF proof does not mistake unrelated WAF coverage for a login rate-limit rule')
assert.equal(cloudflareUnrelatedWafOnlyProof.summary.targetHostnameCoveredLoginRateLimitRules, 0, 'Cloudflare WAF proof reports zero required login rate-limit hostname coverage')
assert.equal(cloudflareUnrelatedWafOnlyProof.summary.requireOwnerReview, true, 'Cloudflare WAF proof remains incomplete without the required login rate-limit rule')
assert.throws(
  () => assertCloudflareWafProofRequirements({ proof: cloudflareUnrelatedWafOnlyProof }),
  /enabled login rate-limit rule covering the required hostname was not found/,
  'Cloudflare WAF --require-rules fails when only unrelated hostname-covered WAF rules exist',
)
assert.throws(
  () => assertCloudflareWafProofRequirements({
    proof: {
      ...cloudflareUnrelatedWafOnlyProof,
      summary: { ...cloudflareUnrelatedWafOnlyProof.summary, requireOwnerReview: false },
    },
  }),
  /enabled login rate-limit rule covering the required hostname was not found/,
  'Cloudflare WAF --require-rules independently enforces login rate-limit count and coverage',
)

const cloudflareEnsureAmbiguousDescriptionLog = []
const cloudflareEnsureAmbiguousDescription = await runWithMockedCloudflareFetch(async (url, init = {}) => {
  const method = init.method || 'GET'
  const normalized = String(url).replace('https://api.cloudflare.com/client/v4', '')
  cloudflareEnsureAmbiguousDescriptionLog.push({ method, path: normalized })
  if (normalized === '/zones/zone-ensure-fixture') {
    return cloudflareJsonResponse(200, {
      result: {
        id: 'zone-ensure-fixture',
        name: 'book.sandboxhotel.com',
        status: 'active',
      },
    })
  }
  if (normalized === '/zones/zone-ensure-fixture/rulesets/phases/http_request_firewall_custom/entrypoint') {
    return cloudflareJsonResponse(200, {
      result: {
        id: 'entrypoint-custom',
        phase: 'http_request_firewall_custom',
        name: 'custom-firewall',
        rules: [
          {
            id: 'custom-ambiguous-a',
            ref: 'other-rule-a',
            description: 'Sandbox PMS common probe block',
            expression: '(http.host eq "book.sandboxhotel.com" and starts_with(http.request.uri.path, "/blocked"))',
            enabled: true,
            action: 'block',
          },
          {
            id: 'custom-ambiguous-b',
            ref: 'other-rule-b',
            description: 'Sandbox PMS common probe block',
            expression: '(http.host eq "book.sandboxhotel.com" and starts_with(http.request.uri.path, "/legacy"))',
            enabled: true,
            action: 'block',
          },
        ],
      },
    })
  }
  if (normalized === '/zones/zone-ensure-fixture/rulesets/phases/http_ratelimit/entrypoint') {
    return cloudflareJsonResponse(200, {
      result: {
        id: 'entrypoint-ratelimit',
        phase: 'http_ratelimit',
        name: 'ratelimits',
        rules: [
          {
            id: 'rate-limit-existing',
            ref: 'sandbox_pms_login_rate_limit',
            description: 'Sandbox PMS login rate limit',
            expression: '(http.host in {"book.sandboxhotel.com"} and http.request.method eq "POST" and http.request.uri.path eq "/api/auth/login")',
            enabled: true,
            action: 'block',
            ratelimit: {
              period: 10,
              requests_per_period: 10,
              mitigation_timeout: 10,
              characteristics: ['ip.src', 'cf.colo.id'],
              action_parameters: { response: { content: 'fixture body' } },
              extra_provider_metadata: 'ignored',
            },
          },
        ],
      },
    })
  }
  return cloudflareJsonResponse(404, { success: false, errors: [{ message: 'unexpected fixture path' }] })
}, async () => ensureSandboxCloudflareWafRules({
  token: 'token-fixture',
  targetZoneId: 'zone-ensure-fixture',
  dryRun: false,
  hostnames: ['book.sandboxhotel.com'],
}))
const ambiguousCommonRuleResult = cloudflareEnsureAmbiguousDescription.results.find((result) => result.ruleRef === 'sandbox_pms_common_probe_block')
assert.equal(ambiguousCommonRuleResult.operation, 'blocked-ambiguous-description-match', 'Cloudflare WAF ensure blocks ambiguous description-only matches')
assert.equal(ambiguousCommonRuleResult.ruleId, null, 'Cloudflare WAF ensure does not mutate when description is ambiguous')
assert.equal(ambiguousCommonRuleResult.blockReason, 'multiple rules matched description "Sandbox PMS common probe block"', 'Cloudflare WAF ensure explains ambiguous-description block reason')
const loginRateLimitResult = cloudflareEnsureAmbiguousDescription.results.find((result) => result.ruleRef === 'sandbox_pms_login_rate_limit')
assert.equal(loginRateLimitResult.operation, 'unchanged', 'Cloudflare WAF ensure treats reordered ratelimit characteristics and extra metadata as unchanged')
assert.equal(cloudflareEnsureAmbiguousDescription.ready, false, 'Cloudflare WAF ensure blocks ready when ambiguous-description rule matching is non-mutating')
assert.equal(
  cloudflareEnsureAmbiguousDescriptionLog.every((entry) => entry.method === 'GET'),
  true,
  'Cloudflare WAF ensure performs no write requests when ambiguous matches force a block operation',
)

const cloudflareEnvFixture = parseCloudflareEnvFileContent(`
# local fixture
CLOUDFLARE_API_TOKEN="token-fixture"
IGNORED_KEY=ignored
CF_ZONE_ID=zone-fixture
CLOUDFLARE_ACCOUNT_ID=account-fixture
`)
assert.equal(cloudflareEnvFixture.parsed.CLOUDFLARE_API_TOKEN, 'token-fixture', 'Cloudflare WAF proof parses allowed local env keys')
assert.equal(cloudflareEnvFixture.parsed.CF_ZONE_ID, 'zone-fixture', 'Cloudflare WAF proof parses zone id from local env file')
assert.equal(cloudflareEnvFixture.parsed.CLOUDFLARE_ACCOUNT_ID, 'account-fixture', 'Cloudflare WAF proof can parse account id without inspecting account-level rulesets by default')
assert.deepEqual(cloudflareEnvFixture.skippedKeys, ['IGNORED_KEY'], 'Cloudflare WAF proof skips unrelated local env keys')

const sandboxCloudflareDesiredRules = sandboxCloudflareWafDesiredRules(['book.sandboxhotel.com', 'staff.sandboxhotel.com'])
assert.equal(sandboxCloudflareDesiredRules.length, 2, 'Cloudflare WAF ensure defaults to Free-plan-compatible custom probe and login rate-limit rules')
assert.deepEqual(
  sandboxCloudflareDesiredRules.map((desired) => desired.rule.ref),
  ['sandbox_pms_common_probe_block', 'sandbox_pms_login_rate_limit'],
  'Cloudflare WAF ensure uses stable rule refs',
)
assert.ok(
  sandboxCloudflareDesiredRules.every((desired) => desired.rule.expression.includes('book.sandboxhotel.com') && desired.rule.expression.includes('staff.sandboxhotel.com')),
  'Cloudflare WAF ensure scopes all rules to protected hostnames',
)
assert.equal(sandboxCloudflareDesiredRules[0].phase, 'http_request_firewall_custom', 'Cloudflare WAF ensure creates the custom rule in the custom firewall phase')
assert.equal(sandboxCloudflareDesiredRules[0].rule.action, 'block', 'Cloudflare WAF ensure blocks common probe paths')
assert.equal(sandboxCloudflareDesiredRules[1].phase, 'http_ratelimit', 'Cloudflare WAF ensure creates login limit in the rate-limit phase')
assert.equal(sandboxCloudflareDesiredRules[1].rule.action, 'block', 'Cloudflare WAF ensure uses Free-plan-compatible block action for login rate limiting')
assert.equal(sandboxCloudflareDesiredRules[1].rule.ratelimit.requests_per_period, 10, 'Cloudflare WAF ensure records the login rate-limit threshold')
assert.equal(sandboxCloudflareDesiredRules[1].rule.ratelimit.period, 10, 'Cloudflare WAF ensure uses the Free-plan-compatible login rate-limit period')
assert.equal(sandboxCloudflareDesiredRules[1].rule.ratelimit.mitigation_timeout, 10, 'Cloudflare WAF ensure uses a short login rate-limit mitigation timeout')
assert.deepEqual(sandboxCloudflareDesiredRules[1].rule.ratelimit.characteristics, ['cf.colo.id', 'ip.src'], 'Cloudflare WAF ensure keys rate limits by colo and source IP')
const sandboxCloudflarePaidQuotaRules = sandboxCloudflareWafDesiredRules(['book.sandboxhotel.com'], { includeApiBurstRateLimit: true })
assert.equal(sandboxCloudflarePaidQuotaRules.length, 3, 'Cloudflare WAF ensure can include the optional API burst rule when rate-limit quota allows')
assert.equal(sandboxCloudflarePaidQuotaRules[2].rule.ref, 'sandbox_pms_api_burst_rate_limit', 'Cloudflare WAF ensure keeps the optional API burst rule ref stable')
assert.equal(sandboxCloudflarePaidQuotaRules[2].rule.ratelimit.requests_per_period, 300, 'Cloudflare WAF ensure records the optional API burst threshold')

const opsEmailNotification = {
  id: 'ops-notification-email-1',
  propertyId: 'property-1',
  taskId: 'task-1',
  trendAlertId: null,
  type: 'TASK_UPDATE',
  channel: 'EMAIL',
  status: 'PENDING_PROVIDER',
  recipientRole: null,
  recipientUserId: null,
  recipientAddress: 'ops@property.test',
  title: 'Hotel Ops email pending',
  summary: 'A Hotel Ops update needs provider delivery.',
  actionUrl: '/ops/tasks',
  metadata: null,
  sentAt: null,
  createdAt: '2026-06-30T01:00:00.000Z',
}
const opsEmailDisplay = opsNotificationDisplay.toHotelOpsNotificationDisplay(opsEmailNotification, {
  readIds: [],
  dismissedIds: [],
})
assert.equal(opsEmailDisplay.id, 'hotel-ops:ops-notification-email-1', 'Hotel Ops notification display ids are namespaced')
assert.equal(opsNotificationDisplay.hotelOpsNotificationBackendId(opsEmailDisplay.id), 'ops-notification-email-1', 'Hotel Ops display id maps back to backend id')
assert.equal(opsEmailDisplay.priority, 'MEDIUM', 'pending provider Hotel Ops email notifications are medium priority')
assert.equal(opsEmailDisplay.actionRequired, true, 'pending provider Hotel Ops email notifications require action')
assert.match(opsEmailDisplay.message, /Email delivery is pending provider setup/, 'pending provider Hotel Ops email notifications explain provider setup')

assert.equal(opsNotificationDisplay.hotelOpsNotificationPriority({
  type: 'APPROVAL_REQUEST',
  channel: 'IN_APP',
  status: 'SENT',
}), 'HIGH', 'Hotel Ops approval requests remain high priority in the notification center')
assert.equal(opsNotificationDisplay.hotelOpsNotificationPriority({
  type: 'NEEDS_HUMAN',
  channel: 'IN_APP',
  status: 'SENT',
}), 'URGENT', 'Hotel Ops needs-human notifications remain urgent in the notification center')

const notificationAckFixture = createOpsCommandPrismaFixture()
const opsNotificationToAck = await notificationAckFixture.prisma.hotelOpsNotification.create({
  data: {
    propertyId: 'property-ops-test',
    type: 'TASK_UPDATE',
    channel: 'IN_APP',
    status: 'SENT',
    title: 'Hotel Ops task update',
    summary: 'A task moved forward.',
    actionUrl: '/ops/tasks',
  },
})
const readOpsNotice = await readOpsNotification(notificationAckFixture.prisma, opsNotificationToAck.id, { id: 'manager', role: 'MANAGER', username: 'manager' })
assert.equal(Boolean(readOpsNotice.readAt), true, 'Hotel Ops notification read state is persisted by the backend')
assert.equal(readOpsNotice.readBy, 'manager', 'Hotel Ops notification read actor is persisted')
await readOpsNotification(notificationAckFixture.prisma, opsNotificationToAck.id, { id: 'manager', role: 'MANAGER', username: 'manager' })
assert.equal(notificationAckFixture.audits.filter((audit) => audit.action === 'OPS_NOTIFICATION_READ').length, 1, 'Hotel Ops duplicate read acknowledgments do not create duplicate audit mutations')
const dismissedOpsNotice = await dismissOpsNotification(notificationAckFixture.prisma, opsNotificationToAck.id, { id: 'owner', role: 'ADMIN', username: 'owner' })
assert.equal(Boolean(dismissedOpsNotice.dismissedAt), true, 'Hotel Ops notification dismiss state is persisted by the backend')
assert.equal(dismissedOpsNotice.dismissedBy, 'owner', 'Hotel Ops notification dismiss actor is persisted')
assert.equal(notificationAckFixture.audits.some((audit) => audit.action === 'OPS_NOTIFICATION_DISMISSED'), true, 'Hotel Ops notification dismiss is audited')
const activeOpsNotifications = await listOpsNotifications(notificationAckFixture.prisma, { dismissed: false })
const dismissedOpsNotifications = await listOpsNotifications(notificationAckFixture.prisma, { dismissed: true })
assert.equal(activeOpsNotifications.some((notification) => notification.id === opsNotificationToAck.id), false, 'Hotel Ops dismissed notifications are excluded from active notification lists')
assert.equal(dismissedOpsNotifications.some((notification) => notification.id === opsNotificationToAck.id), true, 'Hotel Ops dismissed notifications remain queryable for audit review')

const bookingEmailNoApi = bookingEmailCapabilities.resolveBookingEmailCapabilities({
  serverApiEnabled: true,
  apiAvailable: false,
  mailboxConfigured: false,
})
assert.equal(bookingEmailNoApi.canApplyEvents, false, 'booking-email UI disables event mutations when API routes are unavailable')
assert.equal(bookingEmailNoApi.canSyncMailbox, false, 'booking-email UI disables sync when API routes are unavailable')
assert.equal(bookingEmailNoApi.bannerTitle, 'Booking-email backend connection needed', 'booking-email UI names missing API routes clearly')

const bookingEmailMissingMailboxCreds = bookingEmailCapabilities.resolveBookingEmailCapabilities({
  serverApiEnabled: true,
  apiAvailable: true,
  mailboxConfigured: false,
})
assert.equal(bookingEmailMissingMailboxCreds.canApplyEvents, true, 'booking-email UI can apply existing events when only mailbox sync credentials are missing')
assert.equal(bookingEmailMissingMailboxCreds.canSyncMailbox, false, 'booking-email UI blocks mailbox sync until provider credentials are configured')
assert.equal(bookingEmailMissingMailboxCreds.bannerTitle, 'Mailbox sync credentials needed', 'booking-email UI distinguishes provider credential gaps from missing backend routes')

const bookingEmailReady = bookingEmailCapabilities.resolveBookingEmailCapabilities({
  serverApiEnabled: true,
  apiAvailable: true,
  mailboxConfigured: true,
})
assert.equal(bookingEmailReady.canApplyEvents, true, 'booking-email UI applies events when backend routes are available')
assert.equal(bookingEmailReady.canSyncMailbox, true, 'booking-email UI syncs mailbox when backend and provider credentials are ready')

const missingGmailCredentialStatus = bookingEmailGmailCredentialStatus({})
assert.equal(missingGmailCredentialStatus.configured, false, 'booking-email Gmail credential status reports missing credentials')
assert.equal(missingGmailCredentialStatus.mode, 'missing', 'booking-email Gmail credential status names missing mode')
assert.equal(missingGmailCredentialStatus.hasAccessToken, false, 'booking-email Gmail credential status reports missing access token')
assert.equal(missingGmailCredentialStatus.hasRefreshToken, false, 'booking-email Gmail credential status reports missing refresh-token tuple')
assert.equal(missingGmailCredentialStatus.oauthClientConfigured, false, 'booking-email Gmail credential status reports missing OAuth client')
assert.equal(missingGmailCredentialStatus.refreshTokenConfigured, false, 'booking-email Gmail credential status reports missing refresh token')
assert.equal(missingGmailCredentialStatus.targetMailboxConfigured, true, 'booking-email Gmail credential status uses the default target mailbox when env is absent')
assert.equal(missingGmailCredentialStatus.targetMailbox, 'booking@sandboxhotel.com', 'booking-email Gmail credential status reports the target mailbox without secrets')
assert.deepEqual(
  missingGmailCredentialStatus.missing,
  [
    'BOOKING_EMAIL_GMAIL_CLIENT_ID or GMAIL_CLIENT_ID',
    'BOOKING_EMAIL_GMAIL_CLIENT_SECRET or GMAIL_CLIENT_SECRET',
    'BOOKING_EMAIL_GMAIL_REFRESH_TOKEN or GMAIL_REFRESH_TOKEN',
  ],
  'booking-email Gmail credential status reports exact non-secret missing keys',
)
assert.equal(JSON.stringify(missingGmailCredentialStatus).includes('fixture'), false, 'booking-email Gmail credential status omits secret values')
assert.equal(
  bookingEmailGmailCredentialStatus({
    BOOKING_EMAIL_GMAIL_ACCESS_TOKEN: 'gmail-access-fixture',
    BOOKING_EMAIL_GMAIL_USER_ID: 'booking@sandboxhotel.com',
  }).mode,
  'access_token',
  'booking-email Gmail credential status supports explicit access tokens',
)
assert.equal(
  bookingEmailGmailCredentialStatus({
    BOOKING_EMAIL_GMAIL_CLIENT_ID: 'client-id',
    BOOKING_EMAIL_GMAIL_CLIENT_SECRET: 'client-confidential-fixture',
    BOOKING_EMAIL_GMAIL_REFRESH_TOKEN: 'gmail-refresh-fixture',
  }).mode,
  'refresh_token',
  'booking-email Gmail credential status supports backend refresh-token credentials',
)
const gmailConnectionPass = await testBookingEmailGmailConnection({
  env: {
    BOOKING_EMAIL_GMAIL_ACCESS_TOKEN: 'gmail-access-fixture',
    BOOKING_EMAIL_PRIMARY_MAILBOX: 'booking@sandboxhotel.com',
  },
  fetchImpl: async (url, request) => {
    assert.equal(String(url), 'https://gmail.googleapis.com/gmail/v1/users/me/profile', 'booking-email Gmail connection test uses the profile endpoint')
    assert.equal(request.headers.authorization, 'Bearer gmail-access-fixture', 'booking-email Gmail connection test authenticates with backend token')
    return new Response(JSON.stringify({ emailAddress: 'booking@sandboxhotel.com', messagesTotal: 10 }), { status: 200 })
  },
})
assert.equal(gmailConnectionPass.status, 'pass', 'booking-email Gmail connection test passes on profile response')
assert.equal(gmailConnectionPass.targetMailboxMatchesAuthenticatedAccount, true, 'booking-email Gmail connection test compares authenticated account to target mailbox')
const gmailConnectionMissing = await testBookingEmailGmailConnection({ env: {} })
assert.equal(gmailConnectionMissing.status, 'not_configured', 'booking-email Gmail connection test reports missing credentials without calling Gmail')
const gmailConnectionFail = await testBookingEmailGmailConnection({
  env: { BOOKING_EMAIL_GMAIL_ACCESS_TOKEN: 'gmail-access-fixture' },
  fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'invalid token=gmail-access-fixture' } }), { status: 401 }),
})
assert.equal(gmailConnectionFail.status, 'fail', 'booking-email Gmail connection test reports provider failures')
assert.equal(gmailConnectionFail.message.includes('gmail-access-fixture'), false, 'booking-email Gmail connection test redacts provider failures')
let gmailRefreshRequestBody = null
const refreshedGmailToken = await resolveBookingEmailGmailAccessToken({
  env: {
    BOOKING_EMAIL_GMAIL_CLIENT_ID: 'client-id',
    BOOKING_EMAIL_GMAIL_CLIENT_SECRET: 'client-confidential-fixture',
    BOOKING_EMAIL_GMAIL_REFRESH_TOKEN: 'gmail-refresh-fixture',
  },
  fetchImpl: async (url, request) => {
    assert.equal(String(url), 'https://oauth2.googleapis.com/token', 'booking-email Gmail refresh uses the OAuth token endpoint')
    gmailRefreshRequestBody = request.body
    assert.equal(request.method, 'POST', 'booking-email Gmail refresh uses POST')
    assert.equal(request.headers['content-type'], 'application/x-www-form-urlencoded', 'booking-email Gmail refresh uses form encoding')
    return new Response(JSON.stringify({ access_token: 'new-gmail-access-fixture', expires_in: 3600, token_type: 'Bearer' }), { status: 200 })
  },
})
assert.equal(refreshedGmailToken, 'new-gmail-access-fixture', 'booking-email Gmail refresh resolves an access token')
assert.equal(gmailRefreshRequestBody.get('grant_type'), 'refresh_token', 'booking-email Gmail refresh sends refresh grant type')
assert.equal(gmailRefreshRequestBody.get('refresh_token'), 'gmail-refresh-fixture', 'booking-email Gmail refresh sends the configured refresh token only to Google')
await assert.rejects(
  () => resolveBookingEmailGmailAccessToken({
    env: {
      BOOKING_EMAIL_GMAIL_CLIENT_ID: 'client-id',
      BOOKING_EMAIL_GMAIL_CLIENT_SECRET: 'client-confidential-fixture',
      BOOKING_EMAIL_GMAIL_REFRESH_TOKEN: 'gmail-refresh-fixture',
    },
    fetchImpl: async () => new Response(JSON.stringify({
      error_description: 'invalid refresh_token=gmail-refresh-fixture client_secret=client-confidential-fixture',
    }), { status: 400 }),
  }),
  (error) => {
    assert.equal(error.message.includes('gmail-refresh-fixture'), false, 'booking-email Gmail refresh errors redact refresh token values')
    assert.equal(error.message.includes('client-confidential-fixture'), false, 'booking-email Gmail refresh errors redact client secret values')
    assert.match(error.message, /refresh_token=\[redacted\]/, 'booking-email Gmail refresh error remains actionable after redaction')
    return true
  },
  'booking-email Gmail refresh errors are redacted before surfacing',
)

const gmailAuthorizationUrl = new URL(buildGmailAuthorizationUrl({
  clientId: 'client-id-fixture',
  redirectUri: 'http://127.0.0.1:53682/oauth2callback',
  scopes: gmailOauthScopes([]),
  state: 'state-fixture',
}))
assert.equal(String(gmailAuthorizationUrl.origin + gmailAuthorizationUrl.pathname), 'https://accounts.google.com/o/oauth2/v2/auth', 'Gmail OAuth helper uses Google authorization endpoint')
assert.equal(gmailAuthorizationUrl.searchParams.get('client_id'), 'client-id-fixture', 'Gmail OAuth helper carries the configured OAuth client id')
assert.equal(gmailAuthorizationUrl.searchParams.get('redirect_uri'), 'http://127.0.0.1:53682/oauth2callback', 'Gmail OAuth helper carries the exact redirect URI')
assert.equal(gmailAuthorizationUrl.searchParams.get('response_type'), 'code', 'Gmail OAuth helper requests an authorization code')
assert.equal(gmailAuthorizationUrl.searchParams.get('access_type'), 'offline', 'Gmail OAuth helper requests an offline refresh token')
assert.equal(gmailAuthorizationUrl.searchParams.get('prompt'), 'consent', 'Gmail OAuth helper forces consent so Google can issue a refresh token')
assert.equal(gmailAuthorizationUrl.searchParams.get('scope'), 'https://www.googleapis.com/auth/gmail.readonly', 'Gmail OAuth helper defaults to readonly mailbox scope')
assert.deepEqual(
  gmailOauthScopes(['--include-send-scope']),
  ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],
  'Gmail OAuth helper keeps send scope opt-in',
)
const gmailOauthClientFixturePath = resolve('node_modules/.tmp/business-tests/google-oauth-client.fixture.json')
await writeFile(gmailOauthClientFixturePath, JSON.stringify({
  installed: {
    client_id: 'file-client-id-fixture',
    client_secret: 'file-client-secret-fixture',
    redirect_uris: ['http://127.0.0.1:53682/oauth2callback'],
  },
}), 'utf8')
const gmailOauthFileCredentials = readGoogleOauthClientCredentials(gmailOauthClientFixturePath)
assert.equal(gmailOauthFileCredentials.clientId, 'file-client-id-fixture', 'Gmail OAuth helper reads client id from Google OAuth JSON')
assert.equal(gmailOauthFileCredentials.clientSecret, 'file-client-secret-fixture', 'Gmail OAuth helper reads client secret from Google OAuth JSON for in-memory exchange only')
assert.deepEqual(gmailOauthFileCredentials.redirectUris, ['http://127.0.0.1:53682/oauth2callback'], 'Gmail OAuth helper reads redirect URIs from Google OAuth JSON')
const resolvedGmailOauthClient = resolveGmailOauthClient(['--credentials-file', gmailOauthClientFixturePath], {})
assert.equal(resolvedGmailOauthClient.clientId, 'file-client-id-fixture', 'Gmail OAuth helper can use a Google OAuth client JSON file')
assert.equal(resolvedGmailOauthClient.clientSecret, 'file-client-secret-fixture', 'Gmail OAuth helper keeps JSON client secret in memory for exchange/apply')
const overriddenGmailOauthClient = resolveGmailOauthClient(['--credentials-file', gmailOauthClientFixturePath, '--client-id', 'arg-client-id-fixture'], {
  BOOKING_EMAIL_GMAIL_CLIENT_SECRET: 'env-client-secret-fixture',
})
assert.equal(overriddenGmailOauthClient.clientId, 'arg-client-id-fixture', 'Gmail OAuth helper lets explicit client id override the file')
assert.equal(overriddenGmailOauthClient.clientSecret, 'env-client-secret-fixture', 'Gmail OAuth helper lets env client secret override the file')
const gmailOauthListener = await startAuthorizationCodeListener({
  redirectUri: 'http://127.0.0.1:53683/oauth2callback',
  timeoutMs: 5000,
})
const gmailOauthListenerResponseStatus = await new Promise((resolveResponse, reject) => {
  const request = httpGet('http://127.0.0.1:53683/oauth2callback?code=listener-code-fixture', (response) => {
    response.resume()
    response.on('end', () => resolveResponse(response.statusCode))
  })
  request.on('error', reject)
})
assert.equal(gmailOauthListenerResponseStatus, 200, 'Gmail OAuth helper local listener accepts the callback')
assert.equal(await gmailOauthListener.code, 'listener-code-fixture', 'Gmail OAuth helper local listener captures the authorization code in memory')
let gmailOauthExchangeBody = null
const gmailOauthExchange = await exchangeAuthorizationCode({
  code: 'authorization-code-fixture',
  clientId: 'client-id-fixture',
  clientSecret: 'client-secret-fixture',
  redirectUri: 'http://127.0.0.1:53682/oauth2callback',
  fetchImpl: async (url, request) => {
    assert.equal(String(url), 'https://oauth2.googleapis.com/token', 'Gmail OAuth helper exchanges codes at the Google token endpoint')
    gmailOauthExchangeBody = request.body
    assert.equal(request.method, 'POST', 'Gmail OAuth helper exchanges codes with POST')
    assert.equal(request.headers['content-type'], 'application/x-www-form-urlencoded', 'Gmail OAuth helper uses form encoding')
    return new Response(JSON.stringify({
      refresh_token: 'refresh-token-fixture',
      access_token: 'access-token-fixture',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
    }), { status: 200 })
  },
})
assert.equal(gmailOauthExchange.refreshToken, 'refresh-token-fixture', 'Gmail OAuth helper returns a refresh token to the in-memory apply path')
assert.equal(gmailOauthExchange.accessTokenPresent, true, 'Gmail OAuth helper reports access token presence without requiring output of the value')
assert.equal(gmailOauthExchangeBody.get('grant_type'), 'authorization_code', 'Gmail OAuth helper uses authorization-code grant type')
assert.equal(gmailOauthExchangeBody.get('code'), 'authorization-code-fixture', 'Gmail OAuth helper sends the pasted authorization code only to Google')
assert.equal(gmailOauthExchangeBody.get('client_secret'), 'client-secret-fixture', 'Gmail OAuth helper sends the client secret only to Google')
await assert.rejects(
  () => exchangeAuthorizationCode({
    code: 'authorization-code-fixture',
    clientId: 'client-id-fixture',
    clientSecret: 'client-secret-fixture',
    redirectUri: 'http://127.0.0.1:53682/oauth2callback',
    fetchImpl: async () => new Response(JSON.stringify({
      error_description: 'invalid code=authorization-code-fixture refresh_token=refresh-token-fixture client_secret=client-secret-fixture token=ya29.access-fixture',
    }), { status: 400 }),
  }),
  (error) => {
    assert.equal(error.message.includes('authorization-code-fixture'), false, 'Gmail OAuth helper redacts authorization codes from errors')
    assert.equal(error.message.includes('refresh-token-fixture'), false, 'Gmail OAuth helper redacts refresh tokens from errors')
    assert.equal(error.message.includes('client-secret-fixture'), false, 'Gmail OAuth helper redacts client secrets from errors')
    assert.equal(error.message.includes('ya29.access-fixture'), false, 'Gmail OAuth helper redacts access-token-shaped values from errors')
    assert.match(error.message, /client_secret=\[redacted\]/, 'Gmail OAuth helper keeps redacted exchange errors actionable')
    return true
  },
  'Gmail OAuth helper redacts provider errors before surfacing',
)

const previewedBookingEmail = previewBookingEmailEvent({
  subject: 'Booking confirmation ABC-1234',
  rawText: 'Guest: Example Guest Check in: 2026-07-10 Check out: 2026-07-12 Double THB 3200 paid',
})
assert.equal(previewedBookingEmail.eventType, 'NEW_BOOKING', 'booking-email preview classifies booking confirmations')
assert.equal(previewedBookingEmail.channelRefPresent, true, 'booking-email preview reports reference extraction without exposing the value')
assert.equal(previewedBookingEmail.stayDatesPresent, true, 'booking-email preview reports stay-date extraction without exposing guest details')
const approvedProviderQuery = approvedBookingEmailProviderQuery()
assert.match(approvedProviderQuery, /\(from:booking\.com OR from:guest\.booking\.com OR from:agoda\.com OR from:trip\.com OR from:expedia\.com OR from:priceline\.com OR from:airbnb\.com\)/, 'booking-email approved provider query keeps the approved OTA sender scope')
assert.match(approvedProviderQuery, /-from:ebk\.promo\.hotelpartner@trip\.com/, 'booking-email approved provider query excludes the Trip.com partner-report sender')
assert.match(approvedProviderQuery, /-from:growth-product@agoda\.com/, 'booking-email approved provider query excludes the Agoda partner-invoice sender')
assert.match(approvedProviderQuery, /-subject:"new sign-in to your account"/, 'booking-email approved provider query excludes Booking.com security notices')
assert.match(approvedProviderQuery, /newer_than:30d/, 'booking-email approved provider query stays bounded by default')
assert.doesNotMatch(approvedBookingEmailProviderQuery({ allPast: true }), /newer_than:/, 'booking-email all-past provider query removes the recency bound')
assert.equal(
  primaryMailboxBookingEmailQuery('booking@sandboxhotel.com'),
  'to:booking@sandboxhotel.com -in:spam -in:trash newer_than:30d',
  'booking-email primary-mailbox query stays available as an explicit troubleshooting fallback',
)
for (const fixture of bookingEmailParserFixtures) {
  const parsed = parseBookingEmailDetails(fixture.input)
  assert.equal(parsed.eventType, fixture.expected.eventType, `${fixture.name} keeps the expected booking-email event type`)
  assert.equal(parsed.channelRef, fixture.expected.channelRef, `${fixture.name} keeps the expected booking-email reference`)
  assert.equal(parsed.details.guestName, fixture.expected.guestName, `${fixture.name} keeps the expected booking-email guest name`)
  assert.equal(parsed.details.checkIn, fixture.expected.checkIn, `${fixture.name} keeps the expected booking-email check-in date`)
  assert.equal(parsed.details.checkOut, fixture.expected.checkOut, `${fixture.name} keeps the expected booking-email check-out date`)
  assert.equal(parsed.details.roomType, fixture.expected.roomType, `${fixture.name} keeps the expected booking-email room type`)
  assert.equal(parsed.details.amount, fixture.expected.amount, `${fixture.name} keeps the expected booking-email amount`)
  assert.equal(parsed.details.paymentStatus, fixture.expected.paymentStatus, `${fixture.name} keeps the expected booking-email payment status`)
  assert.equal(parsed.reviewReason, null, `${fixture.name} parses without a review blocker`)
}

for (const fixture of bookingEmailNoiseFixtures) {
  const parsed = parseBookingEmailDetails(fixture.input)
  assert.equal(parsed.eventType, 'UNKNOWN', `${fixture.name} stays out of the booking-email workflow`)
  assert.match(parsed.reviewReason || '', /event type/i, `${fixture.name} remains queued for manual classification`)
}

const duplicateScopeFixture = createBookingEmailPrismaFixture()
const duplicateScopeActor = { id: 'front-desk-booking', username: 'front.desk', role: 'FRONT_DESK' }
const sameReferencePaymentFixture = {
  ...bookingEmailParserFixtures[4].input,
  subject: bookingEmailParserFixtures[4].input.subject.replace('PAY-5511', 'LH-ABCD1234'),
  rawText: bookingEmailParserFixtures[4].input.rawText.replace(/PAY-5511/g, 'LH-ABCD1234'),
}
await syncBookingEmail(duplicateScopeFixture.prisma, {
  sourceId: duplicateScopeFixture.sources[0].id,
  reviewOnly: true,
  events: [
    { ...bookingEmailParserFixtures[0].input, sourceMessageId: 'gmail-new-booking-fixture' },
    { ...sameReferencePaymentFixture, sourceMessageId: 'gmail-payment-fixture' },
  ],
}, duplicateScopeActor)
assert.equal(duplicateScopeFixture.events.length, 2, 'booking-email duplicate-scope fixture stores both test events')
assert.equal(duplicateScopeFixture.events[1].duplicateOfEventId, null, 'booking-email duplicate scope does not mark different event types with the same reference as duplicates')

const duplicateReplayFixture = createBookingEmailPrismaFixture()
await syncBookingEmail(duplicateReplayFixture.prisma, {
  sourceId: duplicateReplayFixture.sources[0].id,
  reviewOnly: true,
  events: [
    { ...bookingEmailParserFixtures[0].input, sourceMessageId: 'gmail-resend-a', rawHeaders: { messageId: '<provider-replay@example.test>' } },
    { ...bookingEmailParserFixtures[0].input, sourceMessageId: 'gmail-resend-b', rawHeaders: { messageId: '<provider-replay@example.test>' } },
  ],
}, duplicateScopeActor)
assert.equal(Boolean(duplicateReplayFixture.events[1].duplicateOfEventId), true, 'booking-email duplicate scope still flags same-type resend content as a duplicate')

const autoProcessFixture = createBookingEmailPrismaFixture({
  autoProcessSafeEvents: true,
})
const autoProcessResult = await syncBookingEmail(autoProcessFixture.prisma, {
  sourceId: autoProcessFixture.sources[0].id,
  reviewOnly: false,
  events: [
    { ...bookingEmailParserFixtures[0].input, sourceMessageId: 'gmail-auto-process-fixture' },
  ],
}, duplicateScopeActor)
assert.equal(autoProcessResult.events[0].status, 'ERROR', 'booking-email auto-process persists async approval failures onto the event')
assert.match(autoProcessResult.events[0].errorReason || '', /room type/i, 'booking-email auto-process keeps the approval failure reason on the event')

function gmailBody(value) {
  return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

let gmailListPageRequests = 0
const paginatedGmailEvents = await fetchGmailEventsForSource({
  mailbox: 'booking@sandboxhotel.com',
  query: 'to:booking@sandboxhotel.com',
}, {
  env: { BOOKING_EMAIL_GMAIL_ACCESS_TOKEN: 'gmail-access-fixture' },
  maxMessages: 2,
  pageSize: 1,
  fetchImpl: async (url) => {
    const parsed = new URL(String(url))
    if (parsed.pathname.endsWith('/messages')) {
      gmailListPageRequests += 1
      const pageToken = parsed.searchParams.get('pageToken')
      return new Response(JSON.stringify(pageToken
        ? { messages: [{ id: 'gmail-page-2' }] }
        : { messages: [{ id: 'gmail-page-1' }], nextPageToken: 'page-2' }), { status: 200 })
    }
    const id = decodeURIComponent(parsed.pathname.split('/').at(-1) || '')
    return new Response(JSON.stringify({
      id,
      threadId: `thread-${id}`,
      internalDate: String(Date.parse('2026-07-01T08:00:00.000Z')),
      snippet: 'Booking snippet',
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'from', value: 'Booking.com <booking@example.test>' },
          { name: 'to', value: 'booking@sandboxhotel.com' },
          { name: 'subject', value: `Booking confirmation ${id}` },
          { name: 'date', value: 'Wed, 01 Jul 2026 08:00:00 +0000' },
          { name: 'message-id', value: `<${id}@example.test>` },
        ],
        body: {
          data: gmailBody('Guest: Example Guest Check in: 2026-07-10 Check out: 2026-07-12 Double THB 3200'),
        },
      },
    }), { status: 200 })
  },
})
assert.equal(paginatedGmailEvents.length, 2, 'booking-email Gmail fetch follows bounded pagination')
assert.equal(gmailListPageRequests, 2, 'booking-email Gmail fetch requests additional pages when needed')
assert.equal(paginatedGmailEvents[0].sourceMessageId, 'gmail-page-1', 'booking-email Gmail fetch keeps source message ids for dedupe')

const bookingEmailForm = bookingEmailWorkflow.bookingEmailDetailsForm({
  id: 'email-event-1',
  source: 'Booking.com',
  sender: 'booking@example.test',
  receivedAt: '2026-07-01T08:00:00.000Z',
  eventType: 'NEW_BOOKING',
  status: 'NEEDS_REVIEW',
  guestName: 'Email Guest',
  checkIn: '2026-07-03',
  checkOut: '2026-07-05',
  roomType: 'DELUXE',
  amount: 4400,
  currency: 'THB',
  channelRef: 'OTA-123',
  parsedDetails: {
    guestName: 'Parsed Guest',
    adults: 2,
    children: 1,
    specialRequests: 'High floor',
  },
})
assert.equal(bookingEmailForm.guestName, 'Parsed Guest', 'booking-email edit form prefers parsed guest details')
assert.equal(bookingEmailForm.amount, '4400', 'booking-email edit form falls back to event amount')
assert.equal(bookingEmailForm.channelRef, 'OTA-123', 'booking-email edit form carries channel reference')

const editedBookingEmailPayload = bookingEmailWorkflow.buildBookingEmailApprovePayload({
  mode: 'apply_parsed',
  form: {
    ...bookingEmailForm,
    amount: '4500',
    adults: '2',
    children: '0',
    paymentMethod: 'ONLINE',
    notes: 'Corrected by front desk.',
  },
  reason: 'Corrected extracted total before creating reservation.',
})
assert.equal(editedBookingEmailPayload.mode, 'apply_parsed', 'booking-email edited details use apply mode')
assert.equal(editedBookingEmailPayload.editedDetails.amount, 4500, 'booking-email edited details parse amount')
assert.equal(editedBookingEmailPayload.editedDetails.children, 0, 'booking-email edited details preserve zero children')
assert.equal(editedBookingEmailPayload.editedDetails.paymentMethod, 'ONLINE', 'booking-email edited details preserve payment method')
assert.equal(editedBookingEmailPayload.reason, 'Corrected extracted total before creating reservation.', 'booking-email edited apply payload carries audit reason')

assert.throws(
  () => bookingEmailWorkflow.buildBookingEmailApprovePayload({ mode: 'link_reservation', form: bookingEmailForm, reservationId: ' ' }),
  /Reservation ID is required/,
  'booking-email link payload requires a reservation id',
)
const linkBookingEmailPayload = bookingEmailWorkflow.buildBookingEmailApprovePayload({
  mode: 'link_reservation',
  form: bookingEmailForm,
  reservationId: 'reservation-1',
})
assert.equal(linkBookingEmailPayload.reservationId, 'reservation-1', 'booking-email link payload targets the selected reservation')
assert.equal(
  bookingEmailWorkflow.bookingEmailDefaultApprovalMode({ eventType: 'NEW_BOOKING', reservationId: 'reservation-1' }),
  'link_reservation',
  'booking-email default approval links matched new bookings instead of creating duplicates',
)
assert.equal(
  bookingEmailWorkflow.bookingEmailDefaultApprovalMode({ eventType: 'PAYMENT_NOTICE', reservationId: 'reservation-1' }),
  'apply_parsed',
  'booking-email default approval applies payment notices through reservation-aware parsing',
)
assert.equal(
  bookingEmailWorkflow.bookingEmailActionRequiresReason({ eventType: 'CANCELLATION' }),
  true,
  'booking-email cancellation actions require an operational reason',
)
assert.equal(
  bookingEmailWorkflow.bookingEmailActionRequiresReason({ eventType: 'NEW_BOOKING' }),
  false,
  'booking-email non-cancellation actions do not require a cancellation reason',
)

const notificationDrafts = buildOpsNotificationDrafts({
  id: 'property-1',
  reservationAlertEmail: 'ops@property.test',
}, {
  type: 'APPROVAL_REQUEST',
  taskId: 'task-1',
  recipientRole: 'OWNER',
  title: 'Approval required',
  summary: 'Rate update needs owner approval.',
  actionPath: '/ops/approvals',
})
assert.equal(notificationDrafts.length, 2, 'Hotel Ops notification abstraction records in-app plus email intent when alert email exists')
assert.equal(notificationDrafts[0].channel, 'IN_APP', 'Hotel Ops notification records in-app delivery')
assert.equal(notificationDrafts[0].status, 'SENT', 'Hotel Ops in-app notification is immediately available')
assert.equal(notificationDrafts[1].channel, 'EMAIL', 'Hotel Ops notification records email channel intent')
assert.equal(notificationDrafts[1].status, 'PENDING_PROVIDER', 'Hotel Ops does not fake email delivery without a provider')
assert.equal(notificationDrafts[1].recipientAddress, 'ops@property.test', 'Hotel Ops email intent targets the property alert email')

const opsEmailProviderDisabled = hotelOpsEmailProviderStatus({})
assert.equal(opsEmailProviderDisabled.provider, 'record_only', 'Hotel Ops email provider is record-only unless explicitly enabled')
assert.equal(opsEmailProviderDisabled.configured, false, 'Hotel Ops email provider is not configured by default')
const opsEmailProviderNamedButDisabled = hotelOpsEmailProviderStatus({
  HOTEL_OPS_EMAIL_DELIVERY_ENABLED: 'false',
  HOTEL_OPS_EMAIL_PROVIDER: 'gmail',
  BOOKING_EMAIL_GMAIL_ACCESS_TOKEN: 'gmail-access-fixture',
})
assert.equal(opsEmailProviderNamedButDisabled.provider, 'record_only', 'Hotel Ops email provider name does not enable delivery by itself')
assert.equal(opsEmailProviderNamedButDisabled.configured, false, 'Hotel Ops email delivery remains disabled until explicitly enabled')
const opsEmailProviderReady = hotelOpsEmailProviderStatus({
  HOTEL_OPS_EMAIL_DELIVERY_ENABLED: 'true',
  BOOKING_EMAIL_GMAIL_ACCESS_TOKEN: 'gmail-access-fixture',
  HOTEL_OPS_EMAIL_FROM: 'ops@sandboxhotel.test',
})
assert.equal(opsEmailProviderReady.provider, 'gmail_api', 'Hotel Ops email provider uses Gmail API when explicitly enabled')
assert.equal(opsEmailProviderReady.configured, true, 'Hotel Ops email provider reports configured with backend Gmail credentials')
let gmailSendRequestBody = null
const gmailSendResult = await sendOpsEmailNotification({
  id: 'ops-notification-email-send',
  channel: 'EMAIL',
  status: 'PENDING_PROVIDER',
  recipientAddress: 'ops@property.test',
  title: 'Hotel Ops approval required',
  summary: 'Rate update needs owner approval. token=summary-fixture',
  actionUrl: '/ops/approvals',
}, {
  env: {
    HOTEL_OPS_EMAIL_DELIVERY_ENABLED: 'true',
    BOOKING_EMAIL_GMAIL_ACCESS_TOKEN: 'gmail-access-fixture',
    HOTEL_OPS_EMAIL_FROM: 'ops@sandboxhotel.test',
  },
  fetchImpl: async (url, request) => {
    assert.equal(String(url), 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', 'Hotel Ops Gmail sender uses Gmail send endpoint')
    assert.equal(request.method, 'POST', 'Hotel Ops Gmail sender uses POST')
    assert.equal(request.headers.authorization, 'Bearer gmail-access-fixture', 'Hotel Ops Gmail sender authenticates with backend token')
    gmailSendRequestBody = JSON.parse(request.body)
    const decoded = Buffer.from(gmailSendRequestBody.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    assert.match(decoded, /To: ops@property\.test/, 'Hotel Ops Gmail message targets alert address')
    assert.match(decoded, /Subject: Hotel Ops approval required/, 'Hotel Ops Gmail message carries notification title')
    assert.equal(decoded.includes('summary-fixture'), false, 'Hotel Ops Gmail message redacts credential-like summary values')
    return new Response(JSON.stringify({ id: 'gmail-message-id', threadId: 'gmail-thread-id' }), { status: 200 })
  },
})
assert.equal(gmailSendRequestBody.raw.length > 20, true, 'Hotel Ops Gmail sender submits a raw RFC 5322 message')
assert.equal(gmailSendResult.messageId, 'gmail-message-id', 'Hotel Ops Gmail sender returns provider message id')
await assert.rejects(
  () => sendOpsEmailNotification({
    id: 'ops-notification-email-fail',
    channel: 'EMAIL',
    status: 'PENDING_PROVIDER',
    recipientAddress: 'ops@property.test',
    title: 'Hotel Ops delivery failure',
    summary: 'Delivery failure should redact provider details.',
    actionUrl: '/ops/tasks',
  }, {
    env: {
      HOTEL_OPS_EMAIL_DELIVERY_ENABLED: 'true',
      BOOKING_EMAIL_GMAIL_ACCESS_TOKEN: 'gmail-access-fixture',
      HOTEL_OPS_EMAIL_FROM: 'ops@sandboxhotel.test',
    },
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Gmail send failed token=send-fixture' } }), { status: 500 }),
  }),
  (error) => {
    assert.equal(error.message.includes('send-fixture'), false, 'Hotel Ops Gmail provider failure redacts token-like values')
    assert.match(error.message, /token=\[REDACTED\]/, 'Hotel Ops Gmail provider failure remains actionable after redaction')
    return true
  },
  'Hotel Ops Gmail sender redacts provider failures',
)

const redactedNotificationDrafts = buildOpsNotificationDrafts({
  id: 'property-1',
  reservationAlertEmail: null,
}, {
  type: 'TASK_UPDATE',
  taskId: 'task-secret',
  title: 'password=title-secret',
  summary: 'Worker response token=summary-secret',
  metadata: {
    apiKey: 'metadata-secret',
    nested: {
      password: 'nested-secret',
      note: 'safe note',
    },
  },
})
assert.equal(JSON.stringify(redactedNotificationDrafts).includes('title-secret'), false, 'Hotel Ops notifications redact credential-like title text')
assert.equal(JSON.stringify(redactedNotificationDrafts).includes('summary-secret'), false, 'Hotel Ops notifications redact credential-like summary text')
assert.equal(JSON.stringify(redactedNotificationDrafts).includes('metadata-secret'), false, 'Hotel Ops notifications redact credential-like metadata values')
assert.equal(redactedNotificationDrafts[0].metadata.nested.note, 'safe note', 'Hotel Ops notification metadata keeps safe operational context')

const signedWorkerBody = {
  taskId: 'task-1',
  taskType: 'UPDATE_RATE',
  platform: 'agoda',
  hotelId: 'SANDBOX',
  roomType: 'Deluxe Room',
  dateStart: '2026-07-03',
  dateEnd: '2026-07-04',
  rate: { amount: 2200, currency: 'THB' },
  dryRun: true,
}
const signedWorkerRequest = signOpsWorkerRequest(signedWorkerBody, {
  secret: 'shared-worker-secret',
  timestamp: 1_000_000,
  nonce: 'business-test-nonce',
})
assert.equal(
  verifyOpsWorkerRequest({ body: signedWorkerRequest.body, headers: signedWorkerRequest.headers, secret: 'shared-worker-secret', now: 1_000_000 }).ok,
  true,
  'Hotel Ops signed worker requests verify with shared secret',
)
assert.equal(
  verifyOpsWorkerRequest({ body: signedWorkerRequest.body, headers: {}, secret: 'shared-worker-secret', now: 1_000_000 }).statusCode,
  401,
  'Hotel Ops worker rejects unsigned requests',
)
assert.equal(
  verifyOpsWorkerRequest({ body: signedWorkerRequest.body.replace('UPDATE_RATE', 'READ_RATES'), headers: signedWorkerRequest.headers, secret: 'shared-worker-secret', now: 1_000_000 }).ok,
  false,
  'Hotel Ops worker rejects tampered signed payloads',
)
const replayedWorkerRequest = verifyOpsWorkerRequest({
  body: signedWorkerRequest.body,
  headers: signedWorkerRequest.headers,
  secret: 'shared-worker-secret',
  now: 1_000_001,
})
assert.equal(replayedWorkerRequest.statusCode, 401, 'Hotel Ops worker rejects replayed signed requests')
assert.equal(replayedWorkerRequest.error.includes('nonce'), true, 'Hotel Ops worker replay rejection names the nonce boundary')
const signedMockWorkerResult = runSignedMockOtaWorkerTask(JSON.parse(signedWorkerRequest.body))
assert.equal(signedMockWorkerResult.status, 'SUCCEEDED', 'Hotel Ops signed mock worker returns structured result')
assert.equal(signedMockWorkerResult.data.dryRun, true, 'Hotel Ops signed mock worker stays in dry-run by default')
assert.throws(
  () => runSignedMockOtaWorkerTask({ taskId: 'task-2', taskType: 'FORBIDDEN', platform: 'agoda' }),
  /not allowed/,
  'Hotel Ops worker rejects disallowed task types',
)
assert.throws(
  () => runSignedMockOtaWorkerTask({ taskId: 'task-3', taskType: 'READ_RATES', platform: 'agoda', password: 'never' }),
  /credential field/,
  'Hotel Ops worker payload rejects credential fields',
)
assert.equal(
  opsWorkerConfigured({ OTA_WORKER_BASE_URL: 'http://localhost:8788', OTA_WORKER_SHARED_SECRET: 'secret' }),
  true,
  'Hotel Ops worker config honors package environment variable names',
)
assert.equal(
  opsWorkerConfigured({ OTA_WORKER_URL: 'http://localhost:8788', OTA_WORKER_SECRET: 'secret' }),
  true,
  'Hotel Ops worker config remains compatible with legacy environment variable names',
)
const manualScanPolicy = getOpsScanPolicy({})
assert.equal(manualScanPolicy.schedule.mode, 'manual', 'Hotel Ops scan policy reports manual mode when no schedule is configured')
assert.equal(manualScanPolicy.schedule.configured, false, 'Hotel Ops scan policy does not fake an automatic schedule')
assert.equal(manualScanPolicy.thresholds.highDemandOccupancy, 0.7, 'Hotel Ops scan policy exposes high-demand occupancy threshold')
assert.equal(manualScanPolicy.thresholds.cancellationSpikeMultiplier, 2, 'Hotel Ops scan policy exposes cancellation spike multiplier')
assert.equal(manualScanPolicy.thresholds.strongRoomOccupancyMin, 0.75, 'Hotel Ops scan policy exposes strong room-type occupancy threshold')
assert.equal(manualScanPolicy.thresholds.weakRoomOccupancyMax, 0.35, 'Hotel Ops scan policy exposes weak room-type occupancy threshold')
const cronScanPolicy = getOpsScanPolicy({ HOTEL_OPS_SCAN_CRON: '*/15 * * * *' })
assert.equal(cronScanPolicy.schedule.mode, 'cron', 'Hotel Ops scan policy reports configured cron schedule')
assert.equal(cronScanPolicy.schedule.cron, '*/15 * * * *', 'Hotel Ops scan policy exposes cron expression without secrets')
const intervalScanPolicy = getOpsScanPolicy({ HOTEL_OPS_SCAN_INTERVAL_MINUTES: '30' })
assert.equal(intervalScanPolicy.schedule.mode, 'interval', 'Hotel Ops scan policy reports configured interval schedule')
assert.equal(intervalScanPolicy.schedule.intervalMinutes, 30, 'Hotel Ops scan policy exposes interval minutes')

const silentSchedulerLogger = { error: () => undefined }
const disabledOpsScheduler = createHotelOpsScanScheduler({ env: {}, logger: silentSchedulerLogger })
assert.equal(disabledOpsScheduler.getStatus().enabled, false, 'Hotel Ops scheduler stays disabled without an interval schedule')
assert.equal(disabledOpsScheduler.start().started, false, 'Hotel Ops scheduler does not start in manual mode')
assert.equal((await disabledOpsScheduler.runOnce('unit-test')).skipped, true, 'Hotel Ops scheduler skips manual-only scan runs')

const externalCronOpsScheduler = createHotelOpsScanScheduler({
  env: { HOTEL_OPS_SCAN_CRON: '*/15 * * * *' },
  logger: silentSchedulerLogger,
})
assert.equal(externalCronOpsScheduler.getStatus().enabled, false, 'Hotel Ops in-process scheduler does not pretend to run cron')
assert.equal(externalCronOpsScheduler.getStatus().disabledReason, 'external_cron', 'Hotel Ops cron schedule remains an external scheduler contract')

const intervalHandles = []
const scheduledScanCalls = []
const intervalOpsScheduler = createHotelOpsScanScheduler({
  env: { HOTEL_OPS_SCAN_INTERVAL_MINUTES: '15' },
  getPrisma: async () => ({ fixture: 'ops-prisma' }),
  runScan: async (prisma, input, actor) => {
    scheduledScanCalls.push({ prisma, input, actor })
    return [{ id: 'alert-scheduled-1' }]
  },
  logger: silentSchedulerLogger,
  setIntervalFn: (callback, milliseconds) => {
    const handle = {
      callback,
      milliseconds,
      unrefCalled: false,
      unref() {
        this.unrefCalled = true
      },
    }
    intervalHandles.push(handle)
    return handle
  },
  clearIntervalFn: (handle) => {
    handle.cleared = true
  },
  now: () => new Date('2026-06-30T00:00:00.000Z'),
})
const intervalSchedulerStart = intervalOpsScheduler.start()
assert.equal(intervalSchedulerStart.started, true, 'Hotel Ops interval scheduler starts when interval env is configured')
assert.equal(intervalHandles[0]?.milliseconds, 15 * 60_000, 'Hotel Ops interval scheduler uses configured interval minutes')
assert.equal(intervalHandles[0]?.unrefCalled, true, 'Hotel Ops interval scheduler does not keep Node alive by itself')
const scheduledRun = await intervalOpsScheduler.runOnce('unit-test')
assert.equal(scheduledRun.skipped, false, 'Hotel Ops interval scheduler can run a scan')
assert.equal(scheduledScanCalls.length, 1, 'Hotel Ops scheduler invokes scan service once')
assert.deepEqual(scheduledScanCalls[0].input, { source: 'scheduler', trigger: 'unit-test' }, 'Hotel Ops scheduler tags scan input as scheduled')
assert.equal(scheduledScanCalls[0].actor.role, 'SYSTEM', 'Hotel Ops scheduler runs scans as the system actor')
assert.equal(intervalOpsScheduler.getStatus().status, 'SUCCEEDED', 'Hotel Ops scheduler records successful scan status')
assert.equal(intervalOpsScheduler.getStatus().lastAlertCount, 1, 'Hotel Ops scheduler records alert count')
intervalOpsScheduler.stop()
assert.equal(intervalHandles[0]?.cleared, true, 'Hotel Ops scheduler clears its interval on stop')

let releaseOverlapScan
let overlapScanCount = 0
const overlapOpsScheduler = createHotelOpsScanScheduler({
  env: { HOTEL_OPS_SCAN_INTERVAL_MINUTES: '5' },
  prisma: { fixture: 'overlap-prisma' },
  runScan: async () => {
    overlapScanCount += 1
    return new Promise((resolveScan) => {
      releaseOverlapScan = () => resolveScan([])
    })
  },
  logger: silentSchedulerLogger,
})
const firstOverlapRun = overlapOpsScheduler.runOnce('first')
await Promise.resolve()
const skippedOverlapRun = await overlapOpsScheduler.runOnce('second')
assert.equal(skippedOverlapRun.skipped, true, 'Hotel Ops scheduler skips overlapping scan runs')
assert.equal(skippedOverlapRun.reason, 'already_running', 'Hotel Ops scheduler reports overlap reason')
releaseOverlapScan()
await firstOverlapRun
assert.equal(overlapScanCount, 1, 'Hotel Ops scheduler prevents duplicate overlapping scan execution')

const failingOpsScheduler = createHotelOpsScanScheduler({
  env: { HOTEL_OPS_SCAN_INTERVAL_MINUTES: '5' },
  prisma: { fixture: 'failure-prisma' },
  runScan: async () => {
    throw new Error('token=super-secret-value')
  },
  logger: silentSchedulerLogger,
})
const failedScheduledRun = await failingOpsScheduler.runOnce('failure')
assert.equal(failedScheduledRun.skipped, false, 'Hotel Ops scheduler reports failed scan attempts')
assert.equal(failingOpsScheduler.getStatus().status, 'FAILED', 'Hotel Ops scheduler records failed scan status')
assert.match(failingOpsScheduler.getStatus().lastError, /token=\[redacted\]/, 'Hotel Ops scheduler redacts credential-like failure text')
assert.equal(failingOpsScheduler.getStatus().lastError.includes('super-secret-value'), false, 'Hotel Ops scheduler does not retain secret-like failure values')

const unauthenticatedBookingAdapter = createBookingComAdapter({
  env: {},
  now: '2026-06-30T00:00:00.000Z',
})
const unauthenticatedBookingHealth = await unauthenticatedBookingAdapter.healthCheck()
assert.equal(unauthenticatedBookingHealth.authenticated, false, 'Booking.com adapter reports missing server credentials')
assert.equal(unauthenticatedBookingHealth.requiresHuman, true, 'Booking.com adapter requests human setup when credentials are missing')
assert.equal(JSON.stringify(unauthenticatedBookingHealth).includes('booking-password'), false, 'Booking.com adapter health does not expose credential values')

const bookingAdapter = createBookingComAdapter({
  env: {
    BOOKING_USERNAME: 'booking-user',
    BOOKING_PASSWORD: 'booking-password',
  },
  now: '2026-06-30T00:00:00.000Z',
})
const bookingAuth = await bookingAdapter.ensureAuthenticated()
assert.equal(bookingAuth.authenticated, true, 'Booking.com adapter can authenticate in dry-run mode when server credentials exist')
const bookingDryRunRate = await bookingAdapter.updateRate({
  taskId: 'booking-task-1',
  roomType: 'Deluxe Room',
  dateStart: '2026-07-03',
  dateEnd: '2026-07-04',
  amount: 2200,
  currency: 'THB',
  dryRun: true,
})
assert.equal(bookingDryRunRate.changed, false, 'Booking.com dry-run rate update does not mutate OTA state')
assert.equal(bookingDryRunRate.proofScreenshots.length, 2, 'Booking.com dry-run write records before/after proof placeholders')
assert.equal(bookingDryRunRate.proofScreenshots.every((item) => item.redactionStatus === 'SAFE'), true, 'Booking.com dry-run proof placeholders are marked safe')
assert.equal(JSON.stringify(bookingDryRunRate).includes('booking-password'), false, 'Booking.com dry-run result does not include OTA credentials')
await assert.rejects(
  () => bookingAdapter.updateRate({
    taskId: 'booking-task-2',
    roomType: 'Deluxe Room',
    dateStart: '2026-07-03',
    dateEnd: '2026-07-04',
    amount: 2200,
    currency: 'THB',
    dryRun: false,
  }),
  /real Booking\.com browser writes are not implemented/,
  'Booking.com adapter rejects non-dry-run writes until selectors are verified',
)
const bookingHumanTask = await executeBookingComTask({
  taskId: 'booking-task-3',
  taskType: 'UPDATE_RATE',
  platform: 'booking',
  roomType: 'Deluxe Room',
  dateStart: '2026-07-03',
  dateEnd: '2026-07-04',
  rate: { amount: 2200, currency: 'THB' },
  dryRun: true,
}, {
  env: {
    BOOKING_USERNAME: 'booking-user',
    BOOKING_PASSWORD: 'booking-password',
    BOOKING_FORCE_HUMAN_CHALLENGE: 'CAPTCHA',
  },
  now: '2026-06-30T00:00:00.000Z',
})
assert.equal(bookingHumanTask.status, 'NEEDS_HUMAN', 'Booking.com adapter returns NEEDS_HUMAN for CAPTCHA instead of bypassing it')
assert.equal(bookingHumanTask.errorCode, 'NEEDS_HUMAN_CAPTCHA', 'Booking.com adapter preserves the human challenge reason')

const bookingDraftReply = await executeBookingComTask({
  taskId: 'booking-task-4',
  taskType: 'DRAFT_GUEST_REPLY',
  platform: 'booking',
  message: 'Late check-in is confirmed.',
  dryRun: true,
}, {
  env: {
    BOOKING_USERNAME: 'booking-user',
    BOOKING_PASSWORD: 'booking-password',
  },
  now: '2026-06-30T00:00:00.000Z',
})
assert.equal(bookingDraftReply.status, 'SUCCEEDED', 'Booking.com adapter supports draft guest replies in dry-run mode')
assert.equal(bookingDraftReply.proofScreenshots.length, 1, 'Booking.com draft guest reply records trace proof')
assert.equal(JSON.stringify(bookingDraftReply).includes('booking-password'), false, 'Booking.com draft reply result does not expose credentials')

const bookingSendReply = await executeBookingComTask({
  taskId: 'booking-task-5',
  taskType: 'SEND_GUEST_REPLY',
  platform: 'booking',
  message: 'Door code password=guest-secret',
  dryRun: true,
}, {
  env: {
    BOOKING_USERNAME: 'booking-user',
    BOOKING_PASSWORD: 'booking-password',
  },
  now: '2026-06-30T00:00:00.000Z',
})
assert.equal(bookingSendReply.status, 'SUCCEEDED', 'Booking.com adapter supports approved send guest replies in dry-run mode')
assert.equal(bookingSendReply.proofScreenshots.length, 2, 'Booking.com send guest reply records before/after proof placeholders')
assert.equal(JSON.stringify(bookingSendReply).includes('guest-secret'), false, 'Booking.com send reply dry-run result redacts credential-like message text')

const skeletonStatuses = otaPlatformSkeletonStatuses({ env: {}, signedWorkerConfigured: true })
assert.deepEqual(
  skeletonStatuses.map((item) => item.platform),
  ['agoda', 'trip', 'expedia'],
  'Hotel Ops exposes explicit dry-run adapter skeletons for Agoda, Trip.com, and Expedia',
)
assert.equal(
  skeletonStatuses.every((item) => item.status === 'adapter-skeleton-credentials-needed'),
  true,
  'Non-Booking OTA skeletons report credential/setup status instead of generic mock readiness',
)

let setupOperationalCountCalled = false
await assert.rejects(
  () => completeInitialSetup({
    property: {
      findUnique: async () => ({ id: 'property-setup-test', code: 'SANDBOX', name: 'SANDBOX HOTEL' }),
    },
    user: {
      count: async () => 1,
    },
    reservation: { count: async () => { setupOperationalCountCalled = true; return 0 } },
    guest: { count: async () => { setupOperationalCountCalled = true; return 0 } },
    folio: { count: async () => { setupOperationalCountCalled = true; return 0 } },
    payment: { count: async () => { setupOperationalCountCalled = true; return 0 } },
    charge: { count: async () => { setupOperationalCountCalled = true; return 0 } },
  }, {}),
  /Initial setup has already been completed/,
  'Completed setup rejects before setup payload validation',
)
assert.equal(setupOperationalCountCalled, false, 'Completed setup check exits before operational record counts')

const agodaAdapter = createOtaPlatformSkeletonAdapter('agoda', { now: '2026-06-30T00:00:00.000Z' })
const agodaHealth = await agodaAdapter.healthCheck()
assert.equal(agodaHealth.platform, 'agoda', 'Agoda adapter skeleton reports its platform')
assert.equal(agodaHealth.authenticated, false, 'Agoda adapter skeleton does not pretend credentials are configured')
const agodaDryRunRate = await agodaAdapter.updateRate({
  taskId: 'agoda-task-1',
  roomType: 'Deluxe Room',
  dateStart: '2026-07-03',
  dateEnd: '2026-07-04',
  amount: 2200,
  currency: 'THB',
  dryRun: true,
})
assert.equal(agodaDryRunRate.changed, false, 'Agoda dry-run rate update does not mutate OTA state')
assert.equal(agodaDryRunRate.proofScreenshots.length, 2, 'Agoda dry-run write records before/after proof placeholders')
await assert.rejects(
  () => agodaAdapter.updateRate({
    taskId: 'agoda-task-2',
    roomType: 'Deluxe Room',
    dateStart: '2026-07-03',
    dateEnd: '2026-07-04',
    amount: 2200,
    currency: 'THB',
    dryRun: false,
  }),
  /Agoda real browser writes are not implemented/,
  'Agoda adapter skeleton rejects non-dry-run writes until selectors are verified',
)
const agodaSkeletonTask = await executeOtaPlatformSkeletonTask({
  taskId: 'agoda-task-3',
  taskType: 'UPDATE_RATE',
  platform: 'agoda',
  roomType: 'Deluxe Room',
  dateStart: '2026-07-03',
  dateEnd: '2026-07-04',
  rate: { amount: 2200, currency: 'THB' },
  dryRun: true,
})
assert.equal(agodaSkeletonTask.status, 'SUCCEEDED', 'Agoda adapter skeleton executes signed dry-run tasks')
assert.equal(agodaSkeletonTask.data.adapterMode, 'platform-skeleton', 'Agoda adapter skeleton labels worker results')
const tripSelectorFailure = await executeOtaPlatformSkeletonTask({
  taskId: 'trip-task-1',
  taskType: 'UPDATE_RATE',
  platform: 'trip',
  roomType: 'Deluxe Room',
  dateStart: '2026-07-03',
  dateEnd: '2026-07-04',
  rate: { amount: 2200, currency: 'THB' },
  dryRun: true,
  mockScenario: 'selector_failure',
})
assert.equal(tripSelectorFailure.status, 'FAILED', 'Trip.com adapter skeleton preserves selector-failure test path')
assert.equal(tripSelectorFailure.errorCode, 'MOCK_SELECTOR_FAILURE', 'Trip.com adapter skeleton preserves selector-failure error code')
const expediaHumanChallenge = await executeOtaPlatformSkeletonTask({
  taskId: 'expedia-task-1',
  taskType: 'UPDATE_RATE',
  platform: 'expedia',
  roomType: 'Deluxe Room',
  dateStart: '2026-07-03',
  dateEnd: '2026-07-04',
  rate: { amount: 2200, currency: 'THB' },
  dryRun: true,
  mockScenario: 'human_challenge',
})
assert.equal(expediaHumanChallenge.status, 'NEEDS_HUMAN', 'Expedia adapter skeleton preserves human-challenge test path')
assert.equal(expediaHumanChallenge.errorCode, 'NEEDS_HUMAN_CHALLENGE', 'Expedia adapter skeleton preserves human-challenge error code')

const workerTask = {
  id: 'ops-task-1',
  taskType: 'UPDATE_RATE',
  platform: 'booking',
  hotelId: 'SANDBOX',
  roomType: 'Deluxe Room',
  dateStart: new Date('2026-07-03T00:00:00.000Z'),
  dateEnd: new Date('2026-07-04T00:00:00.000Z'),
  rateAmount: 2200,
  rateCurrency: 'THB',
  availabilityRooms: null,
  availabilityStatus: null,
  rawMessage: 'Change Booking Deluxe Room to 2,200 THB.',
}
const workerPayload = buildOpsWorkerTaskPayload(workerTask)
assert.equal(workerPayload.taskId, 'ops-task-1', 'Hotel Ops executor builds a worker task id')
assert.equal(workerPayload.rate.amount, 2200, 'Hotel Ops executor maps rate amount into worker payload')
assert.equal(JSON.stringify(workerPayload).includes(workerTask.rawMessage), false, 'Hotel Ops executor does not send raw free text to worker')
assert.equal(JSON.stringify(workerPayload).includes('password'), false, 'Hotel Ops executor payload contains no credential fields')

const messageWorkerPayload = buildOpsWorkerTaskPayload({
  ...workerTask,
  id: 'ops-task-message',
  taskType: 'SEND_GUEST_REPLY',
  message: 'Late check-in is confirmed.',
  rawMessage: 'Send guest reply: Late check-in is confirmed.',
})
assert.equal(messageWorkerPayload.message, 'Late check-in is confirmed.', 'Hotel Ops executor carries structured guest reply message text')
assert.equal(JSON.stringify(messageWorkerPayload).includes('Send guest reply:'), false, 'Hotel Ops executor does not send raw guest reply command text')

const localWorkerResult = await executeOpsWorkerTask(workerTask, {
  env: {
    BOOKING_USERNAME: 'booking-user',
    BOOKING_PASSWORD: 'booking-password',
  },
})
assert.equal(localWorkerResult.workerMode, 'local-signed-worker', 'Hotel Ops executor uses local signed worker fallback when no worker URL is configured')
assert.equal(localWorkerResult.status, 'SUCCEEDED', 'Hotel Ops executor local worker returns structured success')
assert.equal(localWorkerResult.proofScreenshots.length, 2, 'Hotel Ops executor stores Booking.com dry-run proof placeholders')
assert.equal(JSON.stringify(localWorkerResult).includes('booking-password'), false, 'Hotel Ops executor never returns OTA credentials')

const localReplyWorkerResult = await executeOpsWorkerTask({
  ...workerTask,
  id: 'ops-task-reply',
  taskType: 'SEND_GUEST_REPLY',
  message: 'Late check-in is confirmed.',
}, {
  env: {
    BOOKING_USERNAME: 'booking-user',
    BOOKING_PASSWORD: 'booking-password',
  },
})
assert.equal(localReplyWorkerResult.status, 'SUCCEEDED', 'Hotel Ops executor local worker handles Booking.com guest reply dry-run tasks')
assert.equal(localReplyWorkerResult.proofScreenshots.length, 2, 'Hotel Ops executor stores reply before/after proof placeholders')

let remoteWorkerRequestChecked = false
const remoteWorkerResult = await executeOpsWorkerTask({
  ...workerTask,
  id: 'ops-task-remote',
  platform: 'agoda',
}, {
  env: {
    OTA_WORKER_BASE_URL: 'https://worker.example.test/tasks',
    OTA_WORKER_SHARED_SECRET: 'remote-worker-secret',
  },
  fetchImpl: async (url, request) => {
    assert.equal(url, 'https://worker.example.test/tasks', 'Hotel Ops executor posts to configured worker URL')
    const verification = verifyOpsWorkerRequest({
      body: request.body,
      headers: request.headers,
      secret: 'remote-worker-secret',
      now: Number(request.headers['x-ops-worker-timestamp']),
    })
    assert.equal(verification.ok, true, 'Hotel Ops executor signs remote worker requests')
    assert.equal(request.body.includes(workerTask.rawMessage), false, 'Hotel Ops remote worker body omits raw command text')
    remoteWorkerRequestChecked = true
    return new Response(JSON.stringify({
      ok: true,
      data: {
        taskId: 'ops-task-remote',
        status: 'SUCCEEDED',
        summary: 'Remote worker accepted task.',
        proofScreenshots: [],
        data: { dryRun: true },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  },
})
assert.equal(remoteWorkerRequestChecked, true, 'Hotel Ops executor exercised the remote signed worker path')
assert.equal(remoteWorkerResult.workerMode, 'remote-signed-worker', 'Hotel Ops executor labels remote worker results')
assert.equal(remoteWorkerResult.signed, true, 'Hotel Ops executor records signed worker execution')

const fixedOpsDate = new Date('2026-06-30T00:00:00.000Z')
const rateCommand = parseHotelOpsCommand('Change Agoda Deluxe Room to 2,200 THB this Friday and Saturday.', { now: fixedOpsDate })
assert.equal(rateCommand.taskType, 'UPDATE_RATE', 'Hotel Ops parser recognizes rate updates')
assert.equal(rateCommand.platform, 'agoda', 'Hotel Ops parser detects Agoda platform')
assert.equal(rateCommand.riskLevel, 'HIGH', 'Hotel Ops rate updates are high risk')
assert.equal(rateCommand.approvalRequired, true, 'Hotel Ops rate updates require approval')
assert.equal(rateCommand.dateRange.start, '2026-07-03', 'Hotel Ops parser resolves this Friday')
assert.equal(rateCommand.dateRange.end, '2026-07-04', 'Hotel Ops parser resolves Saturday')
assert.equal(validateParsedOpsTask(rateCommand).valid, true, 'Hotel Ops strict parser schema accepts complete parsed rate tasks')
const invalidDateParsedTask = validateParsedOpsTask({ ...rateCommand, dateRange: { start: '2026-02-30', end: '2026-07-04' } })
assert.equal(invalidDateParsedTask.valid, false, 'Hotel Ops strict parser schema rejects impossible calendar dates')
assert.match(invalidDateParsedTask.reason, /dateRange\.start/, 'Hotel Ops strict parser schema points to the invalid date field')
const invalidConfidenceParsedTask = validateParsedOpsTask({ ...rateCommand, confidence: 1.5 })
assert.equal(invalidConfidenceParsedTask.valid, false, 'Hotel Ops strict parser schema rejects confidence values outside 0-1')
assert.match(invalidConfidenceParsedTask.reason, /confidence/, 'Hotel Ops strict parser schema points to confidence violations')
const unexpectedSecretFieldParsedTask = validateParsedOpsTask({ ...rateCommand, password: 'never-store-this' })
assert.equal(unexpectedSecretFieldParsedTask.valid, false, 'Hotel Ops strict parser schema rejects unexpected credential-like parser fields')
assert.match(unexpectedSecretFieldParsedTask.reason, /password/, 'Hotel Ops strict parser schema identifies unrecognized parser fields')
assert.equal(hotelOpsAiParserStatus({ HOTEL_OPS_AI_PARSER_ENABLED: 'true' }).configured, false, 'Hotel Ops AI parser is not configured without a backend OpenAI key')
assert.equal(hotelOpsAiParserStatus({ HOTEL_OPS_AI_PARSER_ENABLED: 'true', OPENAI_API_KEY: 'test-key' }).mode, 'openai_responses', 'Hotel Ops AI parser status reports configured OpenAI Responses mode')
let openAiParserRequestBody = ''
const openAiParsedCommand = await parseHotelOpsCommandWithOpenAi('Change Agoda Deluxe Room to 2,200 THB 2026-07-03 to 2026-07-04 password is redaction-marker', {
  apiKey: 'unit-test-value',
  model: 'gpt-test-parser',
  fetchImpl: async (url, request) => {
    assert.equal(url, 'https://api.openai.com/v1/responses', 'Hotel Ops AI parser uses the OpenAI Responses endpoint')
    assert.equal(request.headers.authorization, 'Bearer unit-test-value', 'Hotel Ops AI parser sends the API key only in the backend authorization header')
    openAiParserRequestBody = request.body
    assert.equal(openAiParserRequestBody.includes('redaction-marker'), false, 'Hotel Ops AI parser redacts credential-like command text before model submission')
    assert.equal(openAiParserRequestBody.includes('json_schema'), true, 'Hotel Ops AI parser requests strict JSON schema output')
    return new Response(JSON.stringify({
      output_text: JSON.stringify({
        ...rateCommand,
        hotelId: 'model-hallucinated-hotel',
        riskLevel: 'LOW',
        approvalRequired: false,
        rationale: 'Model parsed the requested rate update.',
      }),
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  },
})
assert.equal(openAiParsedCommand.taskType, 'UPDATE_RATE', 'Hotel Ops AI parser returns parsed task objects from model JSON')
assert.equal(openAiParsedCommand.hotelId, 'SANDBOX', 'Hotel Ops AI parser normalizes model hotel id to the backend property code')
assert.equal(openAiParsedCommand.riskLevel, 'HIGH', 'Hotel Ops AI parser output cannot downgrade backend risk policy')
assert.equal(openAiParsedCommand.approvalRequired, true, 'Hotel Ops AI parser output cannot bypass backend approval policy')
await assert.rejects(
  () => parseHotelOpsCommandWithOpenAi('Change Agoda Deluxe Room to 2,200 THB 2026-07-03 to 2026-07-04.', {
    apiKey: 'unit-test-value',
    fetchImpl: async () => new Response(JSON.stringify({
      output_text: JSON.stringify({ ...rateCommand, confidence: 2 }),
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  }),
  /Parsed task failed schema validation/,
  'Hotel Ops AI parser rejects malformed model output before permission decisions',
)
const parserFallbackCommand = await parseHotelOpsCommandForSubmission('Check bookings for next weekend.', {
  env: { HOTEL_OPS_AI_PARSER_ENABLED: 'true', OPENAI_API_KEY: 'unit-test-value' },
  fetchImpl: async () => {
    throw new Error('provider failed token=redaction-marker')
  },
  now: fixedOpsDate,
})
assert.equal(parserFallbackCommand.parserMode, 'deterministic_fallback', 'Hotel Ops command parser falls back to deterministic parsing when the AI provider fails')
assert.equal(parserFallbackCommand.parsed.taskType, 'SCAN_BOOKINGS', 'Hotel Ops deterministic fallback still returns a controlled parsed task')
assert.equal(parserFallbackCommand.parserFallbackReason.includes('redaction-marker'), false, 'Hotel Ops parser fallback reason redacts credential-like provider errors')

const scanCommand = parseHotelOpsCommand('Check bookings for next weekend.', { now: fixedOpsDate })
assert.equal(['READ_RESERVATIONS', 'SCAN_BOOKINGS'].includes(scanCommand.taskType), true, 'Hotel Ops parser maps booking checks to read-only tasks')
assert.equal(scanCommand.riskLevel, 'LOW', 'Hotel Ops booking scans are low risk')
assert.equal(scanCommand.approvalRequired, false, 'Hotel Ops booking scans do not require owner approval')

const readAvailabilityCommand = parseHotelOpsCommand('Check Booking Deluxe Room availability this Friday and Saturday.', { now: fixedOpsDate })
assert.equal(readAvailabilityCommand.taskType, 'READ_AVAILABILITY', 'Hotel Ops parser maps availability checks to read-only tasks')
assert.equal(readAvailabilityCommand.roomType, 'Deluxe Room', 'Hotel Ops availability check keeps the room type')
assert.equal(readAvailabilityCommand.riskLevel, 'LOW', 'Hotel Ops availability checks are low risk')

const availabilityCommand = parseHotelOpsCommand('Set Booking Deluxe Room availability to 3 rooms this Friday and Saturday.', { now: fixedOpsDate })
assert.equal(availabilityCommand.taskType, 'UPDATE_AVAILABILITY', 'Hotel Ops parser maps availability changes to update tasks')
assert.equal(availabilityCommand.platform, 'booking', 'Hotel Ops availability parser detects Booking platform')
assert.equal(availabilityCommand.availability.rooms, 3, 'Hotel Ops availability parser extracts rooms available')
assert.equal(availabilityCommand.availability.status, 'open', 'Hotel Ops availability parser marks positive rooms as open')
assert.equal(availabilityCommand.approvalRequired, true, 'Hotel Ops availability updates require approval')

const ambiguousAvailabilityCommand = parseHotelOpsCommand('Set Booking availability to 3 rooms.', { now: fixedOpsDate })
assert.equal(ambiguousAvailabilityCommand.taskType, 'NO_OP_CLARIFY', 'Hotel Ops parser requests clarification for incomplete availability updates')
assert.equal(ambiguousAvailabilityCommand.missingFields.includes('roomType'), true, 'Hotel Ops incomplete availability update asks for room type')
assert.equal(ambiguousAvailabilityCommand.missingFields.includes('dateRange'), true, 'Hotel Ops incomplete availability update asks for dates')

const guestMessagesCommand = parseHotelOpsCommand('Read guest messages from Booking.com.', { now: fixedOpsDate })
assert.equal(guestMessagesCommand.taskType, 'READ_GUEST_MESSAGES', 'Hotel Ops parser maps guest message reads to read-only message tasks')
assert.equal(guestMessagesCommand.riskLevel, 'LOW', 'Hotel Ops guest message reads are low risk')

const draftReplyCommand = parseHotelOpsCommand('Draft Booking guest reply: Late check-in is confirmed.', { now: fixedOpsDate })
assert.equal(draftReplyCommand.taskType, 'DRAFT_GUEST_REPLY', 'Hotel Ops parser maps draft reply commands')
assert.equal(evaluateOpsPermission(draftReplyCommand, { id: 'viewer', role: 'VIEWER' }).allowed, false, 'Hotel Ops viewer role cannot create draft reply tasks')
assert.equal(evaluateOpsPermission(draftReplyCommand, { id: 'contractor', role: 'CONTRACTOR' }).allowed, false, 'Hotel Ops unknown roles default to viewer permissions')

const sendReplyCommand = parseHotelOpsCommand('Send Booking guest reply: Late check-in is confirmed.', { now: fixedOpsDate })
assert.equal(sendReplyCommand.taskType, 'SEND_GUEST_REPLY', 'Hotel Ops parser maps explicit send reply commands')
assert.equal(sendReplyCommand.platform, 'booking', 'Hotel Ops send reply parser requires and keeps the target platform')
assert.equal(sendReplyCommand.approvalRequired, true, 'Hotel Ops send reply tasks require approval')
assert.equal(sendReplyCommand.message, 'Late check-in is confirmed.', 'Hotel Ops parser extracts structured guest reply text')
const sendReplyDecision = evaluateOpsPermission(sendReplyCommand, { id: 'manager', role: 'MANAGER' })
assert.equal(sendReplyDecision.requiredApprovalRole, 'OWNER', 'Hotel Ops send-reply writes require owner approval by default')

const missingPlatformReplyCommand = parseHotelOpsCommand('Send guest reply: Late check-in is confirmed.', { now: fixedOpsDate })
assert.equal(missingPlatformReplyCommand.taskType, 'NO_OP_CLARIFY', 'Hotel Ops parser asks for platform before send-reply writes')
assert.equal(missingPlatformReplyCommand.missingFields.includes('platform'), true, 'Hotel Ops send-reply write asks for platform')

const redactedReplyCommand = parseHotelOpsCommand('Send Booking guest reply: password=guest-secret', { now: fixedOpsDate })
assert.equal(redactedReplyCommand.message.includes('guest-secret'), false, 'Hotel Ops parser redacts credential-like text from structured messages')

const forbiddenCommand = parseHotelOpsCommand('Cancel all bookings and refund guests.', { now: fixedOpsDate })
assert.equal(forbiddenCommand.taskType, 'FORBIDDEN', 'Hotel Ops parser blocks destructive booking/refund command')
assert.equal(evaluateOpsPermission(forbiddenCommand, { id: 'owner', role: 'ADMIN' }).allowed, false, 'Hotel Ops forbidden commands cannot execute')
const criticalForbiddenCommands = [
  'Issue a refund for Booking reservation ABC123.',
  'Change the Booking cancellation policy to non-refundable.',
  'Update the Expedia payment policy.',
  'Delete the Agoda listing.',
  'Run arbitrary browser command on Booking.com.',
  'Access an unauthorized OTA account.',
]
for (const forbiddenText of criticalForbiddenCommands) {
  const parsedForbidden = parseHotelOpsCommand(forbiddenText, { now: fixedOpsDate })
  assert.equal(parsedForbidden.taskType, 'FORBIDDEN', `Hotel Ops parser blocks prohibited command: ${forbiddenText}`)
  assert.equal(evaluateOpsPermission(parsedForbidden, { id: 'owner', role: 'ADMIN' }).allowed, false, `Hotel Ops permission guard blocks prohibited command: ${forbiddenText}`)
}

const ambiguousRateCommand = parseHotelOpsCommand('Raise Booking price to 3000.', { now: fixedOpsDate })
assert.equal(ambiguousRateCommand.taskType, 'NO_OP_CLARIFY', 'Hotel Ops parser requests clarification for incomplete rate command')
assert.equal(ambiguousRateCommand.missingFields.includes('dateRange'), true, 'Hotel Ops incomplete rate command asks for dates')
assert.equal(ambiguousRateCommand.missingFields.includes('roomType'), true, 'Hotel Ops incomplete rate command asks for room type')

const missingPlatformRateCommand = parseHotelOpsCommand('Set Deluxe Room to 2,200 THB 2026-07-03 to 2026-07-04.', { now: fixedOpsDate })
assert.equal(missingPlatformRateCommand.taskType, 'NO_OP_CLARIFY', 'Hotel Ops parser asks for platform before rate writes')
assert.equal(missingPlatformRateCommand.missingFields.includes('platform'), true, 'Hotel Ops incomplete rate write asks for platform')

const allRoomsRateCommand = parseHotelOpsCommand('Set all channels all rooms to 2,200 THB 2026-07-03 to 2026-07-04.', { now: fixedOpsDate })
assert.equal(allRoomsRateCommand.taskType, 'UPDATE_RATE', 'Hotel Ops parser accepts all-room recommendation tasks')
assert.equal(allRoomsRateCommand.platform, 'all', 'Hotel Ops parser accepts explicit all-channel writes')
assert.equal(allRoomsRateCommand.roomType, 'All Rooms', 'Hotel Ops parser preserves all-room target')

const allRoomsCloseCommand = parseHotelOpsCommand('Close all channels all rooms 2026-07-03 to 2026-07-04.', { now: fixedOpsDate })
assert.equal(allRoomsCloseCommand.taskType, 'CLOSE_ROOM', 'Hotel Ops parser can recognize all-room close requests')
assert.equal(allRoomsCloseCommand.roomType, 'All Rooms', 'Hotel Ops parser preserves all-room close targets')
const allRoomsCloseDecision = evaluateOpsPermission(allRoomsCloseCommand, { id: 'owner', role: 'ADMIN' })
assert.equal(allRoomsCloseDecision.allowed, false, 'Hotel Ops permission guard blocks full-property close requests')
assert.equal(allRoomsCloseDecision.approvalRequired, false, 'Hotel Ops full-property close requests are not approval-queueable')

const photoUpdateCommand = parseHotelOpsCommand('Update Booking listing photos.', { now: fixedOpsDate })
assert.equal(photoUpdateCommand.taskType, 'UPDATE_PHOTOS', 'Hotel Ops parser maps photo changes to the critical disabled photo task')
assert.equal(photoUpdateCommand.platform, 'booking', 'Hotel Ops photo parser detects the target platform')
assert.equal(photoUpdateCommand.riskLevel, 'CRITICAL', 'Hotel Ops photo updates are critical risk')
const photoUpdateDecision = evaluateOpsPermission(photoUpdateCommand, { id: 'owner', role: 'ADMIN' })
assert.equal(photoUpdateDecision.allowed, false, 'Hotel Ops permission guard blocks disabled photo changes in the MVP')
assert.equal(photoUpdateDecision.requiredApprovalRole, 'OWNER', 'Hotel Ops disabled photo changes still identify owner approval role')

assert.equal(normalizeOpsSourceChannel('LINE'), 'line', 'Hotel Ops source channel normalization accepts known channels case-insensitively')
assert.throws(
  () => normalizeOpsSourceChannel('browser-extension'),
  /source channel is not allowed/,
  'Hotel Ops source channel normalization rejects unsupported channels before Prisma writes',
)
const opsPolicy = getOpsPolicy()
assert.equal(opsPolicy.defaults.dryRun, true, 'Hotel Ops exported policy defaults to dry-run mode')
assert.equal(opsPolicy.taskRules.UPDATE_RATE.requiredApprovalRole, 'OWNER', 'Hotel Ops exported policy shows owner approval for rate changes')
assert.equal(opsPolicy.taskRules.UPDATE_RATE.limits.minRate, 800, 'Hotel Ops exported policy includes the rate floor')
assert.equal(opsPolicy.taskRules.UPDATE_RATE.limits.maxRate, 6000, 'Hotel Ops exported policy includes the rate ceiling')
assert.equal(opsPolicy.taskRules.UPDATE_PHOTOS.enabledInMvp, false, 'Hotel Ops exported policy shows disabled photo updates')
assert.equal(opsPolicy.taskRules.CLOSE_ROOM.limits.preventClosingAllRooms, true, 'Hotel Ops exported policy shows all-room close protection')
assert.equal(opsPolicy.emergencyStop.blockTaskTypes.includes('UPDATE_RATE'), true, 'Hotel Ops exported policy includes rate updates in emergency-stop coverage')
assert.equal(opsPolicy.taskRules.FORBIDDEN.execute, false, 'Hotel Ops exported policy marks forbidden tasks as non-executable')
const uiCommandKeyA = hotelOpsIdempotency.createHotelOpsCommandIdempotencyKey(' Check bookings  for next weekend. ')
const uiCommandKeyB = hotelOpsIdempotency.createHotelOpsCommandIdempotencyKey(' Check bookings  for next weekend. ')
assert.match(uiCommandKeyA, /^ui:check-bookings-for-next-weekend:[a-z0-9-]+$/i, 'Hotel Ops UI command idempotency keys include a safe command hint')
assert.notEqual(uiCommandKeyA, uiCommandKeyB, 'Hotel Ops UI command idempotency keys are per-submit tokens')
assert.equal(uiCommandKeyA.includes('  '), false, 'Hotel Ops UI command idempotency keys normalize whitespace')

const lineOpsEnv = {
  HOTEL_OPS_LINE_COMMANDS_ENABLED: 'true',
  HOTEL_OPS_LINE_COMMAND_PREFIX: '/ops',
  HOTEL_OPS_LINE_COMMAND_USER_MAP: JSON.stringify({ 'line-user-1': 'manager-line' }),
}
const lineOpsEvent = {
  source: { userId: 'line-user-1', type: 'user' },
  message: { id: 'line-message-1', type: 'text', text: '/ops Check bookings for next weekend.' },
  timestamp: fixedOpsDate.getTime(),
}
assert.equal(lineOpsCommandIntakeStatus({}).enabled, false, 'Hotel Ops LINE command intake is disabled by default')
assert.equal(lineOpsCommandIntakeStatus(lineOpsEnv).userMapConfigured, true, 'Hotel Ops LINE command intake reports an allowlist when configured')
assert.equal(parseLineOpsCommandUserMap({ HOTEL_OPS_LINE_COMMAND_USER_MAP: '{bad-json' }).ok, false, 'Hotel Ops LINE command user map rejects invalid JSON')
assert.equal(extractLineOpsCommandText(lineOpsEvent, { ...lineOpsEnv, HOTEL_OPS_LINE_COMMANDS_ENABLED: 'false' }), null, 'Hotel Ops LINE command text is ignored until enabled')
assert.equal(extractLineOpsCommandText({ ...lineOpsEvent, message: { ...lineOpsEvent.message, text: 'Check bookings for next weekend.' } }, lineOpsEnv), null, 'Hotel Ops LINE command text requires the configured prefix')
assert.equal(extractLineOpsCommandText(lineOpsEvent, lineOpsEnv), 'Check bookings for next weekend.', 'Hotel Ops LINE command text strips the configured prefix')
assert.equal(lineOpsCommandIdempotencyKey(lineOpsEvent), 'line:line-message-1', 'Hotel Ops LINE command idempotency uses the LINE message id')
const lineOpsPrisma = {
  user: {
    findFirst: async ({ where }) => {
      assert.deepEqual(where.OR, [{ id: 'manager-line' }, { username: 'manager-line' }, { email: 'manager-line' }], 'Hotel Ops LINE command actor lookup accepts id, username, or email refs')
      return {
        id: 'manager-line-id',
        username: 'manager-line',
        email: null,
        firstName: 'Line',
        lastName: 'Manager',
        role: 'MANAGER',
        active: true,
      }
    },
  },
}
const resolvedLineOpsEvent = await resolveLineOpsCommandEvent(lineOpsPrisma, lineOpsEvent, { env: lineOpsEnv })
assert.equal(resolvedLineOpsEvent.status, 'accepted', 'Hotel Ops LINE command intake accepts allowlisted users')
assert.equal(resolvedLineOpsEvent.actor.id, 'manager-line-id', 'Hotel Ops LINE command intake maps LINE user to an active PMS user')
const unmappedLineOpsEvent = await resolveLineOpsCommandEvent(lineOpsPrisma, { ...lineOpsEvent, source: { userId: 'unknown-line-user' } }, { env: lineOpsEnv })
assert.equal(unmappedLineOpsEvent.status, 'skipped', 'Hotel Ops LINE command intake skips non-allowlisted LINE users')
let submittedLineOpsCommand = null
const processedLineOpsEvents = await processLineOpsCommandEvents(lineOpsPrisma, [lineOpsEvent], {
  env: lineOpsEnv,
  submitCommand: async (_prisma, input, actor) => {
    submittedLineOpsCommand = { input, actor }
    return { task: { id: 'line-task-1' }, duplicate: false }
  },
})
assert.equal(processedLineOpsEvents[0].status, 'accepted', 'Hotel Ops LINE command processing submits allowlisted commands')
assert.equal(submittedLineOpsCommand.input.sourceChannel, 'line', 'Hotel Ops LINE command processing tags source channel as line')
assert.equal(submittedLineOpsCommand.input.idempotencyKey, 'line:line-message-1', 'Hotel Ops LINE command processing passes retry-safe idempotency key')
assert.equal(submittedLineOpsCommand.actor.id, 'manager-line-id', 'Hotel Ops LINE command processing submits as the mapped PMS actor')

const emailOpsEnv = {
  HOTEL_OPS_EMAIL_COMMANDS_ENABLED: 'true',
  HOTEL_OPS_EMAIL_COMMAND_PREFIX: '/ops',
  HOTEL_OPS_EMAIL_COMMAND_USER_MAP: JSON.stringify({ 'manager@example.test': 'manager-email' }),
}
const emailOpsEvent = {
  id: 'booking-email-event-1',
  sourceEmailId: 'gmail-message-1',
  sender: 'Manager <manager@example.test>',
  subject: '/ops Check bookings for next weekend.',
  rawEmailUrl: 'https://mail.google.com/mail/u/0/#inbox/gmail-message-1',
}
assert.equal(emailOpsCommandIntakeStatus({}).enabled, false, 'Hotel Ops email command intake is disabled by default')
assert.equal(emailOpsCommandIntakeStatus(emailOpsEnv).userMapConfigured, true, 'Hotel Ops email command intake reports an allowlist when configured')
assert.equal(parseEmailOpsCommandUserMap({ HOTEL_OPS_EMAIL_COMMAND_USER_MAP: '{bad-json' }).ok, false, 'Hotel Ops email command user map rejects invalid JSON')
assert.equal(normalizeEmailOpsSender('Manager <MANAGER@example.test>'), 'manager@example.test', 'Hotel Ops email command sender normalization extracts mailbox addresses')
assert.equal(extractEmailOpsCommandText(emailOpsEvent, { ...emailOpsEnv, HOTEL_OPS_EMAIL_COMMANDS_ENABLED: 'false' }), null, 'Hotel Ops email command text is ignored until enabled')
assert.equal(extractEmailOpsCommandText({ ...emailOpsEvent, subject: 'Check bookings for next weekend.' }, emailOpsEnv), null, 'Hotel Ops email command text requires the configured prefix')
assert.equal(extractEmailOpsCommandText(emailOpsEvent, emailOpsEnv), 'Check bookings for next weekend.', 'Hotel Ops email command text strips the configured prefix')
assert.equal(extractEmailOpsCommandText({ ...emailOpsEvent, subject: 'Manager request', rawText: '/ops Check arrivals today.' }, emailOpsEnv), 'Check arrivals today.', 'Hotel Ops email command text can be read from the email body when the subject is not prefixed')
assert.equal(emailOpsCommandIdempotencyKey(emailOpsEvent), 'email:gmail-message-1', 'Hotel Ops email command idempotency uses the source email id')
const emailOpsPrisma = {
  user: {
    findFirst: async ({ where }) => {
      assert.deepEqual(where.OR, [{ id: 'manager-email' }, { username: 'manager-email' }, { email: 'manager-email' }], 'Hotel Ops email command actor lookup accepts id, username, or email refs')
      return {
        id: 'manager-email-id',
        username: 'manager-email',
        email: null,
        firstName: 'Email',
        lastName: 'Manager',
        role: 'MANAGER',
        active: true,
      }
    },
  },
}
const resolvedEmailOpsEvent = await resolveEmailOpsCommandEvent(emailOpsPrisma, emailOpsEvent, { env: emailOpsEnv })
assert.equal(resolvedEmailOpsEvent.status, 'accepted', 'Hotel Ops email command intake accepts allowlisted senders')
assert.equal(resolvedEmailOpsEvent.actor.id, 'manager-email-id', 'Hotel Ops email command intake maps sender to an active PMS user')
assert.equal(resolvedEmailOpsEvent.sourceMetadata.sourceEmailEventId, 'booking-email-event-1', 'Hotel Ops email command intake keeps source email event metadata')
const unmappedEmailOpsEvent = await resolveEmailOpsCommandEvent(emailOpsPrisma, { ...emailOpsEvent, sender: 'stranger@example.test' }, { env: emailOpsEnv })
assert.equal(unmappedEmailOpsEvent.status, 'skipped', 'Hotel Ops email command intake skips non-allowlisted senders')
let submittedEmailOpsCommand = null
const processedEmailOpsEvents = await processEmailOpsCommandEvents(emailOpsPrisma, [emailOpsEvent], {
  env: emailOpsEnv,
  submitCommand: async (_prisma, input, actor) => {
    submittedEmailOpsCommand = { input, actor }
    return { task: { id: 'email-task-1' }, duplicate: false }
  },
})
assert.equal(processedEmailOpsEvents[0].status, 'accepted', 'Hotel Ops email command processing submits allowlisted commands')
assert.equal(submittedEmailOpsCommand.input.sourceChannel, 'email', 'Hotel Ops email command processing tags source channel as email')
assert.equal(submittedEmailOpsCommand.input.idempotencyKey, 'email:gmail-message-1', 'Hotel Ops email command processing passes retry-safe idempotency key')
assert.equal(submittedEmailOpsCommand.input.sourceMetadata.sourceEmailEventId, 'booking-email-event-1', 'Hotel Ops email command processing passes source email metadata')
assert.equal(submittedEmailOpsCommand.actor.id, 'manager-email-id', 'Hotel Ops email command processing submits as the mapped PMS actor')

const whatsappOpsEnv = {
  HOTEL_OPS_WHATSAPP_COMMANDS_ENABLED: 'true',
  HOTEL_OPS_WHATSAPP_COMMAND_PREFIX: '/ops',
  HOTEL_OPS_WHATSAPP_COMMAND_USER_MAP: JSON.stringify({ '+66 81 234 5678': 'manager-whatsapp' }),
  WHATSAPP_WEBHOOK_APP_SECRET: 'whatsapp-webhook-secret',
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify-token',
}
const whatsappPayload = {
  entry: [{
    changes: [{
      value: {
        metadata: {
          phone_number_id: 'phone-number-id-1',
          display_phone_number: '+66 99 000 0000',
        },
        contacts: [{
          wa_id: '66812345678',
          profile: { name: 'WhatsApp Manager' },
        }],
        messages: [{
          id: 'wamid.message-1',
          from: '66812345678',
          timestamp: '1782945600',
          type: 'text',
          text: { body: '/ops Check bookings for next weekend.' },
        }],
      },
    }],
  }],
}
const whatsappMessages = extractWhatsAppWebhookMessages(whatsappPayload)
const whatsappOpsEvent = whatsappMessages[0]
const whatsappBody = Buffer.from(JSON.stringify(whatsappPayload))
const whatsappSignature = `sha256=${createHmac('sha256', whatsappOpsEnv.WHATSAPP_WEBHOOK_APP_SECRET).update(whatsappBody).digest('hex')}`
assert.equal(whatsAppOpsCommandIntakeStatus({}).enabled, false, 'Hotel Ops WhatsApp command intake is disabled by default')
assert.equal(whatsAppWebhookStatus(whatsappOpsEnv).appSecretConfigured, true, 'WhatsApp webhook status reports configured signing secret')
assert.equal(whatsAppOpsCommandIntakeStatus(whatsappOpsEnv).userMapConfigured, true, 'Hotel Ops WhatsApp command intake reports an allowlist when configured')
assert.equal(parseWhatsAppOpsCommandUserMap({ HOTEL_OPS_WHATSAPP_COMMAND_USER_MAP: '{bad-json' }).ok, false, 'Hotel Ops WhatsApp command user map rejects invalid JSON')
assert.equal(normalizeWhatsAppOpsSender('whatsapp:+66 81-234-5678'), '66812345678', 'Hotel Ops WhatsApp sender normalization handles WhatsApp phone refs')
assert.equal(whatsappMessages.length, 1, 'WhatsApp webhook extraction reads Meta text messages')
assert.equal(whatsappOpsEvent.contactName, 'WhatsApp Manager', 'WhatsApp webhook extraction keeps contact name metadata')
assert.equal(extractWhatsAppOpsCommandText(whatsappOpsEvent, { ...whatsappOpsEnv, HOTEL_OPS_WHATSAPP_COMMANDS_ENABLED: 'false' }), null, 'Hotel Ops WhatsApp command text is ignored until enabled')
assert.equal(extractWhatsAppOpsCommandText({ ...whatsappOpsEvent, text: 'Check bookings for next weekend.' }, whatsappOpsEnv), null, 'Hotel Ops WhatsApp command text requires the configured prefix')
assert.equal(extractWhatsAppOpsCommandText(whatsappOpsEvent, whatsappOpsEnv), 'Check bookings for next weekend.', 'Hotel Ops WhatsApp command text strips the configured prefix')
assert.equal(whatsAppOpsCommandIdempotencyKey(whatsappOpsEvent), 'whatsapp:wamid.message-1', 'Hotel Ops WhatsApp command idempotency uses the WhatsApp message id')
assert.equal(verifyWhatsAppWebhookSignature(whatsappBody, whatsappSignature, whatsappOpsEnv).ok, true, 'WhatsApp webhook signature verifies with the configured app secret')
assert.equal(verifyWhatsAppWebhookSignature(whatsappBody, 'sha256=bad', whatsappOpsEnv).ok, false, 'WhatsApp webhook rejects invalid signatures')
const whatsappOpsPrisma = {
  user: {
    findFirst: async ({ where }) => {
      assert.deepEqual(where.OR, [{ id: 'manager-whatsapp' }, { username: 'manager-whatsapp' }, { email: 'manager-whatsapp' }], 'Hotel Ops WhatsApp command actor lookup accepts id, username, or email refs')
      return {
        id: 'manager-whatsapp-id',
        username: 'manager-whatsapp',
        email: null,
        firstName: 'WhatsApp',
        lastName: 'Manager',
        role: 'MANAGER',
        active: true,
      }
    },
  },
}
const resolvedWhatsAppOpsEvent = await resolveWhatsAppOpsCommandEvent(whatsappOpsPrisma, whatsappOpsEvent, { env: whatsappOpsEnv })
assert.equal(resolvedWhatsAppOpsEvent.status, 'accepted', 'Hotel Ops WhatsApp command intake accepts allowlisted senders')
assert.equal(resolvedWhatsAppOpsEvent.actor.id, 'manager-whatsapp-id', 'Hotel Ops WhatsApp command intake maps sender to an active PMS user')
assert.equal(resolvedWhatsAppOpsEvent.sourceMetadata.whatsAppMessageId, 'wamid.message-1', 'Hotel Ops WhatsApp command intake keeps source message metadata')
const unmappedWhatsAppOpsEvent = await resolveWhatsAppOpsCommandEvent(whatsappOpsPrisma, { ...whatsappOpsEvent, senderId: '66800000000' }, { env: whatsappOpsEnv })
assert.equal(unmappedWhatsAppOpsEvent.status, 'skipped', 'Hotel Ops WhatsApp command intake skips non-allowlisted senders')
let submittedWhatsAppOpsCommand = null
const processedWhatsAppOpsEvents = await processWhatsAppOpsCommandEvents(whatsappOpsPrisma, [whatsappOpsEvent], {
  env: whatsappOpsEnv,
  submitCommand: async (_prisma, input, actor) => {
    submittedWhatsAppOpsCommand = { input, actor }
    return { task: { id: 'whatsapp-task-1' }, duplicate: false }
  },
})
assert.equal(processedWhatsAppOpsEvents[0].status, 'accepted', 'Hotel Ops WhatsApp command processing submits allowlisted commands')
assert.equal(submittedWhatsAppOpsCommand.input.sourceChannel, 'whatsapp', 'Hotel Ops WhatsApp command processing tags source channel as whatsapp')
assert.equal(submittedWhatsAppOpsCommand.input.idempotencyKey, 'whatsapp:wamid.message-1', 'Hotel Ops WhatsApp command processing passes retry-safe idempotency key')
assert.equal(submittedWhatsAppOpsCommand.input.sourceMetadata.whatsAppMessageId, 'wamid.message-1', 'Hotel Ops WhatsApp command processing passes source message metadata')
assert.equal(submittedWhatsAppOpsCommand.actor.id, 'manager-whatsapp-id', 'Hotel Ops WhatsApp command processing submits as the mapped PMS actor')

const managerDecision = evaluateOpsPermission(rateCommand, { id: 'manager', role: 'MANAGER' })
assert.equal(managerDecision.allowed, true, 'Hotel manager can submit high-risk Hotel Ops task')
assert.equal(managerDecision.approvalRequired, true, 'Hotel manager high-risk Hotel Ops task still needs owner approval')
assert.equal(evaluateOpsPermission(rateCommand, { id: 'front-desk', role: 'FRONT_DESK' }).allowed, false, 'staff cannot create high-risk Hotel Ops write task')
assert.equal(evaluateOpsPermission({ ...rateCommand, platform: 'unknown' }, { id: 'manager', role: 'MANAGER' }).allowed, false, 'Hotel Ops permission guard rejects write tasks without a supported platform')
assert.equal(evaluateOpsPermission(rateCommand, { id: 'owner', role: 'ADMIN' }, { enabled: true }).blockedByEmergencyStop, true, 'Hotel Ops emergency stop blocks write tasks')
assert.equal(evaluateOpsPermission(readAvailabilityCommand, { id: 'viewer', role: 'VIEWER' }).allowed, true, 'Hotel Ops viewer role can still create allowed read-only availability checks')

const opsCommandFixture = createOpsCommandPrismaFixture()
const opsManager = { id: 'manager-ops-test', role: 'MANAGER', name: 'Ops Manager' }
const opsOwner = { id: 'owner-ops-test', role: 'ADMIN', name: 'Owner' }
const emailSourceFixture = createOpsCommandPrismaFixture()
await submitOpsCommand(
  emailSourceFixture.prisma,
  {
    message: 'Check bookings for next weekend.',
    sourceChannel: 'email',
    idempotencyKey: 'email:gmail-message-source-metadata',
    sourceMetadata: {
      sourceEmailEventId: 'booking-email-event-source-metadata',
      sourceEmailId: 'gmail-message-source-metadata',
      rawEmailUrl: 'https://mail.google.com/mail/u/0/#inbox/gmail-message-source-metadata',
      sender: 'manager@example.test',
    },
  },
  opsManager,
)
const emailCommandReceipt = emailSourceFixture.logs.find((log) => log.action === 'COMMAND_RECEIVED')
assert.equal(emailCommandReceipt?.metadata?.sourceChannel, 'email', 'Hotel Ops email commands record source channel in task logs')
assert.equal(emailCommandReceipt?.metadata?.sourceMetadata?.sourceEmailEventId, 'booking-email-event-source-metadata', 'Hotel Ops email commands link task logs to source email events')
assert.equal(
  emailSourceFixture.audits.some((audit) => audit.action === 'OPS_COMMAND_RECEIVED' && audit.changes.sourceMetadata?.sourceEmailId === 'gmail-message-source-metadata'),
  true,
  'Hotel Ops email commands link audit records to source email messages',
)
const whatsappSourceFixture = createOpsCommandPrismaFixture()
const whatsappSourcePrisma = {
  ...whatsappSourceFixture.prisma,
  user: {
    findFirst: async () => opsManager,
  },
}
await processWhatsAppOpsCommandEvents(whatsappSourcePrisma, [whatsappOpsEvent], {
  env: {
    ...whatsappOpsEnv,
    HOTEL_OPS_WHATSAPP_COMMAND_USER_MAP: JSON.stringify({ '66812345678': opsManager.id }),
  },
  submitCommand: submitOpsCommand,
})
const whatsappCommandReceipt = whatsappSourceFixture.logs.find((log) => log.action === 'COMMAND_RECEIVED')
assert.equal(whatsappCommandReceipt?.metadata?.sourceChannel, 'whatsapp', 'Hotel Ops WhatsApp commands record source channel in task logs')
assert.equal(whatsappCommandReceipt?.metadata?.sourceMetadata?.whatsAppMessageId, 'wamid.message-1', 'Hotel Ops WhatsApp commands link task logs to source WhatsApp messages')
assert.equal(
  whatsappSourceFixture.audits.some((audit) => audit.action === 'OPS_COMMAND_RECEIVED' && audit.changes.sourceMetadata?.whatsAppMessageId === 'wamid.message-1'),
  true,
  'Hotel Ops WhatsApp commands link audit records to source WhatsApp messages',
)
const queuedScanResult = await submitOpsCommand(
  opsCommandFixture.prisma,
  { message: 'Check bookings for next weekend.', sourceChannel: 'web', idempotencyKey: 'ops-command-scan-test' },
  opsManager,
)
assert.equal(queuedScanResult.task.status, 'QUEUED', 'Hotel Ops service queues low-risk scan commands')
assert.equal(queuedScanResult.parserMode, 'deterministic', 'Hotel Ops command result reports deterministic parser mode when AI parser is not configured')
assert.equal(opsCommandFixture.tasks.length, 1, 'Hotel Ops service persists one task for a new command')
assert.equal(opsCommandFixture.logs.some((log) => log.action === 'COMMAND_RECEIVED'), true, 'Hotel Ops service logs command receipt')
assert.equal(opsCommandFixture.logs.some((log) => log.action === 'PARSER_OUTPUT'), true, 'Hotel Ops service logs parser output')
assert.equal(opsCommandFixture.logs.find((log) => log.action === 'PARSER_OUTPUT')?.metadata?.parserMode, 'deterministic', 'Hotel Ops parser output log records parser mode')
assert.equal(opsCommandFixture.logs.some((log) => log.action === 'VALIDATION_PASSED'), true, 'Hotel Ops service logs validation pass decisions')
assert.equal(opsCommandFixture.logs.some((log) => log.action === 'TASK_QUEUED'), true, 'Hotel Ops service logs queueing')
assert.equal(opsCommandFixture.audits.some((audit) => audit.action === 'OPS_COMMAND_RECEIVED'), true, 'Hotel Ops service audits command receipt')
assert.equal(opsCommandFixture.audits.some((audit) => audit.action === 'OPS_PARSER_OUTPUT' && audit.changes.taskType === 'SCAN_BOOKINGS'), true, 'Hotel Ops service audits parser output')
assert.equal(opsCommandFixture.audits.some((audit) => audit.action === 'OPS_VALIDATION_PASSED'), true, 'Hotel Ops service audits validation pass decisions')
assert.equal(opsCommandFixture.audits.some((audit) => audit.action === 'OPS_PERMISSION_DECISION'), true, 'Hotel Ops service audits permission decisions')
assert.equal(opsCommandFixture.notifications.some((notification) => notification.type === 'TASK_UPDATE'), true, 'Hotel Ops service records queue notifications')

const originalHotelOpsEmailEnv = {
  HOTEL_OPS_EMAIL_DELIVERY_ENABLED: process.env.HOTEL_OPS_EMAIL_DELIVERY_ENABLED,
  BOOKING_EMAIL_GMAIL_ACCESS_TOKEN: process.env.BOOKING_EMAIL_GMAIL_ACCESS_TOKEN,
  HOTEL_OPS_EMAIL_FROM: process.env.HOTEL_OPS_EMAIL_FROM,
}
const originalHotelOpsEmailFetch = globalThis.fetch
try {
  process.env.HOTEL_OPS_EMAIL_DELIVERY_ENABLED = 'true'
  process.env.BOOKING_EMAIL_GMAIL_ACCESS_TOKEN = 'gmail-access-fixture'
  process.env.HOTEL_OPS_EMAIL_FROM = 'ops@sandboxhotel.test'
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'service-gmail-message-id' }), { status: 200 })
  const emailDeliveryFixture = createOpsCommandPrismaFixture()
  emailDeliveryFixture.property.reservationAlertEmail = 'ops@property.test'
  await submitOpsCommand(
    emailDeliveryFixture.prisma,
    { message: 'Check bookings for next weekend.', sourceChannel: 'web', idempotencyKey: 'ops-command-email-delivery-test' },
    opsManager,
  )
  const serviceEmailNotification = emailDeliveryFixture.notifications.find((notification) => notification.channel === 'EMAIL')
  assert.equal(serviceEmailNotification?.status, 'SENT', 'Hotel Ops service marks email notification sent when Gmail provider succeeds')
  assert.equal(serviceEmailNotification?.metadata?.emailDelivery?.messageId, 'service-gmail-message-id', 'Hotel Ops service stores Gmail delivery proof metadata')
} finally {
  if (originalHotelOpsEmailEnv.HOTEL_OPS_EMAIL_DELIVERY_ENABLED === undefined) delete process.env.HOTEL_OPS_EMAIL_DELIVERY_ENABLED
  else process.env.HOTEL_OPS_EMAIL_DELIVERY_ENABLED = originalHotelOpsEmailEnv.HOTEL_OPS_EMAIL_DELIVERY_ENABLED
  if (originalHotelOpsEmailEnv.BOOKING_EMAIL_GMAIL_ACCESS_TOKEN === undefined) delete process.env.BOOKING_EMAIL_GMAIL_ACCESS_TOKEN
  else process.env.BOOKING_EMAIL_GMAIL_ACCESS_TOKEN = originalHotelOpsEmailEnv.BOOKING_EMAIL_GMAIL_ACCESS_TOKEN
  if (originalHotelOpsEmailEnv.HOTEL_OPS_EMAIL_FROM === undefined) delete process.env.HOTEL_OPS_EMAIL_FROM
  else process.env.HOTEL_OPS_EMAIL_FROM = originalHotelOpsEmailEnv.HOTEL_OPS_EMAIL_FROM
  globalThis.fetch = originalHotelOpsEmailFetch
}

const duplicateScanResult = await submitOpsCommand(
  opsCommandFixture.prisma,
  { message: 'Check bookings for next weekend.', sourceChannel: 'web', idempotencyKey: 'ops-command-scan-test' },
  opsManager,
)
assert.equal(duplicateScanResult.duplicate, true, 'Hotel Ops service marks repeated command idempotency keys as duplicate')
assert.equal(duplicateScanResult.task.id, queuedScanResult.task.id, 'Hotel Ops duplicate commands return the existing task')
assert.equal(opsCommandFixture.tasks.length, 1, 'Hotel Ops duplicate command idempotency does not create another task')
assert.equal(opsCommandFixture.logs.some((log) => log.action === 'IDEMPOTENT_REPLAY'), true, 'Hotel Ops duplicate command replay is logged')

const approvalFixture = createOpsCommandPrismaFixture()
const pendingRateResult = await submitOpsCommand(
  approvalFixture.prisma,
  { message: 'Change Agoda Deluxe Room to 2,200 THB this Friday and Saturday.', sourceChannel: 'line' },
  opsManager,
)
assert.equal(pendingRateResult.task.status, 'PENDING_APPROVAL', 'Hotel Ops service holds high-risk rate changes for approval')
assert.equal(approvalFixture.approvals.length, 1, 'Hotel Ops service creates an approval record for high-risk commands')
assert.equal(approvalFixture.approvals[0].requiredRole, 'OWNER', 'Hotel Ops rate updates require owner approval')
assert.equal(approvalFixture.notifications.some((notification) => notification.type === 'APPROVAL_REQUEST'), true, 'Hotel Ops service records approval request notifications')
assert.equal(approvalFixture.audits.some((audit) => audit.action === 'OPS_APPROVAL_REQUESTED'), true, 'Hotel Ops service audits approval requests')

const allRoomsCloseFixture = createOpsCommandPrismaFixture()
const allRoomsCloseResult = await submitOpsCommand(
  allRoomsCloseFixture.prisma,
  { message: 'Close all channels all rooms 2026-07-03 to 2026-07-04.', sourceChannel: 'web' },
  opsOwner,
)
assert.equal(allRoomsCloseResult.task.status, 'DENIED', 'Hotel Ops service denies all-room close commands')
assert.equal(allRoomsCloseResult.decision.allowed, false, 'Hotel Ops all-room close command returns a blocked decision')
assert.equal(allRoomsCloseFixture.approvals.length, 0, 'Hotel Ops service does not create approvals for all-room close commands')
assert.equal(allRoomsCloseFixture.audits.some((audit) => audit.action === 'OPS_PERMISSION_DECISION' && audit.changes.reason.includes('Closing all rooms')), true, 'Hotel Ops service audits all-room close policy decisions')

approvalFixture.tasks.push({
  ...approvalFixture.tasks[0],
  id: 'foreign-ops-task',
  propertyId: 'property-foreign',
  requesterUserId: 'foreign-manager',
  requesterLabel: 'Foreign Manager',
  idempotencyKey: 'foreign-property-rate-change',
  status: 'PENDING_APPROVAL',
})
approvalFixture.approvals.push({
  ...approvalFixture.approvals[0],
  id: 'foreign-ops-approval',
  taskId: 'foreign-ops-task',
})
const scopedOpsTasks = await listOpsTasks(approvalFixture.prisma)
assert.equal(scopedOpsTasks.some((task) => task.id === 'foreign-ops-task'), false, 'Hotel Ops task history hides tasks from other properties')
const scopedOpsApprovals = await listOpsApprovals(approvalFixture.prisma)
assert.equal(scopedOpsApprovals.some((approval) => approval.taskId === 'foreign-ops-task'), false, 'Hotel Ops approval queue hides approvals from other properties')
await assert.rejects(
  () => getOpsTask(approvalFixture.prisma, 'foreign-ops-task'),
  /Hotel Ops task was not found/,
  'Hotel Ops task detail rejects tasks from other properties',
)
await assert.rejects(
  () => approveOpsTask(approvalFixture.prisma, 'foreign-ops-task', { notes: 'Should not approve cross-property task.' }, opsOwner),
  /Hotel Ops task was not found/,
  'Hotel Ops approval rejects tasks from other properties',
)
await assert.rejects(
  () => approveOpsTask(approvalFixture.prisma, pendingRateResult.task.id, {}, opsOwner),
  /Approval reason is required/,
  'Hotel Ops approval requires an audit reason before queueing write tasks',
)
assert.equal(approvalFixture.approvals[0].status, 'PENDING', 'Hotel Ops reasonless approval leaves the approval pending')
assert.equal(approvalFixture.logs.some((log) => log.action === 'APPROVAL_REJECTED' && log.message.includes('Approval reason is required')), true, 'Hotel Ops service logs reasonless approval attempts')
assert.equal(approvalFixture.audits.some((audit) => audit.action === 'OPS_APPROVAL_REJECTED' && audit.changes.requiredRole === 'OWNER'), true, 'Hotel Ops service audits reasonless approval attempts')

const approvedRateTask = await approveOpsTask(
  approvalFixture.prisma,
  pendingRateResult.task.id,
  { notes: 'Approved dry-run rate proof.' },
  opsOwner,
)
assert.equal(approvedRateTask.status, 'QUEUED', 'Hotel Ops approval queues the task for signed worker execution')
assert.equal(approvalFixture.approvals[0].status, 'APPROVED', 'Hotel Ops approval records the owner decision')
assert.equal(approvalFixture.approvals[0].notes, 'Approved dry-run rate proof.', 'Hotel Ops approval stores the approval reason')
assert.equal(approvalFixture.logs.some((log) => log.action === 'APPROVAL_GRANTED'), true, 'Hotel Ops service logs approval grants')
assert.equal(approvalFixture.audits.some((audit) => audit.action === 'OPS_APPROVAL_GRANTED' && audit.changes.notes === 'Approved dry-run rate proof.'), true, 'Hotel Ops service audits approval grants with the reason')

const executedRateTask = await runQueuedOpsTask(approvalFixture.prisma, pendingRateResult.task.id, opsOwner)
assert.equal(executedRateTask.status, 'SUCCEEDED', 'Hotel Ops service executes approved mock rate updates successfully')
assert.equal(executedRateTask.proofScreenshots.length > 0, true, 'Hotel Ops service persists worker proof screenshots')
assert.equal(executedRateTask.proofScreenshots.every((proof) => proof.redactionStatus === 'SAFE'), true, 'Hotel Ops persisted worker proof is marked safe')
assert.equal(approvalFixture.logs.some((log) => log.action === 'WORKER_STARTED'), true, 'Hotel Ops service logs worker start')
assert.equal(approvalFixture.logs.some((log) => log.action === 'WORKER_SUCCEEDED'), true, 'Hotel Ops service logs worker success')
assert.equal(approvalFixture.audits.some((audit) => audit.action === 'OPS_TASK_STARTED'), true, 'Hotel Ops service audits worker start')
assert.equal(approvalFixture.audits.some((audit) => audit.action === 'OPS_PROOF_STORED' && audit.changes.proofCount > 0), true, 'Hotel Ops service audits persisted worker proof artifacts')
assert.equal(approvalFixture.audits.some((audit) => audit.action === 'OPS_TASK_SUCCEEDED'), true, 'Hotel Ops service audits worker success')
assert.equal(approvalFixture.notifications.some((notification) => notification.summary.includes('Dry run: would update Agoda')), true, 'Hotel Ops service records platform adapter execution result notifications')

const unsafeProofFixture = createOpsCommandPrismaFixture()
const unsafeProofResult = await submitOpsCommand(
  unsafeProofFixture.prisma,
  { message: 'Change Agoda Deluxe Room to 2,200 THB this Friday and Saturday.', sourceChannel: 'web' },
  opsManager,
)
await approveOpsTask(unsafeProofFixture.prisma, unsafeProofResult.task.id, { notes: 'Approved remote proof sanitization smoke.' }, opsOwner)
const originalOpsWorkerFetch = globalThis.fetch
const originalOpsWorkerBaseUrl = process.env.OTA_WORKER_BASE_URL
const originalOpsWorkerSecret = process.env.OTA_WORKER_SHARED_SECRET
try {
  process.env.OTA_WORKER_BASE_URL = 'https://worker.example.test/tasks'
  process.env.OTA_WORKER_SHARED_SECRET = 'remote-worker-secret'
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: true,
    data: {
      taskId: unsafeProofResult.task.id,
      status: 'SUCCEEDED',
      summary: 'Remote worker accepted task with password=summary-secret.',
      errorMessage: 'token=error-secret',
      proofScreenshots: [
        {
          id: 'proof-password=proof-secret',
          kind: 'after',
          storageUrl: 'https://proof.example.test/screenshot?password=proof-secret&token=proof-token',
          capturedAt: 'not-a-date',
          redactionStatus: 'UNKNOWN',
          ignoredCredential: 'password=extra-secret',
        },
        {
          id: 'safe-api_key=safe-proof-secret',
          kind: 'sideways',
          storageUrl: 'https://proof.example.test/safe?api_key=safe-secret',
          capturedAt: '2026-06-30T01:00:00.000Z',
          redactionStatus: 'SAFE',
        },
        ...Array.from({ length: 12 }, (_, index) => ({
          id: `safe-proof-${index}`,
          kind: 'trace',
          storageUrl: `https://proof.example.test/${index}`,
          capturedAt: '2026-06-30T01:00:00.000Z',
          redactionStatus: 'SAFE',
        })),
      ],
      data: { dryRun: true },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } })

  const unsafeProofTask = await runQueuedOpsTask(unsafeProofFixture.prisma, unsafeProofResult.task.id, opsOwner)
  const unsafeProofJson = JSON.stringify(unsafeProofTask)
  assert.equal(unsafeProofTask.status, 'SUCCEEDED', 'Hotel Ops service persists remote signed-worker success')
  assert.equal(unsafeProofTask.proofScreenshots.length, 10, 'Hotel Ops service caps persisted worker proof artifacts')
  assert.equal(unsafeProofTask.proofScreenshots[0].redactionStatus, 'FAILED', 'Hotel Ops service blocks proof artifacts with unknown redaction status')
  assert.equal(unsafeProofTask.proofScreenshots[0].storageUrl.includes('redaction-blocked'), true, 'Hotel Ops service replaces unsafe proof URLs with a blocked reference')
  assert.equal(unsafeProofTask.proofScreenshots[1].kind, 'after', 'Hotel Ops service normalizes unexpected proof kinds for successful write tasks')
  assert.equal(unsafeProofJson.includes('summary-secret'), false, 'Hotel Ops service redacts worker execution summaries before persistence')
  assert.equal(unsafeProofJson.includes('error-secret'), false, 'Hotel Ops service redacts worker error messages before persistence')
  assert.equal(unsafeProofJson.includes('proof-secret'), false, 'Hotel Ops service redacts credential-like proof ids and URLs')
  assert.equal(unsafeProofJson.includes('proof-token'), false, 'Hotel Ops service redacts credential-like proof URL tokens')
  assert.equal(unsafeProofJson.includes('safe-secret'), false, 'Hotel Ops service redacts credential-like query parameters in safe proof URLs')
} finally {
  globalThis.fetch = originalOpsWorkerFetch
  if (originalOpsWorkerBaseUrl === undefined) delete process.env.OTA_WORKER_BASE_URL
  else process.env.OTA_WORKER_BASE_URL = originalOpsWorkerBaseUrl
  if (originalOpsWorkerSecret === undefined) delete process.env.OTA_WORKER_SHARED_SECRET
  else process.env.OTA_WORKER_SHARED_SECRET = originalOpsWorkerSecret
}

const sendReplyApprovalFixture = createOpsCommandPrismaFixture()
const pendingSendReplyResult = await submitOpsCommand(
  sendReplyApprovalFixture.prisma,
  { message: 'Send Booking guest reply: Late check-in is confirmed.', sourceChannel: 'web' },
  opsManager,
)
assert.equal(pendingSendReplyResult.task.status, 'PENDING_APPROVAL', 'Hotel Ops service holds send-reply writes for approval')
assert.equal(sendReplyApprovalFixture.approvals[0].requiredRole, 'OWNER', 'Hotel Ops send-reply approval requires owner role')
await assert.rejects(
  () => approveOpsTask(sendReplyApprovalFixture.prisma, pendingSendReplyResult.task.id, { notes: 'Manager should not approve send reply.' }, opsManager),
  /OWNER approval is required/,
  'Hotel Ops manager cannot approve send-reply writes',
)
await assert.rejects(
  () => denyOpsTask(sendReplyApprovalFixture.prisma, pendingSendReplyResult.task.id, { reason: 'Manager should not deny owner approval.' }, opsManager),
  /OWNER denial is required/,
  'Hotel Ops manager cannot deny owner-required send-reply approvals',
)
assert.equal(sendReplyApprovalFixture.approvals[0].status, 'PENDING', 'Hotel Ops manager-rejected send-reply approval remains pending')
assert.equal(sendReplyApprovalFixture.logs.some((log) => log.action === 'APPROVAL_REJECTED'), true, 'Hotel Ops service logs manager-rejected send-reply approval attempts')
assert.equal(sendReplyApprovalFixture.audits.some((audit) => audit.action === 'OPS_APPROVAL_REJECTED' && audit.changes.requiredRole === 'OWNER'), true, 'Hotel Ops service audits manager-rejected send-reply approval attempts')
assert.equal(sendReplyApprovalFixture.logs.some((log) => log.action === 'DENIAL_REJECTED'), true, 'Hotel Ops service logs manager-rejected send-reply denial attempts')
assert.equal(sendReplyApprovalFixture.audits.some((audit) => audit.action === 'OPS_DENIAL_REJECTED' && audit.changes.requiredRole === 'OWNER'), true, 'Hotel Ops service audits manager-rejected send-reply denial attempts')

const selectorFailureFixture = createOpsCommandPrismaFixture()
const selectorFailureResult = await submitOpsCommand(
  selectorFailureFixture.prisma,
  { message: 'Change Agoda Deluxe Room to 2,200 THB this Friday and Saturday selector failure.', sourceChannel: 'web' },
  opsManager,
)
await approveOpsTask(selectorFailureFixture.prisma, selectorFailureResult.task.id, { notes: 'Approved selector failure smoke.' }, opsOwner)
const failedRateTask = await runQueuedOpsTask(selectorFailureFixture.prisma, selectorFailureResult.task.id, opsOwner)
assert.equal(failedRateTask.status, 'FAILED', 'Hotel Ops service persists failed signed worker results')
assert.equal(failedRateTask.errorCode, 'MOCK_SELECTOR_FAILURE', 'Hotel Ops service preserves worker failure error codes')
assert.equal(failedRateTask.proofScreenshots.some((proof) => proof.kind === 'error'), true, 'Hotel Ops service persists worker error proof screenshots')
assert.equal(selectorFailureFixture.logs.some((log) => log.action === 'WORKER_FAILED'), true, 'Hotel Ops service logs worker failures')
assert.equal(selectorFailureFixture.audits.some((audit) => audit.action === 'OPS_PROOF_STORED' && audit.changes.proofKinds.includes('error')), true, 'Hotel Ops service audits failed-worker proof artifacts')
assert.equal(selectorFailureFixture.audits.some((audit) => audit.action === 'OPS_TASK_FAILED'), true, 'Hotel Ops service audits worker failures')

const humanChallengeFixture = createOpsCommandPrismaFixture()
const humanChallengeResult = await submitOpsCommand(
  humanChallengeFixture.prisma,
  { message: 'Change Agoda Deluxe Room to 2,200 THB this Friday and Saturday captcha.', sourceChannel: 'web' },
  opsManager,
)
await approveOpsTask(humanChallengeFixture.prisma, humanChallengeResult.task.id, { notes: 'Approved human challenge smoke.' }, opsOwner)
const humanChallengeTask = await runQueuedOpsTask(humanChallengeFixture.prisma, humanChallengeResult.task.id, opsOwner)
assert.equal(humanChallengeTask.status, 'NEEDS_HUMAN', 'Hotel Ops service persists human-challenge worker results')
assert.equal(humanChallengeTask.errorCode, 'NEEDS_HUMAN_CHALLENGE', 'Hotel Ops service preserves human-challenge error codes')
assert.equal(humanChallengeTask.proofScreenshots.some((proof) => proof.kind === 'trace'), true, 'Hotel Ops service persists human-challenge trace proof')
assert.equal(humanChallengeFixture.logs.some((log) => log.action === 'WORKER_NEEDS_HUMAN'), true, 'Hotel Ops service logs human-challenge worker results')
assert.equal(humanChallengeFixture.audits.some((audit) => audit.action === 'OPS_PROOF_STORED' && audit.changes.proofKinds.includes('trace')), true, 'Hotel Ops service audits human-challenge proof traces')
assert.equal(humanChallengeFixture.notifications.some((notification) => notification.type === 'NEEDS_HUMAN'), true, 'Hotel Ops service records human-action notifications')
await assert.rejects(
  () => resolveOpsHumanAction(humanChallengeFixture.prisma, humanChallengeTask.id, {}, opsOwner),
  /Human-action completion requires an operational reason/,
  'Hotel Ops human-action resolution requires an audit reason before requeueing',
)
await assert.rejects(
  () => resolveOpsHumanAction(humanChallengeFixture.prisma, humanChallengeTask.id, { reason: 'Manager says the challenge is done.' }, opsManager),
  /OWNER must run this approved Hotel Ops task/,
  'Hotel Ops manager cannot requeue an owner-required human-challenge task',
)
const requeuedHumanTask = await resolveOpsHumanAction(
  humanChallengeFixture.prisma,
  humanChallengeTask.id,
  { reason: 'Owner completed the OTA challenge in the approved session.' },
  opsOwner,
)
assert.equal(requeuedHumanTask.status, 'QUEUED', 'Hotel Ops authorized human-action resolution requeues the task')
assert.equal(requeuedHumanTask.errorCode, null, 'Hotel Ops human-action requeue clears the stale worker error code')
assert.equal(humanChallengeFixture.logs.some((log) => log.action === 'HUMAN_ACTION_RECORDED'), true, 'Hotel Ops service logs human-action resolution')
assert.equal(humanChallengeFixture.audits.some((audit) => audit.action === 'OPS_HUMAN_ACTION_RECORDED'), true, 'Hotel Ops service audits human-action resolution')
assert.equal(humanChallengeFixture.audits.filter((audit) => audit.action === 'OPS_HUMAN_RESOLUTION_REJECTED').length, 2, 'Hotel Ops rejected human-action attempts are audited')
assert.equal(humanChallengeFixture.notifications.some((notification) => notification.type === 'TASK_UPDATE' && notification.metadata?.status === 'QUEUED'), true, 'Hotel Ops human-action requeue records a task-update notification')

const emergencyFixture = createOpsCommandPrismaFixture()
await assert.rejects(
  () => setEmergencyStop(emergencyFixture.prisma, { enabled: true }, opsOwner),
  /Emergency stop changes require an audit reason/,
  'Hotel Ops emergency stop changes require an audit reason',
)
assert.equal(emergencyFixture.audits.some((audit) => audit.action === 'OPS_EMERGENCY_STOP_ENABLE_REJECTED'), true, 'Hotel Ops service audits reasonless emergency-stop attempts')
assert.equal(emergencyFixture.notifications.length, 0, 'Hotel Ops reasonless emergency-stop attempts do not notify or change operational state')
await setEmergencyStop(emergencyFixture.prisma, { enabled: true, reason: 'Owner paused OTA writes.' }, opsOwner)
assert.equal(emergencyFixture.audits.some((audit) => audit.action === 'OPS_EMERGENCY_STOP_ENABLED'), true, 'Hotel Ops service audits emergency stop activation')
assert.equal(emergencyFixture.notifications.some((notification) => notification.type === 'EMERGENCY_STOP'), true, 'Hotel Ops service records emergency stop notifications')
const stoppedRateResult = await submitOpsCommand(
  emergencyFixture.prisma,
  { message: 'Change Agoda Deluxe Room to 2,200 THB this Friday and Saturday.', sourceChannel: 'web' },
  opsManager,
)
assert.equal(stoppedRateResult.task.status, 'DENIED', 'Hotel Ops service denies write commands while emergency stop is active')
assert.equal(stoppedRateResult.decision.blockedByEmergencyStop, true, 'Hotel Ops service marks emergency-stop-denied command decisions')
assert.equal(emergencyFixture.approvals.length, 0, 'Hotel Ops service does not create approvals while emergency stop blocks writes')

const approvalStopFixture = createOpsCommandPrismaFixture()
const pendingStoppedApproval = await submitOpsCommand(
  approvalStopFixture.prisma,
  { message: 'Change Agoda Deluxe Room to 2,200 THB this Friday and Saturday.', sourceChannel: 'web' },
  opsManager,
)
await setEmergencyStop(approvalStopFixture.prisma, { enabled: true, reason: 'Owner paused approval queueing.' }, opsOwner)
await assert.rejects(
  () => approveOpsTask(approvalStopFixture.prisma, pendingStoppedApproval.task.id, { notes: 'Should not queue while stopped.' }, opsOwner),
  /Emergency stop is enabled/,
  'Hotel Ops approval refuses to queue write tasks while emergency stop is active',
)
assert.equal(approvalStopFixture.tasks[0].status, 'PENDING_APPROVAL', 'Hotel Ops emergency-stop-blocked approval leaves the task pending')
assert.equal(approvalStopFixture.approvals[0].status, 'PENDING', 'Hotel Ops emergency-stop-blocked approval leaves the approval pending')
assert.equal(approvalStopFixture.logs.some((log) => log.action === 'APPROVAL_BLOCKED'), true, 'Hotel Ops service logs emergency-stop-blocked approvals')
assert.equal(approvalStopFixture.audits.some((audit) => audit.action === 'OPS_APPROVAL_BLOCKED' && audit.changes.blockedByEmergencyStop === true), true, 'Hotel Ops service audits emergency-stop-blocked approvals')

const runStopFixture = createOpsCommandPrismaFixture()
const pendingStoppedRun = await submitOpsCommand(
  runStopFixture.prisma,
  { message: 'Change Agoda Deluxe Room to 2,200 THB this Friday and Saturday.', sourceChannel: 'web' },
  opsManager,
)
await approveOpsTask(runStopFixture.prisma, pendingStoppedRun.task.id, { notes: 'Queue before stop.' }, opsOwner)
await setEmergencyStop(runStopFixture.prisma, { enabled: true, reason: 'Owner paused worker execution.' }, opsOwner)
await assert.rejects(
  () => runQueuedOpsTask(runStopFixture.prisma, pendingStoppedRun.task.id, opsOwner),
  /Emergency stop is enabled/,
  'Hotel Ops runner refuses queued write tasks while emergency stop is active',
)
assert.equal(runStopFixture.tasks[0].status, 'QUEUED', 'Hotel Ops emergency-stop-blocked runner leaves the task queued')
assert.equal(runStopFixture.logs.some((log) => log.action === 'WORKER_START_BLOCKED'), true, 'Hotel Ops service logs emergency-stop-blocked worker starts')
assert.equal(runStopFixture.audits.some((audit) => audit.action === 'OPS_TASK_RUN_BLOCKED' && audit.changes.blockedByEmergencyStop === true), true, 'Hotel Ops service audits emergency-stop-blocked worker starts')

const deniedFixture = createOpsCommandPrismaFixture()
const deniedRateResult = await submitOpsCommand(
  deniedFixture.prisma,
  { message: 'Change Agoda Deluxe Room to 2,200 THB this Friday and Saturday.', sourceChannel: 'web' },
  opsManager,
)
await assert.rejects(
  () => denyOpsTask(deniedFixture.prisma, deniedRateResult.task.id, {}, opsOwner),
  /Denial reason is required/,
  'Hotel Ops denial requires an audit reason before closing a task',
)
assert.equal(deniedFixture.tasks[0].status, 'PENDING_APPROVAL', 'Hotel Ops reasonless denial leaves the task pending')
assert.equal(deniedFixture.approvals[0].status, 'PENDING', 'Hotel Ops reasonless denial leaves the approval pending')
assert.equal(deniedFixture.logs.some((log) => log.action === 'DENIAL_REJECTED' && log.message.includes('Denial reason is required')), true, 'Hotel Ops service logs reasonless denial attempts')
assert.equal(deniedFixture.audits.some((audit) => audit.action === 'OPS_DENIAL_REJECTED' && audit.changes.requiredRole === 'OWNER'), true, 'Hotel Ops service audits reasonless denial attempts')
const deniedRateTask = await denyOpsTask(deniedFixture.prisma, deniedRateResult.task.id, { reason: 'Do not change rates today.' }, opsOwner)
assert.equal(deniedRateTask.status, 'DENIED', 'Hotel Ops service can deny a pending write task')
assert.equal(deniedFixture.approvals[0].status, 'DENIED', 'Hotel Ops denial records the approval decision')
assert.equal(deniedFixture.audits.some((audit) => audit.action === 'OPS_APPROVAL_DENIED'), true, 'Hotel Ops service audits denied approvals')
await assert.rejects(
  () => runQueuedOpsTask(deniedFixture.prisma, deniedRateResult.task.id, opsOwner),
  /Only queued Hotel Ops tasks can run/,
  'Hotel Ops service refuses to execute denied tasks',
)

const cancelFixture = createOpsCommandPrismaFixture()
const cancellableScanResult = await submitOpsCommand(
  cancelFixture.prisma,
  { message: 'Check bookings for next weekend.', sourceChannel: 'web' },
  opsManager,
)
await assert.rejects(
  () => cancelOpsTask(cancelFixture.prisma, cancellableScanResult.task.id, { reason: 'Front desk should not cancel manager task.' }, { id: 'front-desk-ops-test', role: 'FRONT_DESK', name: 'Front Desk' }),
  /Only the requester, owner, or required approver can cancel/,
  'Hotel Ops service blocks non-requester staff from cancelling another user task',
)
assert.equal(cancelFixture.tasks[0].status, 'QUEUED', 'Hotel Ops unauthorized cancellation leaves the task queued')
assert.equal(cancelFixture.logs.some((log) => log.action === 'TASK_CANCEL_REJECTED'), true, 'Hotel Ops service logs unauthorized cancellation attempts')
assert.equal(cancelFixture.audits.some((audit) => audit.action === 'OPS_TASK_CANCEL_REJECTED'), true, 'Hotel Ops service audits unauthorized cancellation attempts')
await assert.rejects(
  () => cancelOpsTask(cancelFixture.prisma, cancellableScanResult.task.id, {}, opsManager),
  /Cancellation reason is required/,
  'Hotel Ops cancellation requires an audit reason before closing a task',
)
assert.equal(cancelFixture.tasks[0].status, 'QUEUED', 'Hotel Ops reasonless cancellation leaves the task queued')
assert.equal(cancelFixture.logs.some((log) => log.action === 'TASK_CANCEL_REJECTED' && log.message.includes('Cancellation reason is required')), true, 'Hotel Ops service logs reasonless cancellation attempts')
assert.equal(cancelFixture.audits.some((audit) => audit.action === 'OPS_TASK_CANCEL_REJECTED' && audit.changes.reason.includes('Cancellation reason is required')), true, 'Hotel Ops service audits reasonless cancellation attempts')
const cancelledScanTask = await cancelOpsTask(cancelFixture.prisma, cancellableScanResult.task.id, { reason: 'Requester cancelled duplicate scan.' }, opsManager)
assert.equal(cancelledScanTask.status, 'CANCELLED', 'Hotel Ops service lets the requester cancel an open task')
assert.equal(cancelFixture.audits.some((audit) => audit.action === 'OPS_TASK_CANCELLED'), true, 'Hotel Ops service audits requester cancellations')

const forbiddenFixture = createOpsCommandPrismaFixture()
const forbiddenServiceResult = await submitOpsCommand(
  forbiddenFixture.prisma,
  { message: 'Cancel all bookings and refund guests.', sourceChannel: 'web' },
  opsOwner,
)
assert.equal(forbiddenServiceResult.task.status, 'DENIED', 'Hotel Ops service persists forbidden commands as denied attempts')
assert.equal(forbiddenFixture.approvals.length, 0, 'Hotel Ops service does not create approvals for forbidden commands')
assert.equal(forbiddenFixture.logs.some((log) => log.action === 'VALIDATION_FAILED'), true, 'Hotel Ops service logs validation failures for forbidden commands')
assert.equal(forbiddenFixture.audits.some((audit) => audit.action === 'OPS_PARSER_OUTPUT' && audit.changes.taskType === 'FORBIDDEN'), true, 'Hotel Ops service audits forbidden parser output')
assert.equal(forbiddenFixture.audits.some((audit) => audit.action === 'OPS_VALIDATION_FAILED' && audit.changes.valid === false), true, 'Hotel Ops service audits validation failures for forbidden commands')
assert.equal(forbiddenFixture.audits.some((audit) => audit.action === 'OPS_PERMISSION_DECISION' && audit.changes.allowed === false), true, 'Hotel Ops service audits denied forbidden decisions')

const disabledPhotoFixture = createOpsCommandPrismaFixture()
const disabledPhotoResult = await submitOpsCommand(
  disabledPhotoFixture.prisma,
  { message: 'Update Booking listing photos.', sourceChannel: 'web' },
  opsOwner,
)
assert.equal(disabledPhotoResult.task.taskType, 'UPDATE_PHOTOS', 'Hotel Ops service persists disabled photo commands as typed critical tasks')
assert.equal(disabledPhotoResult.task.status, 'DENIED', 'Hotel Ops service denies disabled photo commands instead of queueing them')
assert.equal(disabledPhotoFixture.approvals.length, 0, 'Hotel Ops service does not create approvals for disabled MVP photo changes')
assert.equal(disabledPhotoFixture.audits.some((audit) => audit.action === 'OPS_PARSER_OUTPUT' && audit.changes.taskType === 'UPDATE_PHOTOS'), true, 'Hotel Ops service audits disabled photo parser output')
assert.equal(disabledPhotoFixture.audits.some((audit) => audit.action === 'OPS_PERMISSION_DECISION' && audit.changes.reason.includes('not enabled in the MVP')), true, 'Hotel Ops service audits disabled MVP photo decisions')

const queuedReadTask = {
  taskType: 'READ_RESERVATIONS',
  status: 'QUEUED',
  approvalRequired: false,
  approvals: [],
}
assert.equal(evaluateOpsTaskRun(queuedReadTask, { id: 'front-desk', role: 'FRONT_DESK' }).allowed, true, 'Hotel Ops runner allows queued low-risk tasks for permitted staff')
assert.equal(evaluateOpsTaskRun({ ...queuedReadTask, status: 'DENIED' }, { id: 'manager', role: 'MANAGER' }).allowed, false, 'Hotel Ops runner rejects denied tasks')
assert.equal(evaluateOpsTaskRun({ ...queuedReadTask, status: 'RUNNING' }, { id: 'manager', role: 'MANAGER' }).allowed, false, 'Hotel Ops runner rejects already-claimed tasks')

const pendingRateTask = {
  taskType: 'UPDATE_RATE',
  status: 'QUEUED',
  approvalRequired: true,
  permissionDecision: { requiredApprovalRole: 'OWNER' },
  approvals: [{ status: 'PENDING', requiredRole: 'OWNER' }],
}
assert.equal(evaluateOpsTaskRun(pendingRateTask, { id: 'owner', role: 'ADMIN' }).allowed, false, 'Hotel Ops runner refuses queued write tasks without completed approval')
assert.equal(evaluateOpsTaskRun({ ...pendingRateTask, approvals: [{ status: 'APPROVED', requiredRole: 'OWNER' }] }, { id: 'owner', role: 'ADMIN' }).allowed, true, 'Hotel Ops runner allows owner-approved write tasks')
assert.equal(evaluateOpsTaskRun({ ...pendingRateTask, approvals: [{ status: 'APPROVED', requiredRole: 'OWNER' }] }, { id: 'front-desk', role: 'FRONT_DESK' }).allowed, false, 'Hotel Ops runner prevents lower-role execution of owner-approved write tasks')
assert.equal(evaluateOpsTaskRun({ ...pendingRateTask, approvals: [{ status: 'APPROVED', requiredRole: 'OWNER' }] }, { id: 'owner', role: 'ADMIN' }, { enabled: true }).blockedByEmergencyStop, true, 'Hotel Ops runner rechecks emergency stop before write execution')

const makeOpsReservation = (id, createdAt, overrides = {}) => ({
  id,
  status: 'CONFIRMED',
  checkIn: new Date('2026-07-03T00:00:00.000Z'),
  checkOut: new Date('2026-07-05T00:00:00.000Z'),
  createdAt: new Date(createdAt),
  roomType: { name: 'Deluxe Room' },
  ...overrides,
})
const makeOpsRoom = (roomType, index, overrides = {}) => ({
  id: `room-${roomType.toLowerCase().replace(/\s+/g, '-')}-${index}`,
  operationalStatus: 'AVAILABLE',
  roomType: { name: roomType },
  ...overrides,
})
const recentDemandReservations = Array.from({ length: 8 }, (_, index) => makeOpsReservation(
  `recent-demand-${index}`,
  index < 2 ? '2026-06-29T12:00:00.000Z' : '2026-06-10T12:00:00.000Z',
))
const highDemandInsights = buildOpsScanInsights({
  reservations: recentDemandReservations,
  sellableRooms: 10,
  now: fixedOpsDate,
})
assert.equal(highDemandInsights.some((alert) => alert.alertType === 'HIGH_DEMAND'), true, 'Hotel Ops scan creates high-demand alert only when occupancy and velocity are elevated')
assert.equal(highDemandInsights.find((alert) => alert.alertType === 'HIGH_DEMAND')?.recommendedAction?.approvalRequired, true, 'Hotel Ops high-demand recommendation remains approval-gated')
const highDemandRecommendation = highDemandInsights.find((alert) => alert.alertType === 'HIGH_DEMAND')?.recommendedAction
const recommendationFixture = createOpsCommandPrismaFixture()
recommendationFixture.trendAlerts.push({
  id: 'trend-alert-high-demand',
  propertyId: 'property-ops-test',
  alertType: 'HIGH_DEMAND',
  severity: 'HIGH',
  title: 'High demand window',
  summary: 'Review a controlled rate increase.',
  platform: 'all',
  roomType: 'Deluxe Room',
  dateStart: new Date('2026-06-30T00:00:00.000Z'),
  dateEnd: new Date('2026-07-07T00:00:00.000Z'),
  metrics: {},
  recommendedAction: highDemandRecommendation,
  status: 'CREATED',
  createdAt: fixedOpsDate,
  updatedAt: fixedOpsDate,
})
recommendationFixture.trendAlerts.push({
  ...recommendationFixture.trendAlerts[0],
  id: 'foreign-trend-alert',
  propertyId: 'property-foreign',
  status: 'CREATED',
})
const scopedTrendAlerts = await listOpsTrendAlerts(recommendationFixture.prisma)
assert.equal(scopedTrendAlerts.some((alert) => alert.id === 'foreign-trend-alert'), false, 'Hotel Ops intelligence list hides alerts from other properties')
await assert.rejects(
  () => approveOpsAlertRecommendation(
    recommendationFixture.prisma,
    'trend-alert-high-demand',
    {},
    opsOwner,
  ),
  /Recommendation approval reason is required/,
  'Hotel Ops recommendation approval requires an audit reason before creating a task',
)
assert.equal(recommendationFixture.tasks.length, 0, 'Hotel Ops reasonless recommendation approval does not create a task')
assert.equal(recommendationFixture.trendAlerts[0].status, 'CREATED', 'Hotel Ops reasonless recommendation approval leaves alert status unchanged')
assert.equal(recommendationFixture.audits.some((audit) => audit.action === 'OPS_ALERT_RECOMMENDATION_REJECTED'), true, 'Hotel Ops service audits reasonless recommendation approval attempts')

const approvedRecommendationResult = await approveOpsAlertRecommendation(
  recommendationFixture.prisma,
  'trend-alert-high-demand',
  { reason: 'Pickup trend reviewed; prepare a rate task for owner approval.' },
  opsOwner,
)
assert.equal(approvedRecommendationResult.task.taskType, 'UPDATE_RATE', 'Hotel Ops recommendation approval creates a typed rate task')
assert.equal(approvedRecommendationResult.task.platform, 'all', 'Hotel Ops recommendation approval preserves all-channel target')
assert.equal(approvedRecommendationResult.task.status, 'PENDING_APPROVAL', 'Hotel Ops recommendation approval creates an approval-gated task instead of executing directly')
assert.equal(recommendationFixture.approvals.length, 1, 'Hotel Ops recommendation approval creates a task approval record')
assert.equal(recommendationFixture.trendAlerts[0].status, 'RECOMMENDATION_APPROVED', 'Hotel Ops recommendation approval updates alert status')
assert.equal(recommendationFixture.logs.some((log) => log.action === 'WORKER_STARTED'), false, 'Hotel Ops recommendation approval does not start the worker directly')
assert.equal(recommendationFixture.audits.some((audit) => audit.action === 'OPS_ALERT_RECOMMENDATION_APPROVED' && audit.changes.reason === 'Pickup trend reviewed; prepare a rate task for owner approval.'), true, 'Hotel Ops recommendation approval is audited with the reason')
await assert.rejects(
  () => resolveOpsTrendAlert(recommendationFixture.prisma, 'trend-alert-high-demand', {}, opsOwner),
  /Resolution reason is required/,
  'Hotel Ops alert resolution requires an audit reason before closing an active alert',
)
assert.equal(recommendationFixture.trendAlerts[0].status, 'RECOMMENDATION_APPROVED', 'Hotel Ops reasonless alert resolution leaves alert status unchanged')
assert.equal(recommendationFixture.audits.some((audit) => audit.action === 'OPS_ALERT_RESOLVE_REJECTED'), true, 'Hotel Ops service audits reasonless alert resolution attempts')
const resolvedRecommendationAlert = await resolveOpsTrendAlert(
  recommendationFixture.prisma,
  'trend-alert-high-demand',
  { reason: 'Recommendation queued; owner will review the generated task.' },
  opsOwner,
)
assert.equal(resolvedRecommendationAlert.status, 'RESOLVED', 'Hotel Ops alert resolution closes the alert when a reason is supplied')
assert.equal(recommendationFixture.audits.some((audit) => audit.action === 'OPS_ALERT_RESOLVED' && audit.changes.reason === 'Recommendation queued; owner will review the generated task.'), true, 'Hotel Ops alert resolution is audited with the reason')

const slowFullWindowInsights = buildOpsScanInsights({
  reservations: Array.from({ length: 8 }, (_, index) => makeOpsReservation(`slow-demand-${index}`, '2026-06-10T12:00:00.000Z')),
  sellableRooms: 10,
  now: fixedOpsDate,
})
assert.equal(slowFullWindowInsights.some((alert) => alert.alertType === 'HIGH_DEMAND'), false, 'Hotel Ops scan does not create high-demand alert from occupancy alone')

const lowDemandInsights = buildOpsScanInsights({
  reservations: [makeOpsReservation('low-demand-1', '2026-06-28T12:00:00.000Z')],
  sellableRooms: 10,
  now: fixedOpsDate,
})
assert.equal(lowDemandInsights.some((alert) => alert.alertType === 'LOW_DEMAND'), true, 'Hotel Ops scan creates low-demand alert inside the 7-day window')

const cancellationInsights = buildOpsScanInsights({
  reservations: recentDemandReservations,
  cancellationLogs: [
    { createdAt: new Date('2026-06-29T20:00:00.000Z'), action: 'CANCELLED' },
    { createdAt: new Date('2026-06-29T21:00:00.000Z'), action: 'NO_SHOW' },
    { createdAt: new Date('2026-06-20T12:00:00.000Z'), action: 'CANCELLED' },
  ],
  sellableRooms: 10,
  now: fixedOpsDate,
})
assert.equal(cancellationInsights.some((alert) => alert.alertType === 'CANCELLATION_SPIKE'), true, 'Hotel Ops scan creates cancellation spike alert from recent cancellation acceleration')

const weekendInsights = buildOpsScanInsights({
  reservations: [
    makeOpsReservation('weekend-1', '2026-06-29T12:00:00.000Z'),
    makeOpsReservation('weekend-2', '2026-06-29T13:00:00.000Z'),
  ],
  sellableRooms: 10,
  now: fixedOpsDate,
})
assert.equal(weekendInsights.some((alert) => alert.alertType === 'WEEKEND_SPIKE'), true, 'Hotel Ops scan creates weekend spike alert only when weekend velocity accelerates')

const roomImbalanceInsights = buildOpsScanInsights({
  reservations: [
    ...Array.from({ length: 3 }, (_, index) => makeOpsReservation(`deluxe-imbalance-${index}`, '2026-06-10T12:00:00.000Z', { roomType: { name: 'Deluxe Room' } })),
    makeOpsReservation('standard-imbalance-1', '2026-06-10T12:00:00.000Z', { roomType: { name: 'Standard Room' } }),
  ],
  rooms: [
    ...Array.from({ length: 4 }, (_, index) => makeOpsRoom('Deluxe Room', index)),
    ...Array.from({ length: 4 }, (_, index) => makeOpsRoom('Standard Room', index)),
  ],
  sellableRooms: 8,
  now: fixedOpsDate,
})
const roomImbalanceAlert = roomImbalanceInsights.find((alert) => alert.alertType === 'ROOM_IMBALANCE')
assert.equal(Boolean(roomImbalanceAlert), true, 'Hotel Ops scan creates room-type imbalance alert when one room type is strong and another is weak')
assert.equal(roomImbalanceAlert?.metrics?.strongestRoomType?.roomType, 'Deluxe Room', 'Hotel Ops room imbalance identifies the strongest room type')
assert.equal(roomImbalanceAlert?.metrics?.weakestRoomType?.roomType, 'Standard Room', 'Hotel Ops room imbalance identifies the weakest room type')
assert.equal(roomImbalanceAlert?.recommendedAction, null, 'Hotel Ops room imbalance is alert-only and does not create an automatic OTA mutation recommendation')

const otaImbalanceInsights = buildOpsScanInsights({
  reservations: [
    ...Array.from({ length: 4 }, (_, index) => makeOpsReservation(`ota-booking-${index}`, '2026-06-10T12:00:00.000Z', { source: 'BOOKING_COM' })),
    makeOpsReservation('ota-booking-email', '2026-06-10T12:00:00.000Z', { source: 'EMAIL', sourceEmailEvent: { sourceName: 'Booking.com' } }),
    makeOpsReservation('ota-agoda-1', '2026-06-10T12:00:00.000Z', { source: 'AGODA' }),
    makeOpsReservation('ota-agoda-2', '2026-06-10T12:00:00.000Z', { source: 'AGODA' }),
  ],
  sellableRooms: 20,
  now: fixedOpsDate,
})
const otaImbalanceAlert = otaImbalanceInsights.find((alert) => alert.alertType === 'OTA_IMBALANCE')
assert.equal(Boolean(otaImbalanceAlert), true, 'Hotel Ops scan creates OTA imbalance alert when one supported platform dominates channel mix')
assert.equal(otaImbalanceAlert?.platform, 'booking', 'Hotel Ops OTA imbalance alert identifies the dominant platform')
assert.equal(otaImbalanceAlert?.metrics?.platformCounts?.booking, 5, 'Hotel Ops OTA imbalance counts persisted source and source-email reservations')
assert.equal(otaImbalanceAlert?.recommendedAction, null, 'Hotel Ops OTA imbalance is alert-only and does not create an automatic OTA mutation recommendation')

assert.equal(
  hotelOpsTrendAlertFingerprint({
    alertType: 'LOW_DEMAND',
    platform: 'all',
    roomType: 'All Rooms',
    dateStart: new Date('2026-06-30T00:00:00.000Z'),
    dateEnd: '2026-07-07',
  }),
  hotelOpsTrendAlertFingerprint({
    alertType: 'LOW_DEMAND',
    platform: 'all',
    roomType: 'All Rooms',
    dateStart: '2026-06-30',
    dateEnd: new Date('2026-07-07T00:00:00.000Z'),
  }),
  'Hotel Ops trend alert fingerprint normalizes equivalent date windows',
)
assert.notEqual(
  hotelOpsTrendAlertFingerprint({ alertType: 'LOW_DEMAND', platform: 'all', roomType: 'All Rooms', dateStart: '2026-06-30', dateEnd: '2026-07-07' }),
  hotelOpsTrendAlertFingerprint({ alertType: 'LOW_DEMAND', platform: 'all', roomType: 'All Rooms', dateStart: '2026-06-30', dateEnd: '2026-07-08' }),
  'Hotel Ops trend alert fingerprint changes when the action window changes',
)

const scanAlertRows = []
const scanNotifications = []
const scanAudits = []
const scanSnapshots = []
const scanProperty = { id: 'property-scan-1', code: 'SANDBOX', email: null, reservationAlertEmail: null }
const dateKey = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null)
const scanPrisma = {
  property: {
    findUnique: async () => scanProperty,
  },
  reservation: {
    findMany: async () => [],
  },
  room: {
    findMany: async () => Array.from({ length: 10 }, (_, index) => makeOpsRoom('Deluxe Room', index)),
  },
  reservationLog: {
    findMany: async () => [],
  },
  hotelOpsScanSnapshot: {
    create: async ({ data }) => {
      const createdAt = new Date(`2026-06-30T00:00:0${scanSnapshots.length}.000Z`)
      const row = {
        id: `scan-snapshot-${scanSnapshots.length + 1}`,
        alertsCreated: 0,
        alertsUpdated: 0,
        createdAt,
        ...data,
      }
      scanSnapshots.push(row)
      return row
    },
    update: async ({ where, data }) => {
      const row = scanSnapshots.find((snapshot) => snapshot.id === where.id)
      Object.assign(row, data)
      return row
    },
    findMany: async ({ where, take }) => scanSnapshots
      .filter((snapshot) => snapshot.propertyId === where.propertyId)
      .filter((snapshot) => !where.sourceChannel || snapshot.sourceChannel === where.sourceChannel)
      .filter((snapshot) => !where.force || snapshot.force === where.force)
      .sort((a, b) => (
        new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime()
        || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ))
      .slice(0, take),
  },
  hotelOpsTrendAlert: {
    findFirst: async ({ where }) => scanAlertRows.find((alert) => (
      alert.propertyId === where.propertyId
      && alert.alertType === where.alertType
      && (alert.platform || null) === (where.platform || null)
      && (alert.roomType || null) === (where.roomType || null)
      && dateKey(alert.dateStart) === dateKey(where.dateStart)
      && dateKey(alert.dateEnd) === dateKey(where.dateEnd)
      && where.status.in.includes(alert.status)
    )) || null,
    create: async ({ data }) => {
      const now = new Date(`2026-06-30T00:00:0${scanAlertRows.length}.000Z`)
      const row = {
        id: `scan-alert-${scanAlertRows.length + 1}`,
        status: 'CREATED',
        createdAt: now,
        updatedAt: now,
        ...data,
      }
      scanAlertRows.push(row)
      return row
    },
    update: async ({ where, data }) => {
      const row = scanAlertRows.find((alert) => alert.id === where.id)
      Object.assign(row, data, { updatedAt: new Date('2026-06-30T00:00:10.000Z') })
      return row
    },
  },
  hotelOpsNotification: {
    create: async ({ data }) => {
      const row = { id: `scan-notification-${scanNotifications.length + 1}`, createdAt: new Date('2026-06-30T00:00:00.000Z'), ...data }
      scanNotifications.push(row)
      return row
    },
  },
  auditLog: {
    create: async ({ data }) => {
      scanAudits.push(data)
      return data
    },
  },
}
const firstLowDemandScan = await runOpsScan(scanPrisma, { force: 'low-demand', now: fixedOpsDate }, { id: 'manager', role: 'MANAGER' })
const secondLowDemandScan = await runOpsScan(scanPrisma, { force: 'low-demand', now: fixedOpsDate }, { id: 'manager', role: 'MANAGER' })
assert.equal(scanAlertRows.length, 1, 'Hotel Ops scan reuses an active alert instead of creating duplicates')
assert.equal(firstLowDemandScan[0]?.id, secondLowDemandScan[0]?.id, 'Hotel Ops repeated scan returns the existing active alert')
assert.equal(scanNotifications.filter((notification) => notification.type === 'TREND_ALERT').length, 1, 'Hotel Ops repeated scan does not re-notify for the same active alert')
assert.equal(scanAudits.filter((audit) => audit.action === 'OPS_SCAN_RUN').at(-1)?.changes.updated, 1, 'Hotel Ops repeated scan audits alert refresh count')
assert.equal(scanSnapshots.length, 2, 'Hotel Ops persists a scan snapshot for every booking-intelligence scan')
assert.equal(scanSnapshots[0].activeReservations, 0, 'Hotel Ops scan snapshot stores active reservation counts')
assert.equal(scanSnapshots[0].sellableRooms, 10, 'Hotel Ops scan snapshot stores sellable room counts')
assert.equal(scanSnapshots[0].alertsCreated, 1, 'Hotel Ops scan snapshot records created alert counts')
assert.equal(scanSnapshots[1].alertsUpdated, 1, 'Hotel Ops repeated scan snapshot records refreshed alert counts')
assert.equal(scanAlertRows[0].scanSnapshotId, scanSnapshots[1].id, 'Hotel Ops refreshed alert links to the latest scan snapshot')
assert.equal(scanSnapshots[1].metrics.alertIds.includes(scanAlertRows[0].id), true, 'Hotel Ops scan snapshot stores produced alert ids in metrics')
assert.equal(scanAudits.filter((audit) => audit.action === 'OPS_SCAN_RUN').at(-1)?.changes.scanSnapshotId, scanSnapshots[1].id, 'Hotel Ops scan audit links to the durable snapshot')
const listedScanSnapshots = await listOpsScanSnapshots(scanPrisma, { limit: 1 })
assert.equal(listedScanSnapshots.length, 1, 'Hotel Ops scan snapshot list honors bounded limits')
assert.equal(listedScanSnapshots[0].id, scanSnapshots[1].id, 'Hotel Ops scan snapshot list returns newest evidence first')
assert.equal(listedScanSnapshots[0].hotelId, 'SANDBOX', 'Hotel Ops scan snapshot serialization includes the hotel code')
assert.equal(listedScanSnapshots[0].sourceChannel, 'system', 'Hotel Ops scan snapshot serialization includes source channel')
assert.equal(listedScanSnapshots[0].alertsUpdated, 1, 'Hotel Ops scan snapshot serialization includes alert mutation counts')
assert.equal(Array.isArray(listedScanSnapshots[0].metrics.alertIds), true, 'Hotel Ops scan snapshot serialization includes produced alert ids')
const filteredScanSnapshots = await listOpsScanSnapshots(scanPrisma, { sourceChannel: 'web' })
assert.equal(filteredScanSnapshots.length, 0, 'Hotel Ops scan snapshot list filters source channel')

const parsedIcal = ical.parseIcalEvents(`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:booking-test-001
DTSTART;VALUE=DATE:20260612
DTEND;VALUE=DATE:20260614
SUMMARY:Booking.com iCal booking
DESCRIPTION:Smoke\\nimport
END:VEVENT
END:VCALENDAR`)
assert.equal(parsedIcal.events.length, 1, 'iCal parser imports VEVENT date blocks')
assert.equal(parsedIcal.events[0].uid, 'booking-test-001')
assert.equal(parsedIcal.events[0].checkIn, '2026-06-12')
assert.equal(parsedIcal.events[0].checkOut, '2026-06-14')
assert.equal(parsedIcal.events[0].description, 'Smoke\nimport')

const generatedIcal = ical.generateIcalFeed('Sandbox Hotel Blocks', [{
  uid: 'res,1',
  summary: 'Sandbox Hotel block - Twin; balcony',
  checkIn: '2026-06-12',
  checkOut: '2026-06-14',
  description: 'Unavailable in PMS',
}])
assert.match(generatedIcal, /^BEGIN:VCALENDAR/, 'iCal export starts with calendar envelope')
assert.match(generatedIcal, /DTSTART;VALUE=DATE:20260612/, 'iCal export includes check-in date')
assert.match(generatedIcal, /DTEND;VALUE=DATE:20260614/, 'iCal export includes check-out date')
assert.match(generatedIcal, /UID:res\\,1/, 'iCal export escapes UID text')
assert.match(generatedIcal, /SUMMARY:Sandbox Hotel block - Twin\\; balcony/, 'iCal export escapes summary text')

assert.equal(normalizeIcalProvider('booking-com'), 'BOOKING_COM', 'server iCal provider slugs normalize to enums')
assert.equal(
  buildIcalFeedUrl('https://pms.example.test/', 'token_1234567890123456'),
  'https://pms.example.test/ical/token_1234567890123456.ics',
  'server iCal feed URLs use the public app origin',
)

const fakeIcalPrisma = {
  reservation: {
    findMany: async (query) => {
      assert.deepEqual(query.where.roomTypeId, { in: ['rt-twin'] }, 'server iCal feed honors active room-type mappings')
      return [{
        id: 'res-ical-1',
        confirmationCode: 'SBX-ICAL-1',
        roomType: { code: 'TWIN', name: 'Standard Twin' },
        checkIn: new Date('2026-06-12T00:00:00.000Z'),
        checkOut: new Date('2026-06-14T00:00:00.000Z'),
      }]
    },
  },
}
const serverIcalFeed = await buildIcalFeedForChannel(fakeIcalPrisma, {
  name: 'Booking.com',
  provider: 'BOOKING_COM',
  propertyId: 'property-1',
  mappings: [
    { roomTypeId: 'rt-twin', active: true },
    { roomTypeId: 'rt-double', active: false },
  ],
}, new Date('2026-06-01T00:00:00.000Z'))
assert.match(serverIcalFeed, /X-WR-CALNAME:Booking.com - Sandbox Hotel Blocks/, 'server iCal feed names the channel calendar')
assert.match(serverIcalFeed, /DTSTART;VALUE=DATE:20260612/, 'server iCal feed exports reservation start dates')
assert.match(serverIcalFeed, /DTEND;VALUE=DATE:20260614/, 'server iCal feed exports reservation end dates')
assert.equal(serverIcalFeed.includes('Guest'), false, 'server iCal feed avoids guest PII in event summaries')

function shiftDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const assistantHotelDateKey = rules.getBangkokDateKey(new Date())
const assistantYesterdayKey = shiftDateKey(assistantHotelDateKey, -1)
const assistantTomorrowKey = shiftDateKey(assistantHotelDateKey, 1)

const assistantRooms = [
  {
    roomId: 'room-301',
    number: '301',
    floor: 3,
    type: 'DOUBLE',
    status: 'VACANT_CLEAN',
    operationalStatus: 'AVAILABLE',
    isArrivalToday: false,
    isDepartureToday: false,
    isVIP: false,
    hasIssue: false,
    needsAttention: false,
    cleanStatus: 'INSPECTED',
    depositStatus: 'NONE',
  },
  {
    roomId: 'room-302',
    number: '302',
    floor: 3,
    type: 'DOUBLE',
    status: 'VACANT_DIRTY',
    operationalStatus: 'AVAILABLE',
    isArrivalToday: true,
    isDepartureToday: false,
    isVIP: false,
    hasIssue: false,
    needsAttention: false,
    cleanStatus: 'DIRTY',
    depositStatus: 'NONE',
  },
  {
    roomId: 'room-201',
    number: '201',
    floor: 2,
    type: 'TWIN',
    status: 'OCCUPIED_CLEAN',
    operationalStatus: 'AVAILABLE',
    guestName: 'Departing Guest',
    reservationId: 'res-depart',
    currentReservationId: 'res-depart',
    checkIn: new Date(`${assistantYesterdayKey}T00:00:00.000Z`),
    checkOut: new Date(`${assistantHotelDateKey}T00:00:00.000Z`),
    guestCount: 2,
    isArrivalToday: false,
    isDepartureToday: true,
    isVIP: false,
    hasIssue: false,
    needsAttention: false,
    cleanStatus: 'CLEAN',
    depositStatus: 'PENDING',
    balanceDue: 800,
  },
]

const assistantReservations = [
  {
    id: 'res-arrival',
    confirmationCode: 'SBX-1023',
    guestName: 'John Miller',
    roomType: 'DOUBLE',
    status: 'CONFIRMED',
    checkIn: assistantHotelDateKey,
    checkOut: assistantTomorrowKey,
    adults: 2,
    children: 0,
    balanceDue: 800,
    totalAmount: 1800,
    paidAmount: 1000,
    documentVerified: false,
    depositPaid: false,
  },
  {
    id: 'res-ready',
    confirmationCode: 'SBX-1024',
    guestName: 'Maria Lopez',
    roomType: 'DOUBLE',
    status: 'CONFIRMED',
    checkIn: assistantHotelDateKey,
    checkOut: assistantTomorrowKey,
    adults: 2,
    children: 0,
    assignedRoomId: 'room-301',
    roomNumber: '301',
    balanceDue: 0,
    totalAmount: 1800,
    paidAmount: 1800,
    documentVerified: true,
    depositPaid: true,
    guestNationality: 'Spain',
    guestIdNumber: 'P123',
  },
  {
    id: 'res-depart',
    confirmationCode: 'SBX-0999',
    guestName: 'Departing Guest',
    roomType: 'TWIN',
    status: 'CHECKED_IN',
    checkIn: assistantYesterdayKey,
    checkOut: assistantHotelDateKey,
    adults: 2,
    children: 0,
    assignedRoomId: 'room-201',
    roomNumber: '201',
    balanceDue: 800,
    totalAmount: 3000,
    paidAmount: 2200,
    documentVerified: true,
  },
]

const frontDeskSnapshot = assistantTools.buildSnapshotFromData({
  hotelDateKey: assistantHotelDateKey,
  rooms: assistantRooms,
  reservations: assistantReservations,
  user: { id: 'front', role: 'front-desk', displayName: 'Front Desk' },
})

assert.equal(assistantIntents.parseFrontDeskIntent('Can I sell a double tonight?').intent, 'CHECK_AVAILABILITY', 'availability intent is parsed')
assert.equal(assistantIntents.parseFrontDeskIntent('Who is arriving today?').intent, 'LIST_ARRIVALS', 'arrival list intent is parsed')
assert.equal(assistantIntents.parseFrontDeskIntent('Who has not paid yet?').intent, 'PAYMENT_BALANCE', 'payment intent is parsed')
assert.equal(assistantIntents.parseFrontDeskIntent('Why can’t I check in reservation SBX-1023?').intent, 'CHECK_IN_ELIGIBILITY', 'check-in eligibility intent is parsed')
assert.equal(assistantIntents.parseFrontDeskIntent('Show today’s front desk risks').intent, 'DAILY_RISKS', 'daily risk intent is parsed')

const availabilityAnswer = assistantTools.runAssistantTool(
  frontDeskSnapshot,
  'Can I sell a double tonight?',
  assistantIntents.parseFrontDeskIntent('Can I sell a double tonight?'),
)
assert.equal(availabilityAnswer.records.some((record) => record.label === 'Room 301'), true, 'assistant availability cites available rooms')
assert.equal(availabilityAnswer.actions.some((item) => item.type === 'CREATE_WALK_IN_DRAFT'), true, 'availability offers walk-in workflow action')

const arrivalsAnswer = assistantTools.runAssistantTool(
  frontDeskSnapshot,
  'Who is arriving today?',
  assistantIntents.parseFrontDeskIntent('Who is arriving today?'),
)
assert.equal(arrivalsAnswer.records.length >= 2, true, 'assistant arrivals answer cites arrival reservations')

const blockedCheckInAnswer = assistantTools.runAssistantTool(
  frontDeskSnapshot,
  'Why can’t I check in reservation SBX-1023?',
  assistantIntents.parseFrontDeskIntent('Why can’t I check in reservation SBX-1023?'),
)
assert.equal(blockedCheckInAnswer.warnings.some((warning) => warning.includes('No room assigned')), true, 'assistant explains check-in blocker')
assert.equal(blockedCheckInAnswer.actions.some((item) => item.type === 'ASSIGN_BEST_ROOM'), true, 'assistant offers best-room assignment when safe')

const checkoutAnswer = assistantTools.runAssistantTool(
  frontDeskSnapshot,
  'Can I check out room 201?',
  assistantIntents.parseFrontDeskIntent('Can I check out room 201?'),
)
assert.equal(checkoutAnswer.warnings.some((warning) => warning.includes('Balance')), true, 'assistant explains checkout payment blocker')

const risksAnswer = assistantTools.runAssistantTool(
  frontDeskSnapshot,
  'Show today’s risks',
  assistantIntents.parseFrontDeskIntent('Show today’s risks'),
)
assert.equal(risksAnswer.warnings.length > 0, true, 'assistant daily risk summary surfaces risks')

const housekeepingSnapshot = { ...frontDeskSnapshot, user: { id: 'hk', role: 'housekeeping', displayName: 'Housekeeping' } }
const housekeepingPaymentAnswer = assistantTools.runAssistantTool(
  housekeepingSnapshot,
  'Who has not paid yet?',
  assistantIntents.parseFrontDeskIntent('Who has not paid yet?'),
)
assert.equal(housekeepingPaymentAnswer.directAnswer.includes('cannot view'), true, 'housekeeping cannot see payment details')
assert.equal(assistantGuards.hasAssistantPermission({ role: 'front-desk' }, 'check-in:guest'), true, 'front desk can see check-in actions')
assert.equal(assistantGuards.hasAssistantPermission({ role: 'housekeeping' }, 'process:payment'), false, 'housekeeping cannot process payment actions')

console.log('Business rule tests passed')
