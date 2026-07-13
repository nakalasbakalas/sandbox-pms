import type { ReactNode } from 'react'

import { useI18n, statusLabel } from './i18n'
import type { Language, ReservationSummary } from './types'

export function LoadingBlock() {
  const { t } = useI18n()
  return <div className="state-card state-card--loading">{t('loading')}</div>
}

export function ErrorBlock({ error, retry }: { error: unknown; retry?: () => void }) {
  const { t } = useI18n()
  return (
    <div className="state-card state-card--error" role="alert">
      <strong>{error instanceof Error ? error.message : String(error)}</strong>
      {retry ? <button className="button button--secondary" onClick={retry}>{t('retry')}</button> : null}
    </div>
  )
}

export function EmptyBlock({ children }: { children?: ReactNode }) {
  const { t } = useI18n()
  return <div className="state-card">{children || t('noData')}</div>
}

export function StatusPill({ value }: { value: string }) {
  const { language } = useI18n()
  const tone = /ERROR|FAILED|CANCEL|OUT_OF/.test(value)
    ? 'danger'
    : /PENDING|REVIEW|DIRTY|HOLD|BLOCK/.test(value)
      ? 'warning'
      : /CONFIRMED|CHECKED_IN|AVAILABLE|CLEAN|INSPECTED|COMPLETED|PROCESSED/.test(value)
        ? 'success'
        : 'neutral'
  return <span className={`status status--${tone}`}>{statusLabel(value, language)}</span>
}

export function formatMoney(satang: number | null | undefined, language: Language) {
  return new Intl.NumberFormat(language === 'th' ? 'th-TH' : 'en-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 2,
  }).format(Number(satang || 0) / 100)
}

export function formatDate(value: string | null | undefined, language: Language, options?: Intl.DateTimeFormatOptions) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', options || {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`))
}

export function GuestStay({ reservation, compact = false }: { reservation: ReservationSummary; compact?: boolean }) {
  const { language, t } = useI18n()
  return (
    <div className="guest-stay">
      <div>
        <strong>{reservation.guest.firstName} {reservation.guest.lastName}</strong>
        <span className="muted">{t('confirmation')} {reservation.confirmationCode}</span>
      </div>
      {!compact ? (
        <div>
          <span>{formatDate(reservation.checkIn, language)} → {formatDate(reservation.checkOut, language)}</span>
          <span className="muted">{reservation.roomType.name} · {reservation.assignedRoom?.number || t('unassigned')}</span>
        </div>
      ) : null}
    </div>
  )
}

export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal__header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={close} aria-label="Close">×</button>
        </header>
        {children}
      </section>
    </div>
  )
}

export function StatCard({ label, value, tone = 'default' }: { label: string; value: number | string; tone?: string }) {
  return (
    <article className={`stat stat--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}
