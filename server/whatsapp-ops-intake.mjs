import { createHmac, timingSafeEqual } from 'node:crypto'
import { canPerformAction } from './rbac.mjs'

const DEFAULT_WHATSAPP_OPS_COMMAND_PREFIX = '/ops'

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

function whatsAppOpsCommandPrefix(env = process.env) {
  return normalizeNullableString(env.HOTEL_OPS_WHATSAPP_COMMAND_PREFIX || env.OPS_WHATSAPP_COMMAND_PREFIX) || DEFAULT_WHATSAPP_OPS_COMMAND_PREFIX
}

export function normalizeWhatsAppOpsSender(value) {
  const raw = normalizeNullableString(value)
  if (!raw) return null
  const candidate = raw
    .replace(/^whatsapp:/i, '')
    .replace(/[()\s.-]/g, '')
    .trim()
    .toLowerCase()
  if (/^\+?\d{6,15}$/.test(candidate)) return candidate.replace(/^\+/, '')
  return /^[a-z0-9_:@+-]{2,}$/.test(candidate) ? candidate : null
}

export function parseWhatsAppOpsCommandUserMap(env = process.env) {
  const raw = normalizeNullableString(env.HOTEL_OPS_WHATSAPP_COMMAND_USER_MAP || env.OPS_WHATSAPP_COMMAND_USER_MAP)
  if (!raw) return { ok: true, map: {} }

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, map: {}, error: 'Hotel Ops WhatsApp command user map must be a JSON object.' }
    }
    const entries = Object.entries(parsed)
      .map(([sender, actorRef]) => [normalizeWhatsAppOpsSender(sender), normalizeNullableString(actorRef)])
      .filter(([sender, actorRef]) => sender && actorRef)
    return { ok: true, map: Object.fromEntries(entries) }
  } catch {
    return { ok: false, map: {}, error: 'Hotel Ops WhatsApp command user map must be valid JSON.' }
  }
}

export function whatsAppOpsCommandIntakeStatus(env = process.env) {
  const userMap = parseWhatsAppOpsCommandUserMap(env)
  return {
    enabled: envEnabled(env.HOTEL_OPS_WHATSAPP_COMMANDS_ENABLED || env.OPS_WHATSAPP_COMMANDS_ENABLED),
    prefix: whatsAppOpsCommandPrefix(env),
    userMapConfigured: userMap.ok && Object.keys(userMap.map).length > 0,
    userMapError: userMap.ok ? null : userMap.error,
  }
}

export function whatsAppWebhookStatus(env = process.env) {
  return {
    provider: 'meta_whatsapp_cloud_api',
    appSecretConfigured: Boolean(normalizeNullableString(env.WHATSAPP_WEBHOOK_APP_SECRET || env.WHATSAPP_APP_SECRET)),
    verifyTokenConfigured: Boolean(normalizeNullableString(env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || env.WHATSAPP_VERIFY_TOKEN)),
    accessTokenConfigured: Boolean(normalizeNullableString(env.WHATSAPP_ACCESS_TOKEN || env.WHATSAPP_CLOUD_API_TOKEN)),
    phoneNumberIdConfigured: Boolean(normalizeNullableString(env.WHATSAPP_PHONE_NUMBER_ID)),
  }
}

export function verifyWhatsAppWebhookSignature(rawBody, providedSignature, env = process.env) {
  const secret = normalizeNullableString(env.WHATSAPP_WEBHOOK_APP_SECRET || env.WHATSAPP_APP_SECRET)
  if (!secret) return { ok: false, statusCode: 503, error: 'WHATSAPP_WEBHOOK_APP_SECRET is not configured.' }

  const signature = normalizeNullableString(providedSignature)
  if (!signature) return { ok: false, statusCode: 401, error: 'Signed WhatsApp webhook request is required.' }

  const expectedSignature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
  const provided = Buffer.from(signature)
  const expected = Buffer.from(expectedSignature)
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, statusCode: 401, error: 'Invalid WhatsApp webhook signature.' }
  }

  return { ok: true }
}

function contactNameForMessage(contacts = [], senderId) {
  const normalizedSender = normalizeWhatsAppOpsSender(senderId)
  const contact = contacts.find((item) => normalizeWhatsAppOpsSender(item?.wa_id || item?.from || item?.phone) === normalizedSender)
  return normalizeNullableString(contact?.profile?.name || contact?.name)
}

function whatsAppTextForMessage(message = {}) {
  if (message.type === 'text') return normalizeNullableString(message.text?.body)
  if (message.type === 'button') return normalizeNullableString(message.button?.text)
  if (message.type === 'interactive') {
    return normalizeNullableString(
      message.interactive?.button_reply?.title
        || message.interactive?.list_reply?.title
        || message.interactive?.body?.text,
    )
  }
  return null
}

export function extractWhatsAppWebhookMessages(payload = {}) {
  const entries = Array.isArray(payload.entry) ? payload.entry : []
  const extracted = []
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : []
    for (const change of changes) {
      const value = change?.value || {}
      const messages = Array.isArray(value.messages) ? value.messages : []
      const contacts = Array.isArray(value.contacts) ? value.contacts : []
      for (const message of messages) {
        const senderId = normalizeWhatsAppOpsSender(message?.from)
        if (!senderId) continue
        extracted.push({
          provider: 'meta_whatsapp_cloud_api',
          senderId,
          senderPhone: senderId,
          contactName: contactNameForMessage(contacts, senderId),
          messageId: normalizeNullableString(message.id),
          timestamp: normalizeNullableString(message.timestamp),
          type: normalizeNullableString(message.type) || 'unknown',
          text: whatsAppTextForMessage(message),
          metadataPhoneNumberId: normalizeNullableString(value.metadata?.phone_number_id),
          metadataDisplayPhoneNumber: normalizeNullableString(value.metadata?.display_phone_number),
          raw: message,
        })
      }
    }
  }
  return extracted
}

export function extractWhatsAppOpsCommandText(event = {}, env = process.env) {
  const status = whatsAppOpsCommandIntakeStatus(env)
  if (!status.enabled) return null

  const text = normalizeText(event.text || event.body)
  if (!text.toLowerCase().startsWith(status.prefix.toLowerCase())) return null

  const command = normalizeNullableString(text.slice(status.prefix.length))
  return command || null
}

export function whatsAppOpsCommandIdempotencyKey(event = {}, index = 0) {
  const id = normalizeNullableString(event.messageId || event.id || event.timestamp)
  return `whatsapp:${id || `event-${index}`}`
}

function whatsAppReceivedAt(event = {}) {
  const timestamp = Number(event.timestamp)
  if (!Number.isFinite(timestamp)) return null
  const milliseconds = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
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

export async function resolveWhatsAppOpsCommandEvent(prisma, event = {}, options = {}) {
  const env = options.env || process.env
  const command = extractWhatsAppOpsCommandText(event, env)
  if (!command) return { status: 'ignored', reason: 'not_an_ops_command' }

  const mapResult = parseWhatsAppOpsCommandUserMap(env)
  if (!mapResult.ok) return { status: 'skipped', reason: mapResult.error, command }

  const sender = normalizeWhatsAppOpsSender(event.senderId || event.senderPhone || event.from)
  if (!sender) return { status: 'skipped', reason: 'WhatsApp sender is required for Hotel Ops commands.', command }

  const actorRef = mapResult.map[sender]
  if (!actorRef) return { status: 'skipped', reason: 'WhatsApp sender is not allowlisted for Hotel Ops commands.', sender, command }

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
    idempotencyKey: whatsAppOpsCommandIdempotencyKey(event, options.index || 0),
    sourceMetadata: {
      provider: event.provider || 'meta_whatsapp_cloud_api',
      whatsAppMessageId: event.messageId || null,
      whatsAppSender: sender,
      contactName: event.contactName || null,
      receivedAt: whatsAppReceivedAt(event),
      metadataPhoneNumberId: event.metadataPhoneNumberId || null,
      metadataDisplayPhoneNumber: event.metadataDisplayPhoneNumber || null,
    },
  }
}

export async function processWhatsAppOpsCommandEvents(prisma, events = [], options = {}) {
  const submitCommand = options.submitCommand
  if (typeof submitCommand !== 'function') {
    throw new Error('submitCommand is required to process WhatsApp Hotel Ops commands.')
  }

  const results = []
  for (const [index, event] of events.entries()) {
    const resolved = await resolveWhatsAppOpsCommandEvent(prisma, event, {
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
          sourceChannel: 'whatsapp',
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
