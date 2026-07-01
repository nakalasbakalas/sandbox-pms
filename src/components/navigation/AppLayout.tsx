import { SidebarProvider, SidebarTrigger, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from './AppSidebar'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Question, Command, Info } from '@phosphor-icons/react'
import { DensityToggle } from './DensityToggle'
import { UserProfileMenu } from './UserProfileMenu'
import { LanguageSwitcher } from './LanguageSwitcher'
import { FrontDeskAssistantButton } from '@/components/front-desk-assistant/FrontDeskAssistantButton'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { useNavigation } from '@/hooks/use-navigation'
import { cn } from '@/lib/utils'

interface AppLayoutProps {
  children: React.ReactNode
  onOpenShortcuts?: () => void
}

export function AppLayout({ children, onOpenShortcuts }: AppLayoutProps) {
  const { currentRoute } = useNavigation()
  const hideTopHeader = currentRoute === 'board'

  return (
    <SidebarProvider defaultOpen={true}>
      <AppSidebar />
      <SidebarInset className="flex flex-col">
        {!hideTopHeader && (
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/40 bg-background px-3">
            <SidebarTrigger className="-ml-1 h-8 w-8" />
            <div className="h-5 w-px bg-border/40" />
            <div className="flex-1" />
            <FrontDeskAssistantButton />
            <div className="h-5 w-px bg-border/40" />
            <UserProfileMenu />
            <div className="h-5 w-px bg-border/40" />
            <NotificationBell />
            <div className="h-5 w-px bg-border/40" />
            <LanguageSwitcher />
            <div className="h-5 w-px bg-border/40" />
            <DensityToggle />
            <div className="h-5 w-px bg-border/40" />
            {onOpenShortcuts && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Open help"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                  >
                    <Question size={16} weight="duotone" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-3" align="end">
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <h4 className="text-sm font-semibold flex items-center gap-2">
                        <Info size={16} weight="duotone" className="text-primary" />
                        Quick Help
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        Learn keyboard shortcuts
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-between h-8 text-xs"
                      onClick={onOpenShortcuts}
                    >
                      <span className="flex items-center gap-2">
                        <Command size={14} weight="duotone" />
                        Keyboard Shortcuts
                      </span>
                      <kbd className="pointer-events-none inline-flex h-5 select-none items-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                        ?
                      </kbd>
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </header>
        )}
        <main className={cn("flex-1 overflow-auto bg-muted/20", hideTopHeader && "bg-background")}>
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
