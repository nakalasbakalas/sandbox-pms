import { z } from 'zod'
import { recordDomainEvent } from './domain-events.mjs'
import { PmsValidationError } from './pms-domain.mjs'
import { requireCreateIdempotencyKey } from './create-mutation-idempotency.mjs'

const identifier = z.string().trim().min(1).max(200)
const optionalIdentifier = identifier.nullable().optional()
const optionalText = (max) => z.string().trim().max(max).nullable().optional()
const messageType = z.enum(['BOOKING_CONFIRMATION', 'PAYMENT_REMINDER', 'PRE_ARRIVAL', 'CHECK_IN_READY', 'IN_STAY', 'POST_STAY', 'CUSTOM'])
const channel = z.enum(['LINE', 'EMAIL', 'SMS', 'WHATSAPP'])
const recipientType = z.enum(['GUEST', 'STAFF', 'GROUP'])
const reason = z.string().trim().min(3).max(1_000)

const createMessageSchema = z.object({
  channel,
  type: messageType.default('CUSTOM'),
  recipientType,
  recipientId: optionalIdentifier,
  recipientName: z.string().trim().min(1).max(200),
  recipientContact: z.string().trim().max(320).default(''),
  reservationId: optionalIdentifier,
  roomNumber: optionalText(50),
  templateId: optionalIdentifier,
  subject: optionalText(300),
  body: z.string().trim().min(1).max(20_000),
  idempotencyKey: identifier.optional(),
}).strict()

const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: optionalText(1_000),
  type: messageType.default('CUSTOM'),
  channel,
  subject: optionalText(300),
  body: z.string().trim().min(1).max(20_000),
  variables: z.array(z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/)).max(100).default([]),
  active: z.boolean().default(true),
  reason,
}).strict()

export const messagingServiceSchemas = Object.freeze({ createMessage: createMessageSchema, createTemplate: createTemplateSchema })

function validationMessage(error) {
  const issue = error?.issues?.[0]
  return issue ? `${issue.path?.length ? `${issue.path.join('.')}: ` : ''}${issue.message}` : 'Enter valid messaging data.'
}

function parse(schema, input) {
  const result = schema.safeParse(input ?? {})
  if (!result.success) throw new PmsValidationError(validationMessage(result.error))
  return result.data
}

function contextFor(context) {
  const propertyId = String(context?.propertyId || '').trim()
  const actorId = String(context?.actor?.id || '').trim()
  if (!propertyId || !actorId) throw new PmsValidationError('Authenticated property context is required.', 403)
  return { propertyId, actorId, actorName: context.actor?.name || context.actor?.username || context.actor?.email || actorId }
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : value
}

function metadataOf(message) {
  return message?.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata) ? message.metadata : {}
}

function messageMatchesInput(message, input) {
  const metadata = metadataOf(message)
  return (
    message.channel === input.channel
    && message.type === input.type
    && message.recipientType === input.recipientType
    && (message.recipientId || null) === (input.recipientId || null)
    && (metadata.recipientName || '') === input.recipientName
    && (metadata.recipientContact || '') === input.recipientContact
    && (metadata.reservationId || null) === (input.reservationId || null)
    && (metadata.roomNumber || null) === (input.roomNumber || null)
    && (message.templateId || null) === (input.templateId || null)
    && (message.subject || null) === (input.subject || null)
    && message.body === input.body
  )
}

function messageDraftIdempotencyKey(context, input) {
  const requestKey = requireCreateIdempotencyKey(context?.idempotencyKey)
  if (input.idempotencyKey && input.idempotencyKey !== requestKey) {
    throw new PmsValidationError('The message idempotency key must match x-idempotency-key.', 409)
  }
  return requestKey
}

async function lockMessageDraft(tx, propertyId, idempotencyKey) {
  if (typeof tx?.$queryRawUnsafe !== 'function') return
  await tx.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS locked',
    `message-draft:${propertyId}:${idempotencyKey}`,
  )
}

export function publicMessage(message) {
  const metadata = metadataOf(message)
  return {
    id: message.id,
    propertyId: message.propertyId,
    recipientId: message.recipientId || undefined,
    recipientType: message.recipientType,
    recipientName: metadata.recipientName || 'Guest',
    recipientContact: metadata.recipientContact || '',
    reservationId: metadata.reservationId || undefined,
    roomNumber: metadata.roomNumber || undefined,
    channel: message.channel,
    type: message.type || metadata.type || 'CUSTOM',
    templateId: message.templateId || undefined,
    subject: message.subject || undefined,
    body: message.body,
    status: message.status,
    deliveryAttempted: false,
    createdBy: metadata.createdBy || 'PMS staff',
    createdAt: iso(message.createdAt),
  }
}

export function publicMessageTemplate(template) {
  return { ...template, createdAt: iso(template.createdAt), updatedAt: iso(template.updatedAt) }
}

async function validateRecipient(tx, propertyId, input) {
  if (!input.recipientId) return
  if (input.recipientType === 'GUEST') {
    const guest = await tx.guest.findFirst({ where: { id: input.recipientId, propertyId }, select: { id: true } })
    if (!guest) throw new PmsValidationError('Guest recipient was not found for the active property.', 404)
  } else if (input.recipientType === 'STAFF') {
    const membership = await tx.userPropertyMembership.findFirst({ where: { userId: input.recipientId, propertyId, active: true }, select: { id: true } })
    if (!membership) throw new PmsValidationError('Staff recipient was not found for the active property.', 404)
  }
}

async function validateLinks(tx, propertyId, input) {
  await validateRecipient(tx, propertyId, input)
  if (input.reservationId) {
    const reservation = await tx.reservation.findFirst({ where: { id: input.reservationId, propertyId }, select: { id: true } })
    if (!reservation) throw new PmsValidationError('Reservation was not found for the active property.', 404)
  }
  if (input.templateId) {
    const template = await tx.messageTemplate.findFirst({ where: { id: input.templateId, propertyId, active: true }, select: { id: true, channel: true } })
    if (!template || template.channel !== input.channel) throw new PmsValidationError('Active message template was not found for this property and channel.', 404)
  }
}

export async function listMessages(prisma, context) {
  const { propertyId } = contextFor(context)
  const messages = await prisma.message.findMany({ where: { propertyId }, orderBy: { createdAt: 'desc' }, take: 500 })
  return messages.map(publicMessage)
}

export async function createMessageDraft(prisma, context, rawInput) {
  const resolved = contextFor(context)
  const input = parse(createMessageSchema, rawInput)
  const idempotencyKey = messageDraftIdempotencyKey(context, input)
  return prisma.$transaction(async (tx) => {
    await lockMessageDraft(tx, resolved.propertyId, idempotencyKey)
    await validateLinks(tx, resolved.propertyId, input)
    const existing = await tx.message.findUnique({ where: { propertyId_idempotencyKey: { propertyId: resolved.propertyId, idempotencyKey } } })
    if (existing) {
      if (!messageMatchesInput(existing, input)) {
        throw new PmsValidationError('This message idempotency key was already used for a different draft.', 409)
      }
      return publicMessage(existing)
    }
    const message = await tx.message.create({ data: {
      propertyId: resolved.propertyId,
      recipientId: input.recipientId || null,
      recipientType: input.recipientType,
      channel: input.channel,
      type: input.type,
      templateId: input.templateId || null,
      subject: input.subject || null,
      body: input.body,
      status: 'PENDING',
      idempotencyKey,
      metadata: {
        recipientName: input.recipientName,
        recipientContact: input.recipientContact,
        reservationId: input.reservationId || null,
        roomNumber: input.roomNumber || null,
        type: input.type,
        createdBy: resolved.actorName,
        draftOnly: true,
      },
    } })
    await tx.auditLog.create({ data: {
      propertyId: resolved.propertyId, userId: resolved.actorId, action: 'MESSAGE_DRAFT_CREATED',
      entityType: 'message', entityId: message.id,
      changes: { channel: message.channel, type: message.type, recipientType: message.recipientType, status: 'PENDING', providerWrite: false },
    } })
    await recordDomainEvent(tx, {
      propertyId: resolved.propertyId, eventType: 'MESSAGE_DRAFT_CREATED', aggregateType: 'message', aggregateId: message.id,
      actorUserId: resolved.actorId, metadata: { channel: message.channel, type: message.type, deliveryAttempted: false },
    })
    return publicMessage(message)
  })
}

export async function listMessageTemplates(prisma, context) {
  const { propertyId } = contextFor(context)
  const templates = await prisma.messageTemplate.findMany({ where: { propertyId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] })
  return templates.map(publicMessageTemplate)
}

export async function createMessageTemplate(prisma, context, rawInput) {
  const resolved = contextFor(context)
  const input = parse(createTemplateSchema, rawInput)
  try {
    return await prisma.$transaction(async (tx) => {
      const duplicate = await tx.messageTemplate.findFirst({
        where: { propertyId: resolved.propertyId, name: input.name, channel: input.channel },
        select: { id: true },
      })
      if (duplicate) throw new PmsValidationError('A template with this name and channel already exists for the property.', 409)
      const template = await tx.messageTemplate.create({ data: {
        propertyId: resolved.propertyId, name: input.name, description: input.description || null, type: input.type,
        channel: input.channel, subject: input.subject || null, body: input.body,
        variables: [...new Set(input.variables)], active: input.active, createdBy: resolved.actorId,
      } })
      await tx.auditLog.create({ data: {
        propertyId: resolved.propertyId, userId: resolved.actorId, action: 'MESSAGE_TEMPLATE_CREATED',
        entityType: 'messageTemplate', entityId: template.id,
        changes: { name: template.name, channel: template.channel, type: template.type, reason: input.reason },
      } })
      await recordDomainEvent(tx, {
        propertyId: resolved.propertyId, eventType: 'MESSAGE_TEMPLATE_CREATED', aggregateType: 'messageTemplate', aggregateId: template.id,
        actorUserId: resolved.actorId, metadata: { channel: template.channel, type: template.type },
      })
      return publicMessageTemplate(template)
    })
  } catch (error) {
    if (error?.code === 'P2002') throw new PmsValidationError('A template with this name and channel already exists for the property.', 409)
    throw error
  }
}
