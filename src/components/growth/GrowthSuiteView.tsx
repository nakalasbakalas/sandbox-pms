import { useEffect, useMemo, useState } from 'react'
import { useKV } from '@github/spark/hooks'
import {
  Broadcast,
  CalendarCheck,
  ChartLineUp,
  CheckCircle,
  CreditCard,
  DeviceMobile,
  Globe,
  Link,
  MagnifyingGlass,
  Megaphone,
  PlugsConnected,
  Storefront,
  TrendUp,
  Warning,
} from '@phosphor-icons/react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { BoardRoomCard } from '@/types/board'

type GrowthSuiteSettings = {
  bookingEngineEnabled: boolean
  instantConfirmation: boolean
  collectDeposit: boolean
  guestExtras: boolean
  websitePublished: boolean
  metasearchEnabled: boolean
  mobileAlerts: boolean
  directMarkup: number
  depositPercent: number
  bookingWindowDays: number
  promoCode: string
  bookingUrl: string
}

type GrowthProduct = {
  id: string
  label: string
  area: string
  status: 'live' | 'ready' | 'setup'
  icon: typeof Storefront
  routeHint: string
}

type Campaign = {
  channel: string
  status: 'active' | 'paused' | 'draft'
  spend: number
  bookings: number
  roas: number
}

const defaultSettings: GrowthSuiteSettings = {
  bookingEngineEnabled: false,
  instantConfirmation: false,
  collectDeposit: false,
  guestExtras: false,
  websitePublished: false,
  metasearchEnabled: false,
  mobileAlerts: false,
  directMarkup: 0,
  depositPercent: 30,
  bookingWindowDays: 365,
  promoCode: '',
  bookingUrl: '',
}

const suiteProducts: GrowthProduct[] = [
  {
    id: 'calendar',
    label: 'Calendar',
    area: 'Daily operations',
    status: 'live',
    icon: CalendarCheck,
    routeHint: 'Room board',
  },
  {
    id: 'channel-manager',
    label: 'Channel Manager',
    area: 'OTA distribution',
    status: 'live',
    icon: Broadcast,
    routeHint: 'Channels',
  },
  {
    id: 'direct-booking',
    label: 'Direct Booking',
    area: 'Commission-light sales',
    status: 'ready',
    icon: Storefront,
    routeHint: 'Booking engine',
  },
  {
    id: 'insights',
    label: 'Insights',
    area: 'Pricing and reporting',
    status: 'live',
    icon: ChartLineUp,
    routeHint: 'Reports',
  },
  {
    id: 'guest-engagement',
    label: 'Guest Engagement',
    area: 'Guest messaging',
    status: 'live',
    icon: Megaphone,
    routeHint: 'Messaging',
  },
  {
    id: 'payments',
    label: 'Payments',
    area: 'Deposits and folios',
    status: 'live',
    icon: CreditCard,
    routeHint: 'Cashier',
  },
  {
    id: 'mobile',
    label: 'Mobile App',
    area: 'On-the-go operations',
    status: 'ready',
    icon: DeviceMobile,
    routeHint: 'Housekeeping mobile',
  },
  {
    id: 'metasearch',
    label: 'Metasearch',
    area: 'Google, Tripadvisor, Trivago',
    status: 'setup',
    icon: MagnifyingGlass,
    routeHint: 'Campaigns',
  },
]

const campaigns: Campaign[] = [
  { channel: 'Google Hotel Ads', status: 'draft', spend: 0, bookings: 0, roas: 0 },
  { channel: 'Tripadvisor', status: 'draft', spend: 0, bookings: 0, roas: 0 },
  { channel: 'Trivago', status: 'draft', spend: 0, bookings: 0, roas: 0 },
]

const integrations = [
  { name: 'Payment Gateway', category: 'Payments', status: 'Available in PMS', icon: CreditCard },
  { name: 'Accounting Export', category: 'Finance', status: 'Ready to configure', icon: Link },
  { name: 'Smart Locks', category: 'Access', status: 'Ready to configure', icon: PlugsConnected },
  { name: 'Email Marketing', category: 'Guest CRM', status: 'Ready to configure', icon: Megaphone },
]

const statusClass: Record<GrowthProduct['status'], string> = {
  live: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ready: 'bg-blue-50 text-blue-700 border-blue-200',
  setup: 'bg-amber-50 text-amber-700 border-amber-200',
}

const campaignClass: Record<Campaign['status'], string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  paused: 'bg-slate-50 text-slate-700 border-slate-200',
  draft: 'bg-amber-50 text-amber-700 border-amber-200',
}

export function GrowthSuiteView() {
  const [settings, setSettings] = useKV<GrowthSuiteSettings>('growth-suite-settings', defaultSettings)
  const [roomTypes] = useKV<Array<{ id: string; name: string; baseRate: number }>>('room-types-config', [])
  const [rooms] = useKV<BoardRoomCard[]>('pms-rooms', [])
  const [selectedRoomType, setSelectedRoomType] = useState('')
  const currentSettings = settings || defaultSettings

  const roomInventory = useMemo(() => {
    return roomTypes.map((roomType) => ({
      type: roomType.name,
      available: rooms.filter((room) => room.operationalStatus === 'AVAILABLE' && !room.currentReservationId && !room.reservationId).length,
      baseRate: roomType.baseRate,
      directShare: 0,
      extras: [] as string[],
    }))
  }, [roomTypes, rooms])

  const selectedInventory = roomInventory.find(room => room.type === selectedRoomType) || roomInventory[0]
  const directRates = useMemo(() => {
    return roomInventory.map(room => ({
      ...room,
      directRate: Math.round(room.baseRate * (1 + currentSettings.directMarkup / 100)),
    }))
  }, [currentSettings.directMarkup, roomInventory])

  const directConversion = 0
  const siteReadiness = [
    currentSettings.bookingEngineEnabled,
    currentSettings.instantConfirmation,
    currentSettings.collectDeposit,
    currentSettings.websitePublished,
    currentSettings.mobileAlerts,
  ].filter(Boolean).length * 20

  const updateSetting = <K extends keyof GrowthSuiteSettings>(key: K, value: GrowthSuiteSettings[K]) => {
    setSettings(prev => ({
      ...(prev || defaultSettings),
      [key]: value,
    }))
  }

  useEffect(() => {
    if (!selectedRoomType && roomInventory[0]) {
      setSelectedRoomType(roomInventory[0].type)
    }
  }, [roomInventory, selectedRoomType])

  const handlePublishBookingEngine = () => {
    updateSetting('bookingEngineEnabled', true)
    toast.success('Direct booking engine is enabled')
  }

  const handlePublishWebsite = () => {
    updateSetting('websitePublished', true)
    toast.success('Website draft marked as published')
  }

  const handleEnableMetasearch = () => {
    updateSetting('metasearchEnabled', true)
    toast.success('Metasearch campaigns are ready for budget review')
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card px-6 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Storefront className="h-5 w-5 text-primary" weight="duotone" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Growth Suite</h1>
              <p className="text-xs text-muted-foreground">Direct booking, website, metasearch, mobile, and marketplace controls</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="h-7 rounded-md px-2 text-xs">
              {currentSettings.bookingEngineEnabled ? 'Booking engine live' : 'Booking engine paused'}
            </Badge>
            <Button variant="outline" size="sm" onClick={() => toast.info(`Preview opened for ${currentSettings.bookingUrl}`)}>
              <Globe className="mr-2 h-4 w-4" />
              Preview
            </Button>
            <Button size="sm" onClick={handlePublishBookingEngine}>
              <CheckCircle className="mr-2 h-4 w-4" />
              Publish
            </Button>
          </div>
        </div>
      </div>

      <ScrollArea className="h-[calc(100vh-6.25rem)]">
        <div className="space-y-6 p-6">
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricTile label="Direct share" value="0%" detail="No verified direct bookings yet" icon={TrendUp} />
            <MetricTile label="Conversion" value={`${directConversion.toFixed(1)}%`} detail="Website to booking" icon={Storefront} />
            <MetricTile label="Booking value" value="THB 0" detail="Direct revenue this month" icon={CreditCard} />
            <MetricTile label="Readiness" value={`${siteReadiness}%`} detail="Publishing checklist" icon={CheckCircle} />
          </section>

          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {suiteProducts.map(product => {
              const Icon = product.icon

              return (
                <Card key={product.id} className="rounded-lg py-4">
                  <CardContent className="space-y-3 px-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                          <Icon className="h-4 w-4 text-muted-foreground" weight="duotone" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{product.label}</div>
                          <div className="truncate text-xs text-muted-foreground">{product.area}</div>
                        </div>
                      </div>
                      <Badge variant="outline" className={cn('rounded-md text-[10px] capitalize', statusClass[product.status])}>
                        {product.status}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{product.routeHint}</span>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => toast.info(`${product.label} selected`)}>
                        Open
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </section>

          <Tabs defaultValue="booking" className="space-y-4">
            <TabsList className="grid w-full grid-cols-2 lg:w-auto lg:inline-grid lg:grid-cols-4">
              <TabsTrigger value="booking">Direct Booking</TabsTrigger>
              <TabsTrigger value="website">Website</TabsTrigger>
              <TabsTrigger value="metasearch">Metasearch</TabsTrigger>
              <TabsTrigger value="marketplace">Marketplace</TabsTrigger>
            </TabsList>

            <TabsContent value="booking" className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                <Card className="rounded-lg">
                  <CardHeader>
                    <CardTitle className="text-base">Booking Engine Control</CardTitle>
                    <CardDescription>Rates, availability, deposits, and guest add-ons</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-3">
                      <SettingSwitch
                        label="Accept bookings"
                        checked={currentSettings.bookingEngineEnabled}
                        onCheckedChange={(checked) => updateSetting('bookingEngineEnabled', checked)}
                      />
                      <SettingSwitch
                        label="Instant confirmation"
                        checked={currentSettings.instantConfirmation}
                        onCheckedChange={(checked) => updateSetting('instantConfirmation', checked)}
                      />
                      <SettingSwitch
                        label="Guest extras"
                        checked={currentSettings.guestExtras}
                        onCheckedChange={(checked) => updateSetting('guestExtras', checked)}
                      />
                    </div>

                    <Separator />

                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="booking-url">Booking URL</Label>
                        <Input
                          id="booking-url"
                          value={currentSettings.bookingUrl}
                          onChange={(event) => updateSetting('bookingUrl', event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="promo-code">Promo Code</Label>
                        <Input
                          id="promo-code"
                          value={currentSettings.promoCode}
                          onChange={(event) => updateSetting('promoCode', event.target.value.toUpperCase())}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="booking-window">Booking Window</Label>
                        <Input
                          id="booking-window"
                          type="number"
                          min={1}
                          value={currentSettings.bookingWindowDays}
                          onChange={(event) => updateSetting('bookingWindowDays', Number(event.target.value))}
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <SliderField
                        label="Direct rate adjustment"
                        value={currentSettings.directMarkup}
                        min={-20}
                        max={20}
                        suffix="%"
                        onValueChange={(value) => updateSetting('directMarkup', value)}
                      />
                      <SliderField
                        label="Deposit"
                        value={currentSettings.depositPercent}
                        min={0}
                        max={100}
                        suffix="%"
                        onValueChange={(value) => updateSetting('depositPercent', value)}
                      />
                    </div>

                    <div className="overflow-hidden rounded-lg border">
                      <div className="grid grid-cols-[1.2fr_0.7fr_0.7fr_0.7fr] bg-muted/40 px-3 py-2 text-[11px] font-semibold uppercase text-muted-foreground">
                        <span>Room Type</span>
                        <span>Available</span>
                        <span>Base</span>
                        <span>Direct</span>
                      </div>
                      {directRates.length === 0 ? (
                        <div className="px-3 py-4 text-sm text-muted-foreground">
                          No room types configured.
                        </div>
                      ) : (
                        directRates.map(room => (
                          <button
                            key={room.type}
                            className={cn(
                              'grid w-full grid-cols-[1.2fr_0.7fr_0.7fr_0.7fr] px-3 py-3 text-left text-sm transition-colors hover:bg-muted/30',
                              selectedRoomType === room.type && 'bg-blue-50/70'
                            )}
                            onClick={() => setSelectedRoomType(room.type)}
                          >
                            <span className="font-medium">{room.type}</span>
                            <span>{room.available}</span>
                            <span>THB {room.baseRate.toLocaleString()}</span>
                            <span className="font-semibold">THB {room.directRate.toLocaleString()}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card className="rounded-lg">
                  <CardHeader>
                    <CardTitle className="text-base">Guest Booking Preview</CardTitle>
                    <CardDescription>{selectedInventory?.type || 'No room type selected'}</CardDescription>
                  </CardHeader>
                  {selectedInventory ? (
                    <CardContent className="space-y-4">
                      <div className="rounded-lg border bg-muted/20 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold">{selectedInventory.type}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {selectedInventory.available} rooms available today
                            </div>
                          </div>
                          <Badge variant="outline" className="rounded-md bg-emerald-50 text-emerald-700">
                            {selectedInventory.directShare}% direct
                          </Badge>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3">
                          <div className="rounded-md border bg-background p-3">
                            <div className="text-xs text-muted-foreground">Tonight</div>
                            <div className="text-lg font-semibold">
                              THB {Math.round(selectedInventory.baseRate * (1 + currentSettings.directMarkup / 100)).toLocaleString()}
                            </div>
                          </div>
                          <div className="rounded-md border bg-background p-3">
                            <div className="text-xs text-muted-foreground">Deposit</div>
                            <div className="text-lg font-semibold">{currentSettings.depositPercent}%</div>
                          </div>
                        </div>
                      </div>

                      <Button className="w-full" disabled>
                        Test booking requires a live booking engine
                      </Button>
                    </CardContent>
                  ) : (
                    <CardContent>
                      <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                        Configure room types before previewing direct booking inventory.
                      </div>
                    </CardContent>
                  )}
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="website" className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
                <Card className="rounded-lg">
                  <CardHeader>
                    <CardTitle className="text-base">Website Publishing</CardTitle>
                    <CardDescription>Property pages, direct booking path, and mobile readiness</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <SettingSwitch
                      label="Website published"
                      checked={currentSettings.websitePublished}
                      onCheckedChange={(checked) => updateSetting('websitePublished', checked)}
                    />
                    <SettingSwitch
                      label="Mobile alerts"
                      checked={currentSettings.mobileAlerts}
                      onCheckedChange={(checked) => updateSetting('mobileAlerts', checked)}
                    />
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">Readiness</span>
                        <span className="text-muted-foreground">{siteReadiness}%</span>
                      </div>
                      <Progress value={siteReadiness} />
                    </div>
                    <Button onClick={handlePublishWebsite} className="w-full">
                      Publish Website
                    </Button>
                  </CardContent>
                </Card>

                <Card className="rounded-lg">
                  <CardHeader>
                    <CardTitle className="text-base">Website Sections</CardTitle>
                    <CardDescription>Small-property pages wired to direct conversion</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-2 md:grid-cols-2">
                      {['Rooms', 'Offers', 'Gallery', 'Location', 'House Rules', 'Contact'].map((section, index) => (
                        <div key={section} className="flex items-center justify-between rounded-md border px-3 py-3">
                          <div>
                            <div className="text-sm font-medium">{section}</div>
                            <div className="text-xs text-muted-foreground">{index < 4 ? 'Ready' : 'Needs review'}</div>
                          </div>
                          {index < 4 ? (
                            <CheckCircle className="h-4 w-4 text-emerald-600" weight="fill" />
                          ) : (
                            <Warning className="h-4 w-4 text-amber-600" weight="fill" />
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="metasearch" className="space-y-4">
              <Card className="rounded-lg">
                <CardHeader>
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <CardTitle className="text-base">Metasearch Campaigns</CardTitle>
                      <CardDescription>Demand channels routed back to the direct booking engine</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <SettingSwitch
                        label="Campaigns"
                        checked={currentSettings.metasearchEnabled}
                        onCheckedChange={(checked) => updateSetting('metasearchEnabled', checked)}
                        compact
                      />
                      <Button size="sm" onClick={handleEnableMetasearch}>Enable</Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {campaigns.map(campaign => (
                    <div key={campaign.channel} className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1fr_0.5fr_0.5fr_0.5fr_auto] md:items-center">
                      <div>
                        <div className="text-sm font-semibold">{campaign.channel}</div>
                        <div className="text-xs text-muted-foreground">Direct booking landing path</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Spend</div>
                        <div className="text-sm font-medium">THB {campaign.spend.toLocaleString()}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Bookings</div>
                        <div className="text-sm font-medium">{campaign.bookings}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">ROAS</div>
                        <div className="text-sm font-medium">{campaign.roas.toFixed(1)}x</div>
                      </div>
                      <Badge variant="outline" className={cn('w-fit rounded-md text-[10px] capitalize', campaignClass[campaign.status])}>
                        {campaign.status}
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="marketplace" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {integrations.map(integration => {
                  const Icon = integration.icon

                  return (
                    <Card key={integration.name} className="rounded-lg py-4">
                      <CardContent className="space-y-4 px-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                            <Icon className="h-4 w-4 text-muted-foreground" weight="duotone" />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{integration.name}</div>
                            <div className="truncate text-xs text-muted-foreground">{integration.category}</div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="outline" className="rounded-md text-[10px]">
                            {integration.status}
                          </Badge>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => toast.info(`${integration.name} selected`)}>
                            Configure
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  )
}

interface MetricTileProps {
  label: string
  value: string
  detail: string
  icon: typeof Storefront
}

function MetricTile({ label, value, detail, icon: Icon }: MetricTileProps) {
  return (
    <Card className="rounded-lg py-4">
      <CardContent className="flex items-center justify-between gap-3 px-4">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
          <div className="mt-1 truncate text-xs text-muted-foreground">{detail}</div>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className="h-5 w-5 text-muted-foreground" weight="duotone" />
        </div>
      </CardContent>
    </Card>
  )
}

interface SettingSwitchProps {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  compact?: boolean
}

function SettingSwitch({ label, checked, onCheckedChange, compact = false }: SettingSwitchProps) {
  return (
    <div className={cn('flex items-center justify-between rounded-lg border bg-background px-3 py-2', compact && 'gap-2 border-0 p-0')}>
      <Label className={cn('text-sm font-medium', compact && 'text-xs')}>{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

interface SliderFieldProps {
  label: string
  value: number
  min: number
  max: number
  suffix: string
  onValueChange: (value: number) => void
}

function SliderField({ label, value, min, max, suffix, onValueChange }: SliderFieldProps) {
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between text-sm">
        <Label className="font-medium">{label}</Label>
        <span className="text-muted-foreground">
          {value}
          {suffix}
        </span>
      </div>
      <Slider
        min={min}
        max={max}
        step={1}
        value={[value]}
        onValueChange={(next) => onValueChange(next[0] ?? value)}
      />
    </div>
  )
}
