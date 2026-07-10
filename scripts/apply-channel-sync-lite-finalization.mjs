#!/usr/bin/env node
/* global console, process */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()

function exactReplace(content, search, replacement, path) {
  const first = content.indexOf(search)
  if (first === -1) throw new Error('Expected source block was not found in ' + path)
  if (content.indexOf(search, first + search.length) !== -1) {
    throw new Error('Expected source block is not unique in ' + path)
  }
  return content.slice(0, first) + replacement + content.slice(first + search.length)
}

async function read(path) {
  return readFile(resolve(root, path), 'utf8')
}

async function write(path, content) {
  await writeFile(resolve(root, path), content)
  console.log('updated ' + path)
}

async function patchAvailabilityQueue() {
  const path = 'server/availability-queue.mjs'
  let content = await read(path)

  content = exactReplace(
    content,
    "const QUEUE_SOURCE = 'manual_availability_queue_v2'\nconst POLICY_VERSION = '2026-07-10'",
    "export const AVAILABILITY_QUEUE_SOURCE = 'manual_availability_queue_v2'\nconst QUEUE_SOURCE = AVAILABILITY_QUEUE_SOURCE\nconst POLICY_VERSION = '2026-07-10'",
    path,
  )

  content = exactReplace(
    content,
    "const MUTABLE_QUEUE_STATUSES = new Set(['PENDING_APPROVAL', 'APPROVED', 'QUEUED'])\nconst APPROVER_ROLES = new Set(['ADMIN', 'MANAGER', 'OWNER', 'HOTEL_MANAGER'])",
    "const MUTABLE_QUEUE_STATUSES = new Set(['PENDING_APPROVAL', 'APPROVED', 'QUEUED'])\nconst QUEUE_FILTER_STATUSES = new Set([\n  'DRAFT',\n  'PENDING_APPROVAL',\n  'APPROVED',\n  'QUEUED',\n  'RUNNING',\n  'SUCCEEDED',\n  'FAILED',\n  'DENIED',\n  'CANCELLED',\n  'NEEDS_HUMAN',\n])\nconst APPROVER_ROLES = new Set(['ADMIN', 'MANAGER', 'OWNER', 'HOTEL_MANAGER'])",
    path,
  )

  content = exactReplace(
    content,
    `function requireActorRole(actor, allowedRoles, action) {
  const normalized = requireActor(actor)
  if (!allowedRoles.has(normalized.role)) {
    throw new PmsValidationError(\`${'${action}'} requires an owner or authorized manager.\`, 403)
  }
  return normalized
}`,
    `function requireActorRole(actor, allowedRoles, action) {
  const normalized = requireActor(actor)
  if (!allowedRoles.has(normalized.role)) {
    throw new PmsValidationError(\`${'${action}'} requires an owner or authorized manager.\`, 403)
  }
  return normalized
}

export async function resolveAvailabilityQueueActor(prisma, actorRef) {
  const ref = normalizeNullableText(
    actorRef && typeof actorRef === 'object'
      ? actorRef.id || actorRef.username || actorRef.email
      : actorRef,
  )
  if (!ref) throw new PmsValidationError('An active PMS user reference is required.', 401)

  const lowered = ref.toLowerCase()
  const actor = await prisma.user.findFirst({
    where: {
      active: true,
      OR: [
        { id: ref },
        { username: lowered },
        { email: lowered },
      ],
    },
  })
  if (!actor) throw new PmsValidationError('Active PMS user was not found for this queue action.', 404)

  const name = [actor.firstName, actor.lastName]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(' ')

  return {
    id: actor.id,
    name: name || actor.username || actor.email || actor.id,
    email: actor.email || undefined,
    username: actor.username || undefined,
    role: actor.role,
  }
}`,
    path,
  )

  content = exactReplace(
    content,
    `function queueMetadata(task) {
  const metadata = safeObject(task?.permissionDecision)
  return metadata.queueSource === QUEUE_SOURCE ? metadata : null
}`,
    `function queueMetadata(task) {
  const metadata = safeObject(task?.permissionDecision)
  return metadata.queueSource === QUEUE_SOURCE ? metadata : null
}

export function isManualAvailabilityQueueTask(task) {
  return Boolean(queueMetadata(task))
}`,
    path,
  )

  content = exactReplace(
    content,
    "    if (existing) return { duplicate: true, item: queueTaskResponse(existing) }",
    `    if (existing) {
      if (!queueMetadata(existing)) {
        throw new PmsValidationError('Idempotency key is already used by another Hotel Ops task.', 409)
      }
      return { duplicate: true, item: queueTaskResponse(existing) }
    }`,
    path,
  )

  content = exactReplace(
    content,
    "        requiredRole: 'OWNER',",
    "        requiredRole: 'HOTEL_MANAGER',",
    path,
  )

  content = exactReplace(
    content,
    `  const status = normalizeNullableText(filters.status)?.toUpperCase()
  const tasks = await prisma.hotelOpsTask.findMany({`,
    `  const status = normalizeNullableText(filters.status)?.toUpperCase()
  if (status && !QUEUE_FILTER_STATUSES.has(status)) {
    throw new PmsValidationError('Availability queue status filter is invalid.')
  }
  const tasks = await prisma.hotelOpsTask.findMany({`,
    path,
  )

  await write(path, content)
}

async function patchOpsService() {
  const path = 'server/ops-service.mjs'
  let content = await read(path)

  content = exactReplace(
    content,
    "import { bookingEmailGmailCredentialStatus, resolveBookingEmailGmailAccessToken } from './pms-service.mjs'",
    "import { bookingEmailGmailCredentialStatus, resolveBookingEmailGmailAccessToken } from './pms-service.mjs'\nimport { isManualAvailabilityQueueTask } from './availability-queue.mjs'",
    path,
  )

  content = exactReplace(
    content,
    `async function queueOpsTask(tx, task, actor, message = 'Task queued for signed worker execution.', extraData = {}) {
  const queued = task.status === 'QUEUED'`,
    `async function queueOpsTask(tx, task, actor, message = 'Task queued for signed worker execution.', extraData = {}) {
  if (isManualAvailabilityQueueTask(task)) {
    throw new PmsValidationError('Manual availability queue items cannot enter the OTA worker queue.', 409)
  }
  const queued = task.status === 'QUEUED'`,
    path,
  )

  content = exactReplace(
    content,
    `export function evaluateOpsTaskRun(task, actor, emergencyStop = { enabled: false }) {
  if (!task) return { allowed: false, statusCode: 404, reason: 'Hotel Ops task was not found.' }
  if (!['QUEUED', 'APPROVED'].includes(task.status)) {`,
    `export function evaluateOpsTaskRun(task, actor, emergencyStop = { enabled: false }) {
  if (!task) return { allowed: false, statusCode: 404, reason: 'Hotel Ops task was not found.' }
  if (isManualAvailabilityQueueTask(task)) {
    return {
      allowed: false,
      statusCode: 409,
      reason: 'Manual availability queue items must be delivered by a human and completed with a provider confirmation reference.',
      manualOnly: true,
    }
  }
  if (!['QUEUED', 'APPROVED'].includes(task.status)) {`,
    path,
  )

  content = exactReplace(
    content,
    `    await taskLog(tx, task.id, 'APPROVAL_GRANTED', 'Hotel Ops task approved.', actor, { notes: approvalNotes })
    await audit(tx, actor, 'OPS_APPROVAL_GRANTED', 'hotelOpsTask', task.id, { requiredRole: approval.requiredRole, notes: approvalNotes })
    return serializeTask(await queueOpsTask(tx, task, actor, 'Approved task queued for signed worker execution.'))`,
    `    await taskLog(tx, task.id, 'APPROVAL_GRANTED', 'Hotel Ops task approved.', actor, { notes: approvalNotes })
    await audit(tx, actor, 'OPS_APPROVAL_GRANTED', 'hotelOpsTask', task.id, { requiredRole: approval.requiredRole, notes: approvalNotes })

    if (isManualAvailabilityQueueTask(task)) {
      const approvedTask = await tx.hotelOpsTask.update({
        where: { id: task.id },
        data: { status: 'APPROVED' },
        include: taskInclude,
      })
      await taskLog(
        tx,
        task.id,
        'AVAILABILITY_APPROVED',
        'Manual availability change approved. It remains unsent until a human records provider delivery.',
        actor,
        { manualOnly: true, autoDispatch: false },
      )
      await audit(tx, actor, 'AVAILABILITY_QUEUE_APPROVED', 'hotelOpsTask', task.id, {
        requiredRole: approval.requiredRole,
        notes: approvalNotes,
        manualOnly: true,
        autoDispatch: false,
      })
      return serializeTask(approvedTask)
    }

    return serializeTask(await queueOpsTask(tx, task, actor, 'Approved task queued for signed worker execution.'))`,
    path,
  )

  await write(path, content)
}

async function patchScheduler() {
  const path = 'server/ops-scheduler.mjs'
  let content = await read(path)

  content = exactReplace(
    content,
    `const SYSTEM_BOOKING_EMAIL_ACTOR = Object.freeze({
  id: 'system',
  role: 'SYSTEM',
  name: 'Near-live Booking Email Scheduler',
})`,
    `const SYSTEM_BOOKING_EMAIL_ACTOR = Object.freeze({
  id: 'system',
  role: 'SYSTEM',
  name: 'Near-live Booking Email Scheduler',
})

const SCHEDULED_BOOKING_EMAIL_PROVIDERS = new Set(['gmail', 'forwarded-mailbox'])

export function isBookingEmailSourceSchedulable(source = {}) {
  const provider = String(source.provider || 'gmail').trim().toLowerCase()
  return source.enabled !== false && SCHEDULED_BOOKING_EMAIL_PROVIDERS.has(provider)
}`,
    path,
  )

  content = exactReplace(
    content,
    `    lastSourceCount: null,
    lastImportedCount: null,
    lastCommandCount: null,
    lastErrorCount: null,`,
    `    lastSourceCount: null,
    lastSkippedSourceCount: null,
    lastImportedCount: null,
    lastCommandCount: null,
    lastErrorCount: null,`,
    path,
  )

  content = exactReplace(
    content,
    `      const db = await resolvePrisma()
      const sources = (await listBookingSources(db)).filter((source) => source.enabled)
      const sourceResults = []
      let importedCount = 0
      let commandCount = 0
      let errorCount = 0

      for (const source of sources) {`,
    `      const db = await resolvePrisma()
      const enabledSources = (await listBookingSources(db)).filter((source) => source.enabled)
      const sources = enabledSources.filter(isBookingEmailSourceSchedulable)
      const skippedSources = enabledSources.filter((source) => !isBookingEmailSourceSchedulable(source))
      const sourceResults = skippedSources.map((source) => ({
        sourceId: source.id,
        mailbox: source.mailbox,
        provider: source.provider || 'unknown',
        imported: 0,
        acceptedCommands: 0,
        skipped: true,
        skipReason: 'unsupported_provider',
        error: null,
      }))
      let importedCount = 0
      let commandCount = 0
      let errorCount = 0
      const skippedSourceCount = skippedSources.length

      for (const source of sources) {`,
    path,
  )

  content = exactReplace(
    content,
    `      emailState.lastSourceCount = sources.length
      emailState.lastImportedCount = importedCount
      emailState.lastCommandCount = commandCount
      emailState.lastErrorCount = errorCount`,
    `      emailState.lastSourceCount = enabledSources.length
      emailState.lastSkippedSourceCount = skippedSourceCount
      emailState.lastImportedCount = importedCount
      emailState.lastCommandCount = commandCount
      emailState.lastErrorCount = errorCount`,
    path,
  )

  content = exactReplace(
    content,
    `        importedCount,
        commandCount,
        errorCount,
        status: getStatus(),`,
    `        importedCount,
        commandCount,
        errorCount,
        skippedSourceCount,
        status: getStatus(),`,
    path,
  )

  content = exactReplace(
    content,
    `      emailState.lastSourceCount = null
      emailState.lastImportedCount = null
      emailState.lastCommandCount = null`,
    `      emailState.lastSourceCount = null
      emailState.lastSkippedSourceCount = null
      emailState.lastImportedCount = null
      emailState.lastCommandCount = null`,
    path,
  )

  await write(path, content)
}

async function patchCli() {
  const path = 'scripts/availability-queue.mjs'
  let content = await read(path)

  content = exactReplace(
    content,
    `  markAvailabilityQueueItemFailed,
  markAvailabilityQueueItemSent,
} from '../server/availability-queue.mjs'`,
    `  markAvailabilityQueueItemFailed,
  markAvailabilityQueueItemSent,
  resolveAvailabilityQueueActor,
} from '../server/availability-queue.mjs'`,
    path,
  )

  const helpStart = content.indexOf('function helpText() {')
  const helpEnd = content.indexOf('\n\nfunction required', helpStart)
  if (helpStart === -1 || helpEnd === -1) throw new Error('Could not locate CLI help section.')
  const help = `function helpText() {
  return \`
Manual outbound availability queue

Usage:
  npm run availability:queue -- create --provider agoda --hotel-id HOTEL123 \\
    --room-type DOUBLE --from 2026-07-11 --to 2026-07-15 --rooms 2 \\
    --reason "Reservation received; reduce sellable inventory" \\
    --actor admin@example.com

  npm run availability:queue -- list [--status PENDING_APPROVAL] [--limit 100]

  npm run availability:queue -- approve --id TASK_ID \\
    --notes "Approved against PMS inventory" --actor manager

  npm run availability:queue -- mark-sent --id TASK_ID \\
    --reference PROVIDER_CONFIRMATION --notes "Updated in partner portal" \\
    --actor manager

  npm run availability:queue -- mark-failed --id TASK_ID \\
    --reason "Partner portal unavailable" --actor manager

  npm run availability:queue -- cancel --id TASK_ID \\
    --reason "Superseded by newer inventory" --actor manager

  npm run availability:queue -- policy

Providers:
  booking | agoda | trip | expedia | channex

Identity:
  --actor accepts an active PMS user ID, username, or email. The database role and
  display name are used for authorization and audit. --actor-id is a legacy alias;
  caller-supplied actor labels or roles are ignored.

Safety:
  Queue creation and approval never call an OTA. An item is only completed after a
  human records an external provider confirmation/reference.
\`.trim()
}`
  content = content.slice(0, helpStart) + help + content.slice(helpEnd)

  content = exactReplace(
    content,
    `function actorFromArgs(args) {
  return {
    id: required(args, 'actor-id', 'Actor ID'),
    name: required(args, 'actor-label', 'Actor label'),
    role: required(args, 'actor-role', 'Actor role'),
  }
}`,
    `async function actorFromArgs(prisma, args) {
  const actorRef = String(args.actor || args['actor-id'] || '').trim()
  if (!actorRef) throw new Error('Active PMS actor is required (--actor).')
  return resolveAvailabilityQueueActor(prisma, actorRef)
}`,
    path,
  )

  content = exactReplace(
    content,
    '  const actor = actorFromArgs(args)',
    '  const actor = await actorFromArgs(prisma, args)',
    path,
  )

  await write(path, content)
}

async function patchTypesAndUi() {
  const typePath = 'src/types/hotel-ops.ts'
  let types = await read(typePath)
  types = exactReplace(
    types,
    `export type PermissionDecision = {
  allowed: boolean
  approvalRequired: boolean
  requiredApprovalRole?: HotelOpsRole
  riskLevel: RiskLevel
  reason: string
  blockedByEmergencyStop?: boolean
}`,
    `export type PermissionDecision = {
  allowed: boolean
  approvalRequired?: boolean
  requiredApprovalRole?: HotelOpsRole
  riskLevel?: RiskLevel
  reason?: string
  blockedByEmergencyStop?: boolean
  queueSource?: string
  policyVersion?: string
  provider?: string
  providerLabel?: string
  deliveryTarget?: 'MANUAL_PORTAL' | 'CHANNEL_MANAGER' | string
  autoDispatch?: boolean
  trueTwoWayRequiresZeroLag?: boolean
  providerReference?: string
  deliveryNotes?: string
}`,
    typePath,
  )
  await write(typePath, types)

  const uiPath = 'src/components/hotel-ops/HotelOpsCommandCenterView.tsx'
  let ui = await read(uiPath)
  ui = exactReplace(
    ui,
    `async function copyProofUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url)
    toast.success('Proof reference copied.')
  } catch {
    toast.error('Could not copy proof reference.')
  }
}

function TaskCard({`,
    `async function copyProofUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url)
    toast.success('Proof reference copied.')
  } catch {
    toast.error('Could not copy proof reference.')
  }
}

function isManualAvailabilityQueueTask(task: HotelOpsTask) {
  return task.permissionDecision?.queueSource === 'manual_availability_queue_v2'
}

function TaskCard({`,
    uiPath,
  )

  ui = exactReplace(
    ui,
    `  compact?: boolean
}) {
  return (`,
    `  compact?: boolean
}) {
  const manualAvailabilityQueue = isManualAvailabilityQueueTask(task)
  return (`,
    uiPath,
  )

  ui = exactReplace(
    ui,
    `              {task.approvalRequired && <Badge variant="outline">Approval required</Badge>}
            </div>`,
    `              {task.approvalRequired && <Badge variant="outline">Approval required</Badge>}
              {manualAvailabilityQueue && <Badge variant="secondary">Manual delivery</Badge>}
            </div>`,
    uiPath,
  )

  ui = exactReplace(
    ui,
    `{['QUEUED', 'APPROVED'].includes(task.status) && onRun && (`,
    `{!manualAvailabilityQueue && ['QUEUED', 'APPROVED'].includes(task.status) && onRun && (`,
    uiPath,
  )

  ui = exactReplace(
    ui,
    `        {task.executionSummary && (
          <div className="rounded border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {task.executionSummary}
          </div>
        )}`,
    `        {manualAvailabilityQueue && ['PENDING_APPROVAL', 'APPROVED'].includes(task.status) && (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            This item is manual-only. After approval, update the provider portal and record the provider confirmation with the availability queue command. It cannot be sent to the OTA worker.
          </div>
        )}

        {task.executionSummary && (
          <div className="rounded border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {task.executionSummary}
          </div>
        )}`,
    uiPath,
  )

  await write(uiPath, ui)
}

async function patchRenderAndDocs() {
  const renderPath = 'render.yaml'
  let render = await read(renderPath)
  render = exactReplace(
    render,
    `      - key: BOOKING_EMAIL_NEAR_LIVE_ENABLED
        value: true`,
    `      - key: BOOKING_EMAIL_NEAR_LIVE_ENABLED
        value: false`,
    renderPath,
  )
  await write(renderPath, render)

  const readmePath = 'README.md'
  let readme = await read(readmePath)
  readme = exactReplace(
    readme,
    `The complete architecture, activation sequence, failure behavior, application status, Channex decision trigger, and operator commands are in [docs/CHANNEL_SYNC_V2.md](docs/CHANNEL_SYNC_V2.md). The implementation prompt is recorded in [docs/prompts/CHANNEL_SYNC_V2_EXECUTED_PROMPT.md](docs/prompts/CHANNEL_SYNC_V2_EXECUTED_PROMPT.md).`,
    `The lite release boundary, audit findings, execution plan, activation checks, and rollback steps are in [docs/CHANNEL_SYNC_LITE_FINALIZATION.md](docs/CHANNEL_SYNC_LITE_FINALIZATION.md). The architecture and operator runbook remain in [docs/CHANNEL_SYNC_V2.md](docs/CHANNEL_SYNC_V2.md). The executed prompts are recorded in [docs/prompts/CHANNEL_SYNC_LITE_FINALIZATION_EXECUTED_PROMPT.md](docs/prompts/CHANNEL_SYNC_LITE_FINALIZATION_EXECUTED_PROMPT.md) and [docs/prompts/CHANNEL_SYNC_V2_EXECUTED_PROMPT.md](docs/prompts/CHANNEL_SYNC_V2_EXECUTED_PROMPT.md).`,
    readmePath,
  )
  await write(readmePath, readme)

  const docPath = 'docs/CHANNEL_SYNC_V2.md'
  let doc = await read(docPath)
  doc = exactReplace(
    doc,
    `Status: **implemented on \`feat/channel-sync-v2\`; external provider access remains pending owner submission and provider approval**.`,
    `Status: **lite finalization candidate on \`feat/channel-sync-lite-finalize\`; external provider access remains pending owner submission and provider approval**.`,
    docPath,
  )
  doc = exactReplace(
    doc,
    `1. loads every enabled booking-email source;
2. fetches a bounded set of recent Gmail messages through OAuth;`,
    `1. loads enabled booking-email sources;
2. polls only Gmail-backed source types supported by the lite synchronizer and records unsupported source types as skipped;
3. fetches a bounded set of recent Gmail messages through OAuth;`,
    docPath,
  )
  doc = doc.replace('3. uses existing source-message and booking-reference de-duplication;', '4. uses existing source-message and booking-reference de-duplication;')
  doc = doc.replace('4. parses and stores review events;', '5. parses and stores review events;')
  doc = doc.replace('5. optionally recognizes allowlisted `/ops` commands through the existing guarded intake;', '6. optionally recognizes allowlisted `/ops` commands through the existing guarded intake;')
  doc = doc.replace('6. records source sync timestamps/errors;', '7. records source sync timestamps/errors;')
  doc = doc.replace('7. leaves booking, cancellation, modification, and payment application to the review workflow.', '8. leaves booking, cancellation, modification, and payment application to the review workflow.')
  doc = exactReplace(
    doc,
    `- Risk is \`HIGH\` and owner approval is created with the task.`,
    `- Risk is \`HIGH\` and hotel-manager-or-owner approval is created with the task.`,
    docPath,
  )
  doc = exactReplace(
    doc,
    `- Queue creation and approval do not call an OTA worker, browser adapter, or API.
- \`mark-sent\` requires a provider confirmation/reference.`,
    `- Queue creation and approval do not call an OTA worker, browser adapter, or API.
- Generic Hotel Ops approval leaves these records in \`APPROVED\`; generic queue/run actions reject them.
- The task interface labels them as manual delivery and hides the worker Run action.
- \`mark-sent\` requires a provider confirmation/reference.`,
    docPath,
  )
  doc = doc.replace(/--actor-id PMS_USER_ID \\\n\s*--actor-label "Hotel manager" \\\n\s*--actor-role MANAGER/g, '--actor manager')
  doc = doc.replace(/--actor-id PMS_USER_ID \\\n\s*--actor-label "Hotel manager" \\\n\s*--actor-role MANAGER/g, '--actor manager')
  doc = doc.replace(/--actor-id PMS_USER_ID \\\n\s*--actor-label "Hotel manager" \\\n\s*--actor-role MANAGER/g, '--actor manager')
  doc = doc.replace(/--actor-id PMS_USER_ID \\\n\s*--actor-label "Hotel manager" \\\n\s*--actor-role MANAGER/g, '--actor manager')
  doc = doc.replace(/--actor-id PMS_USER_ID \\\n\s*--actor-label "Hotel manager" \\\n\s*--actor-role MANAGER/g, '--actor manager')
  doc = exactReplace(
    doc,
    `Queue records also remain visible through the existing Hotel Ops task/approval interfaces because they use the same database models.`,
    `Queue records also remain visible through the existing Hotel Ops task/approval interfaces because they use the same database models. CLI actor identity is resolved from an active PMS user ID, username, or email; command-line labels and roles are not trusted.`,
    docPath,
  )
  doc = exactReplace(
    doc,
    `2. Confirm Gmail OAuth secrets exist in Render.
3. Deploy with the Render blueprint values.
4. Confirm booking-email source \`lastSyncAt\` advances approximately every two minutes.`,
    `2. Confirm Gmail OAuth secrets exist in Render.
3. Deploy with near-live polling still disabled, then explicitly set \`BOOKING_EMAIL_NEAR_LIVE_ENABLED=true\` after the mailbox check.
4. Confirm booking-email source \`lastSyncAt\` advances approximately every two minutes.`,
    docPath,
  )
  doc = exactReplace(
    doc,
    `7. Approve it and confirm no OTA call occurs.
8. Perform a safe manual provider update and record the confirmation reference.`,
    `7. Approve it, confirm it remains \`APPROVED\`, and verify the generic worker Run action is unavailable/rejected.
8. Perform a safe manual provider update and record the confirmation reference.`,
    docPath,
  )
  doc = exactReplace(
    doc,
    `\`npm test\` now runs the existing business suite followed by \`scripts/run-channel-sync-tests.mjs\`. The added tests cover policy gating, bounds, review-only scheduling, multi-source scheduler behavior, queue validation, idempotency, audit artifacts, and the Channex decision policy.`,
    `\`npm test\` runs the existing business suite followed by \`scripts/run-channel-sync-tests.mjs\`. The lite tests cover policy gating, bounds, email-only startup semantics, review-only scheduling, supported-source filtering, per-source failure isolation, database-resolved actors, the manual queue lifecycle, generic worker-path rejection, idempotency, audit artifacts, and the Channex decision policy.`,
    docPath,
  )
  await write(docPath, doc)
}

async function writeTests() {
  const path = 'scripts/run-channel-sync-tests.mjs'
  const content = String.raw`/* global console, setImmediate */
import assert from 'node:assert/strict'
import {
  approveAvailabilityQueueItem,
  cancelAvailabilityQueueItem,
  createAvailabilityQueueItem,
  getChannelSyncV2Policy,
  isManualAvailabilityQueueTask,
  listAvailabilityQueue,
  markAvailabilityQueueItemFailed,
  markAvailabilityQueueItemSent,
  normalizeAvailabilityQueueInput,
  resolveAvailabilityQueueActor,
} from '../server/availability-queue.mjs'
import {
  approveOpsTask,
  evaluateOpsTaskRun,
} from '../server/ops-service.mjs'
import {
  createHotelOpsScanScheduler,
  getBookingEmailSyncPolicy,
  isBookingEmailSourceSchedulable,
} from '../server/ops-scheduler.mjs'

function bookingEmailEnv(overrides = {}) {
  return {
    BOOKING_EMAIL_NEAR_LIVE_ENABLED: 'true',
    BOOKING_EMAIL_SYNC_INTERVAL_SECONDS: '120',
    BOOKING_EMAIL_SYNC_BATCH_LIMIT: '25',
    BOOKING_EMAIL_PRIMARY_MAILBOX: 'booking@example.com',
    BOOKING_EMAIL_GMAIL_CLIENT_ID: 'client-id',
    BOOKING_EMAIL_GMAIL_CLIENT_SECRET: 'client-secret',
    BOOKING_EMAIL_GMAIL_REFRESH_TOKEN: 'refresh-token',
    ...overrides,
  }
}

function createQueuePrismaFixture() {
  const now = () => new Date('2026-07-10T00:00:00.000Z')
  const property = {
    id: 'property-1',
    code: 'SANDBOX',
    name: 'SANDBOX HOTEL',
    email: null,
    reservationAlertEmail: null,
  }
  const users = [
    { id: 'admin-1', username: 'admin', email: 'admin@example.com', firstName: 'Admin', lastName: 'User', role: 'ADMIN', active: true },
    { id: 'manager-1', username: 'manager', email: 'manager@example.com', firstName: 'Hotel', lastName: 'Manager', role: 'MANAGER', active: true },
    { id: 'front-1', username: 'frontdesk', email: 'front@example.com', firstName: 'Front', lastName: 'Desk', role: 'FRONT_DESK', active: true },
    { id: 'inactive-1', username: 'inactive', email: 'inactive@example.com', firstName: 'Inactive', lastName: 'User', role: 'ADMIN', active: false },
  ]
  const tasks = []
  const approvals = []
  const logs = []
  const audits = []
  let taskCounter = 0
  let approvalCounter = 0
  let logCounter = 0
  let auditCounter = 0

  const withRelations = (task) => task ? {
    ...task,
    approvals: approvals.filter((approval) => approval.taskId === task.id),
    logs: logs.filter((log) => log.taskId === task.id),
    notifications: [],
  } : null

  const taskMatches = (task, where = {}) => {
    if (where.id && task.id !== where.id) return false
    if (where.idempotencyKey && task.idempotencyKey !== where.idempotencyKey) return false
    if (where.propertyId && task.propertyId !== where.propertyId) return false
    if (where.taskType && task.taskType !== where.taskType) return false
    if (where.status && task.status !== where.status) return false
    return true
  }

  const prisma = {
    property: {
      findUnique: async ({ where }) => {
        if (where?.id === property.id || where?.code === property.code) return property
        return null
      },
    },
    user: {
      findFirst: async ({ where = {} } = {}) => users.find((user) => {
        if (where.active !== undefined && user.active !== where.active) return false
        const clauses = Array.isArray(where.OR) ? where.OR : []
        if (clauses.length === 0) return true
        return clauses.some((clause) => (
          (clause.id && user.id === clause.id)
          || (clause.username && user.username === clause.username)
          || (clause.email && user.email === clause.email)
        ))
      }) || null,
    },
    hotelOpsEmergencyStop: {
      findUnique: async () => ({ id: 'stop-1', propertyId: property.id, enabled: false }),
    },
    hotelOpsTask: {
      findUnique: async ({ where }) => withRelations(tasks.find((task) => taskMatches(task, where))),
      findMany: async ({ where = {}, take } = {}) => tasks
        .filter((task) => taskMatches(task, where))
        .slice(0, take || tasks.length)
        .map(withRelations),
      create: async ({ data }) => {
        const task = {
          id: 'task-' + (++taskCounter),
          createdAt: now(),
          updatedAt: now(),
          proofScreenshots: null,
          executionSummary: null,
          errorCode: null,
          errorMessage: null,
          ...data,
        }
        tasks.push(task)
        return withRelations(task)
      },
      update: async ({ where, data }) => {
        const task = tasks.find((item) => item.id === where?.id)
        if (!task) return null
        Object.assign(task, data, { updatedAt: now() })
        return withRelations(task)
      },
      updateMany: async ({ where, data }) => {
        const task = tasks.find((item) => taskMatches(item, where))
        if (!task) return { count: 0 }
        Object.assign(task, data, { updatedAt: now() })
        return { count: 1 }
      },
    },
    hotelOpsTaskApproval: {
      create: async ({ data }) => {
        const approval = {
          id: 'approval-' + (++approvalCounter),
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
      findFirst: async ({ where = {} } = {}) => approvals.find((approval) => (
        (!where.taskId || approval.taskId === where.taskId)
        && (!where.status || approval.status === where.status)
      )) || null,
      findMany: async ({ where = {} } = {}) => approvals.filter((approval) => (
        (!where.status || approval.status === where.status)
      )),
      update: async ({ where, data }) => {
        const approval = approvals.find((item) => item.id === where?.id)
        if (!approval) return null
        Object.assign(approval, data)
        return approval
      },
    },
    hotelOpsTaskLog: {
      create: async ({ data }) => {
        const log = { id: 'log-' + (++logCounter), createdAt: now(), ...data }
        logs.push(log)
        return log
      },
    },
    auditLog: {
      create: async ({ data }) => {
        const audit = { id: 'audit-' + (++auditCounter), createdAt: now(), ...data }
        audits.push(audit)
        return audit
      },
    },
    $transaction: async (callback) => callback(prisma),
  }

  return {
    prisma,
    property,
    users,
    tasks,
    approvals,
    logs,
    audits,
    getTask: (taskId) => withRelations(tasks.find((task) => task.id === taskId)),
  }
}

async function run() {
  const disabled = getBookingEmailSyncPolicy({})
  assert.equal(disabled.enabled, false)
  assert.equal(disabled.disabledReason, 'not_requested')
  assert.equal(disabled.reviewOnly, true)
  assert.equal(disabled.operationalMutationsEnabled, false)

  const missingCredentials = getBookingEmailSyncPolicy({
    BOOKING_EMAIL_NEAR_LIVE_ENABLED: 'true',
    BOOKING_EMAIL_PRIMARY_MAILBOX: 'booking@example.com',
  })
  assert.equal(missingCredentials.enabled, false)
  assert.equal(missingCredentials.disabledReason, 'gmail_oauth_not_configured')

  const enabled = getBookingEmailSyncPolicy(bookingEmailEnv())
  assert.equal(enabled.enabled, true)
  assert.equal(enabled.intervalSeconds, 120)
  assert.equal(enabled.batchLimit, 25)
  assert.equal(enabled.credentialMode, 'refresh_token')

  const bounded = getBookingEmailSyncPolicy(bookingEmailEnv({
    BOOKING_EMAIL_SYNC_INTERVAL_SECONDS: '2',
    BOOKING_EMAIL_SYNC_BATCH_LIMIT: '9999',
  }))
  assert.equal(bounded.intervalSeconds, 30)
  assert.equal(bounded.batchLimit, 250)

  assert.equal(isBookingEmailSourceSchedulable({ provider: 'gmail', enabled: true }), true)
  assert.equal(isBookingEmailSourceSchedulable({ provider: 'forwarded-mailbox', enabled: true }), true)
  assert.equal(isBookingEmailSourceSchedulable({ enabled: true }), true)
  assert.equal(isBookingEmailSourceSchedulable({ provider: 'manual', enabled: true }), false)
  assert.equal(isBookingEmailSourceSchedulable({ provider: 'imap', enabled: true }), false)
  assert.equal(isBookingEmailSourceSchedulable({ provider: 'gmail', enabled: false }), false)

  const normalized = normalizeAvailabilityQueueInput({
    provider: 'Trip.com',
    hotelId: 'TRIP-HOTEL-1',
    roomType: 'DOUBLE',
    startDate: '2026-07-11',
    endDate: '2026-07-15',
    availableRooms: 2,
    reason: 'New Agoda booking reduces shared inventory.',
  })
  assert.equal(normalized.provider, 'trip')
  assert.equal(normalized.taskPlatform, 'trip')
  assert.equal(normalized.deliveryTarget, 'MANUAL_PORTAL')
  assert.equal(normalized.autoDispatch, false)
  assert.match(normalized.idempotencyKey, /^availability-queue:/)

  const channex = normalizeAvailabilityQueueInput({
    provider: 'channex',
    hotelId: 'PROPERTY-1',
    roomType: 'TWIN',
    startDate: '2026-07-11',
    endDate: '2026-07-11',
    availabilityStatus: 'closed',
    reason: 'Stop sell while reconciling inventory.',
  })
  assert.equal(channex.availableRooms, 0)
  assert.equal(channex.deliveryTarget, 'CHANNEL_MANAGER')
  assert.equal(channex.taskPlatform, 'all')

  assert.throws(() => normalizeAvailabilityQueueInput({
    provider: 'agoda',
    hotelId: 'A1',
    roomType: 'DOUBLE',
    startDate: '2026-07-15',
    endDate: '2026-07-11',
    availableRooms: 1,
    reason: 'Invalid date range.',
  }), /End date/)

  assert.throws(() => normalizeAvailabilityQueueInput({
    provider: 'agoda',
    hotelId: 'A1',
    roomType: 'DOUBLE',
    startDate: '2026-07-11',
    endDate: '2026-07-15',
    availabilityStatus: 'open',
    reason: 'Missing rooms.',
  }), /Available rooms/)

  const fixture = createQueuePrismaFixture()
  const admin = await resolveAvailabilityQueueActor(fixture.prisma, 'ADMIN@EXAMPLE.COM')
  const manager = await resolveAvailabilityQueueActor(fixture.prisma, 'manager')
  const frontDesk = await resolveAvailabilityQueueActor(fixture.prisma, { id: 'front-1', role: 'ADMIN', name: 'Forged Admin' })
  assert.equal(admin.role, 'ADMIN')
  assert.equal(admin.name, 'Admin User')
  assert.equal(manager.role, 'MANAGER')
  assert.equal(frontDesk.role, 'FRONT_DESK')
  assert.equal(frontDesk.name, 'Front Desk')
  await assert.rejects(() => resolveAvailabilityQueueActor(fixture.prisma, 'inactive'), /Active PMS user/)
  await assert.rejects(() => resolveAvailabilityQueueActor(fixture.prisma, 'missing-user'), /Active PMS user/)

  const created = await createAvailabilityQueueItem(fixture.prisma, {
    provider: 'agoda',
    hotelId: 'AGODA-1',
    roomType: 'DOUBLE',
    startDate: '2026-07-11',
    endDate: '2026-07-15',
    availableRooms: 1,
    reason: 'Reservation received; reduce sellable inventory.',
  }, admin)
  assert.equal(created.duplicate, false)
  assert.equal(created.item.status, 'PENDING_APPROVAL')
  assert.equal(created.item.autoDispatch, false)
  assert.equal(fixture.tasks.length, 1)
  assert.equal(fixture.approvals.length, 1)
  assert.equal(fixture.approvals[0].requiredRole, 'HOTEL_MANAGER')
  assert.equal(fixture.logs[0].action, 'AVAILABILITY_QUEUED')
  assert.equal(fixture.audits[0].action, 'AVAILABILITY_QUEUE_CREATED')
  assert.equal(isManualAvailabilityQueueTask(fixture.getTask(created.item.id)), true)

  const duplicate = await createAvailabilityQueueItem(fixture.prisma, {
    provider: 'agoda',
    hotelId: 'AGODA-1',
    roomType: 'DOUBLE',
    startDate: '2026-07-11',
    endDate: '2026-07-15',
    availableRooms: 1,
    reason: 'Reservation received; reduce sellable inventory.',
  }, admin)
  assert.equal(duplicate.duplicate, true)
  assert.equal(fixture.tasks.length, 1)

  const approvedThroughExistingUi = await approveOpsTask(
    fixture.prisma,
    created.item.id,
    { notes: 'Compared with PMS inventory.' },
    manager,
  )
  assert.equal(approvedThroughExistingUi.status, 'APPROVED')
  assert.equal(fixture.getTask(created.item.id).status, 'APPROVED')
  assert.equal(fixture.logs.some((log) => log.taskId === created.item.id && log.action === 'TASK_QUEUED'), false)
  assert.equal(fixture.logs.some((log) => log.taskId === created.item.id && log.action === 'AVAILABILITY_APPROVED'), true)

  const workerDecision = evaluateOpsTaskRun(fixture.getTask(created.item.id), admin, { enabled: false })
  assert.equal(workerDecision.allowed, false)
  assert.equal(workerDecision.manualOnly, true)
  assert.match(workerDecision.reason, /provider confirmation reference/i)

  await assert.rejects(
    () => markAvailabilityQueueItemSent(fixture.prisma, created.item.id, {}, manager),
    /Provider confirmation\/reference/,
  )
  const sent = await markAvailabilityQueueItemSent(
    fixture.prisma,
    created.item.id,
    { providerReference: 'AGODA-CONFIRM-1', notes: 'Updated in partner portal.' },
    manager,
  )
  assert.equal(sent.status, 'SUCCEEDED')
  assert.equal(sent.providerReference, 'AGODA-CONFIRM-1')

  const failureItem = await createAvailabilityQueueItem(fixture.prisma, {
    provider: 'trip',
    hotelId: 'TRIP-2',
    roomType: 'TWIN',
    startDate: '2026-07-16',
    endDate: '2026-07-17',
    availableRooms: 0,
    reason: 'Temporary reconciliation stop sell.',
  }, admin)
  const approvedFailureItem = await approveAvailabilityQueueItem(
    fixture.prisma,
    failureItem.item.id,
    { notes: 'Manager approved manual update.' },
    manager,
  )
  assert.equal(approvedFailureItem.status, 'APPROVED')
  const failed = await markAvailabilityQueueItemFailed(
    fixture.prisma,
    failureItem.item.id,
    { errorMessage: 'Provider portal unavailable.' },
    manager,
  )
  assert.equal(failed.status, 'FAILED')
  assert.equal(failed.errorMessage, 'Provider portal unavailable.')

  const cancelItem = await createAvailabilityQueueItem(fixture.prisma, {
    provider: 'booking',
    hotelId: 'BOOKING-3',
    roomType: 'DOUBLE',
    startDate: '2026-07-18',
    endDate: '2026-07-19',
    availableRooms: 2,
    reason: 'Prepare provider availability update.',
  }, admin)
  const cancelled = await cancelAvailabilityQueueItem(
    fixture.prisma,
    cancelItem.item.id,
    { reason: 'Superseded by a newer inventory calculation.' },
    manager,
  )
  assert.equal(cancelled.status, 'CANCELLED')

  const restrictedItem = await createAvailabilityQueueItem(fixture.prisma, {
    provider: 'expedia',
    hotelId: 'EXPEDIA-4',
    roomType: 'DOUBLE',
    startDate: '2026-07-20',
    endDate: '2026-07-21',
    availableRooms: 1,
    reason: 'Queue manager-reviewed availability.',
  }, frontDesk)
  await assert.rejects(
    () => approveAvailabilityQueueItem(fixture.prisma, restrictedItem.item.id, { notes: 'Forged approval.' }, frontDesk),
    /owner or authorized manager/,
  )
  await assert.rejects(
    () => listAvailabilityQueue(fixture.prisma, { status: 'NOT_A_STATUS' }),
    /status filter is invalid/,
  )
  const pending = await listAvailabilityQueue(fixture.prisma, { status: 'PENDING_APPROVAL' })
  assert.equal(pending.some((item) => item.id === restrictedItem.item.id), true)

  const intervals = []
  const syncCalls = []
  const scheduler = createHotelOpsScanScheduler({
    env: bookingEmailEnv(),
    prisma: {},
    listBookingSources: async () => [
      { id: 'source-success-1', mailbox: 'booking@example.com', provider: 'gmail', enabled: true },
      { id: 'source-failure', mailbox: 'forwarded@example.com', provider: 'forwarded-mailbox', enabled: true },
      { id: 'source-success-2', mailbox: 'secondary@example.com', provider: 'gmail', enabled: true },
      { id: 'source-manual', mailbox: 'manual@example.com', provider: 'manual', enabled: true },
    ],
    syncBooking: async (_db, input, actor) => {
      syncCalls.push({ input, actor })
      if (input.sourceId === 'source-failure') throw new Error('token=top-secret provider failure')
      if (input.sourceId === 'source-success-1') {
        return {
          events: [{ id: 'event-1' }, { id: 'event-2' }],
          opsCommandEvents: [{ id: 'event-1', rawText: '/ops read reservations' }],
        }
      }
      return { events: [{ id: 'event-3' }], opsCommandEvents: [] }
    },
    processEmailCommands: async () => [{ status: 'accepted' }],
    submitEmailCommand: async () => ({ task: { id: 'ops-1' } }),
    setIntervalFn: (callback, milliseconds) => {
      const handle = { callback, milliseconds, unref() {} }
      intervals.push(handle)
      return handle
    },
    clearIntervalFn: () => {},
    logger: { log() {}, error() {} },
    now: () => new Date('2026-07-10T12:00:00.000Z'),
  })

  const start = scheduler.start()
  assert.equal(start.started, false)
  assert.equal(start.backgroundStarted, true)
  assert.equal(start.bookingEmailStarted, true)
  assert.equal(start.status.bookingEmail.started, true)
  assert.equal(intervals.length, 1)
  assert.equal(intervals[0].milliseconds, 120_000)

  const syncResult = await scheduler.runBookingEmailOnce('test')
  assert.equal(syncResult.skipped, false)
  assert.equal(syncResult.importedCount, 3)
  assert.equal(syncResult.commandCount, 1)
  assert.equal(syncResult.errorCount, 1)
  assert.equal(syncResult.skippedSourceCount, 1)
  assert.deepEqual(syncCalls.map((call) => call.input.sourceId), ['source-success-1', 'source-failure', 'source-success-2'])
  assert.equal(syncCalls.every((call) => call.input.reviewOnly === true), true)
  assert.equal(syncCalls.every((call) => call.input.limit === 25), true)
  assert.equal(syncCalls.every((call) => call.actor.name === 'Near-live Booking Email Scheduler'), true)
  assert.equal(scheduler.getStatus().bookingEmail.status, 'PARTIAL')
  assert.equal(scheduler.getStatus().bookingEmail.lastSourceCount, 4)
  assert.equal(scheduler.getStatus().bookingEmail.lastSkippedSourceCount, 1)
  assert.doesNotMatch(scheduler.getStatus().bookingEmail.lastError || '', /top-secret/)
  assert.match(scheduler.getStatus().bookingEmail.lastError || '', /redacted/)

  scheduler.stop()
  assert.equal(scheduler.getStatus().bookingEmail.started, false)

  let releaseSlowSync
  const slowSync = new Promise((resolve) => { releaseSlowSync = resolve })
  const overlapScheduler = createHotelOpsScanScheduler({
    env: bookingEmailEnv(),
    prisma: {},
    listBookingSources: async () => [{ id: 'slow-source', mailbox: 'slow@example.com', provider: 'gmail', enabled: true }],
    syncBooking: async () => {
      await slowSync
      return { events: [], opsCommandEvents: [] }
    },
    processEmailCommands: async () => [],
    submitEmailCommand: async () => ({ task: { id: 'unused' } }),
    logger: { log() {}, error() {} },
  })
  const firstRun = overlapScheduler.runBookingEmailOnce('first')
  await new Promise((resolve) => setImmediate(resolve))
  const overlappingRun = await overlapScheduler.runBookingEmailOnce('second')
  assert.equal(overlappingRun.skipped, true)
  assert.equal(overlappingRun.reason, 'already_running')
  releaseSlowSync()
  await firstRun

  const policy = getChannelSyncV2Policy({ CHANNEL_MANAGER_PROVIDER: 'channex' })
  assert.equal(policy.outboundAvailability.mode, 'manual_queue')
  assert.equal(policy.outboundAvailability.autoDispatch, false)
  assert.equal(policy.trueTwoWay.zeroLagRequired, true)
  assert.equal(policy.trueTwoWay.channelOnlyProvider, 'channex')
  assert.deepEqual(policy.directApiApplications.map((item) => item.provider), ['agoda', 'trip'])

  console.log('Channel sync lite finalization tests passed.')
}

await run()
`
  await write(path, content)
}

await patchAvailabilityQueue()
await patchOpsService()
await patchScheduler()
await patchCli()
await patchTypesAndUi()
await patchRenderAndDocs()
await writeTests()

console.log('Channel sync lite finalization patch applied.')
