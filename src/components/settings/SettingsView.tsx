import { useKV } from '@github/spark/hooks'
import type { PropertySetup } from '@/types/onboarding'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BrandingSettings } from '@/components/settings/BrandingSettings'
import { Gear, Image, Buildings, Users } from '@phosphor-icons/react'

export function SettingsView() {
  const [propertyData] = useKV<PropertySetup>('onboarding-property', {} as PropertySetup)

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
          <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="branding" className="gap-2">
              <Image size={18} weight="duotone" />
              Branding
            </TabsTrigger>
            <TabsTrigger value="property" className="gap-2">
              <Buildings size={18} weight="duotone" />
              Property
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

          <TabsContent value="property" className="space-y-6">
            <div className="text-center py-12 text-muted-foreground">
              Property settings coming soon
            </div>
          </TabsContent>

          <TabsContent value="users" className="space-y-6">
            <div className="text-center py-12 text-muted-foreground">
              User management coming soon
            </div>
          </TabsContent>

          <TabsContent value="advanced" className="space-y-6">
            <div className="text-center py-12 text-muted-foreground">
              Advanced settings coming soon
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
