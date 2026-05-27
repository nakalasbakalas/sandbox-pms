import { Button } from '@/components/ui/button'
import { 
  CalendarBlank,
  Clock,
  Robot
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

interface QuickActionsBarProps {
  viewMode: '7day' | '14day' | '30day'
  onViewModeChange: (mode: '7day' | '14day' | '30day') => void
  filterCount: number
  automationEnabled?: boolean
  onOpenAutomation?: () => void
}

export function QuickActionsBar({ 
  viewMode, 
  onViewModeChange, 
  filterCount,
  automationEnabled,
  onOpenAutomation 
}: QuickActionsBarProps) {
  return (
    <div className="flex items-center justify-between rounded-lg px-3 py-1.5 bg-muted/40 border border-border/40">
      <div className="flex items-center gap-1">
        <div className="flex items-center bg-background rounded-md border border-border/60 p-0.5">
          {(['7day', '14day', '30day'] as const).map((mode) => (
            <Button
              key={mode}
              variant="ghost"
              size="sm"
              onClick={() => onViewModeChange(mode)}
              className={cn(
                "h-6 text-[11px] font-medium px-2.5 rounded-[5px] transition-all",
                viewMode === mode 
                  ? "bg-foreground text-background shadow-sm hover:bg-foreground hover:text-background" 
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {mode === '7day' && <CalendarBlank className="w-3 h-3 mr-1" />}
              {mode.replace('day', 'D')}
            </Button>
          ))}
        </div>

        {onOpenAutomation && (
          <>
            <div className="h-4 w-px bg-border/40 mx-1.5" />
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-6 text-[11px] gap-1.5 font-medium px-2.5 text-muted-foreground hover:text-foreground"
              onClick={onOpenAutomation}
            >
              <Robot className="w-3 h-3" />
              Automation
              {automationEnabled && (
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              )}
            </Button>
          </>
        )}
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Clock className="w-3 h-3" />
        <span className="font-medium">
          {new Date().toLocaleDateString('en-GB', { 
            weekday: 'short',
            day: '2-digit', 
            month: 'short',
            year: 'numeric',
          })}
        </span>
      </div>
    </div>
  )
}
