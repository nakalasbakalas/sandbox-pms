import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowsClockwise,
  CheckCircle,
  Database,
  Info,
  Warning,
  XCircle,
} from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SERVER_API_ENABLED, pmsApi } from '@/lib/pms-api-client'
import { getServerSetupStatus, type ServerSetupStatus } from '@/lib/server-auth-client'
import { getSystemCapabilityRegistry } from '@/lib/system-capabilities-client'
import type {
  SystemCapability,
  SystemCapabilityRegistry,
  SystemCapabilityStatus,
} from '@/types/system-capabilities'

type CapabilityState = 'VERIFIED' | 'LIMITED' | 'UNAVAILABLE' | 'UNKNOWN'

type HealthPayload = {
  ok: boolean
  service?: string
  environment?: string
  timestamp?: string
  database?: {
    configured: boolean
    ok: boolean | null
    error?: string
  }
  integrations?: {
    lineWebhookConfigured?: boolean
    whatsappWebhookConfigured?: boolean
    hotelOpsEmailCommandIntake?: { enabled?: boolean }
    hotelOpsWhatsAppCommandIntake?: { enabled?: boolean }
  }
}

type StatusSnapshot = {
  health: HealthPayload | null
  setup: ServerSetupStatus | null
  registry: SystemCapabilityRegistry | null
  errors: string[]
  checkedAt: Date
}

type Capability = {
  name: string
  category: 'Infrastructure' | 'Operations' | 'Finance' | 'Integrations'
  state: CapabilityState
  evidence: string
  boundary?: string
}

type RegistrySection = 'operations' | 'finance' | 'integrations'

const CAPABILITY_NAMES: Record<string, string> = {
  today: 'Today command center',
  reservations: 'Reservations',
  frontDesk: 'Front desk and booking board',
  housekeeping: 'Housekeeping',
  rates: 'Rates',
  nightAudit: 'Night audit',
  messaging: 'Messaging',
  realtime: 'Real-time server events',
  accountingV2: 'Accounting V2',
  onlinePayments: 'Online payments',
  bookingEmail: 'Booking Email',
  directBooking: 'Direct booking',
  ota: 'OTA adapters',
  ical: 'iCal channel feeds',
}

const SECTION_NAMES: Record<RegistrySection, Capability['category']> = {
  operations: 'Operations',
  finance: 'Finance',
  integrations: 'Integrations',
}

function capabilityVariant(state: CapabilityState) {
  if (state === 'VERIFIED') return 'default'
  if (state === 'LIMITED') return 'secondary'
  if (state === 'UNAVAILABLE') return 'destructive'
  return 'outline'
}

function CapabilityIcon({ state }: { state: CapabilityState }) {
  if (state === 'VERIFIED') return <CheckCircle className="text-emerald-600" size={22} weight="fill" />
  if (state === 'LIMITED') return <Warning className="text-amber-600" size={22} weight="fill" />
  if (state === 'UNAVAILABLE') return <XCircle className="text-rose-600" size={22} weight="fill" />
  return <Info className="text-slate-500" size={22} weight="fill" />
}

function fulfilled<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === 'fulfilled' ? result.value : null
}

function resultError(label: string, result: PromiseSettledResult<unknown>) {
  if (result.status === 'fulfilled') return null
  return `${label}: ${result.reason instanceof Error ? result.reason.message : 'request failed'}`
}

function humanizeCapabilityName(key: string) {
  return CAPABILITY_NAMES[key] || key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (value) => value.toUpperCase())
}

function registryCapabilityState(status: SystemCapabilityStatus, section: RegistrySection): CapabilityState {
  if (status === 'available') return 'VERIFIED'
  if (status === 'enabled') return section === 'integrations' ? 'LIMITED' : 'VERIFIED'
  if (status === 'disabled') return 'UNAVAILABLE'
  return 'LIMITED'
}

function registryCapabilityBoundary(section: RegistrySection, capability: SystemCapability) {
  const boundaries: string[] = []

  if (capability.writeMode === 'review-gated') {
    boundaries.push('Changes require staff review or approval before they become operational.')
  } else if (capability.writeMode === 'dry-run') {
    boundaries.push('Dry-run only; no live provider write capability is claimed.')
  } else if (capability.writeMode === 'disabled') {
    boundaries.push('This capability is disabled or not implemented.')
  } else if (capability.writeMode === 'controlled') {
    boundaries.push('Writes must pass authenticated backend policy and audit controls.')
  }

  if (section === 'integrations' && !capability.providerProof) {
    boundaries.push('The registry does not prove live provider access, successful provider writes, or owner approval.')
  }

  return boundaries.join(' ')
}

function registryCapabilities(registry: SystemCapabilityRegistry | null): Capability[] {
  if (!registry) return []

  return (Object.keys(SECTION_NAMES) as RegistrySection[]).flatMap((section) =>
    Object.entries(registry[section]).map(([key, capability]) => ({
      name: humanizeCapabilityName(key),
      category: SECTION_NAMES[section],
      state: registryCapabilityState(capability.status, section),
      evidence: capability.evidence,
      boundary: registryCapabilityBoundary(section, capability),
    })),
  )
}

export function SystemStatusView() {
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null)
  const [isChecking, setIsChecking] = useState(false)

  const refreshStatus = useCallback(async () => {
    if (!SERVER_API_ENABLED) {
      setSnapshot({
        health: null,
        setup: null,
        registry: null,
        errors: ['PMS API server mode is disabled. Browser demo data is not operational evidence.'],
        checkedAt: new Date(),
      })
      return
    }

    setIsChecking(true)
    try {
      const [healthResult, setupResult, registryResult] = await Promise.allSettled([
        pmsApi<HealthPayload>('/api/health?deep=1', null),
        getServerSetupStatus(),
        getSystemCapabilityRegistry(),
      ])
      setSnapshot({
        health: fulfilled(healthResult),
        setup: fulfilled(setupResult),
        registry: fulfilled(registryResult),
        errors: [
          resultError('Backend health', healthResult),
          resultError('Property setup', setupResult),
          resultError('Capability registry', registryResult),
        ].filter((value): value is string => Boolean(value)),
        checkedAt: new Date(),
      })
    } finally {
      setIsChecking(false)
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const capabilities = useMemo<Capability[]>(() => {
    if (!SERVER_API_ENABLED) {
      return [
        {
          name: 'Operational PMS backend',
          category: 'Infrastructure',
          state: 'UNAVAILABLE',
          evidence: 'This build is running without VITE_PMS_API_MODE=server.',
          boundary: 'Local browser data is demo-only and is not counted as connected or healthy.',
        },
      ]
    }

    const health = snapshot?.health
    const database = health?.database
    const setup = snapshot?.setup
    return [
      {
        name: 'PMS application server',
        category: 'Infrastructure',
        state: health?.ok ? 'VERIFIED' : snapshot ? 'UNAVAILABLE' : 'UNKNOWN',
        evidence: health?.ok
          ? `Authenticated application is responding in ${health.environment || 'an unspecified environment'}.`
          : 'No successful backend health response was received.',
      },
      {
        name: 'PostgreSQL database',
        category: 'Infrastructure',
        state: database?.configured && database.ok === true
          ? 'VERIFIED'
          : database?.configured
            ? 'UNAVAILABLE'
            : snapshot
              ? 'UNAVAILABLE'
              : 'UNKNOWN',
        evidence: database?.ok === true
          ? 'The backend completed a live database query during this check.'
          : database?.configured
            ? 'The backend is configured for a database, but the live query did not pass.'
            : 'No backend database configuration was confirmed.',
      },
      {
        name: 'Property and staff setup',
        category: 'Infrastructure',
        state: setup?.hasProperty && setup.hasUsers && !setup.needsSetup
          ? 'VERIFIED'
          : setup
            ? 'UNAVAILABLE'
            : 'UNKNOWN',
        evidence: setup?.hasProperty && setup.hasUsers
          ? `${setup.propertyName || 'The PMS property'} and at least one staff user exist in the backend.`
          : 'Backend property and staff setup is incomplete or could not be verified.',
      },
      ...registryCapabilities(snapshot?.registry || null),
    ]
  }, [snapshot])

  const counts = useMemo(() => ({
    verified: capabilities.filter((capability) => capability.state === 'VERIFIED').length,
    limited: capabilities.filter((capability) => capability.state === 'LIMITED').length,
    unavailable: capabilities.filter((capability) => capability.state === 'UNAVAILABLE').length,
  }), [capabilities])

  const coreOperational = Boolean(
    SERVER_API_ENABLED &&
    snapshot?.health?.ok &&
    snapshot.health.database?.ok === true &&
    snapshot.setup?.hasProperty &&
    snapshot.setup.hasUsers &&
    !snapshot.setup.needsSetup &&
    snapshot.registry?.sourceOfTruth === 'server' &&
    ['today', 'reservations', 'frontDesk'].every(
      (key) => snapshot.registry?.operations[key]?.status === 'available',
    ),
  )

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-3xl font-bold">System Status &amp; Capabilities</h1>
          <p className="mt-1 max-w-3xl text-muted-foreground">
            Canonical backend capability registry with live health and setup evidence. Browser storage is never used as connectivity proof.
          </p>
        </div>
        <Button onClick={() => void refreshStatus()} disabled={isChecking || !SERVER_API_ENABLED}>
          <ArrowsClockwise className={isChecking ? 'animate-spin' : ''} />
          Refresh backend evidence
        </Button>
      </div>

      <Card className={coreOperational ? 'border-emerald-200' : 'border-amber-300'}>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Core PMS</CardTitle>
              <CardDescription>Health, setup, and registry-backed operational prerequisites</CardDescription>
            </div>
            <Badge variant={coreOperational ? 'default' : 'secondary'}>
              {coreOperational ? 'CORE BACKEND AVAILABLE' : SERVER_API_ENABLED ? 'ATTENTION REQUIRED' : 'DEMO ONLY'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-md border bg-emerald-50 p-3">
              <div className="text-2xl font-bold text-emerald-800">{counts.verified}</div>
              <div className="text-xs text-emerald-800">Verified now</div>
            </div>
            <div className="rounded-md border bg-amber-50 p-3">
              <div className="text-2xl font-bold text-amber-800">{counts.limited}</div>
              <div className="text-xs text-amber-800">Limited/manual</div>
            </div>
            <div className="rounded-md border bg-rose-50 p-3">
              <div className="text-2xl font-bold text-rose-800">{counts.unavailable}</div>
              <div className="text-xs text-rose-800">Unavailable</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Database size={16} />
            Checked {snapshot?.checkedAt.toLocaleString() || 'not yet'}
            {snapshot?.health?.service ? ` · ${snapshot.health.service}` : ''}
            {snapshot?.registry?.generatedAt ? ` · Registry ${new Date(snapshot.registry.generatedAt).toLocaleString()}` : ''}
          </div>
          {snapshot?.errors.map((error) => (
            <div key={error} className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {error}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {capabilities.map((capability) => (
          <Card key={capability.name}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <CapabilityIcon state={capability.state} />
                  <div>
                    <CardTitle className="text-base">{capability.name}</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">{capability.category}</p>
                  </div>
                </div>
                <Badge variant={capabilityVariant(capability.state)}>{capability.state}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>{capability.evidence}</p>
              {capability.boundary && (
                <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                  Boundary: {capability.boundary}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Evidence meaning</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-3">
          <div><strong>Verified</strong> means the server registry reports an internal capability available or a supporting health/setup check passed.</div>
          <div><strong>Limited</strong> means a manual, dry-run, review-only, or otherwise bounded capability exists.</div>
          <div><strong>Unavailable</strong> means the capability is disabled, unimplemented, or failed its current check.</div>
          <div className="md:col-span-3 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            Provider proof is separate: configured credentials or enabled flags do not prove live access, successful writes, or owner approval.
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
