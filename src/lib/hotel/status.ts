import type { Language } from '@/lib/i18n'

export type StatusGroup = 'reservation' | 'room' | 'payment' | 'housekeeping'

export interface StatusDefinition {
  label: Record<Language, string>
  className: string
  dotClassName: string
}

const statusAliases: Record<string, string> = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CHECKED_IN: 'checked_in',
  CHECKED_OUT: 'checked_out',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no_show',
  HOLD: 'hold',
  VACANT_CLEAN: 'available',
  VACANT_DIRTY: 'dirty',
  OCCUPIED_CLEAN: 'occupied',
  OCCUPIED_DIRTY: 'occupied',
  AVAILABLE: 'available',
  BLOCKED: 'blocked',
  OUT_OF_ORDER: 'out_of_order',
  OUT_OF_SERVICE: 'out_of_order',
  CLEAN: 'clean',
  DIRTY: 'dirty',
  INSPECTED: 'inspected',
  CLEANING: 'cleaning',
  IN_PROGRESS: 'in_progress',
  PAID: 'paid',
  PARTIAL: 'partial',
  UNPAID: 'unpaid',
  REFUNDED: 'refunded',
  OVERDUE: 'overdue',
}

const shared = {
  pending: {
    label: { en: 'Pending', th: 'รอดำเนินการ' },
    className: 'border-amber-200 bg-amber-50 text-amber-800',
    dotClassName: 'bg-amber-500',
  },
  paid: {
    label: { en: 'Paid', th: 'ชำระแล้ว' },
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    dotClassName: 'bg-emerald-500',
  },
  partial: {
    label: { en: 'Partial', th: 'ชำระบางส่วน' },
    className: 'border-amber-200 bg-amber-50 text-amber-800',
    dotClassName: 'bg-amber-500',
  },
  unpaid: {
    label: { en: 'Unpaid', th: 'ยังไม่ชำระ' },
    className: 'border-rose-200 bg-rose-50 text-rose-800',
    dotClassName: 'bg-rose-500',
  },
} satisfies Record<string, StatusDefinition>

export const statusCatalog = {
  reservation: {
    pending: shared.pending,
    confirmed: {
      label: { en: 'Confirmed', th: 'ยืนยันแล้ว' },
      className: 'border-sky-200 bg-sky-50 text-sky-800',
      dotClassName: 'bg-sky-500',
    },
    checked_in: {
      label: { en: 'Checked in', th: 'เช็คอินแล้ว' },
      className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      dotClassName: 'bg-emerald-500',
    },
    checked_out: {
      label: { en: 'Checked out', th: 'เช็คเอาต์แล้ว' },
      className: 'border-slate-200 bg-slate-50 text-slate-700',
      dotClassName: 'bg-slate-400',
    },
    cancelled: {
      label: { en: 'Cancelled', th: 'ยกเลิก' },
      className: 'border-rose-200 bg-rose-50 text-rose-800',
      dotClassName: 'bg-rose-500',
    },
    no_show: {
      label: { en: 'No-show', th: 'ไม่มาเข้าพัก' },
      className: 'border-red-200 bg-red-50 text-red-800',
      dotClassName: 'bg-red-500',
    },
    hold: {
      label: { en: 'Hold', th: 'พักไว้' },
      className: 'border-violet-200 bg-violet-50 text-violet-800',
      dotClassName: 'bg-violet-500',
    },
  },
  room: {
    available: {
      label: { en: 'Available', th: 'ว่าง' },
      className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      dotClassName: 'bg-emerald-500',
    },
    occupied: {
      label: { en: 'Occupied', th: 'มีผู้เข้าพัก' },
      className: 'border-sky-200 bg-sky-50 text-sky-800',
      dotClassName: 'bg-sky-500',
    },
    dirty: {
      label: { en: 'Dirty', th: 'รอทำความสะอาด' },
      className: 'border-orange-200 bg-orange-50 text-orange-800',
      dotClassName: 'bg-orange-500',
    },
    cleaning: {
      label: { en: 'Cleaning', th: 'กำลังทำความสะอาด' },
      className: 'border-cyan-200 bg-cyan-50 text-cyan-800',
      dotClassName: 'bg-cyan-500',
    },
    clean: {
      label: { en: 'Clean', th: 'ทำความสะอาดแล้ว' },
      className: 'border-green-200 bg-green-50 text-green-800',
      dotClassName: 'bg-green-500',
    },
    inspected: {
      label: { en: 'Inspected', th: 'ตรวจแล้ว' },
      className: 'border-teal-200 bg-teal-50 text-teal-800',
      dotClassName: 'bg-teal-500',
    },
    out_of_order: {
      label: { en: 'Out of order', th: 'งดใช้งาน' },
      className: 'border-red-200 bg-red-50 text-red-800',
      dotClassName: 'bg-red-500',
    },
    blocked: {
      label: { en: 'Blocked', th: 'ปิดใช้งาน' },
      className: 'border-slate-300 bg-slate-100 text-slate-800',
      dotClassName: 'bg-slate-500',
    },
  },
  payment: {
    unpaid: shared.unpaid,
    partial: shared.partial,
    paid: shared.paid,
    refunded: {
      label: { en: 'Refunded', th: 'คืนเงินแล้ว' },
      className: 'border-violet-200 bg-violet-50 text-violet-800',
      dotClassName: 'bg-violet-500',
    },
    overdue: {
      label: { en: 'Overdue', th: 'เกินกำหนดชำระ' },
      className: 'border-red-200 bg-red-50 text-red-800',
      dotClassName: 'bg-red-500',
    },
  },
  housekeeping: {
    dirty: {
      label: { en: 'Dirty', th: 'รอทำความสะอาด' },
      className: 'border-orange-200 bg-orange-50 text-orange-800',
      dotClassName: 'bg-orange-500',
    },
    in_progress: {
      label: { en: 'In progress', th: 'กำลังทำ' },
      className: 'border-cyan-200 bg-cyan-50 text-cyan-800',
      dotClassName: 'bg-cyan-500',
    },
    clean: {
      label: { en: 'Clean', th: 'ทำความสะอาดแล้ว' },
      className: 'border-green-200 bg-green-50 text-green-800',
      dotClassName: 'bg-green-500',
    },
    inspected: {
      label: { en: 'Inspected', th: 'ตรวจแล้ว' },
      className: 'border-teal-200 bg-teal-50 text-teal-800',
      dotClassName: 'bg-teal-500',
    },
    maintenance: {
      label: { en: 'Maintenance', th: 'ซ่อมบำรุง' },
      className: 'border-red-200 bg-red-50 text-red-800',
      dotClassName: 'bg-red-500',
    },
  },
} satisfies Record<StatusGroup, Record<string, StatusDefinition>>

export function normalizeStatus(status: string): string {
  return statusAliases[status] ?? status.toLowerCase()
}

export function getStatusDefinition(group: StatusGroup, status: string): StatusDefinition {
  const normalized = normalizeStatus(status)
  return statusCatalog[group][normalized] ?? {
    label: { en: status.replaceAll('_', ' '), th: status.replaceAll('_', ' ') },
    className: 'border-slate-200 bg-slate-50 text-slate-700',
    dotClassName: 'bg-slate-400',
  }
}
