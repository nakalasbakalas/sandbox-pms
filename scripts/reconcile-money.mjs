/* global console, process */
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { bahtToSatang, parseSatang } from '../server/money.mjs'
import {
  databaseUrlContainsDisposableMarker,
  databaseUrlContainsProductionMarker,
  parseDatabaseUrl,
} from './db-safety.mjs'
import { loadEnvDefaults } from './env-utils.mjs'
import { createPrismaClient } from '../server/prisma-client.mjs'

const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const APPROVED_STAGING_ROLE = 'approved-staging'
const DEFAULT_PAGE_SIZE = 500

export const MONEY_RECONCILIATION_MODELS = Object.freeze([
  model('Property', 'property', [
    pair('extraGuestFee', 'extraGuestFeeSatang'),
    pair('childFee', 'childFeeSatang'),
    pair('inventoryMinimumRate', 'inventoryMinimumRateSatang'),
  ]),
  model('RoomType', 'roomType', [pair('baseRate', 'baseRateSatang')]),
  model('Reservation', 'reservation', [
    pair('ratePerNight', 'ratePerNightSatang'),
    pair('totalAmount', 'totalAmountSatang'),
    pair('depositAmount', 'depositAmountSatang'),
  ]),
  model('RoomDateInventory', 'roomDateInventory', [pair('rate', 'rateSatang')]),
  model('Folio', 'folio', [
    pair('subtotal', 'subtotalSatang'),
    pair('tax', 'taxSatang'),
    pair('total', 'totalSatang'),
    pair('paid', 'paidSatang'),
    pair('balance', 'balanceSatang'),
  ]),
  model('Charge', 'charge', [
    pair('amount', 'amountSatang'),
    pair('total', 'totalSatang'),
  ]),
  model('Payment', 'payment', [pair('amount', 'amountSatang')]),
  model('BookingEmailEvent', 'bookingEmailEvent', [pair('amount', 'amountSatang')]),
  model('HotelOpsTask', 'hotelOpsTask', [pair('rateAmount', 'rateAmountSatang')]),
  model('RateRule', 'rateRule', [pair('adjustment', 'adjustmentSatang', {
    applies: (row) => row.adjustmentType !== 'PERCENTAGE',
    extraSelect: ['adjustmentType'],
  })]),
  model('RateCalendar', 'rateCalendar', [pair('rate', 'rateSatang')]),
])

function pair(legacyField, shadowField, options = {}) {
  return Object.freeze({ legacyField, shadowField, ...options })
}

function model(name, delegate, pairs) {
  return Object.freeze({ name, delegate, pairs: Object.freeze(pairs) })
}

export class MoneyReconciliationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'MoneyReconciliationError'
    this.code = code
  }
}

export function parseReconciliationArgs(argv = []) {
  let databaseRole

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--database-role') {
      databaseRole = argv[index + 1]
      index += 1
    } else if (argument.startsWith('--database-role=')) {
      databaseRole = argument.slice('--database-role='.length)
    } else {
      throw new MoneyReconciliationError('INVALID_ARGUMENTS', 'Unsupported money reconciliation option.')
    }
  }

  if (databaseRole !== undefined && databaseRole !== APPROVED_STAGING_ROLE) {
    throw new MoneyReconciliationError('INVALID_ARGUMENTS', 'The requested database role is not approved.')
  }

  return { databaseRole }
}

export function assertSafeReadOnlyDatabase(databaseUrl, databaseRole) {
  if (!databaseUrl) {
    throw new MoneyReconciliationError('DATABASE_URL_REQUIRED', 'DATABASE_URL is required.')
  }

  let parsed
  try {
    parsed = parseDatabaseUrl(databaseUrl)
  } catch {
    throw new MoneyReconciliationError('INVALID_DATABASE_TARGET', 'DATABASE_URL is invalid.')
  }

  if (databaseUrlContainsProductionMarker(databaseUrl)) {
    throw new MoneyReconciliationError('UNSAFE_DATABASE_TARGET', 'Production-like database targets are refused.')
  }

  if (LOCAL_DATABASE_HOSTS.has(parsed.hostname.toLowerCase())) return databaseUrl

  const disposableMarker = databaseUrlContainsDisposableMarker(databaseUrl)
  const stagingTargetText = [parsed.hostname, parsed.pathname, parsed.search, parsed.username].join(' ').toLowerCase()
  const stagingTarget = disposableMarker !== null && /(?:staging|stage)/.test(stagingTargetText)
  if (databaseRole === APPROVED_STAGING_ROLE && stagingTarget) return databaseUrl

  throw new MoneyReconciliationError('UNSAFE_DATABASE_TARGET', 'Nonlocal database targets require an approved staging role.')
}

function emptyModelResult() {
  return { checked: 0, null: 0, mismatch: 0 }
}

export function reconcileMoneyRows(rows, config) {
  const result = emptyModelResult()

  for (const row of rows) {
    let checked = false
    let hasNullShadow = false
    let hasMismatch = false

    for (const fieldPair of config.pairs) {
      if (fieldPair.applies && !fieldPair.applies(row)) continue

      const legacyValue = row[fieldPair.legacyField]
      if (legacyValue === null || legacyValue === undefined) continue

      checked = true
      const shadowValue = row[fieldPair.shadowField]
      if (shadowValue === null || shadowValue === undefined) {
        hasNullShadow = true
        continue
      }

      try {
        if (bahtToSatang(legacyValue, fieldPair.legacyField) !== parseSatang(shadowValue, fieldPair.shadowField)) {
          hasMismatch = true
        }
      } catch {
        hasMismatch = true
      }
    }

    if (checked) result.checked += 1
    if (hasNullShadow) result.null += 1
    if (hasMismatch) result.mismatch += 1
  }

  return result
}

function addModelResult(target, source) {
  target.checked += source.checked
  target.null += source.null
  target.mismatch += source.mismatch
}

function selectFor(config) {
  const select = { id: true }
  for (const fieldPair of config.pairs) {
    select[fieldPair.legacyField] = true
    select[fieldPair.shadowField] = true
    for (const field of fieldPair.extraSelect || []) select[field] = true
  }
  return select
}

async function reconcileModel(prisma, config, pageSize) {
  const delegate = prisma?.[config.delegate]
  if (!delegate || typeof delegate.findMany !== 'function') {
    throw new MoneyReconciliationError('INVALID_PRISMA_CLIENT', 'The Prisma client is missing a required read delegate.')
  }

  const result = emptyModelResult()
  let cursor

  while (true) {
    const rows = await delegate.findMany({
      select: selectFor(config),
      orderBy: { id: 'asc' },
      take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

    addModelResult(result, reconcileMoneyRows(rows, config))
    if (rows.length < pageSize) break
    cursor = rows.at(-1).id
  }

  return result
}

export async function reconcileMoney(prisma, options = {}) {
  const pageSize = options.pageSize || DEFAULT_PAGE_SIZE
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 5_000) {
    throw new MoneyReconciliationError('INVALID_PAGE_SIZE', 'The reconciliation page size is invalid.')
  }

  const report = {
    checkedRows: 0,
    nullShadowRows: 0,
    mismatchRows: 0,
    tables: {},
  }

  for (const config of MONEY_RECONCILIATION_MODELS) {
    const result = await reconcileModel(prisma, config, pageSize)
    report.tables[config.name] = result
    report.checkedRows += result.checked
    report.nullShadowRows += result.null
    report.mismatchRows += result.mismatch
  }

  return report
}

export function reconciliationFailureReport(error) {
  return {
    checkedRows: 0,
    nullShadowRows: 0,
    mismatchRows: 0,
    tables: {},
    errorCode: error instanceof MoneyReconciliationError ? error.code : 'RECONCILIATION_FAILED',
  }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { databaseRole } = parseReconciliationArgs(argv)
  const databaseUrl = assertSafeReadOnlyDatabase(env.DATABASE_URL, databaseRole)
  const prisma = createPrismaClient(databaseUrl)

  try {
    const report = await reconcileMoney(prisma)
    console.log(JSON.stringify(report, null, 2))
    if (report.nullShadowRows > 0 || report.mismatchRows > 0) process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) {
  loadEnvDefaults()
  main().catch((error) => {
    console.error(JSON.stringify(reconciliationFailureReport(error), null, 2))
    process.exitCode = 1
  })
}
