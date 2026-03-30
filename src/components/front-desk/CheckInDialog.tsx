import { useState } from 'react'
import type { ArrivalItem, CheckInData } from '@/types/front-desk'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CheckCircle, Warning, Bed } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { getAvailableRoomsForWalkIn } from '@/lib/mock-front-desk-data'

interface CheckInDialogProps {
  arrival: ArrivalItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (data: CheckInData) => void
}

export function CheckInDialog({ arrival, open, onOpenChange, onConfirm }: CheckInDialogProps) {
  const [selectedRoomId, setSelectedRoomId] = useState('')
  const [guestVerified, setGuestVerified] = useState(false)
  const [depositConfirmed, setDepositConfirmed] = useState(false)
  const [documentsCollected, setDocumentsCollected] = useState(false)
  const [roomConditionNoted, setRoomConditionNoted] = useState(false)
  const [welcomePackProvided, setWelcomePackProvided] = useState(false)
  const [additionalNotes, setAdditionalNotes] = useState('')

  if (!arrival) return null

  const availableRooms = arrival.roomNumber 
    ? [{ id: 'assigned', number: arrival.roomNumber }]
    : getAvailableRoomsForWalkIn(arrival.roomType)

  const allChecksComplete = guestVerified && depositConfirmed && documentsCollected && 
                            roomConditionNoted && welcomePackProvided

  const handleSubmit = () => {
    if (!allChecksComplete) {
      toast.error('Please complete all checks before check-in')
      return
    }

    const roomId = arrival.roomNumber ? 'assigned-room-id' : selectedRoomId
    if (!roomId) {
      toast.error('Please select a room')
      return
    }

    const checkInData: CheckInData = {
      reservationId: arrival.reservationId,
      roomId,
      actualCheckIn: new Date(),
      guestVerified,
      depositConfirmed,
      documentsCollected,
      roomConditionNoted,
      welcomePackProvided,
      additionalNotes: additionalNotes || undefined,
    }

    onConfirm(checkInData)
    resetForm()
  }

  const resetForm = () => {
    setSelectedRoomId('')
    setGuestVerified(false)
    setDepositConfirmed(false)
    setDocumentsCollected(false)
    setRoomConditionNoted(false)
    setWelcomePackProvided(false)
    setAdditionalNotes('')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { 
      if (!o) resetForm() 
      onOpenChange(o)
    }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <CheckCircle className="text-blue-600" weight="duotone" size={24} />
            Check In Guest
          </DialogTitle>
          <DialogDescription>
            Complete the check-in process for {arrival.guestName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Guest:</span>
                <p className="font-semibold">{arrival.guestName}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Reservation ID:</span>
                <p className="font-mono text-xs">{arrival.reservationId}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Room Type:</span>
                <p className="font-semibold">{arrival.roomType}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Nights:</span>
                <p className="font-semibold">{arrival.nights} nights</p>
              </div>
              <div>
                <span className="text-muted-foreground">Total Amount:</span>
                <p className="font-semibold">฿{arrival.totalAmount.toLocaleString()}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Source:</span>
                <p className="font-semibold">{arrival.source}</p>
              </div>
            </div>
          </div>

          {!arrival.roomNumber && (
            <div className="space-y-2">
              <Label htmlFor="room-select" className="flex items-center gap-2">
                <Bed size={16} weight="bold" />
                Assign Room
              </Label>
              <Select value={selectedRoomId} onValueChange={setSelectedRoomId}>
                <SelectTrigger id="room-select">
                  <SelectValue placeholder="Select an available room" />
                </SelectTrigger>
                <SelectContent>
                  {availableRooms.map(room => (
                    <SelectItem key={room.id} value={room.id}>
                      Room {room.number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-3">
            <Label className="text-base font-semibold">Check-in Checklist</Label>
            
            <div className="space-y-3 pl-1">
              <div className="flex items-start gap-3">
                <Checkbox 
                  id="guest-verified" 
                  checked={guestVerified}
                  onCheckedChange={(checked) => setGuestVerified(checked as boolean)}
                />
                <div className="flex-1">
                  <label htmlFor="guest-verified" className="text-sm font-medium cursor-pointer">
                    Guest identity verified
                  </label>
                  <p className="text-xs text-muted-foreground">ID or passport checked and recorded</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Checkbox 
                  id="deposit-confirmed" 
                  checked={depositConfirmed}
                  onCheckedChange={(checked) => setDepositConfirmed(checked as boolean)}
                />
                <div className="flex-1">
                  <label htmlFor="deposit-confirmed" className="text-sm font-medium cursor-pointer">
                    Deposit payment confirmed
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {arrival.depositPaid ? 'Pre-paid deposit verified' : 'Deposit collected and recorded'}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Checkbox 
                  id="documents-collected" 
                  checked={documentsCollected}
                  onCheckedChange={(checked) => setDocumentsCollected(checked as boolean)}
                />
                <div className="flex-1">
                  <label htmlFor="documents-collected" className="text-sm font-medium cursor-pointer">
                    Documents collected
                  </label>
                  <p className="text-xs text-muted-foreground">Registration form signed, policies acknowledged</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Checkbox 
                  id="room-condition" 
                  checked={roomConditionNoted}
                  onCheckedChange={(checked) => setRoomConditionNoted(checked as boolean)}
                />
                <div className="flex-1">
                  <label htmlFor="room-condition" className="text-sm font-medium cursor-pointer">
                    Room condition noted
                  </label>
                  <p className="text-xs text-muted-foreground">Initial room state verified and clean</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Checkbox 
                  id="welcome-pack" 
                  checked={welcomePackProvided}
                  onCheckedChange={(checked) => setWelcomePackProvided(checked as boolean)}
                />
                <div className="flex-1">
                  <label htmlFor="welcome-pack" className="text-sm font-medium cursor-pointer">
                    Welcome pack provided
                  </label>
                  <p className="text-xs text-muted-foreground">Keys, Wi-Fi details, hotel information given</p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Additional Notes (Optional)</Label>
            <Textarea
              id="notes"
              placeholder="Any special notes about the check-in..."
              value={additionalNotes}
              onChange={(e) => setAdditionalNotes(e.target.value)}
              rows={3}
            />
          </div>

          {!allChecksComplete && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <Warning className="text-amber-600 flex-shrink-0 mt-0.5" size={18} weight="bold" />
              <p className="text-sm text-amber-800">
                Please complete all checklist items to proceed with check-in
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button 
            variant="outline" 
            onClick={() => {
              resetForm()
              onOpenChange(false)
            }}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={!allChecksComplete}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <CheckCircle className="mr-2" size={18} weight="bold" />
            Complete Check-In
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
