interface AttemptStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type DurableAttemptOperation =
  | 'cashier-payment'
  | 'cashier-charge'
  | 'check-in-payment'
  | 'check-out-payment'

export interface DurableAttemptDescriptor {
  operation: DurableAttemptOperation
  entityId: string
  material: unknown
}

interface StoredAttempt {
  version: 1
  fingerprint: string
  key: string
}

interface DurableAttemptKeyManagerOptions {
  storage?: AttemptStorage
  randomId?: () => string
}

const STORAGE_PREFIX = 'pms:attempt:v1:'
const ALLOWED_OPERATIONS = new Set<DurableAttemptOperation>([
  'cashier-payment',
  'cashier-charge',
  'check-in-payment',
  'check-out-payment',
])

class MemoryAttemptStorage implements AttemptStorage {
  private readonly entries = new Map<string, string>()

  getItem(key: string) {
    return this.entries.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.entries.set(key, value)
  }

  removeItem(key: string) {
    this.entries.delete(key)
  }
}

function defaultRandomId() {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function normalizedOperation(value: DurableAttemptOperation) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!ALLOWED_OPERATIONS.has(normalized as DurableAttemptOperation)) throw new Error('Unsupported attempt operation.')
  return normalized as DurableAttemptOperation
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') return `${value}n`
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined && typeof entry !== 'function' && typeof entry !== 'symbol')
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    )
  }
  return String(value)
}

function fallbackDigest(value: string) {
  let left = 0x811c9dc5
  let right = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    left = Math.imul(left ^ code, 0x01000193)
    right = Math.imul(right ^ code, 0x85ebca6b)
  }
  return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`
}

async function digest(value: unknown) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(canonicalize(value))
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(serialized)
    const result = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  return fallbackDigest(serialized)
}

function parseStoredAttempt(value: string | null): StoredAttempt | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<StoredAttempt>
    if (parsed.version !== 1 || typeof parsed.fingerprint !== 'string' || typeof parsed.key !== 'string') return null
    return parsed as StoredAttempt
  } catch {
    return null
  }
}

export class DurableAttemptKeyManager {
  private readonly storage: AttemptStorage
  private readonly randomId: () => string
  private readonly pending = new Map<string, Promise<string>>()

  constructor(options: DurableAttemptKeyManagerOptions = {}) {
    this.storage = options.storage || new MemoryAttemptStorage()
    this.randomId = options.randomId || defaultRandomId
  }

  private async storageKey(descriptor: DurableAttemptDescriptor) {
    const operation = normalizedOperation(descriptor.operation)
    const entityId = String(descriptor.entityId || '').trim()
    if (!entityId) throw new Error('Attempt entity is required.')
    return `${STORAGE_PREFIX}${await digest({ operation, entityId })}`
  }

  async getOrCreate(descriptor: DurableAttemptDescriptor) {
    const storageKey = await this.storageKey(descriptor)
    const pending = this.pending.get(storageKey)
    if (pending) return pending

    const operation = normalizedOperation(descriptor.operation)
    const resolution = (async () => {
      const fingerprint = await digest(descriptor.material)
      const stored = parseStoredAttempt(this.storage.getItem(storageKey))
      if (stored?.fingerprint === fingerprint) return stored.key

      const key = `pms-${operation}:${this.randomId()}`.slice(0, 200)
      this.storage.setItem(storageKey, JSON.stringify({ version: 1, fingerprint, key } satisfies StoredAttempt))
      return key
    })()
    this.pending.set(storageKey, resolution)
    try {
      return await resolution
    } finally {
      if (this.pending.get(storageKey) === resolution) this.pending.delete(storageKey)
    }
  }

  async confirmSuccess(descriptor: DurableAttemptDescriptor) {
    const storageKey = await this.storageKey(descriptor)
    const fingerprint = await digest(descriptor.material)
    const stored = parseStoredAttempt(this.storage.getItem(storageKey))
    if (stored?.fingerprint === fingerprint) this.storage.removeItem(storageKey)
  }
}

export const durableAttemptKeys = new DurableAttemptKeyManager()
