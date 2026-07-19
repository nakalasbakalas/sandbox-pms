import { createHash } from 'node:crypto'
import { PmsValidationError } from './pms-domain.mjs'

function stableValue(value) {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    )
  }
  return value
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

export function requireCreateIdempotencyKey(value) {
  const key = String(value || '').trim()
  if (!/^[a-zA-Z0-9._:-]{8,200}$/.test(key)) {
    throw new PmsValidationError('A valid x-idempotency-key is required for PMS create operations.')
  }
  return key
}

async function lockAttempt(tx, propertyId, idempotencyKey) {
  if (typeof tx?.$queryRawUnsafe !== 'function') return
  await tx.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS locked',
    `pms-create:${propertyId}:${idempotencyKey}`,
  )
}

export async function claimPmsCreateAttempt(tx, { propertyId, idempotencyKey, operation, intent }) {
  const key = requireCreateIdempotencyKey(idempotencyKey)
  const intentFingerprint = fingerprint({ operation, intent })
  await lockAttempt(tx, propertyId, key)
  const existing = await tx.pmsCreateAttempt.findUnique({
    where: { propertyId_idempotencyKey: { propertyId, idempotencyKey: key } },
  })
  if (existing) {
    if (existing.operation !== operation || existing.intentFingerprint !== intentFingerprint) {
      throw new PmsValidationError('This create idempotency key was already used for a different command.', 409)
    }
    return { replay: true, attempt: existing }
  }
  const attempt = await tx.pmsCreateAttempt.create({
    data: { propertyId, idempotencyKey: key, operation, intentFingerprint },
  })
  return { replay: false, attempt }
}

export async function completePmsCreateAttempt(tx, attempt, { entityType, entityId, result }) {
  await tx.pmsCreateAttempt.update({
    where: { id: attempt.id },
    data: { entityType, entityId, resultFingerprint: fingerprint(result) },
  })
}

export function assertPmsCreateReplay(attempt, { entityType, entityId, result }) {
  if (!attempt?.entityId || attempt.entityType !== entityType || attempt.entityId !== entityId || !attempt.resultFingerprint) {
    throw new PmsValidationError('The original create outcome is unavailable. Refresh before trying again.', 409)
  }
  if (attempt.resultFingerprint !== fingerprint(result)) {
    throw new PmsValidationError('The original create outcome has been superseded by a later change. Refresh to view the current record.', 409)
  }
  return { ...result, idempotentReplay: true }
}
