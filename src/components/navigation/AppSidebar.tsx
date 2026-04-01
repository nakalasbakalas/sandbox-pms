import { 
  SquaresFour, 
  House, 
  CalendarBlank, 
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
} from '@phosphor-icons/react'
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
import { PermissionGate } from '@/components/auth/PermissionGate'

const primaryNavItems = [
  { id: 'board', label: 'Board', icon: SquaresFour, permission: 'view:board' as const },
  { id: 'front-desk', label: 'Front Desk', icon: House, anyOf: ['view:board', 'create:reservation'] as const },
  { id: 'reservations', label: 'Reservations', icon: CalendarBlank, permission: 'view:reservations' as const },
  { id: 'guests', label: 'Guests', icon: Users, permission: 'view:guests' as const },
  { id: 'housekeeping', label: 'Housekeeping', icon: Broom, permission: 'view:housekeeping' as const },
  { id: 'cashier', label: 'Cashier', icon: CurrencyDollar, permission: 'view:cashier' as const },
  { id: 'rates', label: 'Rates', icon: Receipt, permission: 'view:rates' as const },
  { id: 'channels', label: 'Channels', icon: Broadcast, permission: 'view:channels' as const },
  { id: 'reports', label: 'Reports', icon: ChartBar, permission: 'view:reports' as const },
  { id: 'settings', label: 'Settings', icon: Gear, permission: 'view:settings' as const },
]

const communicationItems = [
  { id: 'messaging', label: 'Guest Messaging', icon: ChatCircle, permission: 'view:messaging' as const },
  { id: 'internal-comms', label: 'Staff Comms', icon: ChatCenteredDots, permission: 'view:messaging' as const },
  { id: 'guest-communications', label: 'Guest Comms', icon: Envelope, permission: 'view:messaging' as const },
]

const operationsItems = [
  { id: 'night-audit', label: 'Night Audit', icon: Moon, permission: 'view:night-audit' as const },
  { id: 'revenue-analytics', label: 'Revenue Analytics', icon: ChartLine, permission: 'view:analytics' as const },
  { id: 'predictive-analytics', label: 'Predictive Analytics', icon: Brain, permission: 'view:analytics' as const },
]

const adminItems = [
  { id: 'user-management', label: 'User Management', icon: Shield, permission: 'manage:users' as const },
]

export function AppSidebar() {
  const { currentRoute, navigate } = useNavigation()
  const { hasPermission, hasAnyPermission } = useAuth()

  const canViewItem = (item: typeof primaryNavItems[0]) => {
    if (item.permission) {
      return hasPermission(item.permission)
    }
    if (item.anyOf) {
      return hasAnyPermission(item.anyOf as any)
    }
    return true
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-6 rounded bg-primary flex items-center justify-center flex-shrink-0">
            <SquaresFour className="w-3.5 h-3.5 text-primary-foreground" weight="bold" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[11px] font-semibold text-sidebar-foreground truncate leading-tight">Sandbox Hotel</span>
            <span className="text-[9px] text-sidebar-foreground/50 truncate">PMS</span>
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
                    onClick={() => navigate(item.id as any)}
                    tooltip={item.label}
                    className="h-7 text-[11px]"
                  >
                    <item.icon className="w-3 h-3" weight={currentRoute === item.id ? 'fill' : 'regular'} />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {communicationItems.some(canViewItem) && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[9px] text-sidebar-foreground/50 py-1">
              Communications
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {communicationItems.filter(canViewItem).map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={currentRoute === item.id}
                      onClick={() => navigate(item.id as any)}
                      tooltip={item.label}
                      className="h-7 text-[11px]"
                    >
                      <item.icon className="w-3 h-3" weight={currentRoute === item.id ? 'fill' : 'regular'} />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {operationsItems.some(canViewItem) && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[9px] text-sidebar-foreground/50 py-1">
              Operations
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {operationsItems.filter(canViewItem).map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={currentRoute === item.id}
                      onClick={() => navigate(item.id as any)}
                      tooltip={item.label}
                      className="h-7 text-[11px]"
                    >
                      <item.icon className="w-3.5 h-3.5" weight={currentRoute === item.id ? 'fill' : 'regular'} />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {adminItems.some(canViewItem) && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[9px] text-sidebar-foreground/50 py-1">
              Administration
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.filter(canViewItem).map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={currentRoute === item.id}
                      onClick={() => navigate(item.id as any)}
                      tooltip={item.label}
                      className="h-7 text-[11px]"
                    >
                      <item.icon className="w-3.5 h-3.5" weight={currentRoute === item.id ? 'fill' : 'regular'} />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <div className="text-[10px] text-sidebar-foreground/30 text-center font-medium">
          v1.0.0
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
