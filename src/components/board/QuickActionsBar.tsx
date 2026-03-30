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
    <div className="flex items-center justify-between bg-gradient-to-r from-muted/40 to-muted/20 rounded-xl px-4 py-3 border border-border shadow-sm">
      <div className="flex items-center gap-2">
        <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mr-2">
          View
        </div>
        <Button
          variant={viewMode === '7day' ? 'default' : 'outline'}
          size="sm"
          onClick={() => onViewModeChange('7day')}
          className={cn(
            "h-8 text-xs font-bold transition-all px-3 shadow-sm",
            viewMode === '7day' && "shadow-md"
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
            "h-8 text-xs font-bold transition-all px-3 shadow-sm",
            viewMode === '14day' && "shadow-md"
          )}
        >
          14 Days
        </Button>
        <Button
          variant={viewMode === '30day' ? 'default' : 'outline'}
          size="sm"
          onClick={() => onViewModeChange('30day')}
          className={cn(
            "h-8 text-xs font-bold transition-all px-3 shadow-sm",
            viewMode === '30day' && "shadow-md"
          )}
        >
          30 Days
        </Button>

        <div className="h-5 w-px bg-border mx-2" />

        <Button variant="outline" size="sm" className="h-8 text-xs gap-2 font-bold hover:bg-accent px-3 shadow-sm">
          <FunnelSimple className="w-3.5 h-3.5" />
          Filters
          {filterCount > 0 && (
            <Badge variant="default" className="h-4 min-w-4 px-1.5 flex items-center justify-center text-[10px] ml-0 font-bold">
              {filterCount}
            </Badge>
          )}
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-background/50 px-3 py-1.5 rounded-lg border border-border/50">
          <Clock className="w-3.5 h-3.5" />
          <span className="font-bold text-[11px]">
            {new Date().toLocaleDateString('en-GB', { 
              day: '2-digit', 
              month: 'short',
              year: 'numeric'
            })}
          </span>
        </div>
        
        <div className="h-5 w-px bg-border" />

        <div className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
          <kbd className="inline-flex items-center gap-0.5 rounded border bg-background px-2 py-1 font-mono text-[10px] font-bold text-muted-foreground shadow-sm">
            <span className="text-[11px]">⌘</span>1/2/3
          </kbd>
          <span className="text-[11px]">Switch views</span>
        </div>
      </div>
    </div>
  )
}
