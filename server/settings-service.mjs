import { z } from 'zod'
import { recordDomainEvent } from './domain-events.mjs'
import { getSystemCapabilities } from './capability-service.mjs'
import { bahtToSatang, dualWriteMoney, satangToApiString } from './money.mjs'
import { PmsValidationError } from './pms-domain.mjs'

const SETTINGS_WRITE_ROLES = new Set(['ADMIN', 'MANAGER'])
const SENSITIVE_KEY = /(password|passcode|secret|token|api.?key|authorization|cookie|session|credential)/i
const CREDENTIAL_VALUE = /\b(password|passcode|secret|token|api[_ -]?key|authorization|cookie|session|credential)\s*(?::|=|\bis\b|\bare\b)\s*("[^"]*"|'[^']*'|\S+)/i
const SENSITIVE_QUERY_KEY = /^(access_token|api[_-]?key|auth|authorization|credential|password|secret|session|signature|token)$/i

const reasonSchema = z.string().trim().min(3).max(1_000)
const nullableText = (maximum) => z.string().trim().max(maximum).nullable().optional()
const nullableEmail = z.string().trim().toLowerCase().email().max(254).nullable().optional()
const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time in HH:mm format.')
const currencySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a three-letter ISO currency code.')
const basisPointsSchema = z.number().int().min(0).max(10_000)
const satangSchema = z.union([z.string(), z.bigint()]).transform((value, context) => {
  const text = String(value).trim()
  if (!/^\d+$/.test(text)) {
    context.addIssue({ code: 'custom', message: 'Use a non-negative base-10 satang integer.' })
    return z.NEVER
  }
  if (BigInt(text) > 1_000_000_000_000n) {
    context.addIssue({ code: 'custom', message: 'The satang value is outside the supported range.' })
    return z.NEVER
  }
  return text
})

function nullableSecureUrl() {
  return z.string().trim().url().max(2_000).superRefine((value, context) => {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:') context.addIssue({ code: 'custom', message: 'Use an HTTPS URL.' })
    if (parsed.username || parsed.password) context.addIssue({ code: 'custom', message: 'URL credentials are not allowed.' })
    for (const key of parsed.searchParams.keys()) {
      if (SENSITIVE_QUERY_KEY.test(key)) context.addIssue({ code: 'custom', message: 'Sensitive URL query parameters are not allowed.' })
    }
  }).nullable().optional()
}

const profileSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  address: nullableText(1_000),
  phone: nullableText(50),
  email: nullableEmail,
  publicWebsite: nullableSecureUrl(),
  lineId: nullableText(100),
  lineUrl: nullableSecureUrl(),
  supportHours: nullableText(300),
  reservationAlertEmail: nullableEmail,
  timezone: z.string().trim().min(1).max(100).refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value }).format()
      return true
    } catch {
      return false
    }
  }, 'Use a valid IANA timezone.').optional(),
  defaultCheckIn: timeSchema.optional(),
  defaultCheckOut: timeSchema.optional(),
  currency: currencySchema.optional(),
}).strict()

const feesSchema = z.object({
  extraGuestFeeSatang: satangSchema.optional(),
  childFeeSatang: satangSchema.optional(),
  inventoryMinimumRateSatang: satangSchema.nullable().optional(),
}).strict()

const policiesSchema = z.object({
  checkInWindow: nullableText(160),
  checkOutWindow: nullableText(160),
  smoking: nullableText(1_000),
  cancellation: nullableText(2_000),
  deposit: nullableText(2_000),
  noShow: nullableText(2_000),
  childPolicy: nullableText(2_000),
}).strict()

const operationsSchema = z.object({
  baseLanguage: z.string().trim().min(2).max(80).optional(),
  alertRecipients: z.array(z.string().trim().toLowerCase().email().max(254)).max(20).optional(),
  noOverbooking: z.boolean().optional(),
  businessDateCutoffTime: timeSchema.optional(),
}).strict()

const accountingSchema = z.object({
  exportDateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']).optional(),
  taxIdentifiersConfigured: z.boolean().optional(),
  accountingMappingsConfigured: z.boolean().optional(),
}).strict()

const paymentMethodsSchema = z.object({
  paymentGatewayConfigured: z.literal(false).optional(),
  enabledMethods: z.array(z.enum(['CASH', 'BANK_TRANSFER', 'PROMPTPAY', 'CARD_RECORDED_ONLY'])).max(10).optional(),
}).strict()

const operationalSettingsSchema = z.object({
  operations: operationsSchema.optional(),
  accounting: accountingSchema.optional(),
  paymentMethods: paymentMethodsSchema.optional(),
}).strict()

const updatePropertySettingsSchema = z.object({
  reason: reasonSchema,
  profile: profileSchema.optional(),
  fees: feesSchema.optional(),
  policies: policiesSchema.optional(),
  operationalSettings: operationalSettingsSchema.optional(),
}).strict().superRefine((value, context) => {
  if (!value.profile && !value.fees && !value.policies && !value.operationalSettings) {
    context.addIssue({ code: 'custom', message: 'At least one settings section is required.' })
  }
})

const taxItemSchema = z.object({
  id: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,50}$/),
  name: z.string().trim().min(1).max(120),
  rateBasisPoints: basisPointsSchema,
  appliesTo: z.enum(['ALL', 'ROOM', 'FOOD', 'BEVERAGE', 'EXTRAS']),
  included: z.boolean(),
}).strict()

const updateTaxSettingsSchema = z.object({
  reason: reasonSchema,
  enabled: z.boolean(),
  pricesIncludeTax: z.boolean(),
  taxes: z.array(taxItemSchema).max(20),
}).strict().superRefine((value, context) => {
  const ids = new Set()
  for (const [index, tax] of value.taxes.entries()) {
    if (ids.has(tax.id)) context.addIssue({ code: 'custom', path: ['taxes', index, 'id'], message: 'Tax identifiers must be unique.' })
    ids.add(tax.id)
  }
  const total = value.enabled ? value.taxes.reduce((sum, tax) => sum + tax.rateBasisPoints, 0) : 0
  if (total > 10_000) context.addIssue({ code: 'custom', path: ['taxes'], message: 'Combined tax cannot exceed 100 percent.' })
})

export const settingsServiceSchemas = Object.freeze({
  updatePropertySettings: updatePropertySettingsSchema,
  updateTaxSettings: updateTaxSettingsSchema,
})

function validationMessage(error) {
  const issue = error?.issues?.[0]
  if (!issue) return 'Enter valid property settings.'
  return `${issue.path?.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`
}

function parseInput(schema, input) {
  const result = schema.safeParse(input ?? {})
  if (!result.success) throw new PmsValidationError(validationMessage(result.error))
  if (CREDENTIAL_VALUE.test(JSON.stringify(result.data))) {
    throw new PmsValidationError('Credential-shaped values are not allowed in property settings.')
  }
  return result.data
}

function contextFor(context) {
  const propertyId = String(context?.propertyId || '').trim()
  const actorId = String(context?.actor?.id || '').trim()
  const role = String(context?.role || context?.actor?.role || '').trim().toUpperCase()
  if (!propertyId || !actorId || !role) throw new PmsValidationError('Authenticated property context is required.', 403)
  return { propertyId, actorId, role, requestId: String(context?.requestId || '').trim() || null }
}

function requireSettingsWriter(context) {
  const resolved = contextFor(context)
  if (!SETTINGS_WRITE_ROLES.has(resolved.role)) {
    throw new PmsValidationError('Property settings changes require manager or admin permission.', 403)
  }
  return resolved
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function pick(source, keys) {
  const output = {}
  const record = plainObject(source)
  for (const key of keys) if (record[key] !== undefined) output[key] = record[key]
  return output
}

function mergeSections(existing, patch) {
  const current = plainObject(existing)
  const next = { ...current }
  for (const [section, value] of Object.entries(patch || {})) {
    next[section] = { ...plainObject(current[section]), ...value }
  }
  return next
}

function exactSatang(record, legacyField, exactField) {
  if (record?.[exactField] !== null && record?.[exactField] !== undefined) return BigInt(record[exactField])
  return bahtToSatang(record?.[legacyField] ?? 0, legacyField)
}

function normalizedTaxes(property) {
  const configuration = plainObject(property.taxConfiguration)
  const taxes = Array.isArray(configuration.taxes) ? configuration.taxes : []
  return {
    enabled: configuration.enabled === true,
    pricesIncludeTax: configuration.pricesIncludeTax === true,
    rateBasisPoints: property.taxRateBasisPoints ?? Math.round(Number(property.taxRate || 0) * 100),
    taxes: taxes.slice(0, 20).map((tax, index) => ({
      id: String(tax?.id || `tax-${index + 1}`).slice(0, 50),
      name: String(tax?.name || 'Tax').slice(0, 120),
      rateBasisPoints: Number.isInteger(tax?.rateBasisPoints) ? tax.rateBasisPoints : Math.round(Number(tax?.rate || 0) * 100),
      appliesTo: ['ALL', 'ROOM', 'FOOD', 'BEVERAGE', 'EXTRAS'].includes(tax?.appliesTo) ? tax.appliesTo : 'ALL',
      included: tax?.included === true,
    })),
  }
}

function publicSettings(property) {
  const operational = plainObject(property.operationalSettings)
  return {
    propertyId: property.id,
    code: property.code,
    profile: pick(property, [
      'name', 'address', 'phone', 'email', 'publicWebsite', 'lineId', 'lineUrl', 'supportHours',
      'reservationAlertEmail', 'timezone', 'defaultCheckIn', 'defaultCheckOut', 'currency',
    ]),
    fees: {
      extraGuestFeeSatang: satangToApiString(exactSatang(property, 'extraGuestFee', 'extraGuestFeeSatang')),
      childFeeSatang: satangToApiString(exactSatang(property, 'childFee', 'childFeeSatang')),
      inventoryMinimumRateSatang: property.inventoryMinimumRate === null && property.inventoryMinimumRateSatang === null
        ? null
        : satangToApiString(exactSatang(property, 'inventoryMinimumRate', 'inventoryMinimumRateSatang')),
    },
    taxConfiguration: normalizedTaxes(property),
    policies: pick(property.policies, ['checkInWindow', 'checkOutWindow', 'smoking', 'cancellation', 'deposit', 'noShow', 'childPolicy']),
    operationalSettings: {
      operations: pick(operational.operations, ['baseLanguage', 'alertRecipients', 'noOverbooking', 'businessDateCutoffTime']),
      accounting: pick(operational.accounting, ['exportDateFormat', 'taxIdentifiersConfigured', 'accountingMappingsConfigured']),
      paymentMethods: pick(operational.paymentMethods, ['paymentGatewayConfigured', 'enabledMethods']),
    },
    updatedAt: property.updatedAt,
  }
}

async function requireProperty(prisma, propertyId) {
  const property = await prisma.property.findFirst({ where: { id: propertyId } })
  if (!property) throw new PmsValidationError('Property settings were not found for the active property.', 404)
  return property
}

function auditData(context, action, changedSections, reason) {
  return {
    userId: context.actorId,
    action,
    entityType: 'Property',
    entityId: context.propertyId,
    changes: {
      propertyId: context.propertyId,
      reason,
      changedSections,
      requestId: context.requestId,
    },
  }
}

export async function getPropertySettings(prisma, context) {
  const { propertyId } = contextFor(context)
  return publicSettings(await requireProperty(prisma, propertyId))
}

export async function updatePropertySettings(prisma, context, rawInput) {
  const resolved = requireSettingsWriter(context)
  const input = parseInput(updatePropertySettingsSchema, rawInput)
  const existing = await requireProperty(prisma, resolved.propertyId)
  const data = {}
  const changedSections = []

  if (input.profile) {
    Object.assign(data, input.profile)
    changedSections.push('profile')
  }
  if (input.fees) {
    if (input.fees.extraGuestFeeSatang !== undefined) Object.assign(data, dualWriteMoney('extraGuestFee', 'extraGuestFeeSatang', BigInt(input.fees.extraGuestFeeSatang)))
    if (input.fees.childFeeSatang !== undefined) Object.assign(data, dualWriteMoney('childFee', 'childFeeSatang', BigInt(input.fees.childFeeSatang)))
    if (input.fees.inventoryMinimumRateSatang === null) {
      data.inventoryMinimumRate = null
      data.inventoryMinimumRateSatang = null
    } else if (input.fees.inventoryMinimumRateSatang !== undefined) {
      Object.assign(data, dualWriteMoney('inventoryMinimumRate', 'inventoryMinimumRateSatang', BigInt(input.fees.inventoryMinimumRateSatang)))
    }
    changedSections.push('fees')
  }
  if (input.policies) {
    data.policies = { ...plainObject(existing.policies), ...input.policies }
    changedSections.push('policies')
  }
  if (input.operationalSettings) {
    data.operationalSettings = mergeSections(existing.operationalSettings, input.operationalSettings)
    changedSections.push('operationalSettings')
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.property.update({ where: { id: existing.id }, data })
    await tx.auditLog.create({ data: auditData(resolved, 'PROPERTY_SETTINGS_UPDATED', changedSections, input.reason) })
    await recordDomainEvent(tx, {
      propertyId: resolved.propertyId,
      eventType: 'PROPERTY_SETTINGS_UPDATED',
      aggregateType: 'property',
      aggregateId: existing.id,
      actorUserId: resolved.actorId,
      metadata: { changedSections, requestId: resolved.requestId },
    })
    return publicSettings(updated)
  })
}

export async function updatePropertyTaxSettings(prisma, context, rawInput) {
  const resolved = requireSettingsWriter(context)
  const input = parseInput(updateTaxSettingsSchema, rawInput)
  const existing = await requireProperty(prisma, resolved.propertyId)
  const rateBasisPoints = input.enabled ? input.taxes.reduce((sum, tax) => sum + tax.rateBasisPoints, 0) : 0
  const taxConfiguration = {
    ...plainObject(existing.taxConfiguration),
    enabled: input.enabled,
    pricesIncludeTax: input.pricesIncludeTax,
    taxes: input.taxes,
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.property.update({
      where: { id: existing.id },
      data: {
        taxRateBasisPoints: rateBasisPoints,
        taxRate: rateBasisPoints / 100,
        taxConfiguration,
      },
    })
    await tx.auditLog.create({ data: auditData(resolved, 'PROPERTY_TAX_SETTINGS_UPDATED', ['taxConfiguration'], input.reason) })
    await recordDomainEvent(tx, {
      propertyId: resolved.propertyId,
      eventType: 'PROPERTY_TAX_SETTINGS_UPDATED',
      aggregateType: 'property',
      aggregateId: existing.id,
      actorUserId: resolved.actorId,
      metadata: { rateBasisPoints, requestId: resolved.requestId },
    })
    return publicSettings(updated)
  })
}

function sanitizeStatusText(value) {
  return String(value ?? '')
    .replace(/\b(password|passcode|secret|token|api[_ -]?key|authorization|cookie|session|credential)\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi, '$1=[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_API_KEY]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .slice(0, 500)
}

export function sanitizeSettingsStatus(value, depth = 0) {
  if (depth > 6) return '[REDACTED_DEPTH]'
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return sanitizeStatusText(value)
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeSettingsStatus(item, depth + 1))
  if (!value || typeof value !== 'object') return null
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, child]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeSettingsStatus(child, depth + 1),
  ]))
}

export async function getPropertyStatus(prisma, context, env = process.env) {
  const { propertyId } = contextFor(context)
  const property = await requireProperty(prisma, propertyId)
  const tax = normalizedTaxes(property)
  return sanitizeSettingsStatus({
    sourceOfTruth: 'server',
    generatedAt: new Date().toISOString(),
    property: {
      id: property.id,
      code: property.code,
      name: property.name,
      currency: property.currency,
      timezone: property.timezone,
    },
    configuration: {
      profile: property.name && property.currency && property.timezone ? 'configured' : 'incomplete',
      tax: tax.enabled ? 'configured' : 'disabled',
      policies: Object.keys(plainObject(property.policies)).length ? 'configured' : 'incomplete',
      operationalSettings: Object.keys(plainObject(property.operationalSettings)).length ? 'configured' : 'incomplete',
    },
    capabilities: getSystemCapabilities(env),
  })
}
