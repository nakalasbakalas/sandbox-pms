import { z } from 'zod'

const URL_LIKE_PATTERN = /\b(?:https?|ftp):\/\/\S+|\bwww\.\S+/i
const CREDENTIAL_VALUE_PATTERN = /\b(?:password|passcode|secret|api[_ -]?key|authorization|cookie|session|credential|access[_ -]?token|refresh[_ -]?token|token|sig|signature|key|auth)\s*[:=]\s*\S+|\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}|\bsk-[A-Za-z0-9_-]{8,}/i
const DIRECT_CONTACT_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\+?\d[\d\s().-]{7,}\d/i

export function isSafeOperationalReason(value) {
  const text = String(value || '')
  return !URL_LIKE_PATTERN.test(text)
    && !CREDENTIAL_VALUE_PATTERN.test(text)
    && !DIRECT_CONTACT_PATTERN.test(text)
}

export const operationalReasonSchema = z.string().trim().min(3).max(1_000)
  .refine(
    isSafeOperationalReason,
    'Operational reason must not contain URLs, credentials, or direct-contact values.',
  )

export function operationalReasonForEvidence(value) {
  const parsed = operationalReasonSchema.safeParse(value)
  return parsed.success ? parsed.data : '[redacted unsafe operational reason]'
}
