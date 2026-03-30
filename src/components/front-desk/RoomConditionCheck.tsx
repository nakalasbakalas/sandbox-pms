import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { CheckCircle, Warning, Wrench } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

export interface RoomConditionData {
  status: 'GOOD' | 'MINOR_ISSUES' | 'MAJOR_DAMAGE'
  notes: string
}

interface RoomConditionCheckProps {
  data: RoomConditionData
  onChange: (data: RoomConditionData) => void
  roomNumber: string
  type: 'check-in' | 'check-out'
}

export function RoomConditionCheck({ data, onChange, roomNumber, type }: RoomConditionCheckProps) {
  const updateField = (field: keyof RoomConditionData, value: string) => {
    onChange({ ...data, [field]: value })
  }

  const getIcon = () => {
    switch (data.status) {
      case 'GOOD':
        return <CheckCircle className="text-green-600" size={20} weight="bold" />
      case 'MINOR_ISSUES':
        return <Warning className="text-amber-600" size={20} weight="bold" />
      case 'MAJOR_DAMAGE':
        return <Wrench className="text-rose-600" size={20} weight="bold" />
    }
  }

  const getBackgroundColor = () => {
    switch (data.status) {
      case 'GOOD':
        return 'bg-green-50/50 border-green-200'
      case 'MINOR_ISSUES':
        return 'bg-amber-50/50 border-amber-200'
      case 'MAJOR_DAMAGE':
        return 'bg-rose-50/50 border-rose-200'
    }
  }

  return (
    <Card className={cn('p-4', getBackgroundColor())}>
      <div className="flex items-center gap-2 mb-4">
        {getIcon()}
        <h3 className="font-semibold">
          {type === 'check-in' ? 'Pre-Arrival Inspection' : 'Post-Departure Inspection'}
        </h3>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Room {roomNumber} Condition *</Label>
          <RadioGroup 
            value={data.status} 
            onValueChange={(v) => updateField('status', v as typeof data.status)}
          >
            <div className="space-y-2">
              <div className={cn(
                "flex items-start space-x-2 border rounded-md p-3 hover:bg-slate-50 transition-colors",
                data.status === 'GOOD' && "border-green-300 bg-green-50"
              )}>
                <RadioGroupItem value="GOOD" id="condition-good" className="mt-0.5" />
                <div className="flex-1">
                  <Label htmlFor="condition-good" className="cursor-pointer font-medium">
                    {type === 'check-in' ? 'Clean and ready' : 'Good condition'}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {type === 'check-in' 
                      ? 'Room is clean, inspected, and ready for guest arrival' 
                      : 'No damage or issues found'}
                  </p>
                </div>
              </div>

              <div className={cn(
                "flex items-start space-x-2 border rounded-md p-3 hover:bg-slate-50 transition-colors",
                data.status === 'MINOR_ISSUES' && "border-amber-300 bg-amber-50"
              )}>
                <RadioGroupItem value="MINOR_ISSUES" id="condition-minor" className="mt-0.5" />
                <div className="flex-1">
                  <Label htmlFor="condition-minor" className="cursor-pointer font-medium">
                    {type === 'check-in' ? 'Minor issues noted' : 'Minor issues (items replaced)'}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {type === 'check-in' 
                      ? 'Small issues present but room is usable' 
                      : 'Minor consumables used or small wear noted'}
                  </p>
                </div>
              </div>

              <div className={cn(
                "flex items-start space-x-2 border rounded-md p-3 hover:bg-slate-50 transition-colors",
                data.status === 'MAJOR_DAMAGE' && "border-rose-300 bg-rose-50"
              )}>
                <RadioGroupItem value="MAJOR_DAMAGE" id="condition-major" className="mt-0.5" />
                <div className="flex-1">
                  <Label htmlFor="condition-major" className="cursor-pointer font-medium">
                    {type === 'check-in' ? 'Not ready - maintenance required' : 'Major damage'}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {type === 'check-in' 
                      ? 'Room requires attention before guest arrival' 
                      : 'Significant damage requiring maintenance or repair'}
                  </p>
                </div>
              </div>
            </div>
          </RadioGroup>
        </div>

        <div className="space-y-2">
          <Label htmlFor="condition-notes">
            {data.status !== 'GOOD' ? 'Inspection Notes *' : 'Inspection Notes (Optional)'}
          </Label>
          <Textarea
            id="condition-notes"
            placeholder={
              type === 'check-in' 
                ? 'Describe the condition and any issues noted...' 
                : 'Describe any damage, missing items, or issues...'
            }
            value={data.notes}
            onChange={(e) => updateField('notes', e.target.value)}
            rows={3}
            className={cn(
              data.status !== 'GOOD' && !data.notes && "border-amber-300"
            )}
          />
          {data.status !== 'GOOD' && !data.notes && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <Warning size={14} weight="bold" />
              Please provide details about the issues
            </p>
          )}
        </div>

        {data.status === 'MAJOR_DAMAGE' && type === 'check-out' && (
          <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-md">
            <Warning className="text-rose-600 flex-shrink-0 mt-0.5" size={18} weight="bold" />
            <div className="text-sm text-rose-800">
              <p className="font-medium">Manager approval may be required</p>
              <p className="text-xs mt-1">
                Room will be marked for maintenance and charges may apply
              </p>
            </div>
          </div>
        )}

        {data.status === 'MAJOR_DAMAGE' && type === 'check-in' && (
          <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-md">
            <Warning className="text-rose-600 flex-shrink-0 mt-0.5" size={18} weight="bold" />
            <div className="text-sm text-rose-800">
              <p className="font-medium">Room may not be ready for check-in</p>
              <p className="text-xs mt-1">
                Consider delaying check-in or assigning alternative room
              </p>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
