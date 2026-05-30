import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { CheckCircle, Broom, Prohibit, ArrowsClockwise } from '@phosphor-icons/react'
import { BoardRoomCard } from '@/types/board'

interface BulkOperationsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedRooms: BoardRoomCard[]
  onMarkAllClean: () => void
  onMarkAllDirty: () => void
  onBlockAll: () => void
  onUnblockAll: () => void
}

export function BulkOperationsDialog({
  open,
  onOpenChange,
  selectedRooms,
  onMarkAllClean,
  onMarkAllDirty,
  onBlockAll,
  onUnblockAll,
}: BulkOperationsDialogProps) {
  const dirtyRooms = selectedRooms.filter(r => r.cleanStatus === 'DIRTY')
  const cleanRooms = selectedRooms.filter(r => r.cleanStatus === 'CLEAN')
  const availableRooms = selectedRooms.filter(r => r.operationalStatus === 'AVAILABLE')
  const blockedRooms = selectedRooms.filter(r => r.operationalStatus === 'BLOCKED')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-4">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-base">Bulk Operations</DialogTitle>
          <DialogDescription className="text-xs">
            Apply actions to {selectedRooms.length} selected room{selectedRooms.length !== 1 ? 's' : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {selectedRooms.slice(0, 10).map(room => (
              <Badge key={room.roomId} variant="outline" className="text-xs px-1.5 py-0">
                {room.number}
              </Badge>
            ))}
            {selectedRooms.length > 10 && (
              <Badge variant="secondary" className="text-xs px-1.5 py-0">
                +{selectedRooms.length - 10} more
              </Badge>
            )}
          </div>

          <Separator className="my-2" />

          <div className="space-y-1.5">
            {dirtyRooms.length > 0 && (
              <Button
                className="w-full justify-start gap-1.5 h-8 text-xs"
                variant="outline"
                onClick={() => {
                  onMarkAllClean()
                  onOpenChange(false)
                }}
              >
                <Broom className="w-3.5 h-3.5" />
                Mark {dirtyRooms.length} Dirty Room{dirtyRooms.length !== 1 ? 's' : ''} as Clean
              </Button>
            )}

            {cleanRooms.length > 0 && (
              <Button
                className="w-full justify-start gap-1.5 h-8 text-xs"
                variant="outline"
                onClick={() => {
                  onMarkAllDirty()
                  onOpenChange(false)
                }}
              >
                <ArrowsClockwise className="w-3.5 h-3.5" />
                Mark {cleanRooms.length} Clean Room{cleanRooms.length !== 1 ? 's' : ''} as Dirty
              </Button>
            )}

            {availableRooms.length > 0 && (
              <Button
                className="w-full justify-start gap-1.5 h-8 text-xs"
                variant="outline"
                onClick={() => {
                  onBlockAll()
                  onOpenChange(false)
                }}
              >
                <Prohibit className="w-3.5 h-3.5" />
                Block {availableRooms.length} Room{availableRooms.length !== 1 ? 's' : ''}
              </Button>
            )}

            {blockedRooms.length > 0 && (
              <Button
                className="w-full justify-start gap-1.5 h-8 text-xs"
                variant="outline"
                onClick={() => {
                  onUnblockAll()
                  onOpenChange(false)
                }}
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Unblock {blockedRooms.length} Room{blockedRooms.length !== 1 ? 's' : ''}
              </Button>
            )}
          </div>
        </div>

        <DialogFooter className="pt-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-8 text-xs">
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
