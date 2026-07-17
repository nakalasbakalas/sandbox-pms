/* global console */
import assert from 'node:assert/strict'
import {
  getPropertySettings,
  getPropertyStatus,
  sanitizeSettingsStatus,
  updatePropertySettings,
  updatePropertyTaxSettings,
} from '../server/settings-service.mjs'

const property = {
  id: 'property-1',
  code: 'SANDBOX',
  name: 'Sandbox Hotel',
  address: null,
  phone: null,
  email: null,
  publicWebsite: null,
  lineId: null,
  lineUrl: null,
  supportHours: null,
  reservationAlertEmail: null,
  timezone: 'Asia/Bangkok',
  defaultCheckIn: '14:00',
  defaultCheckOut: '12:00',
  currency: 'THB',
  taxRate: 7,
  taxRateBasisPoints: null,
  extraGuestFee: 300,
  extraGuestFeeSatang: null,
  childFee: 100,
  childFeeSatang: 10_000n,
  inventoryMinimumRate: null,
  inventoryMinimumRateSatang: null,
  taxConfiguration: { enabled: true, pricesIncludeTax: true, taxes: [{ id: 'vat', name: 'VAT', rate: 7, appliesTo: 'ALL', included: true }], privateToken: 'must-not-return' },
  policies: { smoking: 'Non-smoking', importedEvidence: 'preserve-this' },
  operationalSettings: {
    operations: { baseLanguage: 'English', noOverbooking: true },
    staff: [{ email: 'private@example.test' }],
  },
  sourceNotes: { credential: 'must-not-return' },
  updatedAt: new Date('2026-07-16T00:00:00.000Z'),
}
const audits = []
const events = []

function prismaFixture() {
  const prisma = {
    property: {
      findFirst: async ({ where }) => where.id === property.id ? { ...property } : null,
      update: async ({ where, data }) => {
        assert.equal(where.id, property.id)
        Object.assign(property, data, { updatedAt: new Date('2026-07-16T01:00:00.000Z') })
        return { ...property }
      },
    },
    auditLog: { create: async ({ data }) => { audits.push(data); return data } },
    domainEvent: { create: async ({ data }) => { const row = { id: BigInt(events.length + 1), ...data, createdAt: new Date() }; events.push(row); return row } },
  }
  prisma.$transaction = async (callback) => callback(prisma)
  return prisma
}

const prisma = prismaFixture()
const manager = { propertyId: property.id, role: 'MANAGER', actor: { id: 'manager-1' }, requestId: 'request-settings-1' }
const frontDesk = { propertyId: property.id, role: 'FRONT_DESK', actor: { id: 'frontdesk-1' } }

const initial = await getPropertySettings(prisma, frontDesk)
assert.equal(initial.fees.extraGuestFeeSatang, '30000', 'legacy baht fees serialize as exact satang strings')
assert.equal(initial.taxConfiguration.rateBasisPoints, 700, 'legacy percent tax normalizes to exact basis points')
assert.equal(JSON.stringify(initial).includes('privateToken'), false, 'settings response is allowlisted')
assert.equal(JSON.stringify(initial).includes('private@example.test'), false, 'import-only staff data is not exposed')
assert.equal(JSON.stringify(initial).includes('sourceNotes'), false, 'source evidence is not exposed')

const updated = await updatePropertySettings(prisma, manager, {
  reason: 'Owner approved property operations update',
  profile: { timezone: 'Asia/Bangkok', defaultCheckOut: '11:00', publicWebsite: 'https://www.sandboxhotel.com' },
  fees: { extraGuestFeeSatang: '30501', inventoryMinimumRateSatang: '55000' },
  policies: { cancellation: 'Review-gated cancellation policy.' },
  operationalSettings: { operations: { baseLanguage: 'Thai', alertRecipients: ['OPS@EXAMPLE.TEST'], noOverbooking: true } },
})
assert.equal(updated.profile.defaultCheckOut, '11:00')
assert.equal(updated.fees.extraGuestFeeSatang, '30501')
assert.equal(property.extraGuestFee, 305.01, 'exact satang dual-writes the compatibility baht value')
assert.equal(property.policies.importedEvidence, 'preserve-this', 'unknown imported evidence is preserved internally')
assert.equal(property.operationalSettings.staff[0].email, 'private@example.test', 'unrelated imported operational data is preserved')
assert.deepEqual(property.operationalSettings.operations.alertRecipients, ['ops@example.test'])
assert.equal(audits.at(-1).action, 'PROPERTY_SETTINGS_UPDATED')
assert.deepEqual(audits.at(-1).changes.changedSections, ['profile', 'fees', 'policies', 'operationalSettings'])
assert.equal(events.at(-1).eventType, 'PROPERTY_SETTINGS_UPDATED')
assert.equal(events.at(-1).propertyId, property.id)

const taxed = await updatePropertyTaxSettings(prisma, manager, {
  reason: 'Accounting approved VAT and service configuration',
  enabled: true,
  pricesIncludeTax: true,
  taxes: [
    { id: 'vat', name: 'VAT', rateBasisPoints: 700, appliesTo: 'ALL', included: true },
    { id: 'service', name: 'Service Charge', rateBasisPoints: 1000, appliesTo: 'ALL', included: true },
  ],
})
assert.equal(taxed.taxConfiguration.rateBasisPoints, 1700)
assert.equal(property.taxRateBasisPoints, 1700)
assert.equal(property.taxRate, 17, 'legacy tax percent is derived from exact basis points')
assert.equal(property.taxConfiguration.privateToken, 'must-not-return', 'imported tax evidence remains preserved but private')
assert.equal(JSON.stringify(taxed).includes('privateToken'), false)
assert.equal(audits.at(-1).action, 'PROPERTY_TAX_SETTINGS_UPDATED')
assert.equal(events.at(-1).metadata.rateBasisPoints, 1700)

await assert.rejects(
  () => updatePropertySettings(prisma, frontDesk, { reason: 'Not allowed', profile: { name: 'Unsafe' } }),
  (error) => error.statusCode === 403 && /manager or admin/.test(error.message),
)
await assert.rejects(
  () => updatePropertySettings(prisma, manager, { reason: 'Unknown field test', profile: { name: 'Hotel', apiToken: 'secret' } }),
  /Unrecognized key/,
)
await assert.rejects(
  () => updatePropertySettings(prisma, manager, { reason: 'Unsafe URL test', profile: { publicWebsite: 'https://example.test/?token=unsafe' } }),
  /Sensitive URL query parameters/,
)
await assert.rejects(
  () => updatePropertySettings(prisma, manager, { reason: 'Credential text test', policies: { deposit: 'password=do-not-store' } }),
  /Credential-shaped values/,
)
await assert.rejects(
  () => updatePropertyTaxSettings(prisma, manager, {
    reason: 'Duplicate tax test', enabled: true, pricesIncludeTax: false,
    taxes: [
      { id: 'vat', name: 'VAT', rateBasisPoints: 700, appliesTo: 'ALL', included: false },
      { id: 'vat', name: 'VAT copy', rateBasisPoints: 100, appliesTo: 'ALL', included: false },
    ],
  }),
  /unique/,
)

const sanitized = sanitizeSettingsStatus({ apiToken: 'unsafe', message: 'password=unsafe', nested: { ok: true } })
assert.equal(sanitized.apiToken, '[REDACTED]')
assert.equal(sanitized.message, 'password=[REDACTED]')

const status = await getPropertyStatus(prisma, frontDesk, {
  DIRECT_BOOKING_ENABLED: 'false', ACCOUNTING_V2_ENABLED: 'false', OTA_LIVE_WRITES_ENABLED: 'false',
  BOOKING_EMAIL_GMAIL_ACCESS_TOKEN: 'must-not-return',
})
assert.equal(status.sourceOfTruth, 'server')
assert.equal(status.property.code, 'SANDBOX')
assert.equal(status.capabilities.integrations.ota.writeMode, 'dry-run')
assert.equal(JSON.stringify(status).includes('must-not-return'), false, 'status only exposes redacted capability state')

await assert.rejects(
  () => getPropertySettings(prisma, { role: 'ADMIN', actor: { id: 'admin-1' } }),
  (error) => error.statusCode === 403 && /Authenticated property context/.test(error.message),
)

console.log('Settings service tests passed')
