import { useState, useEffect } from 'react'
import { useKV } from '@github/spark/hooks'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { CheckCircle, XCircle, Warning, ArrowsClockwise, Database } from '@phosphor-icons/react'
import { useNavigation } from '@/hooks/use-navigation'

interface DataStoreStatus {
  key: string
  name: string
  exists: boolean
  recordCount: number
  lastModified?: Date
  status: 'OK' | 'WARNING' | 'ERROR'
  message?: string
}

interface IntegrationStatus {
  module: string
  connections: string[]
  status: 'CONNECTED' | 'PARTIAL' | 'DISCONNECTED'
  issues: string[]
}

const CRITICAL_DATA_STORES = [
  { key: 'pms-rooms', name: 'Room Board Data' },
  { key: 'reservations', name: 'Reservations' },
  { key: 'guests', name: 'Guest Profiles' },
  { key: 'folios', name: 'Financial Folios' },
  { key: 'onboarding-property', name: 'Property Setup' },
]

const OPTIONAL_DATA_STORES = [
  { key: 'reservations-data', name: 'Reservations View Data' },
  { key: 'unassigned-reservations', name: 'Unassigned Reservations' },
  { key: 'inventory-snapshots', name: 'Inventory Tracking' },
  { key: 'inventory-sync-events', name: 'Inventory Sync Events' },
  { key: 'night-audit-logs', name: 'Night Audit History' },
  { key: 'visual-density', name: 'UI Density Preference' },
  { key: 'automated-messaging-config', name: 'Messaging Configuration' },
]

export function SystemStatusView() {
  const [dataStoreStatuses, setDataStoreStatuses] = useState<DataStoreStatus[]>([])
  const [integrationStatuses, setIntegrationStatuses] = useState<IntegrationStatus[]>([])
  const [isChecking, setIsChecking] = useState(false)
  const { navigate } = useNavigation()

  const checkDataStores = async () => {
    setIsChecking(true)
    const statuses: DataStoreStatus[] = []

    for (const store of [...CRITICAL_DATA_STORES, ...OPTIONAL_DATA_STORES]) {
      try {
        const data = await spark.kv.get(store.key)
        const exists = data !== undefined
        const recordCount = Array.isArray(data) ? data.length : exists ? 1 : 0
        
        let status: DataStoreStatus['status'] = 'OK'
        let message: string | undefined

        if (!exists && CRITICAL_DATA_STORES.some(s => s.key === store.key)) {
          status = 'ERROR'
          message = 'Critical data store not initialized'
        } else if (!exists) {
          status = 'WARNING'
          message = 'Optional data store not created yet'
        } else if (recordCount === 0 && store.key === 'pms-rooms') {
          status = 'ERROR'
          message = 'No rooms configured - run onboarding'
        }

        statuses.push({
          key: store.key,
          name: store.name,
          exists,
          recordCount,
          status,
          message,
        })
      } catch (error) {
        statuses.push({
          key: store.key,
          name: store.name,
          exists: false,
          recordCount: 0,
          status: 'ERROR',
          message: 'Failed to check data store',
        })
      }
    }

    setDataStoreStatuses(statuses)
    checkIntegrations(statuses)
    setIsChecking(false)
  }

  const checkIntegrations = (dataStatuses: DataStoreStatus[]) => {
    const integrations: IntegrationStatus[] = [
      {
        module: 'Board ↔ Front Desk',
        connections: ['pms-rooms', 'reservations', 'folios'],
        status: 'CONNECTED',
        issues: [],
      },
      {
        module: 'Front Desk ↔ Housekeeping',
        connections: ['pms-rooms', 'reservations'],
        status: 'CONNECTED',
        issues: [],
      },
      {
        module: 'Front Desk ↔ Cashier',
        connections: ['reservations', 'folios'],
        status: 'CONNECTED',
        issues: [],
      },
      {
        module: 'Reservations ↔ Channels',
        connections: ['reservations', 'inventory-snapshots', 'inventory-sync-events'],
        status: 'CONNECTED',
        issues: [],
      },
      {
        module: 'Channels ↔ Inventory',
        connections: ['inventory-snapshots', 'inventory-sync-events'],
        status: 'CONNECTED',
        issues: [],
      },
      {
        module: 'Night Audit ↔ All Modules',
        connections: ['night-audit-logs', 'folios', 'reservations', 'pms-rooms'],
        status: 'CONNECTED',
        issues: [],
      },
    ]

    integrations.forEach(integration => {
      const missingStores = integration.connections.filter(conn => {
        const storeStatus = dataStatuses.find(s => s.key === conn)
        return !storeStatus || !storeStatus.exists
      })

      if (missingStores.length > 0) {
        integration.status = 'PARTIAL'
        integration.issues.push(`Missing data stores: ${missingStores.join(', ')}`)
      }

      const errorStores = integration.connections.filter(conn => {
        const storeStatus = dataStatuses.find(s => s.key === conn)
        return storeStatus && storeStatus.status === 'ERROR'
      })

      if (errorStores.length > 0) {
        integration.status = 'DISCONNECTED'
        integration.issues.push(`Error in data stores: ${errorStores.join(', ')}`)
      }
    })

    setIntegrationStatuses(integrations)
  }

  useEffect(() => {
    checkDataStores()
  }, [])

  const overallHealth = dataStoreStatuses.every(s => s.status === 'OK')
    ? 'HEALTHY'
    : dataStoreStatuses.some(s => s.status === 'ERROR')
    ? 'CRITICAL'
    : 'WARNING'

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">System Status & Wiring</h1>
          <p className="text-muted-foreground mt-1">
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
            <Badge
              variant={
                overallHealth === 'HEALTHY'
                  ? 'default'
                  : overallHealth === 'CRITICAL'
                  ? 'destructive'
                  : 'secondary'
              }
            >
              {overallHealth}
            </Badge>
          </div>
          <CardDescription>
            System-wide integration and data store status
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold">
                {dataStoreStatuses.filter(s => s.status === 'OK').length}
              </div>
              <div className="text-sm text-muted-foreground">Healthy Stores</div>
            </div>
            <div>
              <div className="text-2xl font-bold">
                {integrationStatuses.filter(i => i.status === 'CONNECTED').length}
              </div>
              <div className="text-sm text-muted-foreground">Connected Modules</div>
            </div>
            <div>
              <div className="text-2xl font-bold">
                {dataStoreStatuses.reduce((sum, s) => sum + s.recordCount, 0)}
              </div>
              <div className="text-sm text-muted-foreground">Total Records</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Data Store Status</CardTitle>
            <CardDescription>
              Critical and optional data stores used across the system
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <div className="space-y-3">
                <div className="font-semibold text-sm">Critical Data Stores</div>
                {dataStoreStatuses
                  .filter(s => CRITICAL_DATA_STORES.some(c => c.key === s.key))
                  .map(store => (
                    <div
                      key={store.key}
                      className="flex items-start justify-between p-3 border rounded-lg"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{store.name}</span>
                          <Badge variant="outline" className="text-xs">
                            {store.recordCount} records
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {store.key}
                        </div>
                        {store.message && (
                          <div className="text-xs text-yellow-600 mt-1">
                            {store.message}
                          </div>
                        )}
                      </div>
                      <div>
                        {store.status === 'OK' && (
                          <CheckCircle className="text-green-600" size={20} />
                        )}
                        {store.status === 'WARNING' && (
                          <Warning className="text-yellow-600" size={20} />
                        )}
                        {store.status === 'ERROR' && (
                          <XCircle className="text-red-600" size={20} />
                        )}
                      </div>
                    </div>
                  ))}

                <Separator className="my-4" />

                <div className="font-semibold text-sm">Optional Data Stores</div>
                {dataStoreStatuses
                  .filter(s => OPTIONAL_DATA_STORES.some(c => c.key === s.key))
                  .map(store => (
                    <div
                      key={store.key}
                      className="flex items-start justify-between p-3 border rounded-lg"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{store.name}</span>
                          <Badge variant="outline" className="text-xs">
                            {store.recordCount} records
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {store.key}
                        </div>
                        {store.message && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {store.message}
                          </div>
                        )}
                      </div>
                      <div>
                        {store.status === 'OK' && (
                          <CheckCircle className="text-green-600" size={20} />
                        )}
                        {store.status === 'WARNING' && (
                          <Warning className="text-yellow-600" size={20} />
                        )}
                        {store.status === 'ERROR' && (
                          <XCircle className="text-red-600" size={20} />
                        )}
                      </div>
                    </div>
                  ))}
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
                {integrationStatuses.map(integration => (
                  <div
                    key={integration.module}
                    className="p-3 border rounded-lg"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium">{integration.module}</span>
                      <Badge
                        variant={
                          integration.status === 'CONNECTED'
                            ? 'default'
                            : integration.status === 'PARTIAL'
                            ? 'secondary'
                            : 'destructive'
                        }
                      >
                        {integration.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Data stores: {integration.connections.join(', ')}
                    </div>
                    {integration.issues.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {integration.issues.map((issue, i) => (
                          <div key={i} className="text-xs text-yellow-600">
                            ⚠ {issue}
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="p-4 border rounded-lg">
              <div className="font-semibold mb-2">✓ Check-In/Check-Out</div>
              <div className="text-sm text-muted-foreground">
                Updates Board, Housekeeping, Cashier, and Channel inventory
              </div>
            </div>
            <div className="p-4 border rounded-lg">
              <div className="font-semibold mb-2">✓ Reservation Management</div>
              <div className="text-sm text-muted-foreground">
                Syncs to Board timeline, inventory, and OTA channels
              </div>
            </div>
            <div className="p-4 border rounded-lg">
              <div className="font-semibold mb-2">✓ Bulk Operations</div>
              <div className="text-sm text-muted-foreground">
                Edit/assign multiple reservations with full sync
              </div>
            </div>
            <div className="p-4 border rounded-lg">
              <div className="font-semibold mb-2">✓ Payment Processing</div>
              <div className="text-sm text-muted-foreground">
                Updates folios, reservations, and accounting dashboard
              </div>
            </div>
            <div className="p-4 border rounded-lg">
              <div className="font-semibold mb-2">✓ Housekeeping Workflow</div>
              <div className="text-sm text-muted-foreground">
                Room status syncs to Board with auto-notifications
              </div>
            </div>
            <div className="p-4 border rounded-lg">
              <div className="font-semibold mb-2">✓ Channel Sync</div>
              <div className="text-sm text-muted-foreground">
                Real-time inventory and rate push to all OTAs
              </div>
            </div>
            <div className="p-4 border rounded-lg">
              <div className="font-semibold mb-2">✓ Night Audit</div>
              <div className="text-sm text-muted-foreground">
                Automated daily processing across all modules
              </div>
            </div>
            <div className="p-4 border rounded-lg">
              <div className="font-semibold mb-2">✓ Automated Messaging</div>
              <div className="text-sm text-muted-foreground">
                LINE notifications for housekeeping and operations
              </div>
            </div>
            <div className="p-4 border rounded-lg">
              <div className="font-semibold mb-2">✓ Print Functions</div>
              <div className="text-sm text-muted-foreground">
                Housekeeping, Reservations, Folios, and Receipts
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
