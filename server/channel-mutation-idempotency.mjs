import { createHash } from 'node:crypto'
import { PmsValidationError } from './pms-domain.mjs'

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    )
  }
  return value
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('base64url')
}

function idempotencyKeyFromContext(context) {
  const key = String(context?.idempotencyKey || '').trim()
  if (!/^[a-zA-Z0-9._:-]{16,200}$/.test(key)) {
    throw new PmsValidationError('A valid x-idempotency-key is required for channel mutations.')
  }
  return key
}

async function lockAttempt(tx, propertyId, idempotencyKey) {
  if (typeof tx.$executeRawUnsafe === 'function') {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      `channel-mutation:${propertyId}:${idempotencyKey}`,
    )
  }
}

export async function beginChannelMutation(tx, context, operation, intent) {
  const propertyId = String(context?.propertyId || '').trim()
  if (!propertyId) throw new PmsValidationError('Authenticated property context is required.', 403)
  const idempotencyKey = idempotencyKeyFromContext(context)
  const intentFingerprint = fingerprint({ operation, intent })
  await lockAttempt(tx, propertyId, idempotencyKey)

  const existing = await tx.channelMutationAttempt.findUnique({
    where: { propertyId_idempotencyKey: { propertyId, idempotencyKey } },
  })
  if (existing) {
    if (existing.operation !== operation || existing.intentFingerprint !== intentFingerprint) {
      throw new PmsValidationError('The channel idempotency key is already used for a different mutation.', 409)
    }
    return { id: existing.id, replay: true, result: existing.result }
  }

  const created = await tx.channelMutationAttempt.create({
    data: { propertyId, idempotencyKey, operation, intentFingerprint },
  })
  return { id: created.id, replay: false, result: null }
}

export async function completeChannelMutation(tx, attempt, result) {
  if (!attempt || attempt.replay) return result
  const jsonResult = JSON.parse(JSON.stringify(result))
  await tx.channelMutationAttempt.update({
    where: { id: attempt.id },
    data: { result: jsonResult },
  })
  return result
}
