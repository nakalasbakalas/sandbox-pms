import { useState, useEffect } from 'react'
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
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CheckCircle, Warning, Bed, IdentificationCard } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { getAvailableRoomsForWalkIn } from '@/lib/mock-front-desk-data'
import { PaymentCollection, type PaymentData } from './PaymentCollection'
import { Separator } from '@/components/ui/separator'

interface CheckInDialogProps {
  arrival: ArrivalItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (data: CheckInData) => void
}

export function CheckInDialog({ arrival, open, onOpenChange, onConfirm }: CheckInDialogProps) {
  const [selectedRoomId, setSelectedRoomId] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [nationality, setNationality] = useState('')
  const [additionalNotes, setAdditionalNotes] = useState('')
  const [autoChecklist, setAutoChecklist] = useState({
    documents: false,
    welcomePack: false,
    roomReady: false
  })
  
  const [depositPayment, setDepositPayment] = useState<PaymentData>({
    method: 'CARD',
    amount: 0,
    reference: '',
    confirmed: false
  })

  useEffect(() => {
    if (open && arrival) {
      setAutoChecklist({
        documents: true,
        welcomePack: true,
        roomReady: true
      })
    }
  }, [open, arrival])

  if (!arrival) return null

  const availableRooms = arrival.roomNumber 
    ? [{ id: 'assigned', number: arrival.roomNumber }]
    : getAvailableRoomsForWalkIn(arrival.roomType)

  const depositDue = arrival.depositPaid ? 0 : (arrival.totalAmount * 0.3)
  
  const hasIdInfo = idNumber.trim().length >= 5 && nationality.trim().length >= 2
  const depositComplete = depositDue === 0 || (depositPayment.confirmed && depositPayment.amount >= depositDue)
  const allChecksComplete = hasIdInfo && depositComplete && autoChecklist.documents && autoChecklist.welcomePack && autoChecklist.roomReady

  const handleSubmit = () => {
    const roomId = arrival.roomNumber ? 'assigned-room-id' : selectedRoomId
    if (!roomId && !arrival.roomNumber) {
      toast.error('Please select a room')
      return
    }

    const checkInData: CheckInData = {
      reservationId: arrival.reservationId,
      roomId: roomId || 'assigned-room-id',
      actualCheckIn: new Date(),
      guestVerified: true,
      depositConfirmed: depositComplete,
      documentsCollected: autoChecklist.documents,
      roomConditionNoted: autoChecklist.roomReady,
      welcomePackProvided: autoChecklist.welcomePack,
      additionalNotes: additionalNotes || undefined,
    }

    onConfirm(checkInData)
    resetForm()
  }

  const resetForm = () => {
    setSelectedRoomId('')
    setIdNumber('')
    setNationality('')
    setAdditionalNotes('')
    setAutoChecklist({
      documents: false,
      welcomePack: false,
      roomReady: false
    })
    setDepositPayment({
      method: 'CARD',
      amount: 0,
      reference: '',
      confirmed: false
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { 
      if (!o) resetForm() 
      onOpenChange(o)
    }}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <CheckCircle className="text-blue-600" weight="duotone" size={22} />
            Check In: {arrival.guestName}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Room {arrival.roomNumber || 'TBD'} • {arrival.nights} nights • ฿{arrival.totalAmount.toLocaleString()}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {!arrival.roomNumber && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="room-select" className="flex items-center gap-1.5 text-xs">
                  <Bed size={14} weight="bold" />
                  Assign Room
                </Label>
                <Select value={selectedRoomId} onValueChange={setSelectedRoomId}>
                  <SelectTrigger id="room-select" className="h-9">
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
              <Separator />
            </>
          )}

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5 text-xs font-semibold">
              <IdentificationCard size={14} weight="bold" />
              Guest Verification
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="id-number" className="text-xs">ID/Passport Number *</Label>
                <Input
                  id="id-number"
                  placeholder="Enter ID number"
                  value={idNumber}
                  onChange={(e) => setIdNumber(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="nationality" className="text-xs">Nationality *</Label>
                <Input
                  id="nationality"
                  placeholder="e.g. Thai, USA"
                  value={nationality}
                  onChange={(e) => setNationality(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>
          </div>

          <Separator />

          {depositDue > 0 && (
            <>
              <PaymentCollection
                data={depositPayment}
                onChange={setDepositPayment}
                amountDue={depositDue}
                label="Deposit Payment"
              />
              <Separator />
            </>
          )}

          <div className="space-y-2">
            <Label className="text-xs font-semibold">Quick Checklist</Label>
            <div className="grid grid-cols-1 gap-2 text-xs">
              <div className="flex items-center gap-2 p-2 bg-slate-50 rounded border">
                <Checkbox 
                  id="documents" 
                  checked={autoChecklist.documents}
                  onCheckedChange={(checked) => setAutoChecklist(prev => ({ ...prev, documents: checked as boolean }))}
                />
                <label htmlFor="documents" className="cursor-pointer flex-1 font-medium">
                  Registration documents collected
                </label>
              </div>
              <div className="flex items-center gap-2 p-2 bg-slate-50 rounded border">
                <Checkbox 
                  id="welcome" 
                  checked={autoChecklist.welcomePack}
                  onCheckedChange={(checked) => setAutoChecklist(prev => ({ ...prev, welcomePack: checked as boolean }))}
                />
                <label htmlFor="welcome" className="cursor-pointer flex-1 font-medium">
                  Keys & welcome pack provided
                </label>
              </div>
              <div className="flex items-center gap-2 p-2 bg-slate-50 rounded border">
                <Checkbox 
                  id="room-ready" 
                  checked={autoChecklist.roomReady}
                  onCheckedChange={(checked) => setAutoChecklist(prev => ({ ...prev, roomReady: checked as boolean }))}
                />
                <label htmlFor="room-ready" className="cursor-pointer flex-1 font-medium">
                  Room condition verified
                </label>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-xs">Notes (Optional)</Label>
            <Textarea
              id="notes"
              placeholder="Special requests or observations..."
              value={additionalNotes}
              onChange={(e) => setAdditionalNotes(e.target.value)}
              rows={2}
              className="text-sm resize-none"
            />
          </div>

          {!allChecksComplete && (
            <div className="flex items-start gap-1.5 p-2 bg-amber-50 border border-amber-200 rounded-md">
              <Warning className="text-amber-600 flex-shrink-0 mt-0.5" size={14} weight="bold" />
              <div className="text-xs text-amber-800">
                <p className="font-medium">Complete required items:</p>
                <ul className="mt-0.5 space-y-0.5">
                  {!hasIdInfo && <li>• Enter ID and nationality</li>}
                  {!depositComplete && <li>• Collect deposit payment</li>}
                  {!autoChecklist.documents && <li>• Confirm documents collected</li>}
                  {!autoChecklist.welcomePack && <li>• Confirm welcome pack given</li>}
                  {!autoChecklist.roomReady && <li>• Verify room condition</li>}
                </ul>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button 
            variant="outline" 
            onClick={() => {
              resetForm()
              onOpenChange(false)
            }}
            className="h-9"
          >
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={!allChecksComplete}
            className="bg-blue-600 hover:bg-blue-700 h-9"
          >
            <CheckCircle className="mr-1.5" size={16} weight="bold" />
            Complete Check-In
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
