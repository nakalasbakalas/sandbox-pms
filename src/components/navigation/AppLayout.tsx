import { SidebarProvider, SidebarTrigger, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from './AppSidebar'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Question, Command, Info } from '@phosphor-icons/react'

interface AppLayoutProps {
  children: React.ReactNode
  onOpenShortcuts?: () => void
}

export function AppLayout({ children, onOpenShortcuts }: AppLayoutProps) {
  return (
    <SidebarProvider defaultOpen={true}>
      <AppSidebar />
      <SidebarInset className="flex flex-col">
        <header className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border bg-background px-1.5">
          <SidebarTrigger className="-ml-0.5 h-5 w-5" />
          <div className="h-3 w-px bg-border/50" />
          <div className="flex-1" />
          {onOpenShortcuts && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                >
                  <Question size={12} weight="duotone" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2.5" align="end">
                <div className="space-y-2">
                  <div className="space-y-1">
                    <h4 className="text-xs font-semibold flex items-center gap-1">
                      <Info size={12} weight="duotone" className="text-primary" />
                      Quick Help
                    </h4>
                    <p className="text-[10px] text-muted-foreground">
                      Learn keyboard shortcuts
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-between h-6 text-[10px]"
                    onClick={onOpenShortcuts}
                  >
                    <span className="flex items-center gap-1">
                      <Command size={11} weight="duotone" />
                      Keyboard Shortcuts
                    </span>
                    <kbd className="pointer-events-none inline-flex h-3.5 select-none items-center gap-0.5 rounded border bg-muted px-0.5 font-mono text-[9px] font-medium text-muted-foreground">
                      ?
                    </kbd>
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </header>
        <main className="flex-1 overflow-auto bg-muted/30">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
