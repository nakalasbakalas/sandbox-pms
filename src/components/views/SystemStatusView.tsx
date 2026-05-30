import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { CheckCircle, XCircle, Warning, ArrowsClockwise, Database } from '@phosphor-icons/react'
import { useNavigation } from '@/hooks/use-navigation'
import {
  checkPmsDataStores,
  CRITICAL_PMS_DATA_STORES,
  OPTIONAL_PMS_DATA_STORES,
  PMS_MODULE_INTEGRATIONS,
  type PmsDataStoreStatus,
} from '@/lib/pms-data-stores'

interface IntegrationStatus {
  module: string
  connections: string[]
  status: 'CONNECTED' | 'PARTIAL' | 'DISCONNECTED'
  issues: string[]
}

function statusIcon(status: PmsDataStoreStatus['status']) {
  if (status === 'OK') return <CheckCircle className="text-green-600" size={20} />
  if (status === 'WARNING') return <Warning className="text-yellow-600" size={20} />
  return <XCircle className="text-red-600" size={20} />
}

function connectionVariant(status: IntegrationStatus['status']) {
  if (status === 'CONNECTED') return 'default'
  if (status === 'PARTIAL') return 'secondary'
  return 'destructive'
}

function healthVariant(health: 'HEALTHY' | 'WARNING' | 'CRITICAL') {
  if (health === 'HEALTHY') return 'default'
  if (health === 'WARNING') return 'secondary'
  return 'destructive'
}

function StoreStatusRow({ store }: { store: PmsDataStoreStatus }) {
  return (
    <div className="flex items-start justify-between rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{store.name}</span>
          <Badge variant="outline" className="text-xs">
            {store.recordCount} records
          </Badge>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{store.key}</div>
        {store.message && (
          <div className={store.status === 'ERROR' ? 'mt-1 text-xs text-yellow-600' : 'mt-1 text-xs text-muted-foreground'}>
            {store.message}
          </div>
        )}
      </div>
      <div className="ml-3 shrink-0">{statusIcon(store.status)}</div>
    </div>
  )
}

function StoreGroup({
  title,
  statuses,
  keys,
}: {
  title: string
  statuses: PmsDataStoreStatus[]
  keys: string[]
}) {
  const rows = statuses.filter((status) => keys.includes(status.key))

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold">{title}</div>
      {rows.map((store) => (
        <StoreStatusRow key={store.key} store={store} />
      ))}
    </div>
  )
}

export function SystemStatusView() {
  const [dataStoreStatuses, setDataStoreStatuses] = useState<PmsDataStoreStatus[]>([])
  const [integrationStatuses, setIntegrationStatuses] = useState<IntegrationStatus[]>([])
  const [isChecking, setIsChecking] = useState(false)
  const { navigate } = useNavigation()

  const checkIntegrations = useCallback((dataStatuses: PmsDataStoreStatus[]) => {
    const integrations: IntegrationStatus[] = PMS_MODULE_INTEGRATIONS.map((integration) => ({
      ...integration,
      status: 'CONNECTED',
      issues: [],
    }))

    integrations.forEach((integration) => {
      const missingStores = integration.connections.filter((conn) => {
        const storeStatus = dataStatuses.find((status) => status.key === conn)
        return !storeStatus || !storeStatus.exists
      })

      if (missingStores.length > 0) {
        integration.status = 'PARTIAL'
        integration.issues.push(`Missing data stores: ${missingStores.join(', ')}`)
      }

      const errorStores = integration.connections.filter((conn) => {
        const storeStatus = dataStatuses.find((status) => status.key === conn)
        return storeStatus?.status === 'ERROR'
      })

      if (errorStores.length > 0) {
        integration.status = 'DISCONNECTED'
        integration.issues.push(`Error in data stores: ${errorStores.join(', ')}`)
      }
    })

    setIntegrationStatuses(integrations)
  }, [])

  const checkDataStores = useCallback(async () => {
    setIsChecking(true)
    try {
      const statuses = await checkPmsDataStores({ repair: true })
      setDataStoreStatuses(statuses)
      checkIntegrations(statuses)
    } finally {
      setIsChecking(false)
    }
  }, [checkIntegrations])

  useEffect(() => {
    void checkDataStores()
  }, [checkDataStores])

  const overallHealth = useMemo(() => {
    if (dataStoreStatuses.every((status) => status.status === 'OK')) return 'HEALTHY'
    if (dataStoreStatuses.some((status) => status.status === 'ERROR')) return 'CRITICAL'
    return 'WARNING'
  }, [dataStoreStatuses])

  const criticalKeys = CRITICAL_PMS_DATA_STORES.map((store) => store.key)
  const optionalKeys = OPTIONAL_PMS_DATA_STORES.map((store) => store.key)
  const healthyStoreCount = dataStoreStatuses.filter((status) => status.status === 'OK').length
  const connectedModuleCount = integrationStatuses.filter((integration) => integration.status === 'CONNECTED').length
  const totalRecordCount = dataStoreStatuses.reduce((sum, status) => sum + status.recordCount, 0)

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">System Status & Wiring</h1>
          <p className="mt-1 text-muted-foreground">
            Complete integration status for all modules and operations
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('data-backup')}>
            <Database className="mr-2" />
            Backup Data
          </Button>
          <Button onClick={checkDataStores} disabled={isChecking}>
            <ArrowsClockwise className={isChecking ? 'animate-spin' : ''} />
            Refresh Status
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Overall System Health</CardTitle>
            <Badge variant={healthVariant(overallHealth)}>{overallHealth}</Badge>
          </div>
          <CardDescription>
            System-wide integration and data store status
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold">{healthyStoreCount}</div>
              <div className="text-sm text-muted-foreground">Healthy Stores</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{connectedModuleCount}</div>
              <div className="text-sm text-muted-foreground">Connected Modules</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{totalRecordCount}</div>
              <div className="text-sm text-muted-foreground">Total Records</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Data Store Status</CardTitle>
            <CardDescription>
              Critical and optional data stores used across the system
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <div className="space-y-4">
                <StoreGroup title="Critical Data Stores" statuses={dataStoreStatuses} keys={criticalKeys} />
                <Separator />
                <StoreGroup title="Optional Data Stores" statuses={dataStoreStatuses} keys={optionalKeys} />
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Module Integration Status</CardTitle>
            <CardDescription>
              Data flow connections between system modules
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <div className="space-y-3">
                {integrationStatuses.map((integration) => (
                  <div key={integration.module} className="rounded-lg border p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="font-medium">{integration.module}</span>
                      <Badge variant={connectionVariant(integration.status)}>
                        {integration.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Data stores: {integration.connections.join(', ')}
                    </div>
                    {integration.issues.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {integration.issues.map((issue) => (
                          <div key={issue} className="text-xs text-yellow-600">
                            Warning: {issue}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Complete Wiring Overview</CardTitle>
          <CardDescription>
            Summary of all implemented integrations and operations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[
              ['Check-In/Check-Out', 'Updates Board, Housekeeping, Cashier, and Channel inventory'],
              ['Reservation Management', 'Syncs to Board timeline, inventory, and OTA channels'],
              ['Bulk Operations', 'Edit/assign multiple reservations with full sync'],
              ['Payment Processing', 'Updates folios, reservations, and accounting dashboard'],
              ['Housekeeping Workflow', 'Room status syncs to Board with auto-notifications'],
              ['Channel Sync', 'Real-time inventory and rate push to all OTAs'],
              ['Night Audit', 'Automated daily processing across all modules'],
              ['Automated Messaging', 'LINE notifications for housekeeping and operations'],
              ['Print Functions', 'Housekeeping, Reservations, Folios, and Receipts'],
            ].map(([title, description]) => (
              <div key={title} className="rounded-lg border p-4">
                <div className="mb-2 font-semibold">{title}</div>
                <div className="text-sm text-muted-foreground">{description}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
