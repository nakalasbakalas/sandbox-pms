const LOCK_NAMESPACE = 'sandbox-pms:autonomy-shadow:v1'
const MAX_LOCK_PART_LENGTH = 160
const LOCK_PART_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

export class AutonomyDistributedLockError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'AutonomyDistributedLockError'
    this.code = code
  }
}

function lockPart(value, label) {
  const normalized = String(value || '').trim()
  if (
    !normalized
    || normalized.length > MAX_LOCK_PART_LENGTH
    || !LOCK_PART_PATTERN.test(normalized)
  ) {
    throw new AutonomyDistributedLockError(
      `${label} is invalid for a shadow-ingestion lock.`,
      'AUTONOMY_LOCK_INPUT_INVALID',
    )
  }
  return normalized
}

export function buildAutonomyLockKey({ propertyId, job, source = 'default' } = {}) {
  return [
    LOCK_NAMESPACE,
    lockPart(propertyId, 'Property ID'),
    lockPart(job, 'Job'),
    lockPart(source, 'Source'),
  ].join(':')
}

function lockResultAcquired(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) return false
  return rows[0]?.acquired === true
}

function safeLockError(code) {
  const messages = {
    AUTONOMY_LOCK_TRANSACTION_FAILED: 'Shadow-ingestion lock transaction failed safely.',
    AUTONOMY_LOCK_CALLBACK_FAILED: 'Shadow-ingestion work failed while the distributed lock was held.',
  }
  return new AutonomyDistributedLockError(
    messages[code] || 'Shadow-ingestion lock failed safely.',
    code,
  )
}

export async function withAutonomyDistributedLock(
  prisma,
  lockInput,
  callback,
  transactionOptions = {},
) {
  if (!prisma || typeof prisma.$transaction !== 'function') {
    throw new AutonomyDistributedLockError(
      'Prisma transaction support is required for a shadow-ingestion lock.',
      'AUTONOMY_LOCK_CLIENT_INVALID',
    )
  }
  if (typeof callback !== 'function') {
    throw new AutonomyDistributedLockError(
      'Shadow-ingestion lock callback is required.',
      'AUTONOMY_LOCK_CALLBACK_INVALID',
    )
  }

  const lockKey = buildAutonomyLockKey(lockInput)
  const options = {
    isolationLevel: 'Serializable',
    maxWait: 5_000,
    timeout: 30_000,
    ...transactionOptions,
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (!tx || typeof tx.$queryRaw !== 'function') {
        throw safeLockError('AUTONOMY_LOCK_TRANSACTION_FAILED')
      }

      let rows
      try {
        rows = await tx.$queryRaw`
          SELECT pg_try_advisory_xact_lock(
            hashtextextended(${lockKey}, 0)
          ) AS "acquired"
        `
      } catch {
        throw safeLockError('AUTONOMY_LOCK_TRANSACTION_FAILED')
      }

      if (!lockResultAcquired(rows)) {
        return {
          acquired: false,
          skipped: true,
          reason: 'lock_unavailable',
        }
      }

      try {
        const value = await callback(tx)
        return {
          acquired: true,
          skipped: false,
          value,
        }
      } catch {
        throw safeLockError('AUTONOMY_LOCK_CALLBACK_FAILED')
      }
    }, options)
  } catch (error) {
    if (error instanceof AutonomyDistributedLockError) throw error
    throw safeLockError('AUTONOMY_LOCK_TRANSACTION_FAILED')
  }
}
