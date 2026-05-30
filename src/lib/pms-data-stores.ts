import { ensureLocalSparkFallback } from '@/lib/spark-hooks'

export type DataStoreStatusLevel = 'OK' | 'WARNING' | 'ERROR'

export interface PmsDataStoreDefinition {
  key: string
  name: string
  critical: boolean
  defaultValue?: unknown
  repairFrom?: string[]
  emptyErrorMessage?: string
}

export interface PmsDataStoreStatus {
  key: string
  name: string
  exists: boolean
  recordCount: number
  status: DataStoreStatusLevel
  message?: string
  sourceKey?: string
}

const HOUSEKEEPING_AUTOMATION_DEFAULT = {
  enabled: true,
  checkOutNotifications: true,
  earlyCheckInNotifications: true,
  maintenanceRequestNotifications: true,
  priorityRoomNotifications: true,
  noShowNotifications: true,
  extendedStayNotifications: true,
}

export const CRITICAL_PMS_DATA_STORES: PmsDataStoreDefinition[] = [
  {
    key: 'pms-rooms',
    name: 'Room Board Data',
    critical: true,
    emptyErrorMessage: 'No rooms configured - run onboarding',
  },
  {
    key: 'reservations',
    name: 'Reservations',
    critical: true,
    defaultValue: [],
    repairFrom: ['reservations-data'],
  },
  {
    key: 'guests',
    name: 'Guest Profiles',
    critical: true,
    defaultValue: [],
    repairFrom: ['guests-data'],
  },
  {
    key: 'folios',
    name: 'Financial Folios',
    critical: true,
    defaultValue: [],
    repairFrom: ['cashier-folios'],
  },
  {
    key: 'onboarding-property',
    name: 'Property Setup',
    critical: true,
  },
]

export const OPTIONAL_PMS_DATA_STORES: PmsDataStoreDefinition[] = [
  { key: 'reservations-data', name: 'Reservations View Data', critical: false, defaultValue: [] },
  { key: 'guests-data', name: 'Guest Directory View Data', critical: false, defaultValue: [] },
  { key: 'cashier-folios', name: 'Cashier View Folios', critical: false, defaultValue: [] },
  { key: 'unassigned-reservations', name: 'Unassigned Reservations', critical: false, defaultValue: [] },
  { key: 'room-types-config', name: 'Room Type Rate Config', critical: false, defaultValue: [] },
  { key: 'inventory-snapshots', name: 'Inventory Tracking', critical: false, defaultValue: [] },
  { key: 'inventory-sync-events', name: 'Inventory Sync Events', critical: false, defaultValue: [] },
  { key: 'night-audit-logs', name: 'Night Audit History', critical: false, defaultValue: [] },
  { key: 'app-density', name: 'UI Density Preference', critical: false, defaultValue: 'compact', repairFrom: ['visual-density'] },
  {
    key: 'housekeeping-automation-config',
    name: 'Messaging Configuration',
    critical: false,
    defaultValue: HOUSEKEEPING_AUTOMATION_DEFAULT,
    repairFrom: ['automated-messaging-config'],
  },
]

export const PMS_DATA_STORES = [
  ...CRITICAL_PMS_DATA_STORES,
  ...OPTIONAL_PMS_DATA_STORES,
]

export const PMS_MODULE_INTEGRATIONS = [
  {
    module: 'Board <-> Front Desk',
    connections: ['pms-rooms', 'reservations', 'folios'],
  },
  {
    module: 'Front Desk <-> Housekeeping',
    connections: ['pms-rooms', 'reservations'],
  },
  {
    module: 'Front Desk <-> Cashier',
    connections: ['reservations', 'folios'],
  },
  {
    module: 'Reservations <-> Channels',
    connections: ['reservations', 'inventory-snapshots', 'inventory-sync-events'],
  },
  {
    module: 'Channels <-> Inventory',
    connections: ['inventory-snapshots', 'inventory-sync-events'],
  },
  {
    module: 'Night Audit <-> All Modules',
    connections: ['night-audit-logs', 'folios', 'reservations', 'pms-rooms'],
  },
]

function cloneStoreValue<T>(value: T): T {
  if (Array.isArray(value)) return [...value] as T
  if (value && typeof value === 'object') return JSON.parse(JSON.stringify(value)) as T
  return value
}

function hasDefaultValue(store: PmsDataStoreDefinition) {
  return Object.prototype.hasOwnProperty.call(store, 'defaultValue')
}

function getRecordCount(value: unknown) {
  if (Array.isArray(value)) return value.length
  return value === undefined ? 0 : 1
}

async function readFirstAvailableAlias(store: PmsDataStoreDefinition) {
  for (const aliasKey of store.repairFrom || []) {
    const aliasValue = await spark.kv.get(aliasKey)
    if (aliasValue !== undefined) {
      return { key: aliasKey, value: aliasValue }
    }
  }

  return null
}

function shouldRecoverFromAlias(currentValue: unknown, aliasValue: unknown) {
  if (currentValue === undefined) return true
  return Array.isArray(currentValue) && currentValue.length === 0 && Array.isArray(aliasValue) && aliasValue.length > 0
}

export async function checkPmsDataStores({ repair = true } = {}): Promise<PmsDataStoreStatus[]> {
  ensureLocalSparkFallback()

  const statuses: PmsDataStoreStatus[] = []

  for (const store of PMS_DATA_STORES) {
    try {
      let data = await spark.kv.get(store.key)
      let exists = data !== undefined
      let message: string | undefined
      let sourceKey: string | undefined

      if (repair) {
        const alias = await readFirstAvailableAlias(store)

        if (alias && shouldRecoverFromAlias(data, alias.value)) {
          data = cloneStoreValue(alias.value)
          await spark.kv.set(store.key, data)
          exists = true
          sourceKey = alias.key
          message = `Recovered from ${alias.key}`
        } else if (!exists && hasDefaultValue(store)) {
          data = cloneStoreValue(store.defaultValue)
          await spark.kv.set(store.key, data)
          exists = true
          message = 'Initialized empty store'
        }
      }

      const recordCount = getRecordCount(data)
      let status: DataStoreStatusLevel = 'OK'

      if (!exists && store.critical) {
        status = 'ERROR'
        message = 'Critical data store not initialized'
      } else if (!exists) {
        status = 'WARNING'
        message = 'Optional data store not created yet'
      } else if (recordCount === 0 && store.emptyErrorMessage) {
        status = 'ERROR'
        message = store.emptyErrorMessage
      }

      statuses.push({
        key: store.key,
        name: store.name,
        exists,
        recordCount,
        status,
        message,
        sourceKey,
      })
    } catch {
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

  return statuses
}
