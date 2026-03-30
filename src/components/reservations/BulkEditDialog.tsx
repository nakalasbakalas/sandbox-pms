import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { 
  PencilSimple, 
  CheckCircle,
  Calendar as CalendarIcon,
  CurrencyCircleDollar,
  Note,
  User,
  Bed,
  Warning
} from '@phosphor-icons/react'
import { format, addDays, differenceInDays } from 'date-fns'
import { toast } from 'sonner'
import type { ReservationStatus, BookingSource } from '@/types'

interface ReservationData {
  id: string
  status: ReservationStatus
  checkIn: Date
  checkOut: Date
  ratePerNight: number
  totalAmount: number
  depositAmount: number
  depositPaid: boolean
  source: BookingSource
  roomTypeName: string
  roomNumber?: string
  specialRequests?: string | null
  notes?: string | null
  guest: {
    firstName: string
    lastName: string
  }
}

interface BulkEditDialogProps {
  open: boolean
  onClose: () => void
  reservations: ReservationData[]
  onSave: (updates: BulkEditUpdates) => void
}

export interface BulkEditUpdates {
  status?: ReservationStatus
  addDays?: number
  subtractDays?: number
  newCheckIn?: Date
  newCheckOut?: Date
  rateAdjustmentPercent?: number
  rateAdjustmentFixed?: number
  depositPaid?: boolean
  appendNotes?: string
  source?: BookingSource
}

export function BulkEditDialog({ open, onClose, reservations, onSave }: BulkEditDialogProps) {
  const [editMode, setEditMode] = useState<'status' | 'dates' | 'rates' | 'payments' | 'notes' | 'source'>('status')
  
  const [newStatus, setNewStatus] = useState<ReservationStatus | ''>('')
  
  const [dateOperation, setDateOperation] = useState<'extend' | 'shorten' | 'shift'>('extend')
  const [daysToAdjust, setDaysToAdjust] = useState<number>(1)
  const [newCheckIn, setNewCheckIn] = useState<Date | undefined>()
  const [newCheckOut, setNewCheckOut] = useState<Date | undefined>()
  
  const [rateOperation, setRateOperation] = useState<'percent' | 'fixed'>('percent')
  const [rateAdjustmentPercent, setRateAdjustmentPercent] = useState<number>(0)
  const [rateAdjustmentFixed, setRateAdjustmentFixed] = useState<number>(0)
  
  const [markDepositPaid, setMarkDepositPaid] = useState(false)
  const [markDepositUnpaid, setMarkDepositUnpaid] = useState(false)
  
  const [appendNotes, setAppendNotes] = useState('')
  
  const [newSource, setNewSource] = useState<BookingSource | ''>('')

  const handleSave = () => {
    const updates: BulkEditUpdates = {}

    if (editMode === 'status' && newStatus) {
      updates.status = newStatus
    }

    if (editMode === 'dates') {
      if (dateOperation === 'extend') {
        updates.addDays = daysToAdjust
      } else if (dateOperation === 'shorten') {
        updates.subtractDays = daysToAdjust
      } else if (dateOperation === 'shift') {
        if (newCheckIn) updates.newCheckIn = newCheckIn
        if (newCheckOut) updates.newCheckOut = newCheckOut
      }
    }

    if (editMode === 'rates') {
      if (rateOperation === 'percent') {
        updates.rateAdjustmentPercent = rateAdjustmentPercent
      } else {
        updates.rateAdjustmentFixed = rateAdjustmentFixed
      }
    }

    if (editMode === 'payments') {
      if (markDepositPaid) {
        updates.depositPaid = true
      } else if (markDepositUnpaid) {
        updates.depositPaid = false
      }
    }

    if (editMode === 'notes' && appendNotes) {
      updates.appendNotes = appendNotes
    }

    if (editMode === 'source' && newSource) {
      updates.source = newSource
    }

    if (Object.keys(updates).length === 0) {
      toast.error('No changes to apply')
      return
    }

    onSave(updates)
    resetForm()
    onClose()
  }

  const resetForm = () => {
    setNewStatus('')
    setDateOperation('extend')
    setDaysToAdjust(1)
    setNewCheckIn(undefined)
    setNewCheckOut(undefined)
    setRateOperation('percent')
    setRateAdjustmentPercent(0)
    setRateAdjustmentFixed(0)
    setMarkDepositPaid(false)
    setMarkDepositUnpaid(false)
    setAppendNotes('')
    setNewSource('')
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) {
        resetForm()
        onClose()
      }
    }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PencilSimple size={24} weight="bold" className="text-primary" />
            Bulk Edit Reservations
          </DialogTitle>
          <DialogDescription>
            Edit {reservations.length} selected reservation{reservations.length !== 1 ? 's' : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-4">
          <Card 
            className={`p-3 cursor-pointer transition-all hover:bg-accent/50 ${editMode === 'status' ? 'ring-2 ring-primary bg-accent/30' : ''}`}
            onClick={() => setEditMode('status')}
          >
            <div className="text-sm font-medium mb-1">Status</div>
            <div className="text-xs text-muted-foreground">Change reservation status</div>
          </Card>

          <Card 
            className={`p-3 cursor-pointer transition-all hover:bg-accent/50 ${editMode === 'dates' ? 'ring-2 ring-primary bg-accent/30' : ''}`}
            onClick={() => setEditMode('dates')}
          >
            <div className="text-sm font-medium mb-1">Dates</div>
            <div className="text-xs text-muted-foreground">Adjust check-in/out dates</div>
          </Card>

          <Card 
            className={`p-3 cursor-pointer transition-all hover:bg-accent/50 ${editMode === 'rates' ? 'ring-2 ring-primary bg-accent/30' : ''}`}
            onClick={() => setEditMode('rates')}
          >
            <div className="text-sm font-medium mb-1">Rates</div>
            <div className="text-xs text-muted-foreground">Adjust pricing</div>
          </Card>

          <Card 
            className={`p-3 cursor-pointer transition-all hover:bg-accent/50 ${editMode === 'payments' ? 'ring-2 ring-primary bg-accent/30' : ''}`}
            onClick={() => setEditMode('payments')}
          >
            <div className="text-sm font-medium mb-1">Payments</div>
            <div className="text-xs text-muted-foreground">Update payment status</div>
          </Card>

          <Card 
            className={`p-3 cursor-pointer transition-all hover:bg-accent/50 ${editMode === 'notes' ? 'ring-2 ring-primary bg-accent/30' : ''}`}
            onClick={() => setEditMode('notes')}
          >
            <div className="text-sm font-medium mb-1">Notes</div>
            <div className="text-xs text-muted-foreground">Add notes to all</div>
          </Card>

          <Card 
            className={`p-3 cursor-pointer transition-all hover:bg-accent/50 ${editMode === 'source' ? 'ring-2 ring-primary bg-accent/30' : ''}`}
            onClick={() => setEditMode('source')}
          >
            <div className="text-sm font-medium mb-1">Source</div>
            <div className="text-xs text-muted-foreground">Change booking source</div>
          </Card>
        </div>

        <Separator />

        <ScrollArea className="max-h-[50vh]">
          <div className="space-y-4 pr-4">
            {editMode === 'status' && (
              <div>
                <Label htmlFor="bulk-status">New Status</Label>
                <Select value={newStatus} onValueChange={(v) => setNewStatus(v as ReservationStatus)}>
                  <SelectTrigger id="bulk-status" className="mt-2">
                    <SelectValue placeholder="Select new status..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="CONFIRMED">Confirmed</SelectItem>
                    <SelectItem value="CHECKED_IN">Checked In</SelectItem>
                    <SelectItem value="CHECKED_OUT">Checked Out</SelectItem>
                    <SelectItem value="CANCELLED">Cancelled</SelectItem>
                    <SelectItem value="NO_SHOW">No Show</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-2">
                  This will change the status of all {reservations.length} selected reservations
                </p>
              </div>
            )}

            {editMode === 'dates' && (
              <div className="space-y-4">
                <div>
                  <Label>Date Operation</Label>
                  <Select value={dateOperation} onValueChange={(v) => setDateOperation(v as 'extend' | 'shorten' | 'shift')}>
                    <SelectTrigger className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="extend">Extend Stay (Add Days)</SelectItem>
                      <SelectItem value="shorten">Shorten Stay (Remove Days)</SelectItem>
                      <SelectItem value="shift">Set New Dates</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {(dateOperation === 'extend' || dateOperation === 'shorten') && (
                  <div>
                    <Label htmlFor="days-adjust">
                      {dateOperation === 'extend' ? 'Days to Add' : 'Days to Remove'}
                    </Label>
                    <Input
                      id="days-adjust"
                      type="number"
                      min="1"
                      value={daysToAdjust}
                      onChange={(e) => setDaysToAdjust(parseInt(e.target.value) || 1)}
                      className="mt-2"
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      {dateOperation === 'extend' 
                        ? `Checkout date will be extended by ${daysToAdjust} day${daysToAdjust > 1 ? 's' : ''}`
                        : `Checkout date will be shortened by ${daysToAdjust} day${daysToAdjust > 1 ? 's' : ''}`
                      }
                    </p>
                  </div>
                )}

                {dateOperation === 'shift' && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>New Check-in Date</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full mt-2 justify-start">
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {newCheckIn ? format(newCheckIn, 'PPP') : 'Select date...'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                          <Calendar
                            mode="single"
                            selected={newCheckIn}
                            onSelect={setNewCheckIn}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div>
                      <Label>New Check-out Date</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full mt-2 justify-start">
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {newCheckOut ? format(newCheckOut, 'PPP') : 'Select date...'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                          <Calendar
                            mode="single"
                            selected={newCheckOut}
                            onSelect={setNewCheckOut}
                            disabled={(date) => newCheckIn ? date <= newCheckIn : false}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                )}
              </div>
            )}

            {editMode === 'rates' && (
              <div className="space-y-4">
                <div>
                  <Label>Rate Adjustment Type</Label>
                  <Select value={rateOperation} onValueChange={(v) => setRateOperation(v as 'percent' | 'fixed')}>
                    <SelectTrigger className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percent">Percentage Adjustment</SelectItem>
                      <SelectItem value="fixed">Fixed Amount Adjustment</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {rateOperation === 'percent' && (
                  <div>
                    <Label htmlFor="rate-percent">Percentage Change (%)</Label>
                    <Input
                      id="rate-percent"
                      type="number"
                      value={rateAdjustmentPercent}
                      onChange={(e) => setRateAdjustmentPercent(parseFloat(e.target.value) || 0)}
                      className="mt-2"
                      placeholder="e.g. 10 for +10%, -10 for -10%"
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      {rateAdjustmentPercent > 0 && `Rates will increase by ${rateAdjustmentPercent}%`}
                      {rateAdjustmentPercent < 0 && `Rates will decrease by ${Math.abs(rateAdjustmentPercent)}%`}
                      {rateAdjustmentPercent === 0 && 'Enter a percentage to adjust rates'}
                    </p>
                  </div>
                )}

                {rateOperation === 'fixed' && (
                  <div>
                    <Label htmlFor="rate-fixed">Fixed Amount Change (฿)</Label>
                    <Input
                      id="rate-fixed"
                      type="number"
                      value={rateAdjustmentFixed}
                      onChange={(e) => setRateAdjustmentFixed(parseFloat(e.target.value) || 0)}
                      className="mt-2"
                      placeholder="e.g. 200 for +฿200, -200 for -฿200"
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      {rateAdjustmentFixed > 0 && `Rates will increase by ฿${rateAdjustmentFixed}`}
                      {rateAdjustmentFixed < 0 && `Rates will decrease by ฿${Math.abs(rateAdjustmentFixed)}`}
                      {rateAdjustmentFixed === 0 && 'Enter an amount to adjust rates'}
                    </p>
                  </div>
                )}

                <Card className="p-3 bg-blue-50 dark:bg-blue-950 border-blue-200">
                  <div className="text-xs text-blue-700 dark:text-blue-300">
                    <strong>Note:</strong> Total amounts will be recalculated based on the new rate per night
                  </div>
                </Card>
              </div>
            )}

            {editMode === 'payments' && (
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="mark-paid"
                    checked={markDepositPaid}
                    onCheckedChange={(checked) => {
                      setMarkDepositPaid(checked as boolean)
                      if (checked) setMarkDepositUnpaid(false)
                    }}
                  />
                  <div className="flex-1">
                    <label
                      htmlFor="mark-paid"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex items-center gap-2"
                    >
                      <CheckCircle size={18} className="text-green-600" weight="bold" />
                      Mark All Deposits as Paid
                    </label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Set deposit status to paid for all selected reservations
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Checkbox
                    id="mark-unpaid"
                    checked={markDepositUnpaid}
                    onCheckedChange={(checked) => {
                      setMarkDepositUnpaid(checked as boolean)
                      if (checked) setMarkDepositPaid(false)
                    }}
                  />
                  <div className="flex-1">
                    <label
                      htmlFor="mark-unpaid"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex items-center gap-2"
                    >
                      <Warning size={18} className="text-orange-600" weight="bold" />
                      Mark All Deposits as Pending
                    </label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Set deposit status to pending for all selected reservations
                    </p>
                  </div>
                </div>
              </div>
            )}

            {editMode === 'notes' && (
              <div>
                <Label htmlFor="append-notes">Notes to Append</Label>
                <Textarea
                  id="append-notes"
                  value={appendNotes}
                  onChange={(e) => setAppendNotes(e.target.value)}
                  className="mt-2"
                  rows={4}
                  placeholder="These notes will be added to all selected reservations..."
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Notes will be appended to existing notes with a timestamp
                </p>
              </div>
            )}

            {editMode === 'source' && (
              <div>
                <Label htmlFor="bulk-source">New Booking Source</Label>
                <Select value={newSource} onValueChange={(v) => setNewSource(v as BookingSource)}>
                  <SelectTrigger id="bulk-source" className="mt-2">
                    <SelectValue placeholder="Select new booking source..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DIRECT">Direct</SelectItem>
                    <SelectItem value="BOOKING_COM">Booking.com</SelectItem>
                    <SelectItem value="AGODA">Agoda</SelectItem>
                    <SelectItem value="EXPEDIA">Expedia</SelectItem>
                    <SelectItem value="AIRBNB">Airbnb</SelectItem>
                    <SelectItem value="WALK_IN">Walk-in</SelectItem>
                    <SelectItem value="PHONE">Phone</SelectItem>
                    <SelectItem value="EMAIL">Email</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-2">
                  This will update the booking source for all {reservations.length} selected reservations
                </p>
              </div>
            )}

            <Separator />

            <Card className="p-4">
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <User size={18} />
                Selected Reservations ({reservations.length})
              </h4>
              <ScrollArea className="max-h-[200px]">
                <div className="space-y-2">
                  {reservations.map((res) => (
                    <div key={res.id} className="flex items-center justify-between text-sm p-2 bg-muted rounded">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {res.guest.firstName} {res.guest.lastName}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {res.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(res.checkIn), 'MMM d')} - {format(new Date(res.checkOut), 'MMM d')}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </Card>
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => {
            resetForm()
            onClose()
          }}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            <CheckCircle size={16} className="mr-2" weight="bold" />
            Apply Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
