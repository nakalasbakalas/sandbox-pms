import { z } from 'zod'
import { PmsValidationError } from './pms-domain.mjs'
import {
  bahtToSatang,
  dualWriteMoney,
  satangToApiString,
} from './money.mjs'
import { recordDomainEvent } from './domain-events.mjs'

const RATE_WRITE_ROLES = new Set(['ADMIN', 'MANAGER'])
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAX_DATE_RANGE_DAYS = 366
const BASIS_POINTS_PER_WHOLE = 10_000n

const identifierSchema = z.string().trim().min(1).max(200)
const optionalTextSchema = z.string().trim().max(2_000).nullable().optional()
const operationalReasonSchema = z.string().trim().min(3).max(1_000)
const dateKeySchema = z.string().regex(DATE_KEY_PATTERN, 'Use an ISO date in YYYY-MM-DD format.')
const satangSchema = z.union([z.string(), z.bigint()]).transform((value, context) => {
  const text = String(value).trim()
  if (!/^-?\d+$/.test(text)) {
    context.addIssue({ code: 'custom', message: 'Use a base-10 satang integer.' })
    return z.NEVER
  }
  return text
})

const rateRuleFieldsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: optionalTextSchema,
  roomTypeId: identifierSchema.nullable().optional(),
  priority: z.number().int().min(-10_000).max(10_000).default(0),
  startDate: dateKeySchema.nullable().optional(),
  endDate: dateKeySchema.nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  adjustmentType: z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'OVERRIDE']),
  adjustmentSatang: satangSchema.optional(),
  adjustmentBasisPoints: z.number().int().min(-10_000).max(1_000_000).optional(),
  active: z.boolean().default(true),
}).strict()

const createRateRuleSchema = rateRuleFieldsSchema.extend({
  reason: operationalReasonSchema,
}).strict()

const updateRateRuleSchema = z.object({
  ruleId: identifierSchema,
  reason: operationalReasonSchema,
  name: z.string().trim().min(1).max(120).optional(),
  description: optionalTextSchema,
  roomTypeId: identifierSchema.nullable().optional(),
  priority: z.number().int().min(-10_000).max(10_000).optional(),
  startDate: dateKeySchema.nullable().optional(),
  endDate: dateKeySchema.nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  adjustmentType: z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'OVERRIDE']).optional(),
  adjustmentSatang: satangSchema.optional(),
  adjustmentBasisPoints: z.number().int().min(-10_000).max(1_000_000).optional(),
  active: z.boolean().optional(),
}).strict()

const listRateRulesSchema = z.object({
  roomTypeId: identifierSchema.optional(),
  active: z.boolean().optional(),
  date: dateKeySchema.optional(),
}).strict()

const calendarEntrySchema = z.object({
  roomTypeId: identifierSchema,
  date: dateKeySchema,
  rateSatang: satangSchema,
  minStay: z.number().int().min(1).max(365).nullable().optional(),
  maxStay: z.number().int().min(1).max(365).nullable().optional(),
  stopSell: z.boolean().default(false),
  closeToArrival: z.boolean().default(false),
  closeToDeparture: z.boolean().default(false),
  notes: optionalTextSchema,
  reason: operationalReasonSchema,
}).strict()

const listRateCalendarSchema = z.object({
  roomTypeId: identifierSchema.optional(),
  startDate: dateKeySchema,
  endDate: dateKeySchema,
}).strict()

const effectiveRateSchema = z.object({
  roomTypeId: identifierSchema,
  date: dateKeySchema,
  stayLength: z.number().int().min(1).max(365).optional(),
  isArrivalDate: z.boolean().default(false),
  isDepartureDate: z.boolean().default(false),
}).strict()

const recommendationSchema = effectiveRateSchema.extend({
  proposedRateSatang: satangSchema,
  rationale: z.string().trim().min(3).max(1_000),
}).strict()

export const rateServiceSchemas = Object.freeze({
  createRateRule: createRateRuleSchema,
  updateRateRule: updateRateRuleSchema,
  listRateRules: listRateRulesSchema,
  upsertRateCalendarEntry: calendarEntrySchema,
  listRateCalendar: listRateCalendarSchema,
  effectiveRate: effectiveRateSchema,
  recommendation: recommendationSchema,
})

function validationMessage(error) {
  const issue = error?.issues?.[0]
  if (!issue) return 'Enter valid rate data.'
  const path = issue.path?.length ? `${issue.path.join('.')}: ` : ''
  return `${path}${issue.message}`
}

function parseInput(schema, input) {
  const result = schema.safeParse(input ?? {})
  if (!result.success) throw new PmsValidationError(validationMessage(result.error))
  return result.data
}

function dateFromKey(key, label = 'Date') {
  if (!DATE_KEY_PATTERN.test(String(key || ''))) {
    throw new PmsValidationError(`${label} must use YYYY-MM-DD format.`)
  }
  const date = new Date(`${key}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== key) {
    throw new PmsValidationError(`${label} is not a real calendar date.`)
  }
  return date
}

function dateKey(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

function contextFor(context) {
  const propertyId = String(context?.propertyId || '').trim()
  const actorId = String(context?.actor?.id || '').trim()
  const role = String(context?.role || context?.actor?.role || '').trim().toUpperCase()
  if (!propertyId || !actorId || !role) {
    throw new PmsValidationError('Authenticated property context is required.', 403)
  }
  return { propertyId, actorId, role }
}

function requireRateWriter(context) {
  const resolved = contextFor(context)
  if (!RATE_WRITE_ROLES.has(resolved.role)) {
    throw new PmsValidationError('Rate changes require manager or admin permission.', 403)
  }
  return resolved
}

function ensureDateOrder(startDate, endDate, label = 'Date range') {
  if (!startDate || !endDate) return
  if (dateFromKey(startDate).getTime() > dateFromKey(endDate).getTime()) {
    throw new PmsValidationError(`${label} start must be on or before its end.`)
  }
}

function normalizeRuleFields(input) {
  ensureDateOrder(input.startDate, input.endDate, 'Rate rule')
  const daysOfWeek = [...new Set(input.daysOfWeek || [])].sort((left, right) => left - right)
  if (input.adjustmentType === 'PERCENTAGE') {
    if (input.adjustmentBasisPoints === undefined) {
      throw new PmsValidationError('adjustmentBasisPoints is required for a percentage rule.')
    }
    if (input.adjustmentSatang !== undefined) {
      throw new PmsValidationError('adjustmentSatang is not allowed for a percentage rule.')
    }
    return {
      ...input,
      daysOfWeek,
      adjustment: input.adjustmentBasisPoints / 100,
      adjustmentSatang: null,
    }
  }

  if (input.adjustmentSatang === undefined) {
    throw new PmsValidationError('adjustmentSatang is required for a fixed or override rule.')
  }
  if (input.adjustmentBasisPoints !== undefined) {
    throw new PmsValidationError('adjustmentBasisPoints is only allowed for a percentage rule.')
  }
  const adjustmentSatang = BigInt(input.adjustmentSatang)
  if (input.adjustmentType === 'OVERRIDE' && adjustmentSatang < 0n) {
    throw new PmsValidationError('An override rate cannot be negative.')
  }
  return {
    ...input,
    daysOfWeek,
    ...dualWriteMoney('adjustment', 'adjustmentSatang', adjustmentSatang),
    adjustmentBasisPoints: null,
  }
}

async function requireRoomType(prisma, propertyId, roomTypeId) {
  const roomType = await prisma.roomType.findFirst({
    where: { id: roomTypeId, propertyId },
    include: { property: { select: { currency: true } } },
  })
  if (!roomType) throw new PmsValidationError('Room type was not found for the active property.', 404)
  return roomType
}

function auditData(context, action, entityType, entityId, changes) {
  return {
    userId: context.actorId,
    action,
    entityType,
    entityId,
    changes: {
      propertyId: context.propertyId,
      ...changes,
      providerPush: false,
    },
  }
}

function exactMoneySatang(record, legacyField, satangField = `${legacyField}Satang`) {
  const exactValue = record?.[satangField]
  if (exactValue !== null && exactValue !== undefined) return BigInt(exactValue)
  return bahtToSatang(record?.[legacyField] ?? 0, legacyField)
}

function serializeRule(rule) {
  const adjustmentSatang = rule.adjustmentType === 'PERCENTAGE'
    ? null
    : exactMoneySatang(rule, 'adjustment', 'adjustmentSatang')
  const adjustmentBasisPoints = rule.adjustmentType === 'PERCENTAGE'
    ? (rule.adjustmentBasisPoints ?? Math.round(Number(rule.adjustment) * 100))
    : null
  return {
    id: rule.id,
    propertyId: rule.propertyId,
    roomTypeId: rule.roomTypeId,
    name: rule.name,
    description: rule.description,
    priority: rule.priority,
    startDate: rule.startDate ? dateKey(rule.startDate) : null,
    endDate: rule.endDate ? dateKey(rule.endDate) : null,
    daysOfWeek: [...(rule.daysOfWeek || [])],
    adjustmentType: rule.adjustmentType,
    adjustmentSatang: adjustmentSatang === null ? null : satangToApiString(adjustmentSatang),
    adjustmentBasisPoints,
    active: rule.active,
    createdBy: rule.createdBy,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  }
}

function serializeCalendar(entry) {
  return {
    id: entry.id,
    propertyId: entry.propertyId,
    roomTypeId: entry.roomTypeId,
    date: dateKey(entry.date),
    rateSatang: satangToApiString(exactMoneySatang(entry, 'rate', 'rateSatang')),
    minStay: entry.minStay,
    maxStay: entry.maxStay,
    stopSell: entry.stopSell,
    closeToArrival: entry.closeToArrival,
    closeToDeparture: entry.closeToDeparture,
    notes: entry.notes,
    createdBy: entry.createdBy,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

export async function listRateRules(prisma, context, rawInput = {}) {
  const { propertyId } = contextFor(context)
  const input = parseInput(listRateRulesSchema, rawInput)
  if (input.roomTypeId) await requireRoomType(prisma, propertyId, input.roomTypeId)
  const where = { propertyId }
  if (input.active !== undefined) where.active = input.active
  if (input.roomTypeId) where.OR = [{ roomTypeId: input.roomTypeId }, { roomTypeId: null }]
  if (input.date) {
    const date = dateFromKey(input.date)
    where.AND = [
      { OR: [{ startDate: null }, { startDate: { lte: date } }] },
      { OR: [{ endDate: null }, { endDate: { gte: date } }] },
    ]
  }
  const rules = await prisma.rateRule.findMany({
    where,
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  })
  return rules
    .filter((rule) => !input.date || ruleApplies(rule, input.roomTypeId || rule.roomTypeId, dateFromKey(input.date)))
    .map(serializeRule)
}

export async function createRateRule(prisma, context, rawInput) {
  const resolvedContext = requireRateWriter(context)
  const input = parseInput(createRateRuleSchema, rawInput)
  const fields = normalizeRuleFields(input)
  if (fields.roomTypeId) await requireRoomType(prisma, resolvedContext.propertyId, fields.roomTypeId)

  return prisma.$transaction(async (tx) => {
    const created = await tx.rateRule.create({
      data: {
        propertyId: resolvedContext.propertyId,
        roomTypeId: fields.roomTypeId || null,
        name: fields.name,
        description: fields.description || null,
        priority: fields.priority,
        startDate: fields.startDate ? dateFromKey(fields.startDate) : null,
        endDate: fields.endDate ? dateFromKey(fields.endDate) : null,
        daysOfWeek: fields.daysOfWeek,
        adjustment: fields.adjustment,
        adjustmentSatang: fields.adjustmentSatang,
        adjustmentBasisPoints: fields.adjustmentBasisPoints,
        adjustmentType: fields.adjustmentType,
        active: fields.active,
        createdBy: resolvedContext.actorId,
      },
    })
    await tx.auditLog.create({
      data: auditData(resolvedContext, 'RATE_RULE_CREATED', 'RateRule', created.id, {
        reason: input.reason,
        roomTypeId: created.roomTypeId,
        adjustmentType: created.adjustmentType,
      }),
    })
    await recordDomainEvent(tx, {
      propertyId: resolvedContext.propertyId,
      eventType: 'RATE_RULE_CREATED',
      aggregateType: 'rateRule',
      aggregateId: created.id,
      actorUserId: resolvedContext.actorId,
    })
    return serializeRule(created)
  })
}

function fieldsFromExistingRule(rule) {
  const serialized = serializeRule(rule)
  return {
    name: serialized.name,
    description: serialized.description,
    roomTypeId: serialized.roomTypeId,
    priority: serialized.priority,
    startDate: serialized.startDate,
    endDate: serialized.endDate,
    daysOfWeek: serialized.daysOfWeek,
    adjustmentType: serialized.adjustmentType,
    ...(serialized.adjustmentType === 'PERCENTAGE'
      ? { adjustmentBasisPoints: serialized.adjustmentBasisPoints }
      : { adjustmentSatang: serialized.adjustmentSatang }),
    active: serialized.active,
  }
}

export async function updateRateRule(prisma, context, rawInput) {
  const resolvedContext = requireRateWriter(context)
  const input = parseInput(updateRateRuleSchema, rawInput)
  const existing = await prisma.rateRule.findFirst({
    where: { id: input.ruleId, propertyId: resolvedContext.propertyId },
  })
  if (!existing) throw new PmsValidationError('Rate rule was not found for the active property.', 404)

  const patch = { ...input }
  const reason = patch.reason
  delete patch.ruleId
  delete patch.reason
  const mergedInput = { ...fieldsFromExistingRule(existing), ...patch }
  if (mergedInput.adjustmentType === 'PERCENTAGE') delete mergedInput.adjustmentSatang
  else delete mergedInput.adjustmentBasisPoints
  const merged = parseInput(rateRuleFieldsSchema, mergedInput)
  const fields = normalizeRuleFields(merged)
  if (fields.roomTypeId) await requireRoomType(prisma, resolvedContext.propertyId, fields.roomTypeId)

  return prisma.$transaction(async (tx) => {
    const updated = await tx.rateRule.update({
      where: { id: existing.id },
      data: {
        roomTypeId: fields.roomTypeId || null,
        name: fields.name,
        description: fields.description || null,
        priority: fields.priority,
        startDate: fields.startDate ? dateFromKey(fields.startDate) : null,
        endDate: fields.endDate ? dateFromKey(fields.endDate) : null,
        daysOfWeek: fields.daysOfWeek,
        adjustment: fields.adjustment,
        adjustmentSatang: fields.adjustmentSatang,
        adjustmentBasisPoints: fields.adjustmentBasisPoints,
        adjustmentType: fields.adjustmentType,
        active: fields.active,
      },
    })
    await tx.auditLog.create({
      data: auditData(resolvedContext, 'RATE_RULE_UPDATED', 'RateRule', updated.id, {
        reason,
        roomTypeId: updated.roomTypeId,
        adjustmentType: updated.adjustmentType,
      }),
    })
    await recordDomainEvent(tx, {
      propertyId: resolvedContext.propertyId,
      eventType: 'RATE_RULE_UPDATED',
      aggregateType: 'rateRule',
      aggregateId: updated.id,
      actorUserId: resolvedContext.actorId,
    })
    return serializeRule(updated)
  })
}

export async function upsertRateCalendarEntry(prisma, context, rawInput) {
  const resolvedContext = requireRateWriter(context)
  const input = parseInput(calendarEntrySchema, rawInput)
  await requireRoomType(prisma, resolvedContext.propertyId, input.roomTypeId)
  const rateSatang = BigInt(input.rateSatang)
  if (rateSatang < 0n) throw new PmsValidationError('Calendar rate cannot be negative.')
  if (input.minStay && input.maxStay && input.minStay > input.maxStay) {
    throw new PmsValidationError('Minimum stay cannot exceed maximum stay.')
  }
  const date = dateFromKey(input.date)
  const money = dualWriteMoney('rate', 'rateSatang', rateSatang)

  return prisma.$transaction(async (tx) => {
    const existing = await tx.rateCalendar.findUnique({
      where: { roomTypeId_date: { roomTypeId: input.roomTypeId, date } },
    })
    if (existing && existing.propertyId !== resolvedContext.propertyId) {
      throw new PmsValidationError('Rate calendar entry belongs to another property.', 403)
    }
    const entry = await tx.rateCalendar.upsert({
      where: { roomTypeId_date: { roomTypeId: input.roomTypeId, date } },
      create: {
        propertyId: resolvedContext.propertyId,
        roomTypeId: input.roomTypeId,
        date,
        ...money,
        minStay: input.minStay ?? null,
        maxStay: input.maxStay ?? null,
        stopSell: input.stopSell,
        closeToArrival: input.closeToArrival,
        closeToDeparture: input.closeToDeparture,
        notes: input.notes || null,
        createdBy: resolvedContext.actorId,
      },
      update: {
        ...money,
        minStay: input.minStay ?? null,
        maxStay: input.maxStay ?? null,
        stopSell: input.stopSell,
        closeToArrival: input.closeToArrival,
        closeToDeparture: input.closeToDeparture,
        notes: input.notes || null,
      },
    })
    await tx.auditLog.create({
      data: auditData(
        resolvedContext,
        existing ? 'RATE_CALENDAR_UPDATED' : 'RATE_CALENDAR_CREATED',
        'RateCalendar',
        entry.id,
        { reason: input.reason, roomTypeId: input.roomTypeId, date: input.date },
      ),
    })
    await recordDomainEvent(tx, {
      propertyId: resolvedContext.propertyId,
      eventType: existing ? 'RATE_CALENDAR_UPDATED' : 'RATE_CALENDAR_CREATED',
      aggregateType: 'rateCalendar',
      aggregateId: entry.id,
      actorUserId: resolvedContext.actorId,
    })
    return serializeCalendar(entry)
  })
}

export async function listRateCalendar(prisma, context, rawInput) {
  const { propertyId } = contextFor(context)
  const input = parseInput(listRateCalendarSchema, rawInput)
  ensureDateOrder(input.startDate, input.endDate, 'Calendar')
  const startDate = dateFromKey(input.startDate)
  const endDate = dateFromKey(input.endDate)
  const rangeDays = Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1
  if (rangeDays > MAX_DATE_RANGE_DAYS) {
    throw new PmsValidationError(`Calendar range cannot exceed ${MAX_DATE_RANGE_DAYS} days.`)
  }
  if (input.roomTypeId) await requireRoomType(prisma, propertyId, input.roomTypeId)
  const entries = await prisma.rateCalendar.findMany({
    where: {
      propertyId,
      ...(input.roomTypeId ? { roomTypeId: input.roomTypeId } : {}),
      date: { gte: startDate, lte: endDate },
    },
    orderBy: [{ date: 'asc' }, { roomTypeId: 'asc' }],
  })
  return entries.map(serializeCalendar)
}

function ruleApplies(rule, roomTypeId, date) {
  if (!rule.active) return false
  if (rule.roomTypeId && rule.roomTypeId !== roomTypeId) return false
  const timestamp = date.getTime()
  if (rule.startDate && new Date(rule.startDate).getTime() > timestamp) return false
  if (rule.endDate && new Date(rule.endDate).getTime() < timestamp) return false
  return !rule.daysOfWeek?.length || rule.daysOfWeek.includes(date.getUTCDay())
}

function divideRoundHalfUp(numerator, denominator) {
  const negative = numerator < 0n
  const absolute = negative ? -numerator : numerator
  const quotient = absolute / denominator
  const remainder = absolute % denominator
  const rounded = quotient + (remainder * 2n >= denominator ? 1n : 0n)
  return negative ? -rounded : rounded
}

function applyRule(currentRate, rule) {
  if (rule.adjustmentType === 'PERCENTAGE') {
    const basisPoints = BigInt(rule.adjustmentBasisPoints ?? Math.round(Number(rule.adjustment) * 100))
    return currentRate + divideRoundHalfUp(currentRate * basisPoints, BASIS_POINTS_PER_WHOLE)
  }
  if (rule.adjustmentType === 'FIXED_AMOUNT') {
    return currentRate + exactMoneySatang(rule, 'adjustment', 'adjustmentSatang')
  }
  return exactMoneySatang(rule, 'adjustment', 'adjustmentSatang')
}

export async function getEffectiveRate(prisma, context, rawInput) {
  const { propertyId } = contextFor(context)
  const input = parseInput(effectiveRateSchema, rawInput)
  const date = dateFromKey(input.date)
  const roomType = await requireRoomType(prisma, propertyId, input.roomTypeId)
  const [rules, calendar] = await Promise.all([
    prisma.rateRule.findMany({
      where: {
        propertyId,
        active: true,
        OR: [{ roomTypeId: input.roomTypeId }, { roomTypeId: null }],
        AND: [
          { OR: [{ startDate: null }, { startDate: { lte: date } }] },
          { OR: [{ endDate: null }, { endDate: { gte: date } }] },
        ],
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.rateCalendar.findUnique({
      where: { roomTypeId_date: { roomTypeId: input.roomTypeId, date } },
    }),
  ])
  if (calendar && calendar.propertyId !== propertyId) {
    throw new PmsValidationError('Rate calendar entry belongs to another property.', 403)
  }

  const baseRate = exactMoneySatang(roomType, 'baseRate', 'baseRateSatang')
  let effectiveRate = baseRate
  const appliedRules = []
  for (const rule of rules.filter((candidate) => ruleApplies(candidate, input.roomTypeId, date))) {
    const before = effectiveRate
    effectiveRate = applyRule(effectiveRate, rule)
    if (effectiveRate < 0n) {
      throw new PmsValidationError(`Rate rule ${rule.id} produces a negative rate.`, 409)
    }
    appliedRules.push({
      id: rule.id,
      name: rule.name,
      priority: rule.priority,
      adjustmentType: rule.adjustmentType,
      beforeSatang: satangToApiString(before),
      afterSatang: satangToApiString(effectiveRate),
    })
  }

  if (calendar) effectiveRate = exactMoneySatang(calendar, 'rate', 'rateSatang')
  const reasons = []
  if (calendar?.stopSell) reasons.push('STOP_SELL')
  if (input.stayLength && calendar?.minStay && input.stayLength < calendar.minStay) reasons.push('MIN_STAY')
  if (input.stayLength && calendar?.maxStay && input.stayLength > calendar.maxStay) reasons.push('MAX_STAY')
  if (input.isArrivalDate && calendar?.closeToArrival) reasons.push('CLOSE_TO_ARRIVAL')
  if (input.isDepartureDate && calendar?.closeToDeparture) reasons.push('CLOSE_TO_DEPARTURE')

  return {
    propertyId,
    roomTypeId: roomType.id,
    roomTypeCode: roomType.code,
    date: input.date,
    currency: roomType.property?.currency || 'THB',
    baseRateSatang: satangToApiString(baseRate),
    effectiveRateSatang: satangToApiString(effectiveRate),
    source: calendar ? 'CALENDAR' : appliedRules.length ? 'RULES' : 'BASE',
    appliedRules,
    restrictions: {
      minStay: calendar?.minStay ?? null,
      maxStay: calendar?.maxStay ?? null,
      stopSell: calendar?.stopSell ?? false,
      closeToArrival: calendar?.closeToArrival ?? false,
      closeToDeparture: calendar?.closeToDeparture ?? false,
    },
    sellable: reasons.length === 0,
    unsellableReasons: reasons,
  }
}

export async function buildRateRecommendation(prisma, context, rawInput) {
  contextFor(context)
  const input = parseInput(recommendationSchema, rawInput)
  const proposedRate = BigInt(input.proposedRateSatang)
  if (proposedRate < 0n) throw new PmsValidationError('Proposed rate cannot be negative.')
  const current = await getEffectiveRate(prisma, context, {
    roomTypeId: input.roomTypeId,
    date: input.date,
    ...(input.stayLength ? { stayLength: input.stayLength } : {}),
    isArrivalDate: input.isArrivalDate,
    isDepartureDate: input.isDepartureDate,
  })
  return {
    kind: 'RATE_RECOMMENDATION',
    propertyId: current.propertyId,
    roomTypeId: current.roomTypeId,
    date: current.date,
    currentRateSatang: current.effectiveRateSatang,
    proposedRateSatang: satangToApiString(proposedRate),
    differenceSatang: satangToApiString(proposedRate - BigInt(current.effectiveRateSatang)),
    rationale: input.rationale,
    suggestionOnly: true,
    writePerformed: false,
    requiresApproval: true,
    providerPush: false,
  }
}

export const rateServicePolicy = Object.freeze({
  writeRoles: [...RATE_WRITE_ROLES],
  recommendationMode: 'SUGGEST_ONLY',
  providerPush: false,
  calculationOrder: ['BASE', 'RULES_ASCENDING_PRIORITY', 'CALENDAR_OVERRIDE'],
})
