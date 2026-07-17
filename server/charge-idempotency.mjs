import { createHash } from 'node:crypto'

export function chargeIntentFingerprint({
  folioId,
  dateKey = null,
  description,
  category,
  amountSatang,
  quantity,
  sourceEmailEventId = null,
}) {
  return createHash('sha256').update(JSON.stringify([
    String(folioId),
    dateKey ? String(dateKey) : null,
    String(description),
    String(category),
    String(amountSatang),
    Number(quantity),
    sourceEmailEventId ? String(sourceEmailEventId) : null,
  ])).digest('hex')
}
