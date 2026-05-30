import { useState } from 'react'
import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { 
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter
} from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  CheckCircle, 
  Circle, 
  Clock, 
  Wrench,
  Note,
  Broom,
  Warning,
  User,
  CalendarBlank,
  ListChecks,
  X
} from '@phosphor-icons/react'
import type { HousekeepingRoom, CleanStatus, MaintenanceIssue, MaintenanceCategory, MaintenancePriority, CleaningChecklistItem } from '@/types/housekeeping'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { useNotifications } from '@/hooks/use-notifications'

interface RoomDetailSheetProps {
  room: HousekeepingRoom | null
  onClose: () => void
  onUpdateStatus: (roomId: string, status: CleanStatus, notes?: string) => void
  maintenanceIssues: MaintenanceIssue[]
}

export function RoomDetailSheet({ room, onClose, onUpdateStatus, maintenanceIssues }: RoomDetailSheetProps) {
  const [activeTab, setActiveTab] = useState('overview')
  const [showChecklist, setShowChecklist] = useState(false)
  const [showMaintenanceForm, setShowMaintenanceForm] = useState(false)

  if (!room) return null

  return (
    <Sheet open={!!room} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-start justify-between">
            <div>
              <SheetTitle className="text-3xl">Room {room.number}</SheetTitle>
              <SheetDescription className="mt-1">
                {room.type} • Floor {room.floor}
              </SheetDescription>
            </div>
            <StatusBadge status={room.cleanStatus} />
          </div>
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="mx-6 mt-4">
            <TabsTrigger value="overview" className="flex-1">Overview</TabsTrigger>
            <TabsTrigger value="clean" className="flex-1">Clean</TabsTrigger>
            <TabsTrigger value="issues" className="flex-1">
              Issues
              {maintenanceIssues.length > 0 && (
                <Badge variant="destructive" className="ml-2 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs">
                  {maintenanceIssues.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 px-6 py-4">
            <TabsContent value="overview" className="mt-0 space-y-4">
              <OverviewTab room={room} maintenanceIssues={maintenanceIssues} />
            </TabsContent>

            <TabsContent value="clean" className="mt-0 space-y-4">
              <CleaningTab 
                room={room} 
                onUpdateStatus={onUpdateStatus}
                onShowChecklist={() => setShowChecklist(true)}
              />
            </TabsContent>

            <TabsContent value="issues" className="mt-0 space-y-4">
              <IssuesTab 
                room={room} 
                issues={maintenanceIssues}
                onAddIssue={() => setShowMaintenanceForm(true)}
              />
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <ChecklistDialog 
          room={room}
          open={showChecklist}
          onClose={() => setShowChecklist(false)}
          onComplete={(notes) => {
            onUpdateStatus(room.roomId, 'CLEAN', notes)
            setShowChecklist(false)
          }}
        />

        <MaintenanceFormDialog
          room={room}
          open={showMaintenanceForm}
          onClose={() => setShowMaintenanceForm(false)}
        />
      </SheetContent>
    </Sheet>
  )
}

interface OverviewTabProps {
  room: HousekeepingRoom
  maintenanceIssues: MaintenanceIssue[]
}

function OverviewTab({ room, maintenanceIssues }: OverviewTabProps) {
  return (
    <div className="space-y-4 pb-4">
      {room.isArrivalToday && (
        <div className="bg-green-50 border-2 border-green-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-green-700 font-semibold mb-1">
            <Warning size={20} weight="bold" />
            <span>Arrival Today</span>
          </div>
          <div className="text-sm text-green-600">
            Expected at {room.arrivalTime} - Priority cleaning required
          </div>
        </div>
      )}

      {room.isDepartureToday && (
        <div className="bg-orange-50 border-2 border-orange-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-orange-700 font-semibold mb-1">
            <Clock size={20} weight="bold" />
            <span>Departure Today</span>
          </div>
          <div className="text-sm text-orange-600">
            Checkout at {room.checkOutTime}
          </div>
        </div>
      )}

      {maintenanceIssues.length > 0 && (
        <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-red-700 font-semibold mb-2">
            <Wrench size={20} weight="bold" />
            <span>Maintenance Issues ({maintenanceIssues.length})</span>
          </div>
          <div className="space-y-2">
            {maintenanceIssues.map(issue => (
              <div key={issue.id} className="text-sm border-t pt-2 first:border-0 first:pt-0">
                <div className="font-medium text-red-700">{issue.title}</div>
                <div className="text-red-600 text-xs mt-0.5">{issue.category} • {issue.priority}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <InfoCard label="Room Type" value={room.type} />
        <InfoCard label="Floor" value={room.floor.toString()} />
        <InfoCard label="Guest Count" value={room.guestCount?.toString() || '—'} />
        <InfoCard label="Occupied" value={room.isOccupied ? 'Yes' : 'No'} />
      </div>

      {room.guestName && (
        <div className="bg-muted/50 rounded-lg p-4">
          <div className="text-sm text-muted-foreground mb-1">Guest Name</div>
          <div className="font-medium flex items-center gap-2">
            <User size={16} weight="bold" />
            {room.guestName}
          </div>
        </div>
      )}

      {room.specialInstructions && (
        <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-blue-700 font-semibold mb-2">
            <Note size={20} weight="bold" />
            <span>Special Instructions</span>
          </div>
          <div className="text-sm text-blue-600">
            {room.specialInstructions}
          </div>
        </div>
      )}

      {room.lastCleaned && (
        <div className="bg-muted/50 rounded-lg p-4">
          <div className="text-sm text-muted-foreground mb-1">Last Cleaned</div>
          <div className="font-medium flex items-center gap-2">
            <CalendarBlank size={16} weight="bold" />
            {format(new Date(room.lastCleaned), 'MMM d, yyyy h:mm a')}
          </div>
          {room.cleanedBy && (
            <div className="text-sm text-muted-foreground mt-1">
              by {room.cleanedBy}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface CleaningTabProps {
  room: HousekeepingRoom
  onUpdateStatus: (roomId: string, status: CleanStatus, notes?: string) => void
  onShowChecklist: () => void
}

function CleaningTab({ room, onUpdateStatus, onShowChecklist }: CleaningTabProps) {
  return (
    <div className="space-y-3 pb-4">
      <Button
        size="lg"
        variant="outline"
        className="w-full h-16 gap-3 text-base"
        onClick={onShowChecklist}
      >
        <ListChecks size={24} weight="bold" />
        Open Cleaning Checklist
      </Button>

      <Separator className="my-4" />

      <div className="space-y-2">
        <h3 className="font-semibold mb-3">Quick Status Update</h3>
        
        {room.cleanStatus === 'DIRTY' && (
          <>
            <Button
              size="lg"
              className="w-full h-14 gap-3 bg-purple-600 hover:bg-purple-700"
              onClick={() => onUpdateStatus(room.roomId, 'CLEANING')}
            >
              <Broom size={20} weight="bold" />
              Start Cleaning
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="w-full h-14 gap-3"
              onClick={() => onUpdateStatus(room.roomId, 'CLEAN')}
            >
              <CheckCircle size={20} weight="bold" />
              Mark as Clean
            </Button>
          </>
        )}

        {room.cleanStatus === 'CLEANING' && (
          <Button
            size="lg"
            className="w-full h-14 gap-3 bg-green-600 hover:bg-green-700"
            onClick={() => onUpdateStatus(room.roomId, 'CLEAN')}
          >
            <CheckCircle size={20} weight="bold" />
            Finish Cleaning
          </Button>
        )}

        {room.cleanStatus === 'CLEAN' && (
          <>
            <Button
              size="lg"
              className="w-full h-14 gap-3 bg-blue-600 hover:bg-blue-700"
              onClick={() => onUpdateStatus(room.roomId, 'INSPECTED')}
            >
              <CheckCircle size={20} weight="bold" />
              Mark as Inspected
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="w-full h-14 gap-3"
              onClick={() => onUpdateStatus(room.roomId, 'DIRTY')}
            >
              <Circle size={20} />
              Mark as Dirty
            </Button>
          </>
        )}

        {room.cleanStatus === 'INSPECTED' && (
          <Button
            size="lg"
            variant="outline"
            className="w-full h-14 gap-3"
            onClick={() => onUpdateStatus(room.roomId, 'DIRTY')}
          >
            <Circle size={20} />
            Mark as Dirty
          </Button>
        )}
      </div>
    </div>
  )
}

interface IssuesTabProps {
  room: HousekeepingRoom
  issues: MaintenanceIssue[]
  onAddIssue: () => void
}

function IssuesTab({ room, issues, onAddIssue }: IssuesTabProps) {
  return (
    <div className="space-y-4 pb-4">
      <Button
        size="lg"
        variant="default"
        className="w-full gap-3"
        onClick={onAddIssue}
      >
        <Wrench size={20} weight="bold" />
        Report New Issue
      </Button>

      {issues.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Wrench size={48} className="mx-auto mb-3 opacity-30" />
          <p>No maintenance issues reported</p>
        </div>
      ) : (
        <div className="space-y-3">
          {issues.map(issue => (
            <div key={issue.id} className="border rounded-lg p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div className="font-semibold">{issue.title}</div>
                <PriorityBadge priority={issue.priority} />
              </div>
              <div className="text-sm text-muted-foreground">{issue.description}</div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="text-xs">{issue.category}</Badge>
                <Badge variant="outline" className="text-xs">{issue.status}</Badge>
                {issue.blockRoom && (
                  <Badge variant="destructive" className="text-xs">Room Blocked</Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground pt-2 border-t">
                Reported by {issue.reportedBy} • {format(new Date(issue.reportedAt), 'MMM d, h:mm a')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/50 rounded-lg p-3">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: CleanStatus }) {
  const config = {
    CLEAN: { label: 'Clean', className: 'bg-green-100 text-green-700 border-green-300' },
    DIRTY: { label: 'Dirty', className: 'bg-orange-100 text-orange-700 border-orange-300' },
    INSPECTED: { label: 'Inspected', className: 'bg-blue-100 text-blue-700 border-blue-300' },
    CLEANING: { label: 'Cleaning', className: 'bg-purple-100 text-purple-700 border-purple-300' },
  }

  const { label, className } = config[status]

  return (
    <Badge className={`${className} text-sm px-3 py-1 border-2`} variant="secondary">
      {label}
    </Badge>
  )
}

function PriorityBadge({ priority }: { priority: MaintenancePriority }) {
  const config = {
    LOW: { label: 'Low', className: 'bg-gray-100 text-gray-700' },
    MEDIUM: { label: 'Medium', className: 'bg-yellow-100 text-yellow-700' },
    HIGH: { label: 'High', className: 'bg-orange-100 text-orange-700' },
    URGENT: { label: 'Urgent', className: 'bg-red-100 text-red-700' },
  }

  const { label, className } = config[priority]

  return (
    <Badge className={`${className} text-xs`} variant="secondary">
      {label}
    </Badge>
  )
}

interface ChecklistDialogProps {
  room: HousekeepingRoom
  open: boolean
  onClose: () => void
  onComplete: (notes?: string) => void
}

function ChecklistDialog({ room, open, onClose, onComplete }: ChecklistDialogProps) {
  const [checklist, setChecklist] = useState<CleaningChecklistItem[]>([
    { id: '1', category: 'BATHROOM', task: 'Clean toilet and sink', isCompleted: false, order: 1 },
    { id: '2', category: 'BATHROOM', task: 'Clean shower/bathtub', isCompleted: false, order: 2 },
    { id: '3', category: 'BATHROOM', task: 'Restock toiletries', isCompleted: false, order: 3 },
    { id: '4', category: 'BATHROOM', task: 'Replace towels', isCompleted: false, order: 4 },
    { id: '5', category: 'BEDROOM', task: 'Change bed linens', isCompleted: false, order: 5 },
    { id: '6', category: 'BEDROOM', task: 'Vacuum floor', isCompleted: false, order: 6 },
    { id: '7', category: 'BEDROOM', task: 'Dust surfaces', isCompleted: false, order: 7 },
    { id: '8', category: 'AMENITIES', task: 'Restock minibar', isCompleted: false, order: 8 },
    { id: '9', category: 'AMENITIES', task: 'Check TV remote batteries', isCompleted: false, order: 9 },
    { id: '10', category: 'GENERAL', task: 'Empty trash', isCompleted: false, order: 10 },
    { id: '11', category: 'GENERAL', task: 'Check AC/heating', isCompleted: false, order: 11 },
  ])
  const [notes, setNotes] = useState('')

  const toggleItem = (id: string) => {
    setChecklist(prev => prev.map(item => 
      item.id === id ? { ...item, isCompleted: !item.isCompleted } : item
    ))
  }

  const completedCount = checklist.filter(item => item.isCompleted).length
  const totalCount = checklist.length
  const progress = Math.round((completedCount / totalCount) * 100)

  const handleComplete = () => {
    onComplete(notes || undefined)
    setChecklist(prev => prev.map(item => ({ ...item, isCompleted: false })))
    setNotes('')
  }

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <SheetTitle>Cleaning Checklist</SheetTitle>
          <SheetDescription>
            Room {room.number} • {completedCount}/{totalCount} tasks ({progress}%)
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 px-6 py-4">
          <div className="space-y-6 pb-4">
            {['BATHROOM', 'BEDROOM', 'AMENITIES', 'GENERAL'].map(category => {
              const items = checklist.filter(item => item.category === category)
              if (items.length === 0) return null
              
              return (
                <div key={category}>
                  <h4 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground">
                    {category}
                  </h4>
                  <div className="space-y-2.5">
                    {items.map(item => (
                      <div key={item.id} className="flex items-center gap-3 bg-muted/30 rounded-lg p-3">
                        <Checkbox
                          id={item.id}
                          checked={item.isCompleted}
                          onCheckedChange={() => toggleItem(item.id)}
                          className="h-5 w-5"
                        />
                        <Label 
                          htmlFor={item.id}
                          className={`cursor-pointer flex-1 text-base ${item.isCompleted ? 'line-through text-muted-foreground' : ''}`}
                        >
                          {item.task}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}

            <div className="pt-4">
              <Label htmlFor="checklist-notes" className="text-base mb-2 block">
                Additional Notes (Optional)
              </Label>
              <Textarea
                id="checklist-notes"
                placeholder="Any observations or issues..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                className="text-base"
              />
            </div>
          </div>
        </ScrollArea>

        <SheetFooter className="px-6 pb-6 pt-4 border-t">
          <Button variant="outline" onClick={onClose} size="lg" className="flex-1">
            Cancel
          </Button>
          <Button 
            onClick={handleComplete}
            disabled={completedCount < totalCount}
            size="lg"
            className="flex-1 gap-2"
          >
            <CheckCircle size={18} weight="bold" />
            Complete
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

interface MaintenanceFormDialogProps {
  room: HousekeepingRoom
  open: boolean
  onClose: () => void
}

function MaintenanceFormDialog({ room, open, onClose }: MaintenanceFormDialogProps) {
  const [maintenanceIssues, setMaintenanceIssues] = useKV<MaintenanceIssue[]>('maintenance-issues', [])
  const { addNotification } = useNotifications()
  const [category, setCategory] = useState<MaintenanceCategory>('OTHER')
  const [priority, setPriority] = useState<MaintenancePriority>('MEDIUM')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [blockRoom, setBlockRoom] = useState(false)

  const handleSubmit = () => {
    if (!title.trim() || !description.trim()) {
      toast.error('Please fill in all required fields')
      return
    }

    const newIssue: MaintenanceIssue = {
      id: `issue-${Date.now()}`,
      roomId: room.roomId,
      roomNumber: room.number,
      category,
      title: title.trim(),
      description: description.trim(),
      priority,
      reportedBy: 'Current User',
      reportedAt: new Date(),
      status: 'PENDING',
      blockRoom
    }

    setMaintenanceIssues((current) => [...(current || []), newIssue])

    if (priority === 'URGENT' || priority === 'HIGH') {
      addNotification({
        type: priority === 'URGENT' ? 'MAINTENANCE_URGENT' : 'HOUSEKEEPING_URGENT',
        priority,
        title: `${priority === 'URGENT' ? '🚨 URGENT' : '⚠️'} Maintenance: Room ${room.number}`,
        message: `${category}: ${title}`,
        roomNumber: room.number,
        roomId: room.roomId,
        actionRequired: true,
        metadata: {
          issueId: newIssue.id,
          category,
          blockRoom
        }
      })
    }

    toast.success(`Maintenance issue reported for Room ${room.number}`)
    
    setTitle('')
    setDescription('')
    setCategory('OTHER')
    setPriority('MEDIUM')
    setBlockRoom(false)
    onClose()
  }

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <SheetTitle>Report Maintenance Issue</SheetTitle>
          <SheetDescription>Room {room.number}</SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 px-6 py-4">
          <div className="space-y-4 pb-4">
            <div>
              <Label htmlFor="issue-category" className="text-base mb-2 block">Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as MaintenanceCategory)}>
                <SelectTrigger id="issue-category" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AC">Air Conditioning</SelectItem>
                  <SelectItem value="PLUMBING">Plumbing</SelectItem>
                  <SelectItem value="ELECTRICAL">Electrical</SelectItem>
                  <SelectItem value="FURNITURE">Furniture</SelectItem>
                  <SelectItem value="BATHROOM">Bathroom</SelectItem>
                  <SelectItem value="BEDDING">Bedding</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="issue-priority" className="text-base mb-2 block">Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as MaintenancePriority)}>
                <SelectTrigger id="issue-priority" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="URGENT">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="issue-title" className="text-base mb-2 block">Issue Title</Label>
              <Input
                id="issue-title"
                placeholder="e.g., AC not cooling"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-11 text-base"
              />
            </div>

            <div>
              <Label htmlFor="issue-description" className="text-base mb-2 block">Description</Label>
              <Textarea
                id="issue-description"
                placeholder="Describe the issue in detail..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                className="text-base"
              />
            </div>

            <div className="flex items-center gap-3 bg-muted/30 rounded-lg p-4">
              <Checkbox
                id="block-room"
                checked={blockRoom}
                onCheckedChange={(checked) => setBlockRoom(checked as boolean)}
                className="h-5 w-5"
              />
              <Label htmlFor="block-room" className="cursor-pointer text-base">
                Block room from selling
              </Label>
            </div>
          </div>
        </ScrollArea>

        <SheetFooter className="px-6 pb-6 pt-4 border-t">
          <Button variant="outline" onClick={onClose} size="lg" className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleSubmit} size="lg" className="flex-1 gap-2">
            <Wrench size={18} weight="bold" />
            Submit Report
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
