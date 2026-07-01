import { canPerformAction } from './rbac.mjs'

const DEFAULT_LINE_OPS_COMMAND_PREFIX = '/ops'

function normalizeText(value) {
  return String(value || '').trim()
}

function normalizeNullableString(value) {
  const normalized = normalizeText(value)
  return normalized || null
}

function envEnabled(value) {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value || '').trim().toLowerCase())
}

function lineOpsCommandPrefix(env = process.env) {
  return normalizeNullableString(env.HOTEL_OPS_LINE_COMMAND_PREFIX || env.OPS_LINE_COMMAND_PREFIX) || DEFAULT_LINE_OPS_COMMAND_PREFIX
}

export function lineOpsCommandIntakeStatus(env = process.env) {
  const userMap = parseLineOpsCommandUserMap(env)
  return {
    enabled: envEnabled(env.HOTEL_OPS_LINE_COMMANDS_ENABLED || env.OPS_LINE_COMMANDS_ENABLED),
    prefix: lineOpsCommandPrefix(env),
    userMapConfigured: userMap.ok && Object.keys(userMap.map).length > 0,
    userMapError: userMap.ok ? null : userMap.error,
  }
}

export function parseLineOpsCommandUserMap(env = process.env) {
  const raw = normalizeNullableString(env.HOTEL_OPS_LINE_COMMAND_USER_MAP || env.OPS_LINE_COMMAND_USER_MAP)
  if (!raw) return { ok: true, map: {} }

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, map: {}, error: 'Hotel Ops LINE command user map must be a JSON object.' }
    }
    const entries = Object.entries(parsed)
      .map(([lineUserId, actorRef]) => [normalizeNullableString(lineUserId), normalizeNullableString(actorRef)])
      .filter(([lineUserId, actorRef]) => lineUserId && actorRef)
    return { ok: true, map: Object.fromEntries(entries) }
  } catch {
    return { ok: false, map: {}, error: 'Hotel Ops LINE command user map must be valid JSON.' }
  }
}

export function lineSourceUserId(event = {}) {
  return normalizeNullableString(event.source?.userId)
}

export function extractLineOpsCommandText(event = {}, env = process.env) {
  const status = lineOpsCommandIntakeStatus(env)
  if (!status.enabled) return null
  if (event.message?.type !== 'text') return null

  const text = normalizeText(event.message.text)
  const prefix = status.prefix
  if (!text.toLowerCase().startsWith(prefix.toLowerCase())) return null

  const command = normalizeNullableString(text.slice(prefix.length))
  return command || null
}

export function lineOpsCommandIdempotencyKey(event = {}, index = 0) {
  const id = normalizeNullableString(event.message?.id || event.replyToken || event.webhookEventId || event.timestamp)
  return `line:${id || `event-${index}`}`
}

async function findMappedActor(prisma, actorRef) {
  const ref = normalizeNullableString(actorRef)
  if (!ref) return null
  const lowered = ref.toLowerCase()
  return prisma.user.findFirst({
    where: {
      active: true,
      OR: [
        { id: ref },
        { username: lowered },
        { email: lowered },
      ],
    },
  })
}

export async function resolveLineOpsCommandEvent(prisma, event = {}, options = {}) {
  const env = options.env || process.env
  const command = extractLineOpsCommandText(event, env)
  if (!command) return { status: 'ignored', reason: 'not_an_ops_command' }

  const mapResult = parseLineOpsCommandUserMap(env)
  if (!mapResult.ok) return { status: 'skipped', reason: mapResult.error, command }

  const lineUserId = lineSourceUserId(event)
  if (!lineUserId) return { status: 'skipped', reason: 'LINE source user id is required for Hotel Ops commands.', command }

  const actorRef = mapResult.map[lineUserId]
  if (!actorRef) return { status: 'skipped', reason: 'LINE user is not allowlisted for Hotel Ops commands.', lineUserId, command }

  const actor = await findMappedActor(prisma, actorRef)
  if (!actor) return { status: 'skipped', reason: 'Mapped PMS user was not found or is inactive.', lineUserId, command }

  if (!canPerformAction(actor, 'create:ops-task')) {
    return { status: 'skipped', reason: 'Mapped PMS user cannot create Hotel Ops tasks.', lineUserId, command, actorId: actor.id }
  }

  return {
    status: 'accepted',
    lineUserId,
    command,
    actor,
    idempotencyKey: lineOpsCommandIdempotencyKey(event, options.index || 0),
  }
}

export async function processLineOpsCommandEvents(prisma, events = [], options = {}) {
  const submitCommand = options.submitCommand
  if (typeof submitCommand !== 'function') {
    throw new Error('submitCommand is required to process LINE Hotel Ops commands.')
  }

  const results = []
  for (const [index, event] of events.entries()) {
    const resolved = await resolveLineOpsCommandEvent(prisma, event, {
      env: options.env || process.env,
      index,
    })
    if (resolved.status !== 'accepted') {
      results.push(resolved)
      continue
    }

    const result = await submitCommand(
      prisma,
      {
        message: resolved.command,
        sourceChannel: 'line',
        idempotencyKey: resolved.idempotencyKey,
      },
      resolved.actor,
    )
    results.push({
      status: 'accepted',
      lineUserId: resolved.lineUserId,
      actorId: resolved.actor.id,
      command: resolved.command,
      taskId: result.task?.id || null,
      duplicate: Boolean(result.duplicate),
    })
  }
  return results
}
