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

const primaryNavItems = [
  { id: 'board', label: 'Board', icon: SquaresFour },
  { id: 'front-desk', label: 'Front Desk', icon: House },
  { id: 'reservations', label: 'Reservations', icon: CalendarBlank },
  { id: 'guests', label: 'Guests', icon: Users },
  { id: 'housekeeping', label: 'Housekeeping', icon: Broom },
  { id: 'cashier', label: 'Cashier', icon: CurrencyDollar },
  { id: 'rates', label: 'Rates', icon: Receipt },
  { id: 'channels', label: 'Channels', icon: Broadcast },
  { id: 'reports', label: 'Reports', icon: ChartBar },
  { id: 'settings', label: 'Settings', icon: Gear },
]

const communicationItems = [
  { id: 'messaging', label: 'Guest Messaging', icon: ChatCircle },
  { id: 'internal-comms', label: 'Staff Comms', icon: ChatCenteredDots },
  { id: 'guest-communications', label: 'Guest Comms', icon: Envelope },
]

const operationsItems = [
  { id: 'night-audit', label: 'Night Audit', icon: Moon },
  { id: 'revenue-analytics', label: 'Revenue Analytics', icon: ChartLine },
  { id: 'predictive-analytics', label: 'Predictive Analytics', icon: Brain },
]

export function AppSidebar() {
  const { currentRoute, navigate } = useNavigation()

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
              {primaryNavItems.map((item) => (
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

        <SidebarGroup>
          <SidebarGroupLabel className="text-[9px] text-sidebar-foreground/50 py-1">
            Communications
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {communicationItems.map((item) => (
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

        <SidebarGroup>
          <SidebarGroupLabel className="text-[9px] text-sidebar-foreground/50 py-1">
            Operations
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {operationsItems.map((item) => (
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
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <div className="text-[10px] text-sidebar-foreground/30 text-center font-medium">
          v1.0.0
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
