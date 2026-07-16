import type { BoardRoomCard } from '@/types/board'
import { mapServerBoardRooms, pmsApi } from '@/lib/pms-api-client'

export type HousekeepingTaskStatus = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED'
export type HousekeepingTaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
export type HousekeepingTaskKind = 'TURNOVER' | 'CLEANING' | 'INSPECTION' | 'DEEP_CLEAN' | 'LINEN' | 'MAINTENANCE_FOLLOW_UP' | 'OTHER'
export type HousekeepingIssueStatus = 'OPEN' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'

export interface ServerHousekeepingTask {
  id: string
  roomId: string
  room?: { id: string; number: string }
  kind: HousekeepingTaskKind
  status: HousekeepingTaskStatus
  priority: HousekeepingTaskPriority
  title: string
  description?: string | null
  scheduledFor?: string | null
  assignedToUserId?: string | null
  assignedTo?: { id: string; firstName: string; lastName: string; role: string } | null
  completedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface ServerHousekeepingIssue {
  id: string
  roomId: string
  taskId?: string | null
  category: 'HOUSEKEEPING' | 'MAINTENANCE' | 'SAFETY' | 'DAMAGE' | 'SUPPLY' | 'OTHER'
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  status: HousekeepingIssueStatus
  title: string
  description: string
  assignedToUserId?: string | null
  resolvedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface HousekeepingServerSnapshot {
  propertyName: string
  rooms: BoardRoomCard[]
  tasks: ServerHousekeepingTask[]
  issues: ServerHousekeepingIssue[]
}

type TaskCreateInput = {
  roomId: string
  kind: HousekeepingTaskKind
  priority: HousekeepingTaskPriority
  title: string
  description?: string | null
  scheduledFor?: string | null
  assignedToUserId?: string | null
  reason: string
}

type IssueCreateInput = {
  roomId: string
  taskId?: string | null
  category: ServerHousekeepingIssue['category']
  severity: ServerHousekeepingIssue['severity']
  title: string
  description: string
  assignedToUserId?: string | null
  reason: string
}

export const housekeepingApi = {
  async snapshot(): Promise<HousekeepingServerSnapshot> {
    const [board, tasks, issues] = await Promise.all([
      pmsApi<{ ok: true; data: { property?: { name?: string }; rooms?: unknown[]; reservations?: unknown[] } }>('/api/front-desk/board', null),
      pmsApi<{ ok: true; data: ServerHousekeepingTask[] }>('/api/housekeeping/tasks?limit=250', null),
      pmsApi<{ ok: true; data: ServerHousekeepingIssue[] }>('/api/housekeeping/issues?limit=250', null),
    ])
    return {
      propertyName: String(board.data.property?.name || 'Hotel'),
      rooms: mapServerBoardRooms(board.data),
      tasks: tasks.data,
      issues: issues.data,
    }
  },

  updateRoomStatus(roomId: string, status: 'DIRTY' | 'CLEANING' | 'CLEAN' | 'INSPECTED' | 'MAINTENANCE', notes: string) {
    return pmsApi<{ ok: true; message?: string }>(`/api/housekeeping/rooms/${encodeURIComponent(roomId)}/status`, null, {
      method: 'POST',
      body: JSON.stringify({ status, notes }),
    })
  },

  createTask(input: TaskCreateInput) {
    return pmsApi<{ ok: true; data: ServerHousekeepingTask; message?: string }>('/api/housekeeping/tasks', null, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  assignTask(taskId: string, assignedToUserId: string | null, reason: string) {
    return pmsApi<{ ok: true; data: ServerHousekeepingTask; message?: string }>(`/api/housekeeping/tasks/${encodeURIComponent(taskId)}/assign`, null, {
      method: 'POST',
      body: JSON.stringify({ assignedToUserId, reason }),
    })
  },

  transitionTask(taskId: string, status: HousekeepingTaskStatus, reason: string) {
    return pmsApi<{ ok: true; data: ServerHousekeepingTask; message?: string }>(`/api/housekeeping/tasks/${encodeURIComponent(taskId)}/status`, null, {
      method: 'POST',
      body: JSON.stringify({ status, reason }),
    })
  },

  createIssue(input: IssueCreateInput) {
    return pmsApi<{ ok: true; data: ServerHousekeepingIssue; message?: string }>('/api/housekeeping/issues', null, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  transitionIssue(issueId: string, status: HousekeepingIssueStatus, reason: string) {
    return pmsApi<{ ok: true; data: ServerHousekeepingIssue; message?: string }>(`/api/housekeeping/issues/${encodeURIComponent(issueId)}/status`, null, {
      method: 'POST',
      body: JSON.stringify({ status, reason }),
    })
  },
}
