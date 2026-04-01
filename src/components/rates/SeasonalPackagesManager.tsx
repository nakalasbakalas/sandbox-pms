import { useState } from 'react'
import { useKV } from '@github/spark/hooks'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import {
  Plus,
  Trash,
  Edit,
  Copy,
  Package,
  CalendarBlank,
  Gift,
  CheckCircle,
  Star
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'

interface SeasonalPackage {
  id: string
  name: string
  code: string
  description: string
  season: 'HIGH' | 'LOW' | 'SHOULDER' | 'HOLIDAY'
  roomTypeId: string
  packageRate: number
  inclusions: string[]
  validFrom: string
  validTo: string
  minNights?: number
  maxNights?: number
  blackoutDates: string[]
  advanceBookingDays?: number
  status: 'ACTIVE' | 'INACTIVE' | 'SCHEDULED' | 'EXPIRED'
  bookingCount: number
  revenue: number
  createdAt: string
}

export function SeasonalPackagesManager() {
  const [packages, setPackages] = useKV<SeasonalPackage[]>('seasonal-packages', [])
  const [roomTypes] = useKV<any[]>('room-types-config', [])
  
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [editingPackage, setEditingPackage] = useState<SeasonalPackage | null>(null)
  
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [season, setSeason] = useState<'HIGH' | 'LOW' | 'SHOULDER' | 'HOLIDAY'>('HIGH')
  const [roomTypeId, setRoomTypeId] = useState('')
  const [packageRate, setPackageRate] = useState('')
  const [inclusions, setInclusions] = useState('')
  const [validFrom, setValidFrom] = useState<Date>()
  const [validTo, setValidTo] = useState<Date>()
  const [minNights, setMinNights] = useState('')
  const [maxNights, setMaxNights] = useState('')
  const [advanceBookingDays, setAdvanceBookingDays] = useState('')

  const handleCreatePackage = () => {
    if (!name || !code || !roomTypeId || !packageRate || !validFrom || !validTo) {
      toast.error('Please fill in all required fields')
      return
    }

    const rate = parseFloat(packageRate)
    if (isNaN(rate) || rate <= 0) {
      toast.error('Invalid package rate')
      return
    }

    const newPackage: SeasonalPackage = {
      id: `pkg_${Date.now()}`,
      name,
      code: code.toUpperCase(),
      description,
      season,
      roomTypeId,
      packageRate: rate,
      inclusions: inclusions.split('\n').filter(i => i.trim()),
      validFrom: validFrom.toISOString(),
      validTo: validTo.toISOString(),
      minNights: minNights ? parseInt(minNights) : undefined,
      maxNights: maxNights ? parseInt(maxNights) : undefined,
      blackoutDates: [],
      advanceBookingDays: advanceBookingDays ? parseInt(advanceBookingDays) : undefined,
      status: 'ACTIVE',
      bookingCount: 0,
      revenue: 0,
      createdAt: new Date().toISOString()
    }

    setPackages(current => [...current, newPackage])
    resetForm()
    setShowAddDialog(false)
    toast.success('Package created successfully')
  }

  const handleDuplicatePackage = (pkg: SeasonalPackage) => {
    const duplicated: SeasonalPackage = {
      ...pkg,
      id: `pkg_${Date.now()}`,
      name: `${pkg.name} (Copy)`,
      code: `${pkg.code}_COPY`,
      status: 'INACTIVE',
      bookingCount: 0,
      revenue: 0,
      createdAt: new Date().toISOString()
    }

    setPackages(current => [...current, duplicated])
    toast.success('Package duplicated')
  }

  const handleDeletePackage = (id: string) => {
    setPackages(current => current.filter(p => p.id !== id))
    toast.success('Package deleted')
  }

  const togglePackageStatus = (id: string) => {
    setPackages(current =>
      current.map(p =>
        p.id === id
          ? { ...p, status: p.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }
          : p
      )
    )
  }

  const resetForm = () => {
    setName('')
    setCode('')
    setDescription('')
    setSeason('HIGH')
    setRoomTypeId('')
    setPackageRate('')
    setInclusions('')
    setValidFrom(undefined)
    setValidTo(undefined)
    setMinNights('')
    setMaxNights('')
    setAdvanceBookingDays('')
  }

  const getSeasonColor = (season: string) => {
    switch (season) {
      case 'HIGH': return 'bg-red-100 text-red-700'
      case 'LOW': return 'bg-blue-100 text-blue-700'
      case 'SHOULDER': return 'bg-yellow-100 text-yellow-700'
      case 'HOLIDAY': return 'bg-purple-100 text-purple-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  const activePackages = packages.filter(p => p.status === 'ACTIVE')
  const inactivePackages = packages.filter(p => p.status === 'INACTIVE')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Seasonal Packages</h2>
          <p className="text-sm text-muted-foreground">Create special packages for different seasons and events</p>
        </div>
        <Button onClick={() => setShowAddDialog(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Create Package
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Packages</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-3xl font-bold">{activePackages.length}</span>
              <Package className="w-6 h-6 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Bookings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-3xl font-bold">
                {packages.reduce((sum, p) => sum + p.bookingCount, 0)}
              </span>
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Package Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">
                ฿{(packages.reduce((sum, p) => sum + p.revenue, 0)).toLocaleString()}
              </span>
              <Gift className="w-6 h-6 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg Package Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">
                ฿{activePackages.length > 0 
                  ? Math.round(activePackages.reduce((sum, p) => sum + p.packageRate, 0) / activePackages.length).toLocaleString()
                  : '0'
                }
              </span>
              <Star className="w-6 h-6 text-orange-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-500" />
            Active Packages ({activePackages.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            {activePackages.length === 0 ? (
              <div className="text-center py-12">
                <Package className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No active packages</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {activePackages.map(pkg => {
                  const roomType = roomTypes.find(rt => rt.id === pkg.roomTypeId)
                  
                  return (
                    <Card key={pkg.id} className="overflow-hidden">
                      <div className={cn("h-2", getSeasonColor(pkg.season))} />
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-semibold">{pkg.name}</h3>
                              <Badge variant="outline" className="font-mono text-xs">
                                {pkg.code}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mb-2">{pkg.description}</p>
                            <div className="flex items-center gap-2 mb-2">
                              <Badge className={cn("text-xs", getSeasonColor(pkg.season))}>
                                {pkg.season}
                              </Badge>
                              <span className="text-xs text-muted-foreground">{roomType?.name}</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-2xl font-bold">฿{pkg.packageRate.toLocaleString()}</p>
                            <p className="text-xs text-muted-foreground">per night</p>
                          </div>
                        </div>

                        <div className="space-y-2 mb-3">
                          <div className="text-xs">
                            <span className="text-muted-foreground">Valid: </span>
                            <span className="font-medium">
                              {format(new Date(pkg.validFrom), 'MMM d')} - {format(new Date(pkg.validTo), 'MMM d, yyyy')}
                            </span>
                          </div>

                          {pkg.minNights && (
                            <div className="text-xs">
                              <span className="text-muted-foreground">Min stay: </span>
                              <span className="font-medium">{pkg.minNights} nights</span>
                            </div>
                          )}

                          {pkg.inclusions.length > 0 && (
                            <div className="p-2 bg-muted/50 rounded text-xs">
                              <p className="font-semibold mb-1">Includes:</p>
                              <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                                {pkg.inclusions.slice(0, 3).map((inc, i) => (
                                  <li key={i}>{inc}</li>
                                ))}
                                {pkg.inclusions.length > 3 && (
                                  <li className="text-primary">+{pkg.inclusions.length - 3} more</li>
                                )}
                              </ul>
                            </div>
                          )}

                          <div className="flex items-center gap-4 text-xs pt-2 border-t">
                            <div>
                              <span className="text-muted-foreground">Bookings: </span>
                              <span className="font-semibold">{pkg.bookingCount}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Revenue: </span>
                              <span className="font-semibold">฿{pkg.revenue.toLocaleString()}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => togglePackageStatus(pkg.id)}
                          >
                            Deactivate
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDuplicatePackage(pkg)}
                          >
                            <Copy className="w-4 h-4 mr-1" />
                            Duplicate
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleDeletePackage(pkg.id)}
                          >
                            <Trash className="w-4 h-4 mr-1" />
                            Delete
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {inactivePackages.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground">
              Inactive Packages ({inactivePackages.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {inactivePackages.map(pkg => (
                <div key={pkg.id} className="flex items-center justify-between p-3 bg-muted/30 rounded">
                  <div>
                    <p className="font-medium text-sm">{pkg.name}</p>
                    <p className="text-xs text-muted-foreground">{pkg.code}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => togglePackageStatus(pkg.id)}
                    >
                      Activate
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeletePackage(pkg.id)}
                    >
                      <Trash className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Seasonal Package</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Package Name *</Label>
                <Input
                  placeholder="e.g., Summer Escape Package"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Package Code *</Label>
                <Input
                  placeholder="e.g., SUMMER2024"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                placeholder="Describe this package..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Season *</Label>
                <Select value={season} onValueChange={(v: any) => setSeason(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HIGH">High Season</SelectItem>
                    <SelectItem value="LOW">Low Season</SelectItem>
                    <SelectItem value="SHOULDER">Shoulder Season</SelectItem>
                    <SelectItem value="HOLIDAY">Holiday Special</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Room Type *</Label>
                <Select value={roomTypeId} onValueChange={setRoomTypeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select room type" />
                  </SelectTrigger>
                  <SelectContent>
                    {roomTypes.map(rt => (
                      <SelectItem key={rt.id} value={rt.id}>{rt.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Package Rate (฿) *</Label>
              <Input
                type="number"
                placeholder="2500"
                value={packageRate}
                onChange={(e) => setPackageRate(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Valid From *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <CalendarBlank className="w-4 h-4 mr-2" />
                      {validFrom ? format(validFrom, 'MMM d, yyyy') : 'Select date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={validFrom} onSelect={setValidFrom} />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>Valid To *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <CalendarBlank className="w-4 h-4 mr-2" />
                      {validTo ? format(validTo, 'MMM d, yyyy') : 'Select date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={validTo} onSelect={setValidTo} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Min Nights</Label>
                <Input
                  type="number"
                  placeholder="Optional"
                  value={minNights}
                  onChange={(e) => setMinNights(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Max Nights</Label>
                <Input
                  type="number"
                  placeholder="Optional"
                  value={maxNights}
                  onChange={(e) => setMaxNights(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Advance Booking</Label>
                <Input
                  type="number"
                  placeholder="Days"
                  value={advanceBookingDays}
                  onChange={(e) => setAdvanceBookingDays(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Inclusions (one per line)</Label>
              <Textarea
                placeholder="Breakfast for 2&#10;Airport transfer&#10;Welcome cocktail&#10;Late checkout"
                value={inclusions}
                onChange={(e) => setInclusions(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowAddDialog(false)
              resetForm()
            }}>
              Cancel
            </Button>
            <Button onClick={handleCreatePackage}>Create Package</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
