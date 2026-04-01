import type { StaffMessageTemplate, StaffTemplateCategory } from '@/types/staff-templates'
import type { InternalMessagePriority, StaffDepartment } from '@/types/messaging'

export const DEFAULT_STAFF_TEMPLATES: Omit<StaffMessageTemplate, 'id' | 'usageCount' | 'isFavorite' | 'isCustom' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'Room Ready for Check-In',
    category: 'ROOM_STATUS',
    targetDepartment: 'FRONT_DESK',
    priority: 'NORMAL',
    body: 'Room {{roomNumber}} has been cleaned and inspected. Status: {{status}}. Ready for check-in.',
    variables: [
      { key: 'roomNumber', label: 'Room Number', type: 'room', required: true, placeholder: 'e.g. 101' },
      { key: 'status', label: 'Status', type: 'text', required: true, defaultValue: 'Clean' },
    ],
    requiresAcknowledgment: false,
    tags: ['housekeeping', 'check-in', 'room-ready'],
  },
  {
    name: 'Room Issue - Requires Attention',
    category: 'ROOM_STATUS',
    targetDepartment: 'HOUSEKEEPING',
    priority: 'HIGH',
    body: 'Issue found in Room {{roomNumber}}: {{issue}}. Guest checking in at {{checkInTime}}. Please address ASAP.',
    variables: [
      { key: 'roomNumber', label: 'Room Number', type: 'room', required: true, placeholder: 'e.g. 101' },
      { key: 'issue', label: 'Issue Description', type: 'text', required: true, placeholder: 'e.g. AC not working' },
      { key: 'checkInTime', label: 'Check-in Time', type: 'time', required: true, placeholder: 'e.g. 3:00 PM' },
    ],
    requiresAcknowledgment: true,
    tags: ['urgent', 'room-issue', 'maintenance-needed'],
  },
  {
    name: 'Guest Special Request',
    category: 'GUEST_REQUEST',
    targetDepartment: 'ALL',
    priority: 'NORMAL',
    body: 'Guest {{guestName}} in Room {{roomNumber}} has requested: {{request}}. Please fulfill by {{deadline}}.',
    variables: [
      { key: 'guestName', label: 'Guest Name', type: 'guest', required: true, placeholder: 'e.g. John Smith' },
      { key: 'roomNumber', label: 'Room Number', type: 'room', required: true, placeholder: 'e.g. 101' },
      { key: 'request', label: 'Request Details', type: 'text', required: true, placeholder: 'e.g. Extra towels' },
      { key: 'deadline', label: 'Deadline', type: 'time', required: false, defaultValue: 'ASAP' },
    ],
    requiresAcknowledgment: false,
    tags: ['guest-request', 'service'],
  },
  {
    name: 'VIP Arrival Today',
    category: 'GUEST_REQUEST',
    targetDepartment: 'ALL',
    priority: 'HIGH',
    body: 'VIP Guest arriving today: {{guestName}}, Room {{roomNumber}}. Check-in at {{checkInTime}}. Special requests: {{requests}}. Please ensure exceptional service.',
    variables: [
      { key: 'guestName', label: 'Guest Name', type: 'guest', required: true, placeholder: 'e.g. Jane Doe' },
      { key: 'roomNumber', label: 'Room Number', type: 'room', required: true, placeholder: 'e.g. 501' },
      { key: 'checkInTime', label: 'Check-in Time', type: 'time', required: true, placeholder: 'e.g. 2:00 PM' },
      { key: 'requests', label: 'Special Requests', type: 'text', required: false, defaultValue: 'None' },
    ],
    requiresAcknowledgment: true,
    tags: ['vip', 'arrival', 'special-attention'],
  },
  {
    name: 'Maintenance Request - Urgent',
    category: 'MAINTENANCE',
    targetDepartment: 'MAINTENANCE',
    priority: 'URGENT',
    body: '🚨 URGENT: Maintenance needed in Room {{roomNumber}}. Issue: {{issue}}. Guest is {{guestStatus}}. Please respond immediately.',
    variables: [
      { key: 'roomNumber', label: 'Room Number', type: 'room', required: true, placeholder: 'e.g. 203' },
      { key: 'issue', label: 'Issue Description', type: 'text', required: true, placeholder: 'e.g. Plumbing leak' },
      { key: 'guestStatus', label: 'Guest Status', type: 'text', required: true, placeholder: 'e.g. in room' },
    ],
    requiresAcknowledgment: true,
    tags: ['urgent', 'maintenance', 'emergency'],
  },
  {
    name: 'Maintenance Completed',
    category: 'MAINTENANCE',
    targetDepartment: 'FRONT_DESK',
    priority: 'NORMAL',
    body: 'Maintenance completed for Room {{roomNumber}}. Work performed: {{workDone}}. Room is now {{status}}.',
    variables: [
      { key: 'roomNumber', label: 'Room Number', type: 'room', required: true, placeholder: 'e.g. 305' },
      { key: 'workDone', label: 'Work Performed', type: 'text', required: true, placeholder: 'e.g. Fixed AC unit' },
      { key: 'status', label: 'Room Status', type: 'text', required: true, defaultValue: 'ready for use' },
    ],
    requiresAcknowledgment: false,
    tags: ['maintenance', 'completed', 'room-ready'],
  },
  {
    name: 'Shift Handover - Front Desk',
    category: 'SHIFT_HANDOVER',
    targetDepartment: 'FRONT_DESK',
    priority: 'NORMAL',
    body: 'End of shift handover:\n\n📋 Arrivals today: {{arrivals}}\n📤 Departures pending: {{departures}}\n⚠️ Issues to note: {{issues}}\n💰 Cash drawer: {{cashStatus}}\n\nAdditional notes: {{notes}}',
    variables: [
      { key: 'arrivals', label: 'Arrivals Count', type: 'number', required: true, defaultValue: '0' },
      { key: 'departures', label: 'Pending Departures', type: 'number', required: true, defaultValue: '0' },
      { key: 'issues', label: 'Issues to Note', type: 'text', required: false, defaultValue: 'None' },
      { key: 'cashStatus', label: 'Cash Drawer Status', type: 'text', required: true, defaultValue: 'Balanced' },
      { key: 'notes', label: 'Additional Notes', type: 'text', required: false, defaultValue: 'None' },
    ],
    requiresAcknowledgment: true,
    tags: ['handover', 'shift-change', 'front-desk'],
  },
  {
    name: 'Shift Handover - Housekeeping',
    category: 'SHIFT_HANDOVER',
    targetDepartment: 'HOUSEKEEPING',
    priority: 'NORMAL',
    body: 'Housekeeping shift handover:\n\n✅ Rooms cleaned: {{cleaned}}\n🔄 Rooms in progress: {{inProgress}}\n🧹 Priority rooms for next shift: {{priority}}\n🛠️ Supplies needed: {{supplies}}\n\nNotes: {{notes}}',
    variables: [
      { key: 'cleaned', label: 'Rooms Cleaned', type: 'number', required: true, defaultValue: '0' },
      { key: 'inProgress', label: 'Rooms In Progress', type: 'text', required: false, defaultValue: 'None' },
      { key: 'priority', label: 'Priority Rooms', type: 'text', required: false, defaultValue: 'None' },
      { key: 'supplies', label: 'Supplies Needed', type: 'text', required: false, defaultValue: 'Stocked' },
      { key: 'notes', label: 'Additional Notes', type: 'text', required: false, defaultValue: 'None' },
    ],
    requiresAcknowledgment: true,
    tags: ['handover', 'shift-change', 'housekeeping'],
  },
  {
    name: 'Guest Complaint - Immediate Action',
    category: 'URGENT_ALERT',
    targetDepartment: 'MANAGEMENT',
    priority: 'URGENT',
    body: '🚨 Guest complaint requiring immediate attention!\n\nGuest: {{guestName}}\nRoom: {{roomNumber}}\nComplaint: {{complaint}}\nCurrent status: {{status}}\n\nPlease address immediately.',
    variables: [
      { key: 'guestName', label: 'Guest Name', type: 'guest', required: true, placeholder: 'e.g. John Smith' },
      { key: 'roomNumber', label: 'Room Number', type: 'room', required: true, placeholder: 'e.g. 210' },
      { key: 'complaint', label: 'Complaint Details', type: 'text', required: true, placeholder: 'Describe the issue' },
      { key: 'status', label: 'Current Status', type: 'text', required: true, placeholder: 'e.g. Guest waiting at desk' },
    ],
    requiresAcknowledgment: true,
    tags: ['urgent', 'complaint', 'management'],
  },
  {
    name: 'Early Check-In Request',
    category: 'GUEST_REQUEST',
    targetDepartment: 'HOUSEKEEPING',
    priority: 'HIGH',
    body: 'Early check-in request for {{guestName}}. Arrival time: {{arrivalTime}}. Assigned room: {{roomNumber}}. Current status: {{currentStatus}}. Can we accommodate?',
    variables: [
      { key: 'guestName', label: 'Guest Name', type: 'guest', required: true, placeholder: 'e.g. Sarah Johnson' },
      { key: 'arrivalTime', label: 'Arrival Time', type: 'time', required: true, placeholder: 'e.g. 10:00 AM' },
      { key: 'roomNumber', label: 'Room Number', type: 'room', required: true, placeholder: 'e.g. 105' },
      { key: 'currentStatus', label: 'Current Room Status', type: 'text', required: true, placeholder: 'e.g. Dirty' },
    ],
    requiresAcknowledgment: true,
    tags: ['early-check-in', 'guest-request', 'priority'],
  },
  {
    name: 'Late Check-Out Approved',
    category: 'DAILY_OPERATIONS',
    targetDepartment: 'HOUSEKEEPING',
    priority: 'NORMAL',
    body: 'Late check-out approved for {{guestName}} in Room {{roomNumber}}. New departure time: {{departureTime}}. Please adjust cleaning schedule accordingly.',
    variables: [
      { key: 'guestName', label: 'Guest Name', type: 'guest', required: true, placeholder: 'e.g. Michael Brown' },
      { key: 'roomNumber', label: 'Room Number', type: 'room', required: true, placeholder: 'e.g. 308' },
      { key: 'departureTime', label: 'New Departure Time', type: 'time', required: true, placeholder: 'e.g. 2:00 PM' },
    ],
    requiresAcknowledgment: false,
    tags: ['late-checkout', 'scheduling', 'housekeeping'],
  },
  {
    name: 'Lost and Found Item',
    category: 'DAILY_OPERATIONS',
    targetDepartment: 'FRONT_DESK',
    priority: 'NORMAL',
    body: 'Item found in Room {{roomNumber}}: {{itemDescription}}. Last guest: {{guestName}}. Item is being held at front desk.',
    variables: [
      { key: 'roomNumber', label: 'Room Number', type: 'room', required: true, placeholder: 'e.g. 412' },
      { key: 'itemDescription', label: 'Item Description', type: 'text', required: true, placeholder: 'e.g. Black phone charger' },
      { key: 'guestName', label: 'Previous Guest', type: 'guest', required: false, placeholder: 'e.g. Jane Smith' },
    ],
    requiresAcknowledgment: false,
    tags: ['lost-and-found', 'guest-property'],
  },
  {
    name: 'Group Check-In Alert',
    category: 'DAILY_OPERATIONS',
    targetDepartment: 'FRONT_DESK',
    priority: 'HIGH',
    body: 'Group check-in scheduled: {{groupName}} - {{numberOfGuests}} guests arriving at {{arrivalTime}}. Rooms assigned: {{roomNumbers}}. Lead contact: {{contactName}}.',
    variables: [
      { key: 'groupName', label: 'Group Name', type: 'text', required: true, placeholder: 'e.g. Smith Wedding Party' },
      { key: 'numberOfGuests', label: 'Number of Guests', type: 'number', required: true, placeholder: 'e.g. 15' },
      { key: 'arrivalTime', label: 'Arrival Time', type: 'time', required: true, placeholder: 'e.g. 4:00 PM' },
      { key: 'roomNumbers', label: 'Room Numbers', type: 'text', required: true, placeholder: 'e.g. 201-215' },
      { key: 'contactName', label: 'Lead Contact', type: 'guest', required: true, placeholder: 'e.g. John Smith' },
    ],
    requiresAcknowledgment: true,
    tags: ['group', 'check-in', 'scheduling'],
  },
  {
    name: 'Amenity Restock Needed',
    category: 'DAILY_OPERATIONS',
    targetDepartment: 'HOUSEKEEPING',
    priority: 'NORMAL',
    body: 'Amenity restock needed: {{items}}. Current inventory: {{currentLevel}}. Please restock by {{deadline}}.',
    variables: [
      { key: 'items', label: 'Items Needed', type: 'text', required: true, placeholder: 'e.g. Toiletries, towels' },
      { key: 'currentLevel', label: 'Current Inventory', type: 'text', required: false, defaultValue: 'Low' },
      { key: 'deadline', label: 'Restock By', type: 'date', required: false, defaultValue: 'End of day' },
    ],
    requiresAcknowledgment: false,
    tags: ['supplies', 'inventory', 'housekeeping'],
  },
  {
    name: 'No Show - Room Available',
    category: 'DAILY_OPERATIONS',
    targetDepartment: 'FRONT_DESK',
    priority: 'NORMAL',
    body: 'No-show for reservation {{confirmationNumber}}. Guest: {{guestName}}. Room {{roomNumber}} is now available for re-assignment.',
    variables: [
      { key: 'confirmationNumber', label: 'Confirmation Number', type: 'text', required: true, placeholder: 'e.g. ABC123' },
      { key: 'guestName', label: 'Guest Name', type: 'guest', required: true, placeholder: 'e.g. Tom Wilson' },
      { key: 'roomNumber', label: 'Room Number', type: 'room', required: true, placeholder: 'e.g. 115' },
    ],
    requiresAcknowledgment: false,
    tags: ['no-show', 'availability', 'front-desk'],
  },
]

export function createTemplateId(): string {
  return `tmpl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

export function replaceTemplateVariables(template: string, values: Record<string, string>): string {
  let result = template
  Object.entries(values).forEach(([key, value]) => {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value)
  })
  return result
}

export function extractTemplateVariables(template: string): string[] {
  const matches = template.match(/{{([^}]+)}}/g)
  if (!matches) return []
  return matches.map(m => m.replace(/{{|}}/g, ''))
}

export function getTemplatesByCategory(templates: StaffMessageTemplate[], category: StaffTemplateCategory): StaffMessageTemplate[] {
  return templates.filter(t => t.category === category)
}

export function getTemplatesByDepartment(templates: StaffMessageTemplate[], department: StaffDepartment): StaffMessageTemplate[] {
  return templates.filter(t => t.targetDepartment === department || t.targetDepartment === 'ALL')
}

export function getFavoriteTemplates(templates: StaffMessageTemplate[]): StaffMessageTemplate[] {
  return templates.filter(t => t.isFavorite).sort((a, b) => b.usageCount - a.usageCount)
}

export function getMostUsedTemplates(templates: StaffMessageTemplate[], limit: number = 5): StaffMessageTemplate[] {
  return [...templates].sort((a, b) => b.usageCount - a.usageCount).slice(0, limit)
}

export const TEMPLATE_CATEGORIES: { value: StaffTemplateCategory; label: string; icon: string }[] = [
  { value: 'ROOM_STATUS', label: 'Room Status', icon: 'bed' },
  { value: 'GUEST_REQUEST', label: 'Guest Requests', icon: 'user' },
  { value: 'MAINTENANCE', label: 'Maintenance', icon: 'wrench' },
  { value: 'SHIFT_HANDOVER', label: 'Shift Handover', icon: 'arrows-clockwise' },
  { value: 'URGENT_ALERT', label: 'Urgent Alerts', icon: 'warning' },
  { value: 'DAILY_OPERATIONS', label: 'Daily Operations', icon: 'calendar' },
  { value: 'CUSTOM', label: 'Custom', icon: 'pencil' },
]
