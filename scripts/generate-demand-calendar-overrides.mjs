/* global process, console */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { format, parse as parseDate } from 'date-fns'
import * as XLSX from 'xlsx'

import { ROOM_TYPE_CANONICAL_BASE_RATES } from '../server/pms-service.mjs'
import { createPrismaClient } from '../server/prisma-client.mjs'
import { getRoomSetup, updateRoomType } from '../server/pms-service.mjs'
import {
  databaseUrlContainsProductionMarker,
} from './db-safety.mjs'

const DEFAULT_VERSION = '1.0.0'
const DEFAULT_SHEET = '365 Calendar'
const ROOM_PRELOAD_VERSION = '1.0.0'
const SCRIPT_NAME = 'generate-demand-calendar-overrides'
const PRELOAD_SOURCE_TAG = 'nakhon_si_thammarat_2027_demand_calendar'
const EXPECTED_TIER_COUNTS = {
  low: 42,
  normal: 162,
  high: 106,
  peak: 41,
  compression: 14,
}
const EXPECTED_ROW_COUNT = 365
const PRESET_MULTIPLIERS = Object.freeze({
  low: 0.9,
  normal: 1.0,
  high: 1.15,
  peak: 1.35,
  compression: 1.6,
})
const ROOM_RATE_TARGETS = Object.freeze({
  twin: ROOM_TYPE_CANONICAL_BASE_RATES.TWIN,
  double: ROOM_TYPE_CANONICAL_BASE_RATES.DOUBLE,
})
const XLSX_LIB = 'default' in XLSX && XLSX.default ? XLSX.default : XLSX
const OVERRIDE_STATUS = Object.freeze({
  PROJECTED: 'PROJECTED',
  CONFIRMED: 'CONFIRMED',
})

function fail(message) {
  throw new Error(message)
}

function argValue(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  return process.argv[index + 1]
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex')
}

function parseDateValue(value, rowLabel) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return { date: format(value, 'yyyy-MM-dd') }
  }

 if (typeof value === 'number' && Number.isFinite(value)) {
    const excelDate = XLSX_LIB.SSF?.parse_date_code
      ? XLSX_LIB.SSF.parse_date_code(value)
      : null
    if (excelDate) {
      const parsed = new Date(Date.UTC(excelDate.y, excelDate.m - 1, excelDate.d))
      return { date: format(parsed, 'yyyy-MM-dd') }
    }
  }

  const raw = String(value ?? '').trim()
  if (!raw) return { date: '', error: `Row ${rowLabel}: Missing date` }

  const parsedByDateFns = parseDate(raw, 'yyyy-MM-dd', new Date())
  if (Number.isFinite(parsedByDateFns.getTime()) && !Number.isNaN(parsedByDateFns.getTime())) {
    return { date: format(parsedByDateFns, 'yyyy-MM-dd') }
  }

  const parsed = new Date(raw)
  if (Number.isFinite(parsed.getTime())) {
    return { date: format(parsed, 'yyyy-MM-dd') }
  }

  return { date: '', error: `Row ${rowLabel}: Invalid date value (${raw})` }
}

function parseMultiplier(value, rowLabel) {
  const normalized = String(value ?? '')
    .replace(/x$/i, '')
    .replace(/,/g, '')
    .trim()
  if (!normalized) return { multiplier: NaN, error: `Row ${rowLabel}: Missing multiplier` }

  const parsed = Number.parseFloat(normalized)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 5) {
    return { multiplier: NaN, error: `Row ${rowLabel}: Invalid multiplier (${normalized})` }
  }

  return { multiplier: parsed }
}

function normalizeTier(value, rowLabel) {
  const tier = normalizeText(value)
  if (!tier) return { tier: '', error: `Row ${rowLabel}: Missing demand tier` }

  const normalized = tier.replace(/[^a-z]/g, '')
  const canonical = Object.hasOwn(PRESET_MULTIPLIERS, normalized)
    ? normalized
    : normalized.startsWith('compres') || normalized.includes('compress')
      ? 'compression'
      : normalized.includes('normal')
        ? 'normal'
        : normalized.includes('high')
          ? 'high'
          : normalized.includes('peak')
            ? 'peak'
            : normalized.includes('low')
              ? 'low'
              : ''

  if (!canonical || !Object.hasOwn(PRESET_MULTIPLIERS, canonical)) {
    return { tier: '', error: `Row ${rowLabel}: Unknown demand tier (${value})` }
  }

  return { tier: canonical }
}

function normalizeStatus(value) {
  const normalized = normalizeText(value)
  if (!normalized) return OVERRIDE_STATUS.PROJECTED
  return normalized.includes('confirm') ? 'CONFIRMED' : 'PROJECTED'
}

function toCSVValue(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function parseWorkbookRows(buffer, sheetName) {
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' })
  const targetSheet = sheetName && workbook.SheetNames.includes(sheetName)
    ? sheetName
    : workbook.SheetNames[0]

  if (!targetSheet) throw new Error('Workbook has no sheets.')

  const worksheet = workbook.Sheets[targetSheet]
  const matrix = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
  })

  if (!Array.isArray(matrix) || matrix.length === 0) {
    throw new Error(`No data rows found in worksheet "${targetSheet}".`)
  }

  const headerIndex = matrix.findIndex((row, rowIndex) => {
    if (!Array.isArray(row) || row.length === 0) return false
    const normalized = row.map((cell) => normalizeHeader(cell))
    const hasDate = normalized.includes('date')
    const hasDemandTier = normalized.some((value) => value.includes('demand') && value.includes('tier'))
    const hasRateMultiplier = normalized.some(
      (value) => value.includes('rate') && value.includes('multiplier'),
    )
    const hasReviewOrStatus = normalized.some(
      (value) => value.includes('2027') && value.includes('status')
        || value.includes('review') && value.includes('reprice')
        || value.includes('source') && value.includes('status'),
    )
    if (!hasDate || !hasDemandTier || !hasRateMultiplier) return false
    if (rowIndex < 2) return true
    return hasReviewOrStatus || normalized.includes('demand tier') && normalized.includes('rate multiplier')
  })

  if (headerIndex < 0) throw new Error('Worksheet header row must include Date, Demand Tier, and Rate Multiplier.')

  const rawHeaders = Array.isArray(matrix[headerIndex]) ? matrix[headerIndex] : []
  const headers = rawHeaders.map((header, index) => String(header || `__EMPTY_${index}`).trim())

  const rows = matrix.slice(headerIndex + 1).reduce((acc, row) => {
    if (!Array.isArray(row)) return acc
    const hasValue = row.some((value) => value !== '' && value !== null && value !== undefined)
    if (!hasValue) return acc

    const parsed = {}
    headers.forEach((header, colIndex) => {
      parsed[header] = row[colIndex] ?? ''
    })

    if (Object.values(parsed).some((value) => value !== '' && value != null)) {
      acc.push(parsed)
    }

    return acc
  }, [])

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`No data rows found in worksheet "${targetSheet}".`)
  }

  return { targetSheet, headers, rows }
}

function parseDemandSourceRows(rows, headers, version, sourceStatusOverride) {
  const dateIndex = headers.findIndex((header) => normalizeHeader(header).includes('date'))
  const tierIndex = headers.findIndex((header) => normalizeHeader(header).includes('demand') && normalizeHeader(header).includes('tier'))
  const multiplierIndex = headers.findIndex((header) => normalizeHeader(header).includes('rate') && normalizeHeader(header).includes('multiplier'))
  const statusIndex = headers.findIndex((header) => {
    const norm = normalizeHeader(header)
    return norm.includes('2027') && norm.includes('status')
      || norm.includes('source') && norm.includes('status')
      || norm === 'status'
  })
  const repriceIndex = headers.findIndex((header) => {
    const norm = normalizeHeader(header)
    return norm.includes('reprice') || (norm.includes('review') && norm.includes('reprice'))
  })

  if (dateIndex === -1) fail('Source sheet must include Date.')
  if (tierIndex === -1) fail('Source sheet must include Demand Tier.')
  if (multiplierIndex === -1 && tierIndex === -1) fail('Source sheet must include Rate Multiplier or recognized Demand Tier.')

  const rowsByRoomType = []
  const tierCounts = {
    low: 0,
    normal: 0,
    high: 0,
    peak: 0,
    compression: 0,
  }
  let invalidRows = 0

  for (const [rowOffset, row] of rows.entries()) {
    const rowLabel = `${rowOffset + 1}`
    const rowValues = headers.map((header) => row[header])
    const rawDate = rowValues[dateIndex]
    const rawTier = rowValues[tierIndex]
    const rawMultiplier = rowValues[multiplierIndex]
    const rawStatus = statusIndex === -1 ? null : rowValues[statusIndex]
    const rawReviewReprice = repriceIndex === -1 ? null : rowValues[repriceIndex]
    const errors = []

    const parsedDate = parseDateValue(rawDate, rowLabel)
    if (parsedDate.error) errors.push(parsedDate.error)

    const tierResult = normalizeTier(rawTier, rowLabel)
    const multiplierSource = tierResult.tier ? PRESET_MULTIPLIERS[tierResult.tier] : NaN
    const multiplierResult = multiplierIndex === -1
      ? { multiplier: multiplierSource }
      : parseMultiplier(rawMultiplier, rowLabel)
    const multiplier = Number.isFinite(multiplierResult.multiplier) ? multiplierResult.multiplier : multiplierSource

    if (!tierResult.tier) {
      errors.push(tierResult.error)
    }
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      errors.push(multiplierResult.error || `Row ${rowLabel}: No usable multiplier`)
    }

    if (!errors.length && tierResult.tier && tierCounts[tierResult.tier] !== undefined) {
      tierCounts[tierResult.tier] += 1
    }

    if (!parsedDate.date || errors.length > 0) {
      if (errors.length === 0) errors.push(`Row ${rowLabel}: Skipped due to validation error`)
      invalidRows += 1
      continue
    }

    const status = normalizeStatus(rawStatus || sourceStatusOverride || 'Projected')
    const reviewRepriceDate = parseDateValue(rawReviewReprice, rowLabel).date || ''

    if (tierResult.tier && tierResult.tier !== 'normal') {
      for (const [roomType, baseRate] of Object.entries(ROOM_RATE_TARGETS)) {
        const computedRate = Math.round(baseRate * multiplier)
        rowsByRoomType.push({
          roomType,
          date: parsedDate.date,
          rate: computedRate,
          reason: `Demand Calendar ${normalizeText(rawTier || tierResult.tier)} (${status})`,
          sourceStatus: status,
          demandTier: tierResult.tier,
          rateMultiplier: multiplier,
          reviewRepriceDate,
          sourceVersion: version,
          isValid: errors.length === 0,
          errors,
        })
      }
    }
  }

  const missingTier = Object.entries(EXPECTED_TIER_COUNTS).some(
    ([tier, expected]) => (tierCounts[tier] || 0) !== expected,
  )
  if (rows.length !== EXPECTED_ROW_COUNT || missingTier) {
    const mismatch = Object.entries(EXPECTED_TIER_COUNTS)
      .map(([tier, expected]) => `${tier}: ${tierCounts[tier] || 0}/${expected}`)
      .join(', ')
    fail(`Source validation failed. Expected ${EXPECTED_ROW_COUNT} rows and tier mix [${mismatch}], but got ${rows.length} rows and ${tierCounts.low}/${EXPECTED_TIER_COUNTS.low} low, ${tierCounts.normal}/${EXPECTED_TIER_COUNTS.normal} normal, ${tierCounts.high}/${EXPECTED_TIER_COUNTS.high} high, ${tierCounts.peak}/${EXPECTED_TIER_COUNTS.peak} peak, ${tierCounts.compression}/${EXPECTED_TIER_COUNTS.compression} compression.`)
  }

  return { rows: rowsByRoomType, tierCounts, invalidRows }
}

function buildRateCsv(rows, source) {
  const header = [
    'Room Type',
    'Date',
    'Rate',
    'Reason',
    'Demand Tier',
    'Rate Multiplier',
    'Source Status',
    'Review / Reprice Date',
    'Source Version',
  ]
  const csvRows = [header.join(',')]
  for (const row of rows) {
    csvRows.push([
      toCSVValue(row.roomType),
      toCSVValue(row.date),
      toCSVValue(row.rate),
      toCSVValue(row.reason || 'Demand Calendar'),
      toCSVValue(row.demandTier || ''),
      toCSVValue(row.rateMultiplier ?? ''),
      toCSVValue(row.sourceStatus || ''),
      toCSVValue(row.reviewRepriceDate || ''),
      toCSVValue(source.version),
    ].join(','))
  }

  return csvRows.join('\r\n') + '\r\n'
}

function buildManifestRows(rows, source, tierCounts, invalidRows = 0) {
  return {
    manifestVersion: ROOM_PRELOAD_VERSION,
    generatedAt: new Date().toISOString(),
    generatedBy: SCRIPT_NAME,
    source: {
      sourceTag: PRELOAD_SOURCE_TAG,
      sourcePath: source.sourcePath,
      sourceHash: source.sourceHash,
      sheet: source.sheet,
      status: source.status,
      version: source.version,
    },
    validation: {
      totalSourceRows: source.totalSourceRows,
      expectedSourceRows: EXPECTED_ROW_COUNT,
      expectedTierCounts: EXPECTED_TIER_COUNTS,
      tierCounts,
      invalidRows,
      projectedRows: source.projectedRows,
      outputRows: rows.length,
    },
    baselineRates: ROOM_RATE_TARGETS,
    rows: rows.map((row) => ({
      ...row,
      sourceTag: PRELOAD_SOURCE_TAG,
      sourceVersion: source.version,
      sourceAt: source.generatedAt,
    })),
  }
}

function validateRoomTypeParity(rows, roomTypes) {
  const seenTwin = roomTypes.find((row) => row.code?.toUpperCase() === 'TWIN' || row.id.toLowerCase().includes('twin') || row.name.toLowerCase().includes('twin'))
  const seenDouble = roomTypes.find((row) => row.code?.toUpperCase() === 'DOUBLE' || row.id.toLowerCase().includes('double') || row.name.toLowerCase().includes('double'))
  if (!seenTwin || !seenDouble) {
    throw new Error('Expected both twin and double room types in server room setup.')
  }
  const updates = []
  if (seenTwin.baseRate !== ROOM_TYPE_CANONICAL_BASE_RATES.TWIN) {
    updates.push(`twin base rate ${seenTwin.baseRate} -> ${ROOM_TYPE_CANONICAL_BASE_RATES.TWIN}`)
  }
  if (seenDouble.baseRate !== ROOM_TYPE_CANONICAL_BASE_RATES.DOUBLE) {
    updates.push(`double base rate ${seenDouble.baseRate} -> ${ROOM_TYPE_CANONICAL_BASE_RATES.DOUBLE}`)
  }
  if (updates.length > 0) {
    return updates
  }
  return []
}

async function applyServerRoomTypeBaseRates() {
  const prisma = createPrismaClient()
  try {
    const setup = await getRoomSetup(prisma)
    const mismatches = validateRoomTypeParity([], setup.roomTypes)
    if (mismatches.length === 0) {
      console.log('[apply-server] Room type base rates already aligned with canonical values.')
      return
    }

    const scriptActor = {
      id: 'rates-preload-script',
      name: 'Rate preload script',
    }

    const updatesByRole = setup.roomTypes
      .map((roomType) => {
        const lowerName = `${roomType.name || ''}`.toLowerCase()
        const lowerCode = `${roomType.code || ''}`.toLowerCase()
        const target = lowerCode.includes('twin') || lowerName.includes('twin') || roomType.id.toLowerCase() === 'twin'
          ? ROOM_TYPE_CANONICAL_BASE_RATES.TWIN
          : lowerCode.includes('double') || lowerName.includes('double') || roomType.id.toLowerCase() === 'double'
            ? ROOM_TYPE_CANONICAL_BASE_RATES.DOUBLE
            : null
        if (!target) return null

        return {
          roomType,
          target,
        }
      })
      .filter(Boolean)

    if (updatesByRole.length < 2) {
      throw new Error('Could not locate both twin and double room type records to apply canonical rates.')
    }

    for (const item of updatesByRole) {
      if (!item) continue
      await updateRoomType(prisma, item.roomType.id, {
        baseRate: item.target,
        name: item.roomType.name,
        baseOccupancy: item.roomType.standardOccupancy,
        maxOccupancy: item.roomType.maxOccupancy,
      }, scriptActor)
      console.log(`[apply-server] Updated ${item.roomType.name} (${item.roomType.id}) base rate to ${item.target}.`)
    }

    const refreshed = await getRoomSetup(prisma)
    const postApplyMismatches = validateRoomTypeParity([], refreshed.roomTypes)
    if (postApplyMismatches.length > 0) {
      throw new Error(`Server parity validation failed after update: ${postApplyMismatches.join('; ')}`)
    }
    console.log('[apply-server] Server room-type base rate parity check passed.')
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  const sourcePath = resolve(argValue('--source') || '')
  if (!sourcePath) fail('Usage: node scripts/generate-demand-calendar-overrides.mjs --source <path-to-xlsx> [--sheet <worksheet>] [--version 1.0.0]')

  const version = argValue('--version') || DEFAULT_VERSION
  const sheetName = argValue('--sheet') || DEFAULT_SHEET
  const statusOverride = argValue('--source-status') || 'Projected'
  const outDir = resolve(argValue('--out-dir') || './artifacts/rate-preloads')
  const applyServer = hasFlag('--apply-server')
  const dryRun = hasFlag('--dry-run') || !hasFlag('--apply-server')
  const payload = await readFile(sourcePath)

  const hash = sha256Text(payload.toString('hex'))
  const parsed = parseWorkbookRows(payload, sheetName)
  const { rows: sourceRows, headers } = parsed
  const sourceStatus = normalizeStatus(statusOverride)

  const result = parseDemandSourceRows(sourceRows, headers, version, sourceStatus)
  const generatedRows = result.rows
  const sortedRows = generatedRows
    .sort((a, b) => (a.date === b.date ? a.roomType.localeCompare(b.roomType) : a.date.localeCompare(b.date)))

  const outputManifest = buildManifestRows(sortedRows, {
    sourcePath,
    sourceHash: hash,
    sheet: parsed.targetSheet,
    status: sourceStatus,
    version,
    totalSourceRows: sourceRows.length,
    projectedRows: sortedRows.length,
    generatedAt: new Date().toISOString(),
  }, result.tierCounts, result.invalidRows)

  await mkdir(outDir, { recursive: true })
  const manifestPath = resolve(outDir, `nakhon-si-thammarat-2027-demand-calendar-${version}.manifest.json`)
  const csvPath = resolve(outDir, `nakhon-si-thammarat-2027-demand-calendar-${version}.csv`)

  await Promise.all([
    writeFile(manifestPath, `${JSON.stringify(outputManifest, null, 2)}\n`, 'utf8'),
    writeFile(csvPath, buildRateCsv(sortedRows, { version }), 'utf8'),
  ])

  const backupPath = resolve(outDir, `nakhon-si-thammarat-2027-demand-calendar-${version}.rate-overrides-backup.json`)
  await writeFile(
    backupPath,
    `${JSON.stringify({
      version: ROOM_PRELOAD_VERSION,
      source: {
        sourcePath,
        sheet: parsed.targetSheet,
        sourceHash: hash,
        sourceStatus,
      },
      data: {
        'rate-overrides': sortedRows.map(({ roomType, date, rate, reason, demandTier, rateMultiplier, sourceStatus: rowStatus, reviewRepriceDate }) => ({
          id: `override_${date}_${roomType}`,
          roomTypeId: roomType,
          roomType,
          date,
          rate,
          reason,
          demandTier,
          rateMultiplier,
          sourceStatus: rowStatus,
          reviewRepriceDate,
          sourceVersion: version,
        })),
      },
    }, null, 2)}\n`,
    'utf8',
  )

  const projectedRows = sortedRows.length
  const invalidRows = outputManifest.validation.invalidRows
  console.log(`[generate] Parsed ${sourceRows.length} source rows (${result.tierCounts.low}/${EXPECTED_TIER_COUNTS.low} low, ${result.tierCounts.normal}/${EXPECTED_TIER_COUNTS.normal} normal, ${result.tierCounts.high}/${EXPECTED_TIER_COUNTS.high} high, ${result.tierCounts.peak}/${EXPECTED_TIER_COUNTS.peak} peak, ${result.tierCounts.compression}/${EXPECTED_TIER_COUNTS.compression} compression).`)
  console.log(`[generate] Generated ${projectedRows} non-normal override rows; ${invalidRows} invalid rows skipped.`)
  console.log(`[generate] Wrote manifest -> ${manifestPath}`)
  console.log(`[generate] Wrote CSV -> ${csvPath}`)
  console.log(`[generate] Wrote local-apply backup -> ${backupPath}`)

  if (!dryRun && applyServer) {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) fail('DATABASE_URL is required for --apply-server.')
    const prodMarker = databaseUrlContainsProductionMarker(databaseUrl)
    if (prodMarker) {
      fail(`Refusing --apply-server on production-like DATABASE_URL (${prodMarker}). Set an explicit non-production URL.`)
    }

    await applyServerRoomTypeBaseRates()
    return
  }

  if (!dryRun && !applyServer) {
    console.log('[generate] Dry-run mode completed. Add --apply-server to persist canonical base-rate parity changes in Prisma-backed setup.')
    return
  }

  if (dryRun) {
    console.log('[generate] Dry run completed. Set --apply-server to persist room type base-rate changes.')
  }

  console.log('[generate] Local KV preload is ready for Rates > Bulk Upload import from the generated CSV.')
  console.log('[generate] Source status default is PROJECTED. Confirm rows should be promoted to CONFIRMED before strict enforcement.')
  console.log('[generate] Backup JSON includes rate-overrides only and can be imported via Settings > Data Backup & Export if needed.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
