const EVENT_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{2,79}$/
const AGGREGATE_TYPE_PATTERN = /^[a-z][a-zA-Z0-9]{1,49}$/

function requiredIdentifier(value, label, pattern) {
  const normalized = String(value || '').trim()
  if (!pattern.test(normalized)) throw new Error(`${label} is invalid.`)
  return normalized
}

export async function recordDomainEvent(tx, input) {
  const propertyId = String(input?.propertyId || '').trim()
  const aggregateId = String(input?.aggregateId || '').trim()
  if (!propertyId) throw new Error('Domain event propertyId is required.')
  if (!aggregateId) throw new Error('Domain event aggregateId is required.')

  return tx.domainEvent.create({
    data: {
      propertyId,
      eventType: requiredIdentifier(input.eventType, 'Domain event type', EVENT_TYPE_PATTERN),
      aggregateType: requiredIdentifier(input.aggregateType, 'Domain event aggregate type', AGGREGATE_TYPE_PATTERN),
      aggregateId,
      actorUserId: input.actorUserId ? String(input.actorUserId) : null,
      metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : undefined,
    },
  })
}

export function publicDomainEvent(event) {
  return {
    id: String(event.id),
    type: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    occurredAt: event.createdAt instanceof Date ? event.createdAt.toISOString() : String(event.createdAt),
  }
}

export async function listDomainEvents(prisma, { propertyId, after = 0n, limit = 100 } = {}) {
  const normalizedPropertyId = String(propertyId || '').trim()
  if (!normalizedPropertyId) throw new Error('Domain event propertyId is required.')
  const normalizedAfter = typeof after === 'bigint' ? after : BigInt(String(after || '0'))
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 100, 250))
  const events = await prisma.domainEvent.findMany({
    where: {
      propertyId: normalizedPropertyId,
      id: { gt: normalizedAfter },
    },
    orderBy: { id: 'asc' },
    take: normalizedLimit,
  })
  return events.map(publicDomainEvent)
}
