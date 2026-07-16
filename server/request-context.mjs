import { randomUUID } from 'node:crypto'

export const DEFAULT_PROPERTY_CODE = 'SANDBOX'

function forbidden(message) {
  const error = new Error(message)
  error.statusCode = 403
  return error
}

export function requestIdFromHeaders(headers = {}) {
  const raw = Array.isArray(headers['x-request-id']) ? headers['x-request-id'][0] : headers['x-request-id']
  return /^[a-zA-Z0-9._:-]{8,128}$/.test(String(raw || '')) ? String(raw) : randomUUID()
}

export async function resolveRequestContext(prisma, user, request, options = {}) {
  const propertyCode = String(options.propertyCode || DEFAULT_PROPERTY_CODE).trim().toUpperCase()
  const property = await prisma.property.findUnique({ where: { code: propertyCode } })
  if (!property) throw forbidden('The active property is not configured.')

  const membership = await prisma.userPropertyMembership.findUnique({
    where: {
      userId_propertyId: {
        userId: user.id,
        propertyId: property.id,
      },
    },
  })
  if (!membership?.active) throw forbidden('The authenticated user is not assigned to the active property.')

  return {
    requestId: request?.requestId || requestIdFromHeaders(request?.headers),
    actor: user,
    propertyId: property.id,
    propertyCode: property.code,
    role: membership.role || user.role,
    membershipId: membership.id,
    idempotencyKey: String(request?.headers?.['x-idempotency-key'] || '').trim() || null,
  }
}
