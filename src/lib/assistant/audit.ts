import { createAuditRecord, type AuditRecord } from '@/lib/hotel/operations'

export function createAIAssistedAuditRecord(
  entityType: AuditRecord['entityType'],
  entityId: string,
  action: string,
  message: string,
  actor = 'Front desk AI',
  changes?: Record<string, unknown>,
): AuditRecord {
  const suffix = changes ? ` AI details: ${JSON.stringify(changes)}` : ' AI suggested action; user confirmed.'
  return createAuditRecord(entityType, entityId, action, `${message}${suffix}`, actor)
}
