export type CleanStatus = 'CLEAN' | 'DIRTY' | 'INSPECTED' | 'CLEANING'
export type MaintenanceStatus = 'NONE' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'
export type MaintenancePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
export type MaintenanceCategory = 'AC' | 'PLUMBING' | 'ELECTRICAL' | 'FURNITURE' | 'BATHROOM' | 'BEDDING' | 'OTHER'

export interface HousekeepingRoom {
  roomId: string
  number: string
  floor: number
  type: 'TWIN' | 'DOUBLE'
  
  cleanStatus: CleanStatus
  isOccupied: boolean
  
  isDepartureToday: boolean
  isArrivalToday: boolean
  
  arrivalTime?: string
  departureTime?: string
  
  guestName?: string
  checkOutTime?: string
  priority: number
  
  lastCleaned?: Date
  cleanedBy?: string
  cleanDuration?: number
  
  hasMaintenanceIssue: boolean
  maintenanceNotes?: string
  
  inspectedBy?: string
  inspectedAt?: Date
  
  needsDeepClean: boolean
  specialInstructions?: string
}

export interface CleaningTask {
  id: string
  roomId: string
  roomNumber: string
  taskType: 'CHECKOUT_CLEAN' | 'STAYOVER_CLEAN' | 'DEEP_CLEAN' | 'INSPECTION'
  priority: number
  
  assignedTo?: string
  assignedAt?: Date
  
  startedAt?: Date
  completedAt?: Date
  duration?: number
  
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'
  
  notes?: string
  photoUrls?: string[]
  
  issuesFound?: MaintenanceIssue[]
  
  createdAt: Date
}

export interface MaintenanceIssue {
  id: string
  roomId: string
  roomNumber: string
  
  category: MaintenanceCategory
  title: string
  description: string
  priority: MaintenancePriority
  
  reportedBy: string
  reportedAt: Date
  
  assignedTo?: string
  status: MaintenanceStatus
  
  estimatedDuration?: number
  actualDuration?: number
  
  startedAt?: Date
  completedAt?: Date
  
  resolution?: string
  cost?: number
  
  photoUrls?: string[]
  
  blockRoom: boolean
}

export interface HousekeepingStats {
  totalRooms: number
  cleanRooms: number
  dirtyRooms: number
  inProgressRooms: number
  
  checkoutsToday: number
  checkoutsCompleted: number
  checkoutsRemaining: number
  
  arrivalsToday: number
  roomsReady: number
  roomsNotReady: number
  
  averageCleanTime: number
  tasksCompleted: number
  tasksRemaining: number
  
  maintenanceIssues: number
  urgentIssues: number
  blockedRooms: number
}

export interface HousekeepingAssignment {
  staffId: string
  staffName: string
  rooms: string[]
  floor?: number
  tasksCompleted: number
  tasksRemaining: number
  shiftStart: Date
  shiftEnd: Date
}

export interface CleaningChecklistItem {
  id: string
  category: 'BATHROOM' | 'BEDROOM' | 'GENERAL' | 'AMENITIES'
  task: string
  isCompleted: boolean
  order: number
}

export interface CleaningChecklist {
  roomId: string
  roomNumber: string
  items: CleaningChecklistItem[]
  startedAt: Date
  completedAt?: Date
  completedBy?: string
  notes?: string
}
