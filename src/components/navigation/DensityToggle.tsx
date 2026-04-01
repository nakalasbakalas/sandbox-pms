import { Button } from '@/components/ui/button'
import { SquaresFour, ListBullets } from '@phosphor-icons/react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useDensity } from '@/hooks/use-density'
import { motion, AnimatePresence } from 'framer-motion'

export function DensityToggle() {
  const { density, toggleDensity } = useDensity()

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground relative overflow-hidden"
            onClick={toggleDensity}
          >
            <AnimatePresence mode="wait" initial={false}>
              {density === 'compact' ? (
                <motion.div
                  key="compact"
                  initial={{ scale: 0.5, opacity: 0, rotate: -90 }}
                  animate={{ scale: 1, opacity: 1, rotate: 0 }}
                  exit={{ scale: 0.5, opacity: 0, rotate: 90 }}
                  transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                >
                  <ListBullets size={12} weight="duotone" />
                </motion.div>
              ) : (
                <motion.div
                  key="comfortable"
                  initial={{ scale: 0.5, opacity: 0, rotate: -90 }}
                  animate={{ scale: 1, opacity: 1, rotate: 0 }}
                  exit={{ scale: 0.5, opacity: 0, rotate: 90 }}
                  transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                >
                  <SquaresFour size={12} weight="duotone" />
                </motion.div>
              )}
            </AnimatePresence>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-[10px] px-1.5 py-0.5">
          {density === 'compact' ? 'Switch to Comfortable' : 'Switch to Compact'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
