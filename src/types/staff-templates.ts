import type { InternalMessagePriority, StaffDepartment } from './messaging'

export interface StaffMessageTemplate {
  id: string
  name: string
  category: StaffTemplateCategory
  targetDepartment?: StaffDepartment
  priority: InternalMessagePriority
  subject?: string
  body: string
  variables: TemplateVariable[]
  requiresAcknowledgment: boolean
  tags: string[]
  usageCount: number
  isFavorite: boolean
  isCustom: boolean
  createdAt: Date
  updatedAt: Date
}

export type StaffTemplateCategory = 
  | 'ROOM_STATUS'
  | 'GUEST_REQUEST'
  | 'MAINTENANCE'
  | 'SHIFT_HANDOVER'
  | 'URGENT_ALERT'
  | 'DAILY_OPERATIONS'
  | 'CUSTOM'

export interface TemplateVariable {
  key: string
  label: string
  type: 'text' | 'number' | 'room' | 'guest' | 'time' | 'date'
  required: boolean
  defaultValue?: string
  placeholder?: string
}

export interface TemplatePreset {
  name: string
  category: StaffTemplateCategory
  templates: Omit<StaffMessageTemplate, 'id' | 'usageCount' | 'isFavorite' | 'isCustom' | 'createdAt'>[]
}
