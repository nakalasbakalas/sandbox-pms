import { z } from 'zod'
import { parseSatang, satangToApiString } from './money.mjs'
import { PmsValidationError } from './pms-domain.mjs'

const ACCOUNTING_WRITE_ROLES = new Set(['ADMIN', 'MANAGER', 'CASHIER'])
const CREDENTIAL_KEY = /(password|secret|token|api.?key|authorization|cookie|credential)/i
const idSchema = z.string().trim().min(1).max(200)
const reasonSchema = z.string().trim().min(3).max(1_000)
const idempotencySchema = z.string().trim().min(8).max(200)
const currencySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/)
const satangSchema = z.union([z.string(), z.bigint()]).transform((value, context) => {
  const text = String(value).trim()
  if (!/^\d+$/.test(text) || BigInt(text) <= 0n) {
    context.addIssue({ code: 'custom', message: 'Use a positive base-10 satang integer.' })
    return z.NEVER
  }
  return BigInt(text)
})
const nonNegativeSatangSchema = z.union([z.string(), z.bigint()]).transform((value, context) => {
  const text = String(value).trim()
  if (!/^\d+$/.test(text)) {
    context.addIssue({ code: 'custom', message: 'Use a non-negative base-10 satang integer.' })
    return z.NEVER
  }
  return BigInt(text)
})
const evidenceValueSchema = z.union([z.string().trim().max(500), z.number().finite(), z.boolean(), z.null()])
const evidenceSchema = z.record(z.string().trim().min(1).max(80), evidenceValueSchema).optional().superRefine((value, context) => {
  for (const key of Object.keys(value || {})) {
    if (CREDENTIAL_KEY.test(key)) context.addIssue({ code: 'custom', message: 'Credential-shaped audit evidence is not allowed.' })
  }
})

const mutationBase = {
  reason: reasonSchema,
  idempotencyKey: idempotencySchema,
  auditEvidence: evidenceSchema,
}

const folioSchema = z.object({
  reservationId: idSchema,
  folioNumber: z.string().trim().min(1).max(80),
  type: z.enum(['GUEST', 'MASTER', 'COMPANY', 'HOUSE']).default('GUEST'),
  currency: currencySchema.default('THB'),
  isPrimary: z.boolean().default(false),
  ...mutationBase,
}).strict()

const houseAccountSchema = z.object({
  accountNumber: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  currency: currencySchema.default('THB'),
  ...mutationBase,
}).strict()

const postChargeSchema = z.object({
  folioId: idSchema,
  description: z.string().trim().min(1).max(500),
  amountSatang: satangSchema,
  ...mutationBase,
}).strict()

const reverseChargeSchema = z.object({ chargeId: idSchema, ...mutationBase }).strict()

const paymentSchema = z.object({
  folioId: idSchema,
  amountSatang: satangSchema,
  method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'ONLINE', 'OTHER']),
  cashShiftId: idSchema.optional(),
  reference: z.string().trim().max(200).nullable().optional(),
  ...mutationBase,
}).strict().superRefine((value, context) => {
  if (value.method === 'CASH' && !value.cashShiftId) context.addIssue({ code: 'custom', message: 'cashShiftId is required for a cash payment.' })
  if (value.method !== 'CASH' && value.cashShiftId) context.addIssue({ code: 'custom', message: 'cashShiftId is only valid for cash payments.' })
})

const reversePaymentSchema = z.object({
  paymentId: idSchema,
  kind: z.enum(['REFUND', 'REVERSAL']),
  cashShiftId: idSchema.optional(),
  ...mutationBase,
}).strict()

const openCashShiftSchema = z.object({
  cashierId: idSchema,
  currency: currencySchema.default('THB'),
  openingFloatSatang: nonNegativeSatangSchema,
  ...mutationBase,
}).strict()

const cashMovementSchema = z.object({
  cashShiftId: idSchema,
  type: z.enum(['CASH_IN', 'CASH_OUT']),
  amountSatang: satangSchema,
  ...mutationBase,
}).strict()

const closeCashShiftSchema = z.object({
  cashShiftId: idSchema,
  actualCloseSatang: nonNegativeSatangSchema,
  ...mutationBase,
}).strict()

const arEntrySchema = z.object({
  houseAccountId: idSchema,
  folioId: idSchema.optional(),
  kind: z.enum(['TRANSFER', 'SETTLEMENT']),
  amountSatang: satangSchema,
  ...mutationBase,
}).strict().superRefine((value, context) => {
  if (value.kind === 'TRANSFER' && !value.folioId) context.addIssue({ code: 'custom', message: 'folioId is required for a receivable transfer.' })
})

const journalLineSchema = z.object({
  accountCode: z.string().trim().min(1).max(50),
  accountName: z.string().trim().min(1).max(160),
  debitSatang: nonNegativeSatangSchema.default(0n),
  creditSatang: nonNegativeSatangSchema.default(0n),
  folioId: idSchema.nullable().optional(),
}).strict().superRefine((value, context) => {
  if ((value.debitSatang === 0n) === (value.creditSatang === 0n)) {
    context.addIssue({ code: 'custom', message: 'Each journal line must contain exactly one positive debit or credit.' })
  }
})

const journalSchema = z.object({
  entryNumber: z.string().trim().min(1).max(80),
  businessDate: z.coerce.date(),
  description: z.string().trim().min(1).max(500),
  lines: z.array(journalLineSchema).min(2).max(100),
  ...mutationBase,
}).strict()

function parse(schema, input) {
  const result = schema.safeParse(input)
  if (!result.success) throw new PmsValidationError(result.error.issues[0]?.message || 'Invalid accounting request.')
  return result.data
}

function contextValues(context) {
  const propertyId = String(context?.propertyId || '').trim()
  const actorId = String(context?.actor?.id || context?.actorId || '').trim()
  const role = String(context?.actor?.role || context?.role || '').toUpperCase()
  if (!propertyId || !actorId) throw new PmsValidationError('Authenticated property and actor context is required.', 401)
  if (!ACCOUNTING_WRITE_ROLES.has(role)) throw new PmsValidationError('Accounting write permission is required.', 403)
  return { propertyId, actorId }
}

export function accountingV2Enabled(env = process.env) {
  return String(env.ACCOUNTING_V2_ENABLED || 'false').trim().toLowerCase() === 'true'
}

function requireEnabled(env) {
  if (!accountingV2Enabled(env)) throw new PmsValidationError('Accounting V2 is disabled.', 503)
}

async function serializable(prisma, work) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 10_000 })
    } catch (error) {
      if (error?.code === 'P2034' && attempt === 0) continue
      throw error
    }
  }
}

function auditData(input, actorId) {
  return { actorId, reason: input.reason, auditEvidence: input.auditEvidence || undefined, idempotencyKey: input.idempotencyKey }
}

function moneyResult(record) {
  if (!record) return record
  const result = { ...record }
  for (const key of ['amountSatang', 'openingFloatSatang', 'expectedCloseSatang', 'actualCloseSatang', 'varianceSatang', 'debitSatang', 'creditSatang']) {
    if (result[key] !== null && result[key] !== undefined) result[key] = satangToApiString(result[key])
  }
  return result
}

export function calculateFolioBalanceSatang({ charges = [], payments = [], receivableEntries = [] }) {
  const chargeTotal = charges.reduce((sum, row) => sum + (row.kind === 'REVERSAL' ? -1n : 1n) * parseSatang(row.amountSatang), 0n)
  const paymentTotal = payments.reduce((sum, row) => sum + (row.kind === 'PAYMENT' ? -1n : 1n) * parseSatang(row.amountSatang), 0n)
  const receivableTotal = receivableEntries.reduce((sum, row) => {
    if (row.kind === 'TRANSFER') return sum - parseSatang(row.amountSatang)
    if (row.kind === 'REVERSAL') return sum + parseSatang(row.amountSatang)
    return sum
  }, 0n)
  return chargeTotal + paymentTotal + receivableTotal
}

export async function createAccountingFolio(prisma, input, context, env = process.env) {
  requireEnabled(env)
  const parsed = parse(folioSchema, input)
  const { propertyId, actorId } = contextValues(context)
  return serializable(prisma, async (tx) => {
    const replay = await tx.accountingFolio.findUnique({ where: { propertyId_idempotencyKey: { propertyId, idempotencyKey: parsed.idempotencyKey } } })
    if (replay) return replay
    const reservation = await tx.reservation.findFirst({ where: { id: parsed.reservationId, propertyId }, select: { id: true } })
    if (!reservation) throw new PmsValidationError('Reservation was not found for this property.', 404)
    if (parsed.isPrimary) {
      const primary = await tx.accountingFolio.findFirst({ where: { reservationId: reservation.id, isPrimary: true }, select: { id: true } })
      if (primary) throw new PmsValidationError('This reservation already has a primary accounting folio.', 409)
    }
    return tx.accountingFolio.create({ data: {
      propertyId, reservationId: reservation.id, folioNumber: parsed.folioNumber, type: parsed.type,
      currency: parsed.currency, isPrimary: parsed.isPrimary, ...auditData(parsed, actorId),
    } })
  }).then(moneyResult)
}

export async function createHouseAccount(prisma, input, context, env = process.env) {
  requireEnabled(env)
  const parsed = parse(houseAccountSchema, input)
  const { propertyId, actorId } = contextValues(context)
  return serializable(prisma, async (tx) => {
    const replay = await tx.houseAccount.findUnique({ where: { propertyId_idempotencyKey: { propertyId, idempotencyKey: parsed.idempotencyKey } } })
    if (replay) return replay
    return tx.houseAccount.create({ data: {
      propertyId, accountNumber: parsed.accountNumber, name: parsed.name, currency: parsed.currency,
      createdBy: actorId, reason: parsed.reason, auditEvidence: parsed.auditEvidence || undefined,
      idempotencyKey: parsed.idempotencyKey,
    } })
  })
}

export async function postAccountingCharge(prisma, input, context, env = process.env) {
  requireEnabled(env)
  const parsed = parse(postChargeSchema, input)
  const { propertyId, actorId } = contextValues(context)
  return serializable(prisma, async (tx) => {
    const replay = await tx.accountingCharge.findUnique({ where: { propertyId_idempotencyKey: { propertyId, idempotencyKey: parsed.idempotencyKey } } })
    if (replay) return replay
    const folio = await tx.accountingFolio.findFirst({ where: { id: parsed.folioId, propertyId, status: 'OPEN' }, select: { id: true } })
    if (!folio) throw new PmsValidationError('Open accounting folio was not found for this property.', 404)
    return tx.accountingCharge.create({ data: {
      propertyId, folioId: folio.id, kind: 'CHARGE', description: parsed.description,
      amountSatang: parsed.amountSatang, ...auditData(parsed, actorId),
    } })
  }).then(moneyResult)
}

export async function reverseAccountingCharge(prisma, input, context, env = process.env) {
  requireEnabled(env)
  const parsed = parse(reverseChargeSchema, input)
  const { propertyId, actorId } = contextValues(context)
  return serializable(prisma, async (tx) => {
    const replay = await tx.accountingCharge.findUnique({ where: { propertyId_idempotencyKey: { propertyId, idempotencyKey: parsed.idempotencyKey } } })
    if (replay) return replay
    const original = await tx.accountingCharge.findFirst({ where: { id: parsed.chargeId, propertyId, kind: 'CHARGE' } })
    if (!original) throw new PmsValidationError('Posted charge was not found for this property.', 404)
    const prior = await tx.accountingCharge.findFirst({ where: { propertyId, originalChargeId: original.id, kind: 'REVERSAL' }, select: { id: true } })
    if (prior) throw new PmsValidationError('This charge already has a reversal.', 409)
    return tx.accountingCharge.create({ data: {
      propertyId, folioId: original.folioId, kind: 'REVERSAL', description: `Reversal: ${original.description}`,
      amountSatang: original.amountSatang, originalChargeId: original.id, ...auditData(parsed, actorId),
    } })
  }).then(moneyResult)
}

export async function recordAccountingPayment(prisma, input, context, env = process.env) {
  requireEnabled(env)
  const parsed = parse(paymentSchema, input)
  const { propertyId, actorId } = contextValues(context)
  return serializable(prisma, async (tx) => {
    const replay = await tx.accountingPayment.findUnique({ where: { propertyId_idempotencyKey: { propertyId, idempotencyKey: parsed.idempotencyKey } } })
    if (replay) return replay
    const folio = await tx.accountingFolio.findFirst({ where: { id: parsed.folioId, propertyId, status: 'OPEN' }, select: { id: true } })
    if (!folio) throw new PmsValidationError('Open accounting folio was not found for this property.', 404)
    if (parsed.cashShiftId) {
      const shift = await tx.cashShift.findFirst({ where: { id: parsed.cashShiftId, propertyId, status: 'OPEN' }, select: { id: true } })
      if (!shift) throw new PmsValidationError('Open cash shift was not found for this property.', 404)
    }
    return tx.accountingPayment.create({ data: {
      propertyId, folioId: folio.id, kind: 'PAYMENT', method: parsed.method, amountSatang: parsed.amountSatang,
      cashShiftId: parsed.cashShiftId || null, reference: parsed.reference || null, ...auditData(parsed, actorId),
    } })
  }).then(moneyResult)
}

export async function reverseAccountingPayment(prisma, input, context, env = process.env) {
  requireEnabled(env)
  const parsed = parse(reversePaymentSchema, input)
  const { propertyId, actorId } = contextValues(context)
  return serializable(prisma, async (tx) => {
    const replay = await tx.accountingPayment.findUnique({ where: { propertyId_idempotencyKey: { propertyId, idempotencyKey: parsed.idempotencyKey } } })
    if (replay) return replay
    const original = await tx.accountingPayment.findFirst({ where: { id: parsed.paymentId, propertyId, kind: 'PAYMENT' } })
    if (!original) throw new PmsValidationError('Posted payment was not found for this property.', 404)
    if (original.method === 'CASH') {
      if (!parsed.cashShiftId) throw new PmsValidationError('An open cash shift is required to refund or reverse a cash payment.')
      const shift = await tx.cashShift.findFirst({ where: { id: parsed.cashShiftId, propertyId, status: 'OPEN' }, select: { id: true } })
      if (!shift) throw new PmsValidationError('Open cash shift was not found for this property.', 404)
    } else if (parsed.cashShiftId) {
      throw new PmsValidationError('cashShiftId is only valid for a cash refund or reversal.')
    }
    const prior = await tx.accountingPayment.findFirst({ where: { propertyId, originalPaymentId: original.id }, select: { id: true } })
    if (prior) throw new PmsValidationError('This payment already has a refund or reversal.', 409)
    return tx.accountingPayment.create({ data: {
      propertyId, folioId: original.folioId, kind: parsed.kind, method: original.method,
      amountSatang: original.amountSatang, cashShiftId: parsed.cashShiftId || null, reference: original.reference, originalPaymentId: original.id,
      ...auditData(parsed, actorId),
    } })
  }).then(moneyResult)
}

export async function getAccountingFolioBalance(prisma, folioId, context, env = process.env) {
  requireEnabled(env)
  const { propertyId } = contextValues(context)
  const folio = await prisma.accountingFolio.findFirst({
    where: { id: idSchema.parse(folioId), propertyId },
    include: { charges: true, payments: true, receivableEntries: true },
  })
  if (!folio) throw new PmsValidationError('Accounting folio was not found for this property.', 404)
  return { folioId: folio.id, balanceSatang: satangToApiString(calculateFolioBalanceSatang(folio)) }
}

export async function openCashShift(prisma, input, context, env = process.env) {
  requireEnabled(env)
  const parsed = parse(openCashShiftSchema, input)
  const { propertyId, actorId } = contextValues(context)
  return serializable(prisma, async (tx) => {
    const replay = await tx.cashShift.findUnique({ where: { propertyId_idempotencyKey: { propertyId, idempotencyKey: parsed.idempotencyKey } } })
    if (replay) return replay
    const open = await tx.cashShift.findFirst({ where: { propertyId, cashierId: parsed.cashierId, status: 'OPEN' }, select: { id: true } })
    if (open) throw new PmsValidationError('This cashier already has an open cash shift.', 409)
    return tx.cashShift.create({ data: {
      propertyId, cashierId: parsed.cashierId, currency: parsed.currency, openingFloatSatang: parsed.openingFloatSatang,
      openedBy: actorId, auditEvidence: parsed.auditEvidence || undefined, idempotencyKey: parsed.idempotencyKey,
    } })
  }).then(moneyResult)
}

export async function recordCashMovement(prisma, input, context, env = process.env) {
  requireEnabled(env)
  const parsed = parse(cashMovementSchema, input)
  const { propertyId, actorId } = contextValues(context)
  return serializable(prisma, async (tx) => {
    const replay = await tx.cashMovement.findUnique({ where: { propertyId_idempotencyKey: { propertyId, idempotencyKey: parsed.idempotencyKey } } })
    if (replay) return replay
    const shift = await tx.cashShift.findFirst({ where: { id: parsed.cashShiftId, propertyId, status: 'OPEN' }, select: { id: true } })
    if (!shift) throw new PmsValidationError('Open cash shift was not found for this property.', 404)
    return tx.cashMovement.create({ data: {
      propertyId, cashShiftId: shift.id, type: parsed.type, amountSatang: parsed.amountSatang,
      ...auditData(parsed, actorId),
    } })
  }).then(moneyResult)
}

export async function closeCashShift(prisma, input, context, env = process.env) {
  requireEnabled(env)
  const parsed = parse(closeCashShiftSchema, input)
  const { propertyId, actorId } = contextValues(context)
  return serializable(prisma, async (tx) => {
    const replay = await tx.cashShift.findUnique({ where: { propertyId_closeIdempotencyKey: { propertyId, closeIdempotencyKey: parsed.idempotencyKey } } })
    if (replay) return replay
    const shift = await tx.cashShift.findFirst({ where: { id: parsed.cashShiftId, propertyId, status: 'OPEN' }, include: { movements: true, cashPayments: true } })
    if (!shift) throw new PmsValidationError('Open cash shift was not found for this property.', 404)
    const movementTotal = shift.movements.reduce((sum, row) => sum + (row.type === 'CASH_IN' ? 1n : -1n) * parseSatang(row.amountSatang), 0n)
    const paymentTotal = shift.cashPayments.reduce((sum, row) => sum + (row.kind === 'PAYMENT' ? 1n : -1n) * parseSatang(row.amountSatang), 0n)
    const expected = parseSatang(shift.openingFloatSatang) + movementTotal + paymentTotal
    return tx.cashShift.update({ where: { id: shift.id }, data: {
      status: 'CLOSED', expectedCloseSatang: expected, actualCloseSatang: parsed.actualCloseSatang,
      varianceSatang: parsed.actualCloseSatang - expected, closedBy: actorId, closeReason: parsed.reason,
      auditEvidence: parsed.auditEvidence || undefined, closeIdempotencyKey: parsed.idempotencyKey, closedAt: new Date(),
    } })
  }).then(moneyResult)
}

export async function recordAccountsReceivableEntry(prisma, input, context, env = process.env) {
  requireEnabled(env)
  const parsed = parse(arEntrySchema, input)
  const { propertyId, actorId } = contextValues(context)
  return serializable(prisma, async (tx) => {
    const replay = await tx.accountsReceivableEntry.findUnique({ where: { propertyId_idempotencyKey: { propertyId, idempotencyKey: parsed.idempotencyKey } } })
    if (replay) return replay
    const account = await tx.houseAccount.findFirst({ where: { id: parsed.houseAccountId, propertyId, status: 'ACTIVE' }, select: { id: true } })
    if (!account) throw new PmsValidationError('Active house account was not found for this property.', 404)
    if (parsed.folioId) {
      const folio = await tx.accountingFolio.findFirst({ where: { id: parsed.folioId, propertyId, status: 'OPEN' }, select: { id: true } })
      if (!folio) throw new PmsValidationError('Open accounting folio was not found for this property.', 404)
    }
    return tx.accountsReceivableEntry.create({ data: {
      propertyId, houseAccountId: account.id, folioId: parsed.folioId || null, kind: parsed.kind,
      amountSatang: parsed.amountSatang, ...auditData(parsed, actorId),
    } })
  }).then(moneyResult)
}

export async function postJournalEntry(prisma, input, context, env = process.env) {
  requireEnabled(env)
  const parsed = parse(journalSchema, input)
  const { propertyId, actorId } = contextValues(context)
  const debits = parsed.lines.reduce((sum, line) => sum + line.debitSatang, 0n)
  const credits = parsed.lines.reduce((sum, line) => sum + line.creditSatang, 0n)
  if (debits !== credits) throw new PmsValidationError('Journal entry debits and credits must balance exactly to the satang.')
  return serializable(prisma, async (tx) => {
    const replay = await tx.journalEntry.findUnique({ where: { propertyId_idempotencyKey: { propertyId, idempotencyKey: parsed.idempotencyKey } }, include: { lines: true } })
    if (replay) return replay
    for (const line of parsed.lines) {
      if (!line.folioId) continue
      const folio = await tx.accountingFolio.findFirst({ where: { id: line.folioId, propertyId }, select: { id: true } })
      if (!folio) throw new PmsValidationError('A journal line references a folio outside this property.', 404)
    }
    return tx.journalEntry.create({ data: {
      propertyId, entryNumber: parsed.entryNumber, businessDate: parsed.businessDate, description: parsed.description,
      ...auditData(parsed, actorId),
      lines: { create: parsed.lines.map((line) => ({
        accountCode: line.accountCode, accountName: line.accountName, debitSatang: line.debitSatang,
        creditSatang: line.creditSatang, folioId: line.folioId || null,
      })) },
    }, include: { lines: true } })
  })
}

export async function getTrialBalance(prisma, input, context, env = process.env) {
  requireEnabled(env)
  const query = z.object({ from: z.coerce.date(), to: z.coerce.date() }).strict().parse(input)
  const { propertyId } = contextValues(context)
  const lines = await prisma.journalLine.findMany({
    where: { journalEntry: { propertyId, businessDate: { gte: query.from, lte: query.to } } },
    select: { accountCode: true, accountName: true, debitSatang: true, creditSatang: true },
  })
  const accounts = new Map()
  for (const line of lines) {
    const row = accounts.get(line.accountCode) || { accountCode: line.accountCode, accountName: line.accountName, debitSatang: 0n, creditSatang: 0n }
    row.debitSatang += parseSatang(line.debitSatang)
    row.creditSatang += parseSatang(line.creditSatang)
    accounts.set(line.accountCode, row)
  }
  const rows = [...accounts.values()].sort((a, b) => a.accountCode.localeCompare(b.accountCode))
  const totalDebit = rows.reduce((sum, row) => sum + row.debitSatang, 0n)
  const totalCredit = rows.reduce((sum, row) => sum + row.creditSatang, 0n)
  return {
    rows: rows.map((row) => ({ ...row, debitSatang: satangToApiString(row.debitSatang), creditSatang: satangToApiString(row.creditSatang) })),
    totalDebitSatang: satangToApiString(totalDebit), totalCreditSatang: satangToApiString(totalCredit), balanced: totalDebit === totalCredit,
  }
}
