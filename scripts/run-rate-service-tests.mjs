/* global console */
import assert from 'node:assert/strict'
import {
  buildRateRecommendation,
  createRateRule,
  getEffectiveRate,
  listRateCalendar,
  listRateRules,
  rateServicePolicy,
  updateRateRule,
  upsertRateCalendarEntry,
} from '../server/rate-service.mjs'

const now = new Date('2026-07-16T00:00:00.000Z')
const properties = [{ id: 'property-1', code: 'SANDBOX' }, { id: 'property-2', code: 'OTHER' }]
const roomTypes = [
  { id: 'room-type-1', propertyId: 'property-1', code: 'DELUXE', baseRate: 1000, baseRateSatang: 100000n },
  { id: 'room-type-2', propertyId: 'property-2', code: 'OTHER', baseRate: 999, baseRateSatang: 99900n },
]
const rateRules = [
  {
    id: 'rule-global-10-percent', propertyId: 'property-1', roomTypeId: null, name: 'Season uplift',
    description: null, priority: 10, startDate: null, endDate: null, daysOfWeek: [],
    adjustment: 10, adjustmentSatang: null, adjustmentBasisPoints: 1000,
    adjustmentType: 'PERCENTAGE', active: true, createdBy: 'manager-1', createdAt: now, updatedAt: now,
  },
  {
    id: 'rule-deluxe-fixed', propertyId: 'property-1', roomTypeId: 'room-type-1', name: 'Deluxe supplement',
    description: null, priority: 20, startDate: new Date('2026-07-01T00:00:00.000Z'), endDate: new Date('2026-07-31T00:00:00.000Z'),
    daysOfWeek: [4], adjustment: 0.01, adjustmentSatang: 1n, adjustmentBasisPoints: null,
    adjustmentType: 'FIXED_AMOUNT', active: true, createdBy: 'manager-1', createdAt: now, updatedAt: now,
  },
  {
    id: 'rule-other-property', propertyId: 'property-2', roomTypeId: null, name: 'Foreign property rule',
    description: null, priority: 1, startDate: null, endDate: null, daysOfWeek: [],
    adjustment: 100, adjustmentSatang: null, adjustmentBasisPoints: 10000,
    adjustmentType: 'PERCENTAGE', active: true, createdBy: 'manager-2', createdAt: now, updatedAt: now,
  },
]
const calendarEntries = []
const audits = []
const domainEvents = []
let ruleSequence = 10
let calendarSequence = 1

function matchesRuleWhere(rule, where) {
  if (where.propertyId && rule.propertyId !== where.propertyId) return false
  if (where.active !== undefined && rule.active !== where.active) return false
  if (where.OR && !where.OR.some((branch) => branch.roomTypeId === rule.roomTypeId)) return false
  if (where.AND) {
    const startBoundary = where.AND[0].OR[1].startDate.lte
    const endBoundary = where.AND[1].OR[1].endDate.gte
    if (rule.startDate && rule.startDate > startBoundary) return false
    if (rule.endDate && rule.endDate < endBoundary) return false
  }
  return true
}

const prisma = {
  property: { findUnique: async ({ where }) => properties.find((property) => property.code === where.code) || null },
  roomType: {
    findFirst: async ({ where }) => roomTypes.find((roomType) => roomType.id === where.id && roomType.propertyId === where.propertyId) || null,
  },
  rateRule: {
    findMany: async ({ where }) => rateRules
      .filter((rule) => matchesRuleWhere(rule, where))
      .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id)),
    findFirst: async ({ where }) => rateRules.find((rule) => rule.id === where.id && rule.propertyId === where.propertyId) || null,
    create: async ({ data }) => {
      const row = { id: `rule-${ruleSequence++}`, createdAt: now, updatedAt: now, ...data }
      rateRules.push(row)
      return row
    },
    update: async ({ where, data }) => {
      const row = rateRules.find((rule) => rule.id === where.id)
      Object.assign(row, data, { updatedAt: now })
      return row
    },
  },
  rateCalendar: {
    findUnique: async ({ where }) => calendarEntries.find((entry) => (
      entry.roomTypeId === where.roomTypeId_date.roomTypeId
      && entry.date.getTime() === where.roomTypeId_date.date.getTime()
    )) || null,
    findMany: async ({ where }) => calendarEntries.filter((entry) => (
      entry.propertyId === where.propertyId
      && (!where.roomTypeId || entry.roomTypeId === where.roomTypeId)
      && entry.date >= where.date.gte
      && entry.date <= where.date.lte
    )),
    upsert: async ({ where, create, update }) => {
      const existing = calendarEntries.find((entry) => (
        entry.roomTypeId === where.roomTypeId_date.roomTypeId
        && entry.date.getTime() === where.roomTypeId_date.date.getTime()
      ))
      if (existing) {
        Object.assign(existing, update, { updatedAt: now })
        return existing
      }
      const row = { id: `calendar-${calendarSequence++}`, createdAt: now, updatedAt: now, ...create }
      calendarEntries.push(row)
      return row
    },
  },
  auditLog: {
    create: async ({ data }) => {
      audits.push(data)
      return { id: `audit-${audits.length}`, ...data }
    },
  },
  domainEvent: {
    create: async ({ data }) => {
      const row = { id: BigInt(domainEvents.length + 1), createdAt: now, ...data }
      domainEvents.push(row)
      return row
    },
  },
  $transaction: async (callback) => callback(prisma),
}

const managerContext = { propertyId: 'property-1', actor: { id: 'manager-1', role: 'MANAGER' }, role: 'MANAGER' }
const systemContext = { propertyId: 'property-1', actor: { id: 'system', role: 'SYSTEM' }, role: 'SYSTEM' }

assert.deepEqual(rateServicePolicy.calculationOrder, ['BASE', 'RULES_ASCENDING_PRIORITY', 'CALENDAR_OVERRIDE'])
assert.equal(rateServicePolicy.providerPush, false)
assert.equal(rateServicePolicy.recommendationMode, 'SUGGEST_ONLY')

const scopedRules = await listRateRules(prisma, managerContext, { active: true, roomTypeId: 'room-type-1', date: '2026-07-16' })
assert.equal(scopedRules.some((rule) => rule.propertyId === 'property-2'), false, 'rules never cross the active property')

const effective = await getEffectiveRate(prisma, managerContext, {
  roomTypeId: 'room-type-1',
  date: '2026-07-16',
  stayLength: 1,
})
assert.equal(effective.baseRateSatang, '100000')
assert.equal(effective.effectiveRateSatang, '110001', 'percentage rounds in satang before the fixed rule is added')
assert.deepEqual(effective.appliedRules.map((rule) => rule.id), ['rule-global-10-percent', 'rule-deluxe-fixed'])
assert.equal(effective.source, 'RULES')

const createdRule = await createRateRule(prisma, managerContext, {
  name: 'Weekend discount',
  roomTypeId: 'room-type-1',
  priority: 30,
  startDate: '2026-07-01',
  endDate: '2026-07-31',
  daysOfWeek: [6, 5, 6],
  adjustmentType: 'PERCENTAGE',
  adjustmentBasisPoints: -500,
  active: true,
  reason: 'Approved July weekend promotion',
})
assert.equal(createdRule.adjustmentBasisPoints, -500)
assert.deepEqual(createdRule.daysOfWeek, [5, 6])
assert.equal(audits.at(-1).action, 'RATE_RULE_CREATED')
assert.equal(audits.at(-1).changes.providerPush, false, 'rate writes are PMS-only')

const updatedRule = await updateRateRule(prisma, managerContext, {
  ruleId: createdRule.id,
  active: false,
  reason: 'Promotion window was cancelled',
})
assert.equal(updatedRule.active, false)
assert.equal(updatedRule.priority, 30, 'partial updates do not inject schema defaults over persisted fields')
assert.deepEqual(updatedRule.daysOfWeek, [5, 6], 'partial updates preserve untouched day filters')
assert.equal(audits.at(-1).action, 'RATE_RULE_UPDATED')

await assert.rejects(
  () => createRateRule(prisma, systemContext, {
    name: 'Unsafe automation', adjustmentType: 'OVERRIDE', adjustmentSatang: '1', reason: 'Automated write',
  }),
  (error) => error.statusCode === 403 && /manager or admin/.test(error.message),
  'SYSTEM and agent actors cannot directly change rates',
)

await assert.rejects(
  () => createRateRule(prisma, managerContext, {
    name: 'Cross property', roomTypeId: 'room-type-2', adjustmentType: 'OVERRIDE', adjustmentSatang: '10000', reason: 'Wrong scope test',
  }),
  (error) => error.statusCode === 404,
  'room types from another property are rejected',
)

await assert.rejects(
  () => createRateRule(prisma, managerContext, {
    name: 'Unknown input', adjustmentType: 'OVERRIDE', adjustmentSatang: '10000', reason: 'Strict input test', autoApply: true,
  }),
  /Unrecognized key/,
  'unknown and auto-apply fields are rejected',
)

const calendar = await upsertRateCalendarEntry(prisma, managerContext, {
  roomTypeId: 'room-type-1',
  date: '2026-07-16',
  rateSatang: '123456',
  minStay: 2,
  maxStay: 5,
  stopSell: false,
  closeToArrival: true,
  closeToDeparture: false,
  notes: 'Manager-approved date override',
  reason: 'City event pricing',
})
assert.equal(calendar.rateSatang, '123456')
assert.equal(audits.at(-1).action, 'RATE_CALENDAR_CREATED')

const overridden = await getEffectiveRate(prisma, managerContext, {
  roomTypeId: 'room-type-1', date: '2026-07-16', stayLength: 1,
})
assert.equal(overridden.effectiveRateSatang, '123456', 'calendar rate is the final explicit override')
assert.equal(overridden.source, 'CALENDAR')
assert.equal(overridden.sellable, false)
assert.deepEqual(overridden.unsellableReasons, ['MIN_STAY'])
assert.equal(overridden.restrictions.closeToArrival, true)

const closedToArrival = await getEffectiveRate(prisma, managerContext, {
  roomTypeId: 'room-type-1', date: '2026-07-16', stayLength: 2, isArrivalDate: true,
})
assert.deepEqual(closedToArrival.unsellableReasons, ['CLOSE_TO_ARRIVAL'])

const listedCalendar = await listRateCalendar(prisma, managerContext, {
  roomTypeId: 'room-type-1', startDate: '2026-07-01', endDate: '2026-07-31',
})
assert.equal(listedCalendar.length, 1)
assert.equal(listedCalendar[0].propertyId, 'property-1')

const auditCountBeforeSuggestion = audits.length
const recommendation = await buildRateRecommendation(prisma, systemContext, {
  roomTypeId: 'room-type-1',
  date: '2026-07-16',
  stayLength: 2,
  proposedRateSatang: '130000',
  rationale: 'Deterministic occupancy threshold was crossed',
})
assert.equal(recommendation.suggestionOnly, true)
assert.equal(recommendation.writePerformed, false)
assert.equal(recommendation.requiresApproval, true)
assert.equal(recommendation.providerPush, false)
assert.equal(audits.length, auditCountBeforeSuggestion, 'recommendations perform no write or audit mutation')

await assert.rejects(
  () => listRateCalendar(prisma, managerContext, {
    startDate: '2026-01-01', endDate: '2027-12-31',
  }),
  /cannot exceed 366 days/,
)

console.log('Rate service tests passed')
