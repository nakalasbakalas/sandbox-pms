import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { IdentificationCard, Warning } from '@phosphor-icons/react'

export interface GuestVerificationData {
  idType: string
  idNumber: string
  nationality: string
  verified: boolean
}

interface GuestVerificationProps {
  data: GuestVerificationData
  onChange: (data: GuestVerificationData) => void
  guestName: string
}

export function GuestVerification({ data, onChange, guestName }: GuestVerificationProps) {
  const updateField = (field: keyof GuestVerificationData, value: string | boolean) => {
    onChange({ ...data, [field]: value })
  }

  return (
    <Card className="p-4 border-blue-200 bg-blue-50/50">
      <div className="flex items-center gap-2 mb-4">
        <IdentificationCard className="text-blue-600" size={20} weight="bold" />
        <h3 className="font-semibold">Guest Verification</h3>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="id-type">ID Type</Label>
            <Select value={data.idType} onValueChange={(v) => updateField('idType', v)}>
              <SelectTrigger id="id-type">
                <SelectValue placeholder="Select ID type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PASSPORT">Passport</SelectItem>
                <SelectItem value="NATIONAL_ID">National ID</SelectItem>
                <SelectItem value="DRIVERS_LICENSE">Driver's License</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="id-number">ID Number</Label>
            <Input
              id="id-number"
              placeholder="Enter ID number"
              value={data.idNumber}
              onChange={(e) => updateField('idNumber', e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="nationality">Nationality</Label>
          <Input
            id="nationality"
            placeholder="Enter nationality"
            value={data.nationality}
            onChange={(e) => updateField('nationality', e.target.value)}
          />
        </div>

        <div className="flex items-start gap-3 pt-2">
          <Checkbox
            id="verified"
            checked={data.verified}
            onCheckedChange={(checked) => updateField('verified', checked as boolean)}
          />
          <div className="flex-1">
            <label htmlFor="verified" className="text-sm font-medium cursor-pointer">
              Identity verified for {guestName}
            </label>
            <p className="text-xs text-muted-foreground mt-0.5">
              ID document checked and recorded
            </p>
          </div>
        </div>

        {!data.verified && data.idType && data.idNumber && (
          <div className="flex items-start gap-2 p-2 bg-amber-50 border border-amber-200 rounded-md">
            <Warning className="text-amber-600 flex-shrink-0 mt-0.5" size={16} weight="bold" />
            <p className="text-xs text-amber-800">
              Please confirm identity verification
            </p>
          </div>
        )}
      </div>
    </Card>
  )
}
