export type SystemCapabilityStatus =
  | 'available'
  | 'partial'
  | 'manual'
  | 'disabled'
  | 'enabled'
  | 'configured'
  | 'provider-pending'
  | 'enabled-unproven'
  | 'dry-run'

export type SystemCapabilityWriteMode =
  | 'read-only'
  | 'controlled'
  | 'review-gated'
  | 'dry-run'
  | 'disabled'

export type SystemCapability = {
  status: SystemCapabilityStatus
  evidence: string
  writeMode: SystemCapabilityWriteMode
  providerProof: boolean
}

export type SystemCapabilityRegistry = {
  sourceOfTruth: 'server'
  generatedAt: string
  operations: Record<string, SystemCapability>
  finance: Record<string, SystemCapability>
  integrations: Record<string, SystemCapability>
}
