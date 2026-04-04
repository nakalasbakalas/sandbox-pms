import { DataBackupExport } from '@/components/settings/DataBackupExport'
import { ArrowLeft, Database } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { useNavigation } from '@/hooks/use-navigation'

export function DataBackupView() {
  const { navigate } = useNavigation()

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="px-6 py-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('settings')}
              className="mr-2"
            >
              <ArrowLeft size={16} />
            </Button>
            <div className="p-2 rounded-lg bg-primary/10">
              <Database weight="duotone" size={24} className="text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Data Backup & Export</h1>
              <p className="text-sm text-muted-foreground">
                Export, import, and manage your system data
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 max-w-5xl mx-auto">
        <DataBackupExport />
      </div>
    </div>
  )
}
