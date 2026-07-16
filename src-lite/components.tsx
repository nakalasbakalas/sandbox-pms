import { useEffect, useId, useRef, type ReactNode } from 'react'

import { useI18n, statusLabel } from './i18n'
import type { Language, ReservationSummary } from './types'

export function LoadingBlock() {
  const { t } = useI18n()
  return <div className="state-card state-card--loading" role="status" aria-live="polite">{t('loading')}</div>
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
    : /PENDING|REVIEW|DIRTY|HOLD|BLOCK|DISABLED|NOT_READY|NOT_CONFIGURED|FALLBACK/.test(value)
      ? 'warning'
      : /CONFIRMED|CHECKED_IN|AVAILABLE|CLEAN|INSPECTED|COMPLETED|PROCESSED|ENABLED|READY|WATCHING|CONFIGURED/.test(value)
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
        <strong>{reservation.guest.displayName || `${reservation.guest.firstName || ''} ${reservation.guest.lastName || ''}`.trim()}</strong>
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
  const { t } = useI18n()
  const titleId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef(close)
  useEffect(() => {
    closeRef.current = close
  }, [close])
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return undefined
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusableElements = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0)
    const initialFocus = dialog.querySelector<HTMLElement>(
      '[autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not(.icon-button):not([disabled]), a[href]',
    )
    ;(initialFocus || focusableElements()[0] || dialog).focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = focusableElements()
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [])
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="modal__header">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" onClick={close} aria-label={t('close')}>×</button>
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
