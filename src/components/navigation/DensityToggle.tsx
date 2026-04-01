import { Button } from '@/components/ui/button'
import { SquaresFour, ListBullets } from '@phosphor-icons/react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useDensity } from '@/hooks/use-density'

export function DensityToggle() {
  const { density, toggleDensity } = useDensity()

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
            onClick={toggleDensity}
          >
            {density === 'compact' ? (
              <ListBullets size={12} weight="duotone" />
            ) : (
              <SquaresFour size={12} weight="duotone" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-[10px] px-1.5 py-0.5">
          {density === 'compact' ? 'Switch to Comfortable' : 'Switch to Compact'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
