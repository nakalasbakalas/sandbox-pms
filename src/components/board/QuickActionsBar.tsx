import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  FunnelSimple, 
  CalendarBlank,
  Clock,
  Info
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

interface QuickActionsBarProps {
  viewMode: '7day' | '14day' | '30day'
  onViewModeChange: (mode: '7day' | '14day' | '30day') => void
  filterCount: number
}

export function QuickActionsBar({ viewMode, onViewModeChange, filterCount }: QuickActionsBarProps) {
  return (
    <div className="flex items-center justify-between bg-muted/30 rounded-lg px-4 py-2.5 border border-border">
      <div className="flex items-center gap-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mr-2">
          View Mode
        </div>
        <Button
          variant={viewMode === '7day' ? 'default' : 'outline'}
          size="sm"
          onClick={() => onViewModeChange('7day')}
          className={cn(
            "h-8 text-xs font-semibold transition-all",
            viewMode === '7day' && "shadow-sm"
          )}
        >
          <CalendarBlank className="w-3.5 h-3.5 mr-1.5" />
          7 Days
        </Button>
        <Button
          variant={viewMode === '14day' ? 'default' : 'outline'}
          size="sm"
          onClick={() => onViewModeChange('14day')}
          className={cn(
            "h-8 text-xs font-semibold transition-all",
            viewMode === '14day' && "shadow-sm"
          )}
        >
          14 Days
        </Button>
        <Button
          variant={viewMode === '30day' ? 'default' : 'outline'}
          size="sm"
          onClick={() => onViewModeChange('30day')}
          className={cn(
            "h-8 text-xs font-semibold transition-all",
            viewMode === '30day' && "shadow-sm"
          )}
        >
          30 Days
        </Button>

        <div className="h-5 w-px bg-border mx-2" />

        <Button variant="outline" size="sm" className="h-8 text-xs gap-2 font-semibold hover:bg-accent">
          <FunnelSimple className="w-3.5 h-3.5" />
          Filters
          {filterCount > 0 && (
            <Badge variant="default" className="h-4 min-w-4 px-1 flex items-center justify-center text-[10px] ml-0.5">
              {filterCount}
            </Badge>
          )}
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="w-4 h-4" />
          <span className="font-medium">
            Today: {new Date().toLocaleDateString('en-GB', { 
              day: '2-digit', 
              month: 'short',
              year: 'numeric'
            })}
          </span>
        </div>
        
        <div className="h-5 w-px bg-border" />

        <div className="text-xs font-medium text-muted-foreground">
          <kbd className="inline-flex items-center gap-1 rounded border bg-background px-2 py-1 font-mono text-[10px] font-semibold text-muted-foreground">
            <span className="text-xs">⌘</span>1/2/3
          </kbd>
          <span className="ml-2">Switch views</span>
        </div>
      </div>
    </div>
  )
}
