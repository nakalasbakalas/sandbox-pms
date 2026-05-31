import { useState } from 'react'
import { useKV } from '@github/spark/hooks'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { 
  DownloadSimple, 
  UploadSimple, 
  Database, 
  FileArrowDown,
  CheckCircle,
  Warning,
  Info
} from '@phosphor-icons/react'
import { toast } from 'sonner'

interface BackupData {
  version: string
  timestamp: string
  propertyName: string
  data: {
    [key: string]: any
  }
}

const BACKUP_VERSION = '1.0.0'
const SENSITIVE_BACKUP_FIELDS = new Set([
  'password',
  'passwordHash',
  'passwordSalt',
  'apiKey',
  'accessToken',
  'channelAccessToken',
  'channelSecret',
  'clientSecret',
  'secret',
  'token',
])

function sanitizeBackupValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeBackupValue(item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, nestedValue]) =>
        SENSITIVE_BACKUP_FIELDS.has(key)
          ? []
          : [[key, sanitizeBackupValue(nestedValue)]]
      )
    )
  }

  return value
}

const DATA_CATEGORIES = [
  {
    id: 'property',
    label: 'Property Settings',
    description: 'Name, address, branding, logo, tax configuration',
    keys: ['onboarding-property', 'property-branding', 'tax-settings', 'tax-configuration'],
    critical: true
  },
  {
    id: 'rooms',
    label: 'Room Configuration',
    description: 'Room types, room numbers, occupancy rules',
    keys: ['pms-rooms', 'onboarding-room-types', 'onboarding-rooms', 'rooms', 'room-types', 'room-types-config'],
    critical: true
  },
  {
    id: 'rates',
    label: 'Rates & Pricing',
    description: 'Base rates, seasonal rates, pricing rules, parity, and yield data',
    keys: [
      'onboarding-rates',
      'rate-calendar',
      'seasonal-rates',
      'rate-rules',
      'rate-overrides',
      'rate-plans',
      'rate-push-logs',
      'rate-push-settings',
      'pending-rate-pushes',
      'rate-snapshots',
      'rate-parity-settings',
      'parity-checks',
      'parity-violations',
      'yield-rules',
      'yield-adjustments',
      'competitors',
      'competitor-rates',
      'seasonal-packages',
      'tax-rules',
      'discount-rules'
    ],
    critical: true
  },
  {
    id: 'reservations',
    label: 'Reservations',
    description: 'All booking data and guest information',
    keys: ['reservations', 'guests'],
    critical: true
  },
  {
    id: 'users',
    label: 'User Accounts',
    description: 'Staff accounts and permissions (passwords excluded)',
    keys: ['users', 'user-roles'],
    critical: true
  },
  {
    id: 'payments',
    label: 'Payment Settings',
    description: 'PromptPay, payment methods, merchant settings',
    keys: ['promptpay-settings', 'hotel-promptpay-id', 'payment-methods'],
    critical: false
  },
  {
    id: 'channels',
    label: 'Channel Manager',
    description: 'OTA channels, imported reservations, inventory sync, and push logs',
    keys: [
      'channels',
      'channel-reservations',
      'channel-room-mappings',
      'channel-sync-logs',
      'channel-inventory-states',
      'inventory-snapshots',
      'inventory-sync-events',
      'inventory-sync-logs',
      'auto-sync-enabled'
    ],
    critical: false
  },
  {
    id: 'messaging',
    label: 'Messaging Configuration',
    description: 'LINE settings, message templates, alert routing, automation rules',
    keys: [
      'line-settings',
      'line-config',
      'line-templates',
      'message-templates',
      'messages',
      'internal-channels',
      'internal-messages',
      'guest-messages',
      'staff-members',
      'staff-message-templates',
      'guest-message-templates',
      'automated-messaging-settings',
      'housekeeping-automation-config',
      'automated-message-log',
      'automation-last-processed',
      'staff-alert-settings',
      'alert-routing-rules',
      'housekeeping-notifications',
      'notification-sound-enabled',
      'room-ready-notification-settings',
      'room-ready-notification-logs'
    ],
    critical: false
  },
  {
    id: 'reports',
    label: 'Report Settings',
    description: 'Daily summary configuration, trend data, audit history',
    keys: [
      'daily-summary-settings',
      'daily-summary-logs',
      'last-daily-summary-report',
      'weekly-trends-data',
      'weekly-performance-history',
      'night-audit-config',
      'night-audit-logs',
      'audit-records'
    ],
    critical: false
  },
  {
    id: 'cashier',
    label: 'Cashier & Accounting',
    description: 'Transactions, folios, accounting entries',
    keys: ['accounting-entries', 'folios', 'cashier-folios', 'cash-reconciliations'],
    critical: true
  },
  {
    id: 'housekeeping',
    label: 'Housekeeping',
    description: 'Room status, cleaning assignments, inspection data, maintenance records',
    keys: [
      'housekeeping-assignments',
      'housekeeping-inspections',
      'housekeeping-staff',
      'housekeeping-view-mode',
      'room-staff-assignments',
      'maintenance-issues',
      'status-history',
      'last-room-update'
    ],
    critical: false
  },
  {
    id: 'growth',
    label: 'Direct Booking',
    description: 'Direct booking and growth suite configuration',
    keys: ['growth-suite-settings'],
    critical: false
  }
]

export function DataBackupExport() {
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    DATA_CATEGORIES.filter(c => c.critical).map(c => c.id)
  )
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [importProgress, setImportProgress] = useState(0)
  const [propertyData] = useKV<any>('onboarding-property', {})

  const resetToSetupState = async () => {
    if (!window.confirm('Restore this browser app to setup state? This clears local property, room, reservation, payment, channel, message, and user data.')) {
      return
    }

    setIsResetting(true)
    try {
      const resetPrefixes = [
        'auth:',
        'onboarding',
        'pms-',
        'rooms',
        'last-room-update',
        'room-',
        'reservations',
        'unassigned-reservations',
        'guests',
        'folios',
        'cashier-',
        'cash-',
        'accounting-',
        'audit-',
        'internal-',
        'guest-',
        'staff-',
        'rate-',
        'yield-',
        'pending-rate-',
        'channels',
        'channel-',
        'inventory-',
        'sync-',
        'auto-sync-',
        'line-',
        'promptpay-',
        'hotel-promptpay-id',
        'tax-',
        'daily-summary-',
        'weekly-',
        'maintenance-',
        'housekeeping-',
        'messages',
        'message-',
        'automated-',
        'automation-',
        'growth-suite-',
        'competitor',
        'seasonal-',
        'parity-',
        'payment-',
        'night-audit-',
        'property-branding',
        'alert-routing-rules',
        'status-history',
      ]
      const allKeys = await spark.kv.keys()
      const keysToDelete = allKeys.filter((key) => resetPrefixes.some((prefix) => key.startsWith(prefix)))

      await Promise.all(keysToDelete.map((key) => spark.kv.delete(key)))
      window.localStorage.removeItem('auth:current-user')
      window.localStorage.removeItem(['auth', 'pms-token'].join(':'))

      toast.success('Local app data cleared', {
        description: 'Reloading to setup wizard.',
      })

      setTimeout(() => window.location.reload(), 500)
    } catch (error) {
      console.error('Reset error:', error)
      toast.error('Failed to restore setup state')
    } finally {
      setIsResetting(false)
    }
  }

  const toggleCategory = (categoryId: string) => {
    setSelectedCategories(prev =>
      prev.includes(categoryId)
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    )
  }

  const selectAll = () => {
    setSelectedCategories(DATA_CATEGORIES.map(c => c.id))
  }

  const selectCriticalOnly = () => {
    setSelectedCategories(DATA_CATEGORIES.filter(c => c.critical).map(c => c.id))
  }

  const exportData = async (categoryIds: string[] = selectedCategories) => {
    setIsExporting(true)
    setExportProgress(0)

    try {
      const selectedKeys = DATA_CATEGORIES
        .filter(cat => categoryIds.includes(cat.id))
        .flatMap(cat => cat.keys)

      const allKeys = await spark.kv.keys()
      const keysToExport = allKeys.filter(key => 
        selectedKeys.some(pattern => key.includes(pattern))
      )

      const backupData: BackupData = {
        version: BACKUP_VERSION,
        timestamp: new Date().toISOString(),
        propertyName: propertyData?.name || 'Unknown Property',
        data: {}
      }

      const totalKeys = keysToExport.length
      let processed = 0

      for (const key of keysToExport) {
        const value = await spark.kv.get(key)
        if (value !== undefined) {
          backupData.data[key] = sanitizeBackupValue(value)
        }
        processed++
        setExportProgress(Math.round((processed / totalKeys) * 100))
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      const jsonString = JSON.stringify(backupData, null, 2)
      const blob = new Blob([jsonString], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
      link.href = url
      link.download = `${propertyData?.name || 'pms'}-backup-${timestamp}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      toast.success('Backup exported successfully', {
        description: `${Object.keys(backupData.data).length} data items exported`
      })
    } catch (error) {
      console.error('Export error:', error)
      toast.error('Failed to export backup', {
        description: 'Please try again or contact support'
      })
    } finally {
      setIsExporting(false)
      setExportProgress(0)
    }
  }

  const importData = async (file: File) => {
    setIsImporting(true)
    setImportProgress(0)

    try {
      const text = await file.text()
      const backupData: BackupData = JSON.parse(text)

      if (!backupData.version || !backupData.data) {
        throw new Error('Invalid backup file format')
      }

      const dataKeys = Object.keys(backupData.data)
      const totalKeys = dataKeys.length
      let processed = 0

      for (const key of dataKeys) {
        await spark.kv.set(key, backupData.data[key])
        processed++
        setImportProgress(Math.round((processed / totalKeys) * 100))
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      toast.success('Backup imported successfully', {
        description: `${totalKeys} data items restored. Please refresh the page.`
      })

      setTimeout(() => {
        window.location.reload()
      }, 2000)
    } catch (error) {
      console.error('Import error:', error)
      toast.error('Failed to import backup', {
        description: error instanceof Error ? error.message : 'Invalid backup file'
      })
    } finally {
      setIsImporting(false)
      setImportProgress(0)
    }
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      if (window.confirm('WARNING: Importing will overwrite ALL existing data. Are you sure you want to continue?')) {
        importData(file)
      }
    }
    event.target.value = ''
  }

  const exportQuickBackup = async () => {
    const criticalIds = DATA_CATEGORIES.filter(c => c.critical).map(c => c.id)
    setSelectedCategories(criticalIds)
    await exportData(criticalIds)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Database weight="duotone" size={24} className="text-primary" />
            </div>
            <div className="flex-1">
              <CardTitle>Data Backup & Export</CardTitle>
              <CardDescription>
                Export all system data for backup, migration, or compliance
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <Info weight="duotone" className="h-4 w-4" />
            <AlertDescription>
              Backups are saved as JSON files and can be imported to restore data. 
              Passwords are automatically excluded for security.
            </AlertDescription>
          </Alert>

          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Select Data to Export</h3>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={selectCriticalOnly}>
                  Critical Only
                </Button>
                <Button variant="outline" size="sm" onClick={selectAll}>
                  Select All
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {DATA_CATEGORIES.map(category => (
                <div
                  key={category.id}
                  className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedCategories.includes(category.id)
                      ? 'bg-primary/5 border-primary/30'
                      : 'hover:bg-muted/50'
                  }`}
                  onClick={() => toggleCategory(category.id)}
                >
                  <Checkbox
                    id={category.id}
                    checked={selectedCategories.includes(category.id)}
                    onCheckedChange={() => toggleCategory(category.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="flex-1 min-w-0">
                    <Label
                      htmlFor={category.id}
                      className="font-medium cursor-pointer flex items-center gap-2"
                    >
                      {category.label}
                      {category.critical && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">
                          Critical
                        </span>
                      )}
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {category.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {isExporting && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Exporting data...</span>
                <span className="font-medium">{exportProgress}%</span>
              </div>
              <Progress value={exportProgress} />
            </div>
          )}

          <div className="flex gap-3">
            <Button
              onClick={() => exportData()}
              disabled={selectedCategories.length === 0 || isExporting}
              className="flex-1"
            >
              <DownloadSimple className="mr-2" weight="bold" />
              {isExporting ? 'Exporting...' : 'Export Selected Data'}
            </Button>
            <Button
              variant="outline"
              onClick={exportQuickBackup}
              disabled={isExporting}
            >
              <FileArrowDown className="mr-2" />
              Quick Backup
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-destructive/10">
              <UploadSimple weight="duotone" size={24} className="text-destructive" />
            </div>
            <div className="flex-1">
              <CardTitle>Import Backup</CardTitle>
              <CardDescription>
                Restore data from a previous backup file
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <Warning weight="duotone" className="h-4 w-4" />
            <AlertDescription>
              <strong>Warning:</strong> Importing will overwrite ALL existing data. 
              Create a backup of your current data before proceeding.
            </AlertDescription>
          </Alert>

          {isImporting && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Importing data...</span>
                <span className="font-medium">{importProgress}%</span>
              </div>
              <Progress value={importProgress} />
            </div>
          )}

          <div>
            <input
              type="file"
              id="backup-import"
              accept=".json"
              onChange={handleFileSelect}
              disabled={isImporting}
              className="hidden"
            />
            <Button
              variant="outline"
              onClick={() => document.getElementById('backup-import')?.click()}
              disabled={isImporting}
              className="w-full"
            >
              <UploadSimple className="mr-2" weight="bold" />
              {isImporting ? 'Importing...' : 'Select Backup File'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>External Backup Readiness</CardTitle>
          <CardDescription>
            Provider-backed scheduling requires a configured storage integration
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <CheckCircle weight="duotone" className="h-4 w-4" />
            <AlertDescription>
              Local JSON export and import are available now. Automated off-site backups are not enabled until a storage provider and retention policy are configured.
            </AlertDescription>
          </Alert>

          <div className="grid gap-3">
            {[
              ['Schedule', 'No automated backup schedule is configured'],
              ['Storage Provider', 'No off-site storage destination is connected'],
              ['Recovery Policy', 'No point-in-time recovery policy is configured'],
            ].map(([label, description]) => (
              <div key={label} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <div className="font-medium text-sm">{label}</div>
                  <div className="text-xs text-muted-foreground">{description}</div>
                </div>
                <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  Not configured
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-destructive/10">
              <Warning weight="duotone" size={24} className="text-destructive" />
            </div>
            <div className="flex-1">
              <CardTitle>Restore to Setup State</CardTitle>
              <CardDescription>
                Clear local browser data and return the app to first-run setup.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <Warning weight="duotone" className="h-4 w-4" />
            <AlertDescription>
              This only clears local browser storage. Server database resets must be handled with a reviewed database backup and migration plan.
            </AlertDescription>
          </Alert>

          <Button
            variant="destructive"
            onClick={resetToSetupState}
            disabled={isResetting}
            className="w-full"
          >
            {isResetting ? 'Restoring...' : 'Restore Local App to Setup'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
