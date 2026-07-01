import { canPerformAction } from './rbac.mjs'

const DEFAULT_EMAIL_OPS_COMMAND_PREFIX = '/ops'

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

function emailOpsCommandPrefix(env = process.env) {
  return normalizeNullableString(env.HOTEL_OPS_EMAIL_COMMAND_PREFIX || env.OPS_EMAIL_COMMAND_PREFIX) || DEFAULT_EMAIL_OPS_COMMAND_PREFIX
}

export function normalizeEmailOpsSender(value) {
  const raw = normalizeNullableString(value)
  if (!raw) return null
  const bracketed = raw.match(/<([^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)>/)
  const candidate = (bracketed?.[1] || raw).replace(/^mailto:/i, '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null
}

export function parseEmailOpsCommandUserMap(env = process.env) {
  const raw = normalizeNullableString(env.HOTEL_OPS_EMAIL_COMMAND_USER_MAP || env.OPS_EMAIL_COMMAND_USER_MAP)
  if (!raw) return { ok: true, map: {} }

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, map: {}, error: 'Hotel Ops email command user map must be a JSON object.' }
    }
    const entries = Object.entries(parsed)
      .map(([sender, actorRef]) => [normalizeEmailOpsSender(sender), normalizeNullableString(actorRef)])
      .filter(([sender, actorRef]) => sender && actorRef)
    return { ok: true, map: Object.fromEntries(entries) }
  } catch {
    return { ok: false, map: {}, error: 'Hotel Ops email command user map must be valid JSON.' }
  }
}

export function emailOpsCommandIntakeStatus(env = process.env) {
  const userMap = parseEmailOpsCommandUserMap(env)
  return {
    enabled: envEnabled(env.HOTEL_OPS_EMAIL_COMMANDS_ENABLED || env.OPS_EMAIL_COMMANDS_ENABLED),
    prefix: emailOpsCommandPrefix(env),
    userMapConfigured: userMap.ok && Object.keys(userMap.map).length > 0,
    userMapError: userMap.ok ? null : userMap.error,
  }
}

function eventTextCandidates(event = {}) {
  return [
    event.subject,
    event.rawText,
    event.body,
    event.snippet,
    event.text,
  ].map(normalizeNullableString).filter(Boolean)
}

export function extractEmailOpsCommandText(event = {}, env = process.env) {
  const status = emailOpsCommandIntakeStatus(env)
  if (!status.enabled) return null

  const prefix = status.prefix
  for (const text of eventTextCandidates(event)) {
    if (!text.toLowerCase().startsWith(prefix.toLowerCase())) continue
    const command = normalizeNullableString(text.slice(prefix.length))
    if (command) return command
  }
  return null
}

export function emailOpsCommandIdempotencyKey(event = {}, index = 0) {
  const id = normalizeNullableString(
    event.sourceEmailId
      || event.sourceMessageId
      || event.gmailMessageId
      || event.messageId
      || event.id
      || event.threadId,
  )
  return `email:${id || `event-${index}`}`
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

export async function resolveEmailOpsCommandEvent(prisma, event = {}, options = {}) {
  const env = options.env || process.env
  const command = extractEmailOpsCommandText(event, env)
  if (!command) return { status: 'ignored', reason: 'not_an_ops_command' }

  const mapResult = parseEmailOpsCommandUserMap(env)
  if (!mapResult.ok) return { status: 'skipped', reason: mapResult.error, command }

  const sender = normalizeEmailOpsSender(event.sender || event.from)
  if (!sender) return { status: 'skipped', reason: 'Email sender is required for Hotel Ops commands.', command }

  const actorRef = mapResult.map[sender]
  if (!actorRef) return { status: 'skipped', reason: 'Email sender is not allowlisted for Hotel Ops commands.', sender, command }

  const actor = await findMappedActor(prisma, actorRef)
  if (!actor) return { status: 'skipped', reason: 'Mapped PMS user was not found or is inactive.', sender, command }

  if (!canPerformAction(actor, 'create:ops-task')) {
    return { status: 'skipped', reason: 'Mapped PMS user cannot create Hotel Ops tasks.', sender, command, actorId: actor.id }
  }

  return {
    status: 'accepted',
    sender,
    command,
    actor,
    idempotencyKey: emailOpsCommandIdempotencyKey(event, options.index || 0),
    sourceMetadata: {
      sourceEmailEventId: event.id || null,
      sourceEmailId: event.sourceEmailId || event.sourceMessageId || null,
      rawEmailUrl: event.rawEmailUrl || null,
      sender,
    },
  }
}

export async function processEmailOpsCommandEvents(prisma, events = [], options = {}) {
  const submitCommand = options.submitCommand
  if (typeof submitCommand !== 'function') {
    throw new Error('submitCommand is required to process email Hotel Ops commands.')
  }

  const results = []
  for (const [index, event] of events.entries()) {
    const resolved = await resolveEmailOpsCommandEvent(prisma, event, {
      env: options.env || process.env,
      index,
    })
    if (resolved.status !== 'accepted') {
      results.push(resolved)
      continue
    }

    try {
      const result = await submitCommand(
        prisma,
        {
          message: resolved.command,
          sourceChannel: 'email',
          idempotencyKey: resolved.idempotencyKey,
          sourceMetadata: resolved.sourceMetadata,
        },
        resolved.actor,
      )
      results.push({
        status: 'accepted',
        sender: resolved.sender,
        actorId: resolved.actor.id,
        command: resolved.command,
        taskId: result.task?.id || null,
        duplicate: Boolean(result.duplicate),
      })
    } catch (error) {
      results.push({
        status: 'error',
        sender: resolved.sender,
        actorId: resolved.actor.id,
        command: resolved.command,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return results
}
