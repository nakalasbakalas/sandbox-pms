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
    <div className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2 border border-border">
      <div className="flex items-center gap-1.5">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mr-1.5">
          View
        </div>
        <Button
          variant={viewMode === '7day' ? 'default' : 'outline'}
          size="sm"
          onClick={() => onViewModeChange('7day')}
          className={cn(
            "h-7 text-xs font-semibold transition-all px-2.5",
            viewMode === '7day' && "shadow-sm"
          )}
        >
          <CalendarBlank className="w-3 h-3 mr-1" />
          7d
        </Button>
        <Button
          variant={viewMode === '14day' ? 'default' : 'outline'}
          size="sm"
          onClick={() => onViewModeChange('14day')}
          className={cn(
            "h-7 text-xs font-semibold transition-all px-2.5",
            viewMode === '14day' && "shadow-sm"
          )}
        >
          14d
        </Button>
        <Button
          variant={viewMode === '30day' ? 'default' : 'outline'}
          size="sm"
          onClick={() => onViewModeChange('30day')}
          className={cn(
            "h-7 text-xs font-semibold transition-all px-2.5",
            viewMode === '30day' && "shadow-sm"
          )}
        >
          30d
        </Button>

        <div className="h-4 w-px bg-border mx-1.5" />

        <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 font-semibold hover:bg-accent px-2.5">
          <FunnelSimple className="w-3 h-3" />
          Filters
          {filterCount > 0 && (
            <Badge variant="default" className="h-3.5 min-w-3.5 px-1 flex items-center justify-center text-[9px] ml-0">
              {filterCount}
            </Badge>
          )}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="w-3.5 h-3.5" />
          <span className="font-medium text-[11px]">
            {new Date().toLocaleDateString('en-GB', { 
              day: '2-digit', 
              month: 'short',
              year: 'numeric'
            })}
          </span>
        </div>
        
        <div className="h-4 w-px bg-border" />

        <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <kbd className="inline-flex items-center gap-0.5 rounded border bg-background px-1.5 py-0.5 font-mono text-[9px] font-semibold text-muted-foreground">
            <span className="text-[10px]">⌘</span>1/2/3
          </kbd>
          <span className="text-[10px]">Switch views</span>
        </div>
      </div>
    </div>
  )
}
