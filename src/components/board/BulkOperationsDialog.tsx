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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk Operations</DialogTitle>
          <DialogDescription>
            Apply actions to {selectedRooms.length} selected room{selectedRooms.length !== 1 ? 's' : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            {selectedRooms.slice(0, 10).map(room => (
              <Badge key={room.roomId} variant="outline">
                {room.number}
              </Badge>
            ))}
            {selectedRooms.length > 10 && (
              <Badge variant="secondary">
                +{selectedRooms.length - 10} more
              </Badge>
            )}
          </div>

          <Separator />

          <div className="space-y-2">
            {dirtyRooms.length > 0 && (
              <Button
                className="w-full justify-start gap-2"
                variant="outline"
                onClick={() => {
                  onMarkAllClean()
                  onOpenChange(false)
                }}
              >
                <Broom className="w-4 h-4" />
                Mark {dirtyRooms.length} Dirty Room{dirtyRooms.length !== 1 ? 's' : ''} as Clean
              </Button>
            )}

            {cleanRooms.length > 0 && (
              <Button
                className="w-full justify-start gap-2"
                variant="outline"
                onClick={() => {
                  onMarkAllDirty()
                  onOpenChange(false)
                }}
              >
                <ArrowsClockwise className="w-4 h-4" />
                Mark {cleanRooms.length} Clean Room{cleanRooms.length !== 1 ? 's' : ''} as Dirty
              </Button>
            )}

            {availableRooms.length > 0 && (
              <Button
                className="w-full justify-start gap-2"
                variant="outline"
                onClick={() => {
                  onBlockAll()
                  onOpenChange(false)
                }}
              >
                <Prohibit className="w-4 h-4" />
                Block {availableRooms.length} Room{availableRooms.length !== 1 ? 's' : ''}
              </Button>
            )}

            {blockedRooms.length > 0 && (
              <Button
                className="w-full justify-start gap-2"
                variant="outline"
                onClick={() => {
                  onUnblockAll()
                  onOpenChange(false)
                }}
              >
                <CheckCircle className="w-4 h-4" />
                Unblock {blockedRooms.length} Room{blockedRooms.length !== 1 ? 's' : ''}
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
