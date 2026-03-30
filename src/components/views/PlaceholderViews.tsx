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

export function ReservationsView() {
  return (
    <PlaceholderView
      title="Reservations"
      description="View and manage all bookings across channels"
      icon={Calendar}
      features={[
        'Comprehensive reservations calendar',
        'Booking creation and modification',
        'Reservation search and filtering',
        'Channel source tracking',
        'Cancellation and no-show management',
        'Group reservations',
      ]}
    />
  )
}

export function GuestsView() {
  return (
    <PlaceholderView
      title="Guests"
      description="Guest profiles and stay history"
      icon={Users}
      features={[
        'Guest profile management',
        'Stay history and preferences',
        'Contact information',
        'ID document storage',
        'Guest notes and warnings',
        'Loyalty tracking',
      ]}
    />
  )
}

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

export function CashierView() {
  return (
    <PlaceholderView
      title="Cashier"
      description="Payments, folios, and financial operations"
      icon={CurrencyCircleDollar}
      features={[
        'Guest folio management',
        'Charge posting and extras',
        'Payment collection',
        'Deposit tracking',
        'Invoice and receipt generation',
        'Balance due alerts',
      ]}
    />
  )
}

export function RatesView() {
  return (
    <PlaceholderView
      title="Rates & Pricing"
      description="Dynamic pricing rules and rate management"
      icon={ChartLineUp}
      features={[
        'Room type base rates',
        'Seasonal pricing rules',
        'Weekend and weekday rates',
        'Long-stay discounts',
        'Rate calendar visualization',
        'Pricing rule builder',
      ]}
    />
  )
}

export function ChannelsView() {
  return (
    <PlaceholderView
      title="Channels"
      description="OTA integrations and channel manager"
      icon={ArrowsClockwise}
      features={[
        'Booking.com integration',
        'Agoda integration',
        'Expedia integration',
        'Real-time inventory sync',
        'Rate parity management',
        'Channel performance analytics',
      ]}
    />
  )
}

export function ReportsView() {
  return (
    <PlaceholderView
      title="Reports"
      description="Analytics and operational intelligence"
      icon={ChartBar}
      features={[
        'Occupancy and revenue metrics',
        'ADR and RevPAR analysis',
        'Channel performance comparison',
        'Guest booking patterns',
        'Housekeeping efficiency',
        'Financial summaries',
      ]}
    />
  )
}

export function SettingsView() {
  return (
    <PlaceholderView
      title="Settings"
      description="System configuration and property management"
      icon={Gear}
      features={[
        'Property information',
        'Room configuration',
        'User management and permissions',
        'Rate and tax settings',
        'Channel credentials',
        'System preferences',
      ]}
    />
  )
}
