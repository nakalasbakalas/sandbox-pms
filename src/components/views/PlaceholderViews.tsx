import { 
  Calendar, 
  Users, 
  Broom, 
  CurrencyCircleDollar, 
  ChartBar, 
  ChartLineUp, 
  ArrowsClockwise, 
  Gear 
} from '@phosphor-icons/react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface PlaceholderViewProps {
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  features: string[]
}

export function PlaceholderView({ title, description, icon: Icon, features }: PlaceholderViewProps) {
  return (
    <div className="h-screen flex items-center justify-center bg-background p-6">
      <Card className="max-w-2xl w-full p-12 text-center">
        <div className="flex justify-center mb-6">
          <div className="p-6 rounded-2xl bg-muted">
            <Icon className="w-16 h-16 text-muted-foreground" />
          </div>
        </div>
        
        <h1 className="text-4xl font-bold mb-4">{title}</h1>
        <p className="text-lg text-muted-foreground mb-8">{description}</p>
        
        <div className="space-y-4 mb-8">
          <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Planned Features
          </p>
          <ul className="space-y-2">
            {features.map((feature, index) => (
              <li key={index} className="text-left flex items-start gap-3">
                <span className="text-primary text-xl">•</span>
                <span className="text-muted-foreground">{feature}</span>
              </li>
            ))}
          </ul>
        </div>
        
        <div className="flex justify-center gap-3">
          <Button variant="outline" disabled>Coming Soon</Button>
        </div>
      </Card>
    </div>
  )
}

export { FrontDeskView } from '../front-desk/FrontDeskView'
export { SettingsView } from '../settings/SettingsView'
export { RatesView } from '../rates/RatesView'
export { ChannelsView } from '../channels/ChannelsView'
export { ReportsView } from '../reports/ReportsView'

export function HousekeepingView() {
  return (
    <PlaceholderView
      title="Housekeeping"
      description="Room status and cleaning operations"
      icon={Broom}
      features={[
        'Real-time room status updates',
        'Cleaning assignment management',
        'Dirty / Clean / Inspected tracking',
        'Maintenance flagging',
        'Turnover pressure indicators',
        'Mobile-optimized interface',
      ]}
    />
  )
}
