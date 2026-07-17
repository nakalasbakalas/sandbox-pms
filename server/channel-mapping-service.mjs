import { z } from 'zod'
import { recordDomainEvent } from './domain-events.mjs'
import { PmsValidationError } from './pms-domain.mjs'

const identifier = z.string().trim().min(1).max(200)
const reason = z.string().trim().min(3).max(1_000)
const mappingFields = z.object({
  channelId: identifier,
  externalRoomTypeId: identifier,
  externalRoomTypeName: z.string().trim().min(1).max(300),
  externalRatePlanId: identifier.nullable().optional(),
  roomTypeId: identifier,
  roomIds: z.array(identifier).min(1).max(500),
  active: z.boolean().default(true),
}).strict()

const createMappingSchema = mappingFields.extend({ reason }).strict()
const updateMappingSchema = z.object({
  channelId: identifier.optional(),
  externalRoomTypeId: identifier.optional(),
  externalRoomTypeName: z.string().trim().min(1).max(300).optional(),
  externalRatePlanId: identifier.nullable().optional(),
  roomTypeId: identifier.optional(),
  roomIds: z.array(identifier).min(1).max(500).optional(),
  active: z.boolean().optional(),
  reason,
}).strict()
const deleteMappingSchema = z.object({ reason }).strict()

export const channelMappingServiceSchemas = Object.freeze({ createMapping: createMappingSchema, updateMapping: updateMappingSchema, deleteMapping: deleteMappingSchema })

function parse(schema, input) {
  const result = schema.safeParse(input ?? {})
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new PmsValidationError(`${issue.path?.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`)
  }
  return result.data
}

function contextFor(context) {
  const propertyId = String(context?.propertyId || '').trim()
  const actorId = String(context?.actor?.id || '').trim()
  if (!propertyId || !actorId) throw new PmsValidationError('Authenticated property context is required.', 403)
  return { propertyId, actorId }
}

function publicMapping(mapping) {
  return {
    id: mapping.id,
    channelId: mapping.channelId,
    externalRoomTypeId: mapping.externalRoomTypeId,
    externalRoomTypeName: mapping.externalRoomTypeName,
    externalRatePlanId: mapping.externalRatePlanId || undefined,
    roomTypeId: mapping.roomTypeId,
    roomIds: mapping.roomIds,
    active: mapping.active,
    updatedAt: mapping.updatedAt instanceof Date ? mapping.updatedAt.toISOString() : mapping.updatedAt,
  }
}

async function requireChannel(tx, propertyId, channelId) {
  const channel = await tx.channel.findFirst({ where: { id: channelId, propertyId }, select: { id: true } })
  if (!channel) throw new PmsValidationError('Channel was not found for the active property.', 404)
  return channel
}

async function validateInventory(tx, propertyId, roomTypeId, roomIds) {
  const roomType = await tx.roomType.findFirst({ where: { id: roomTypeId, propertyId }, select: { id: true } })
  if (!roomType) throw new PmsValidationError('Room type was not found for the active property.', 404)
  const uniqueRoomIds = [...new Set(roomIds)]
  if (uniqueRoomIds.length !== roomIds.length) throw new PmsValidationError('roomIds must not contain duplicates.')
  const roomCount = await tx.room.count({ where: { id: { in: uniqueRoomIds }, propertyId, roomTypeId } })
  if (roomCount !== uniqueRoomIds.length) throw new PmsValidationError('Every mapped room must belong to the selected property and room type.', 404)
  return uniqueRoomIds
}

async function auditAndEmit(tx, resolved, action, eventType, mapping, reasonText) {
  await tx.auditLog.create({ data: {
    propertyId: resolved.propertyId, userId: resolved.actorId, action,
    entityType: 'channelMapping', entityId: mapping.id,
    changes: {
      channelId: mapping.channelId, roomTypeId: mapping.roomTypeId, roomCount: mapping.roomIds.length,
      externalRoomTypeId: mapping.externalRoomTypeId, active: mapping.active, reason: reasonText, providerWrite: false,
    },
  } })
  await recordDomainEvent(tx, {
    propertyId: resolved.propertyId, eventType, aggregateType: 'channelMapping', aggregateId: mapping.id,
    actorUserId: resolved.actorId,
    metadata: { channelId: mapping.channelId, roomTypeId: mapping.roomTypeId, roomCount: mapping.roomIds.length, providerWrite: false },
  })
}

export async function listChannelMappings(prisma, context) {
  const { propertyId } = contextFor(context)
  const mappings = await prisma.channelMapping.findMany({
    where: { channel: { propertyId } }, orderBy: { updatedAt: 'desc' },
  })
  return mappings.map(publicMapping)
}

export async function createChannelMapping(prisma, context, rawInput) {
  const resolved = contextFor(context)
  const input = parse(createMappingSchema, rawInput)
  try {
    return await prisma.$transaction(async (tx) => {
      await requireChannel(tx, resolved.propertyId, input.channelId)
      const roomIds = await validateInventory(tx, resolved.propertyId, input.roomTypeId, input.roomIds)
      const mapping = await tx.channelMapping.create({ data: {
        channelId: input.channelId, externalRoomTypeId: input.externalRoomTypeId,
        externalRoomTypeName: input.externalRoomTypeName, externalRatePlanId: input.externalRatePlanId || null,
        roomTypeId: input.roomTypeId, roomIds, active: input.active,
      } })
      await auditAndEmit(tx, resolved, 'CHANNEL_MAPPING_CREATED', 'CHANNEL_MAPPING_CREATED', mapping, input.reason)
      return publicMapping(mapping)
    })
  } catch (error) {
    if (error?.code === 'P2002') throw new PmsValidationError('This channel already has a mapping for the selected room type.', 409)
    throw error
  }
}

export async function updateChannelMapping(prisma, context, mappingId, rawInput) {
  const resolved = contextFor(context)
  const input = parse(updateMappingSchema, rawInput)
  return prisma.$transaction(async (tx) => {
    const existing = await tx.channelMapping.findFirst({ where: { id: mappingId, channel: { propertyId: resolved.propertyId } } })
    if (!existing) throw new PmsValidationError('Channel mapping was not found for the active property.', 404)
    const channelId = input.channelId || existing.channelId
    const roomTypeId = input.roomTypeId || existing.roomTypeId
    const requestedRoomIds = input.roomIds || existing.roomIds
    await requireChannel(tx, resolved.propertyId, channelId)
    const roomIds = await validateInventory(tx, resolved.propertyId, roomTypeId, requestedRoomIds)
    const mapping = await tx.channelMapping.update({ where: { id: existing.id }, data: {
      channelId,
      roomTypeId,
      roomIds,
      ...(input.externalRoomTypeId !== undefined ? { externalRoomTypeId: input.externalRoomTypeId } : {}),
      ...(input.externalRoomTypeName !== undefined ? { externalRoomTypeName: input.externalRoomTypeName } : {}),
      ...(input.externalRatePlanId !== undefined ? { externalRatePlanId: input.externalRatePlanId } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    } })
    await auditAndEmit(tx, resolved, 'CHANNEL_MAPPING_UPDATED', 'CHANNEL_MAPPING_UPDATED', mapping, input.reason)
    return publicMapping(mapping)
  })
}

export async function deleteChannelMapping(prisma, context, mappingId, rawInput) {
  const resolved = contextFor(context)
  const input = parse(deleteMappingSchema, rawInput)
  return prisma.$transaction(async (tx) => {
    const existing = await tx.channelMapping.findFirst({ where: { id: mappingId, channel: { propertyId: resolved.propertyId } } })
    if (!existing) throw new PmsValidationError('Channel mapping was not found for the active property.', 404)
    await auditAndEmit(tx, resolved, 'CHANNEL_MAPPING_DELETED', 'CHANNEL_MAPPING_DELETED', existing, input.reason)
    await tx.channelMapping.delete({ where: { id: existing.id } })
    return publicMapping(existing)
  })
}
