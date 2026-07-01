function safeSeed(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 64)
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
}

function randomKeyPart() {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function createHotelOpsCommandIdempotencyKey(seed = '') {
  return `ui:${safeSeed(seed) || 'command'}:${randomKeyPart()}`.slice(0, 180)
}
