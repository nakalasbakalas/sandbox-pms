import { useKV } from '@github/spark/hooks'
import type { PropertySetup } from '@/types/onboarding'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { BrandingSettings } from '@/components/settings/BrandingSettings'
import { TaxSettings } from '@/components/settings/TaxSettings'
import { PromptPaySettings } from '@/components/settings/PromptPaySettings'
import { LineSettings } from '@/components/settings/LineSettings'
import { StaffAlertSettings } from '@/components/settings/StaffAlertSettings'
import { RoomReadyNotificationSettings } from '@/components/settings/RoomReadyNotificationSettings'
import { DailySummarySettings } from '@/components/settings/DailySummarySettings'
import { TrendDataManager } from '@/components/settings/TrendDataManager'
import { PropertySettings } from '@/components/settings/PropertySettings'
import { RoomTypeManagement } from '@/components/settings/RoomTypeManagement'
import { DataBackupExport } from '@/components/settings/DataBackupExport'
import { Gear, Image, Buildings, Users, ChatCircle, Bell, BellRinging, ChartLine, Receipt, ArrowRight, DoorOpen } from '@phosphor-icons/react'
import { useNavigation } from '@/hooks/use-navigation'

export function SettingsView() {
  const [propertyData] = useKV<PropertySetup>('onboarding-property', {} as PropertySetup)
  const { navigate } = useNavigation()

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Gear weight="duotone" size={24} className="text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{propertyData?.name || 'Hotel'} Settings</h1>
              <p className="text-sm text-muted-foreground">Manage your property configuration and branding</p>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 max-w-5xl mx-auto">
        <Tabs defaultValue="branding" className="w-full">
          <TabsList className="grid w-full grid-cols-10 mb-6">
            <TabsTrigger value="branding" className="gap-2">
              <Image size={18} weight="duotone" />
              Branding
            </TabsTrigger>
            <TabsTrigger value="tax" className="gap-2">
              <Receipt size={18} weight="duotone" />
              Tax & Payments
            </TabsTrigger>
            <TabsTrigger value="line" className="gap-2">
              <ChatCircle size={18} weight="duotone" />
              LINE
            </TabsTrigger>
            <TabsTrigger value="alerts" className="gap-2">
              <Bell size={18} weight="duotone" />
              Alerts
            </TabsTrigger>
            <TabsTrigger value="room-ready" className="gap-2">
              <BellRinging size={18} weight="duotone" />
              Room Ready
            </TabsTrigger>
            <TabsTrigger value="daily-summary" className="gap-2">
              <ChartLine size={18} weight="duotone" />
              Daily Reports
            </TabsTrigger>
            <TabsTrigger value="property" className="gap-2">
              <Buildings size={18} weight="duotone" />
              Property
            </TabsTrigger>
            <TabsTrigger value="room-types" className="gap-2">
              <DoorOpen size={18} weight="duotone" />
              Rooms
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-2">
              <Users size={18} weight="duotone" />
              Users
            </TabsTrigger>
            <TabsTrigger value="advanced" className="gap-2">
              <Gear size={18} weight="duotone" />
              Advanced
            </TabsTrigger>
          </TabsList>

          <TabsContent value="branding" className="space-y-6">
            <BrandingSettings />
          </TabsContent>

          <TabsContent value="tax" className="space-y-6">
            <TaxSettings />
            <PromptPaySettings />
          </TabsContent>

          <TabsContent value="line" className="space-y-6">
            <LineSettings />
          </TabsContent>

          <TabsContent value="alerts" className="space-y-6">
            <StaffAlertSettings />
          </TabsContent>

          <TabsContent value="room-ready" className="space-y-6">
            <RoomReadyNotificationSettings />
          </TabsContent>

          <TabsContent value="daily-summary" className="space-y-6">
            <DailySummarySettings />
            <TrendDataManager />
          </TabsContent>

          <TabsContent value="property" className="space-y-6">
            <PropertySettings />
          </TabsContent>

          <TabsContent value="room-types" className="space-y-6">
            <RoomTypeManagement />
          </TabsContent>

          <TabsContent value="users" className="space-y-6">
            <div className="text-center py-12 text-muted-foreground">
              User management is available in the advanced settings
            </div>
          </TabsContent>

          <TabsContent value="advanced" className="space-y-6">
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">User Management</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <div className="font-medium">User Accounts & Permissions</div>
                    <div className="text-sm text-muted-foreground">
                      Manage staff accounts, roles, and access permissions
                    </div>
                  </div>
                  <Button onClick={() => navigate('user-management')}>
                    Manage Users
                    <ArrowRight className="ml-2" size={16} />
                  </Button>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">System Administration</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <div className="font-medium">System Status & Wiring</div>
                    <div className="text-sm text-muted-foreground">
                      View complete integration status and data flow connections
                    </div>
                  </div>
                  <Button onClick={() => navigate('system-status')}>
                    View Status
                    <ArrowRight className="ml-2" size={16} />
                  </Button>
                </div>
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <div className="font-medium">Operational Audit Trail</div>
                    <div className="text-sm text-muted-foreground">
                      Review system health, integration wiring, and backup exports for operational follow-up
                    </div>
                  </div>
                  <Button variant="outline" onClick={() => navigate('system-status')}>
                    Review Activity
                    <ArrowRight className="ml-2" size={16} />
                  </Button>
                </div>
              </div>
            </Card>

            <DataBackupExport />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
