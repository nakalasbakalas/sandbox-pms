import { 
  SquaresFour, 
  House, 
  CalendarBlank, 
  CalendarCheck,
  Bed,
  Users, 
  Broom, 
  CurrencyDollar, 
  Receipt, 
  Broadcast, 
  ChartBar, 
  Gear,
  ChatCircle,
  ChatCenteredDots,
  Envelope,
  Moon,
  ChartLine,
  Brain,
  Shield,
  Storefront,
} from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from '@/components/ui/sidebar'
import { useNavigation } from '@/hooks/use-navigation'
import { useAuth } from '@/hooks/use-auth'
import { useI18n } from '@/lib/i18n'
import type { Permission } from '@/types/auth'
import type { NavigationRoute } from '@/types/navigation'
import { useKV } from '@github/spark/hooks'
import type { PropertySetup } from '@/types/onboarding'

type NavItem = {
  id: NavigationRoute
  labelKey: Parameters<ReturnType<typeof useI18n>['t']>[0]
  icon: Icon
  permission?: Permission
  anyOf?: readonly Permission[]
}

const primaryNavItems: readonly NavItem[] = [
  { id: 'today', labelKey: 'nav.today', icon: CalendarCheck, anyOf: ['view:board', 'create:reservation', 'view:housekeeping'] as const },
  { id: 'reservations', labelKey: 'nav.reservations', icon: CalendarBlank, permission: 'view:reservations' as const },
  { id: 'booking-inbox', labelKey: 'nav.bookingInbox', icon: Envelope, anyOf: ['view:reservations', 'view:messaging'] as const },
  { id: 'front-desk', labelKey: 'nav.frontDeskBoard', icon: SquaresFour, anyOf: ['view:board', 'check-in:guest', 'check-out:guest'] as const },
  { id: 'rooms', labelKey: 'nav.rooms', icon: Bed, anyOf: ['view:board', 'view:housekeeping'] as const },
  { id: 'housekeeping', labelKey: 'nav.housekeeping', icon: Broom, permission: 'view:housekeeping' as const },
  { id: 'guests', labelKey: 'nav.guests', icon: Users, permission: 'view:guests' as const },
  { id: 'cashier', labelKey: 'nav.payments', icon: CurrencyDollar, permission: 'view:cashier' as const },
  { id: 'reports', labelKey: 'nav.reports', icon: ChartBar, permission: 'view:reports' as const },
  { id: 'settings', labelKey: 'nav.settings', icon: Gear, permission: 'view:settings' as const },
]

const revenueItems: readonly NavItem[] = [
  { id: 'rates', labelKey: 'nav.rates', icon: Receipt, permission: 'view:rates' as const },
  { id: 'channels', labelKey: 'nav.channels', icon: Broadcast, permission: 'view:channels' as const },
  { id: 'growth-suite', labelKey: 'nav.directBooking', icon: Storefront, anyOf: ['view:channels', 'view:rates', 'view:analytics'] as const },
]

const communicationItems: readonly NavItem[] = [
  { id: 'messaging', labelKey: 'nav.messaging', icon: ChatCircle, permission: 'view:messaging' as const },
  { id: 'internal-comms', labelKey: 'nav.staffComms', icon: ChatCenteredDots, permission: 'view:messaging' as const },
  { id: 'guest-communications', labelKey: 'nav.guestComms', icon: Envelope, permission: 'view:messaging' as const },
]

const operationsItems: readonly NavItem[] = [
  { id: 'night-audit', labelKey: 'nav.nightAudit', icon: Moon, permission: 'view:night-audit' as const },
  { id: 'revenue-analytics', labelKey: 'nav.revenueAnalytics', icon: ChartLine, permission: 'view:analytics' as const },
  { id: 'predictive-analytics', labelKey: 'nav.predictiveAnalytics', icon: Brain, permission: 'view:analytics' as const },
]

const hotelOpsItems: readonly NavItem[] = [
  { id: 'ops-chat', labelKey: 'nav.opsChat', icon: Brain, permission: 'create:ops-task' as const },
  { id: 'ops-approvals', labelKey: 'nav.opsApprovals', icon: Shield, permission: 'approve:ops-task' as const },
  { id: 'ops-tasks', labelKey: 'nav.opsTasks', icon: Receipt, permission: 'view:ops' as const },
  { id: 'ops-intelligence', labelKey: 'nav.opsIntelligence', icon: ChartLine, permission: 'view:ops' as const },
  { id: 'ops-settings', labelKey: 'nav.opsSettings', icon: Gear, permission: 'manage:ops-settings' as const },
]

const adminItems: readonly NavItem[] = [
  { id: 'user-management', labelKey: 'nav.userManagement', icon: Shield, permission: 'manage:users' as const },
]

export function AppSidebar() {
  const { currentRoute, navigate } = useNavigation()
  const { hasPermission, hasAnyPermission } = useAuth()
  const { t } = useI18n()
  const [propertyData] = useKV<PropertySetup>('onboarding-property', {} as PropertySetup)
  const propertyName = propertyData?.name || 'Hotel PMS'

  const canViewItem = (item: NavItem) => {
    if (item.permission) {
      return hasPermission(item.permission)
    }
    if (item.anyOf) {
      return hasAnyPermission([...item.anyOf])
    }
    return true
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border/50 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
            <SquaresFour className="w-4 h-4 text-primary-foreground" weight="bold" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold text-sidebar-foreground truncate leading-tight">{propertyName}</span>
            <span className="text-[10px] text-sidebar-foreground/50 truncate">Property Management</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {primaryNavItems.filter(canViewItem).map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={currentRoute === item.id}
                    onClick={() => navigate(item.id)}
                    tooltip={t(item.labelKey)}
                    className="h-8 text-xs"
                  >
                    <item.icon className="w-3.5 h-3.5" weight={currentRoute === item.id ? 'fill' : 'regular'} />
                    <span>{t(item.labelKey)}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {revenueItems.some(canViewItem) && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] text-sidebar-foreground/50 py-1 tracking-wide">
              {t('nav.revenueDistribution')}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {revenueItems.filter(canViewItem).map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={currentRoute === item.id}
                      onClick={() => navigate(item.id)}
                      tooltip={t(item.labelKey)}
                      className="h-8 text-xs"
                    >
                      <item.icon className="w-3.5 h-3.5" weight={currentRoute === item.id ? 'fill' : 'regular'} />
                      <span>{t(item.labelKey)}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {communicationItems.some(canViewItem) && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] text-sidebar-foreground/50 py-1 tracking-wide">
              {t('nav.communications')}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {communicationItems.filter(canViewItem).map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={currentRoute === item.id}
                      onClick={() => navigate(item.id)}
                      tooltip={t(item.labelKey)}
                      className="h-8 text-xs"
                    >
                      <item.icon className="w-3.5 h-3.5" weight={currentRoute === item.id ? 'fill' : 'regular'} />
                      <span>{t(item.labelKey)}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {operationsItems.some(canViewItem) && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] text-sidebar-foreground/50 py-1 tracking-wide">
              {t('nav.operationsTools')}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {operationsItems.filter(canViewItem).map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={currentRoute === item.id}
                      onClick={() => navigate(item.id)}
                      tooltip={t(item.labelKey)}
                      className="h-8 text-xs"
                    >
                      <item.icon className="w-3.5 h-3.5" weight={currentRoute === item.id ? 'fill' : 'regular'} />
                      <span>{t(item.labelKey)}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {hotelOpsItems.some(canViewItem) && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] text-sidebar-foreground/50 py-1 tracking-wide">
              Hotel Ops AI
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {hotelOpsItems.filter(canViewItem).map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={currentRoute === item.id}
                      onClick={() => navigate(item.id)}
                      tooltip={t(item.labelKey)}
                      className="h-8 text-xs"
                    >
                      <item.icon className="w-3.5 h-3.5" weight={currentRoute === item.id ? 'fill' : 'regular'} />
                      <span>{t(item.labelKey)}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {adminItems.some(canViewItem) && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] text-sidebar-foreground/50 py-1 tracking-wide">
              {t('nav.administration')}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.filter(canViewItem).map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={currentRoute === item.id}
                      onClick={() => navigate(item.id)}
                      tooltip={t(item.labelKey)}
                      className="h-8 text-xs"
                    >
                      <item.icon className="w-3.5 h-3.5" weight={currentRoute === item.id ? 'fill' : 'regular'} />
                      <span>{t(item.labelKey)}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/40 p-3">
        <div className="text-[10px] text-sidebar-foreground/25 text-center">
          v1.0.0
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
