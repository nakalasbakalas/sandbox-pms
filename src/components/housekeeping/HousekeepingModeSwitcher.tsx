import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DeviceTablet, DeviceMobile } from '@phosphor-icons/react'
import { TabletHousekeepingApp } from './TabletHousekeepingApp'
import { MobileHousekeepingView } from './MobileHousekeepingView'
import { useKV } from '@github/spark/hooks'

type ViewMode = 'tablet' | 'mobile' | null

export function HousekeepingModeSwitcher() {
  const [preferredMode, setPreferredMode] = useKV<ViewMode>('housekeeping-view-mode', null)
  const [mode, setMode] = useState<ViewMode>(preferredMode)

  const selectMode = (newMode: ViewMode) => {
    setMode(newMode)
    setPreferredMode(newMode)
  }

  if (mode === 'tablet') {
    return <TabletHousekeepingApp />
  }

  if (mode === 'mobile') {
    return <MobileHousekeepingView />
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/5 flex items-center justify-center p-6">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">Housekeeping</h1>
          <p className="text-lg text-muted-foreground">
            Choose your preferred view
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <Card className="p-8 hover:shadow-lg transition-all hover:border-primary/50 cursor-pointer group">
            <button
              onClick={() => selectMode('tablet')}
              className="w-full text-left"
            >
              <div className="flex items-center justify-center mb-6">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                  <DeviceTablet size={48} weight="bold" className="text-white" />
                </div>
              </div>
              
              <h2 className="text-2xl font-bold mb-3 text-center">Tablet Mode</h2>
              
              <p className="text-muted-foreground mb-6 text-center">
                Optimized for iPad and tablets with grid layout and touch-friendly cards
              </p>

              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-2 flex-shrink-0" />
                  <span>Large touch-friendly room cards</span>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-2 flex-shrink-0" />
                  <span>Grid layout with filtering and search</span>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-2 flex-shrink-0" />
                  <span>Sliding detail sheets for each room</span>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-2 flex-shrink-0" />
                  <span>Quick status updates with one tap</span>
                </div>
              </div>

              <Button className="w-full mt-6 h-12 text-base" size="lg">
                Use Tablet Mode
              </Button>
            </button>
          </Card>

          <Card className="p-8 hover:shadow-lg transition-all hover:border-primary/50 cursor-pointer group">
            <button
              onClick={() => selectMode('mobile')}
              className="w-full text-left"
            >
              <div className="flex items-center justify-center mb-6">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                  <DeviceMobile size={48} weight="bold" className="text-white" />
                </div>
              </div>
              
              <h2 className="text-2xl font-bold mb-3 text-center">Mobile Mode</h2>
              
              <p className="text-muted-foreground mb-6 text-center">
                Compact list view with swipe gestures and detailed room screens
              </p>

              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-2 flex-shrink-0" />
                  <span>Compact list grouped by floor</span>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-2 flex-shrink-0" />
                  <span>Swipe gestures for quick updates</span>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-2 flex-shrink-0" />
                  <span>Full-screen room detail views</span>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-2 flex-shrink-0" />
                  <span>Staff assignment management</span>
                </div>
              </div>

              <Button className="w-full mt-6 h-12 text-base" variant="outline" size="lg">
                Use Mobile Mode
              </Button>
            </button>
          </Card>
        </div>

        <div className="text-center mt-8 text-sm text-muted-foreground">
          You can change this preference anytime from the housekeeping view
        </div>
      </div>
    </div>
  )
}
