import { statusLabel } from './i18n'
import type { BookingDetail, Language, MoneySatang } from './types'

function money(satang: MoneySatang, language: Language, currency: string) {
  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : 'THB'
  return new Intl.NumberFormat(language === 'th' ? 'th-TH' : 'en-TH', {
    style: 'currency',
    currency: safeCurrency,
    minimumFractionDigits: 2,
  }).format(satang / 100)
}

function timestamp(value: string | null, language: Language) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  }).format(date)
}

export function GuestFolioDocument({ detail, language, preparedAt }: { detail: BookingDetail; language: Language; preparedAt: string }) {
  const { property, reservation } = detail
  const folio = reservation.folio
  if (!folio) return null
  const currency = String(property.currency || 'THB').trim().toUpperCase()
  const isThai = language === 'th'
  const checkIn = reservation.checkIn?.slice(0, 10) || '—'
  const checkOut = reservation.checkOut?.slice(0, 10) || '—'
  const nights = Number.isSafeInteger(reservation.nights) ? reservation.nights : null

  return (
    <article className="folio-print-sheet" aria-hidden="true">
      <header className="folio-print-header">
        <div><p>{property.name}</p><h1>{isThai ? 'โฟลิโอผู้เข้าพัก / ใบสรุปรายการ' : 'Guest Folio / Statement'}</h1></div>
        <div className="folio-print-status"><span>{isThai ? 'ยอดคงเหลือ' : 'Balance due'}</span><strong>{money(folio.balanceSatang, language, currency)}</strong></div>
      </header>
      <p className="folio-print-disclaimer">{isThai ? 'เอกสารสรุปรายการจากระบบโรงแรม ไม่ใช่ใบกำกับภาษี และไม่มีเลขที่ใบกำกับภาษีหรือเลขประจำตัวผู้เสียภาษี' : 'Operational guest folio generated from the hotel ledger. This is not a tax invoice and does not claim a tax-invoice number or tax ID.'}</p>
      <dl className="folio-print-meta">
        <div><dt>{isThai ? 'ผู้เข้าพัก' : 'Guest'}</dt><dd>{reservation.guest.displayName}</dd></div>
        <div><dt>{isThai ? 'เลขยืนยันการจอง' : 'Booking confirmation'}</dt><dd>{reservation.confirmationCode}</dd></div>
        <div><dt>{isThai ? 'รหัสโฟลิโอ' : 'Folio ID'}</dt><dd>{folio.id}</dd></div>
        <div><dt>{isThai ? 'ห้อง' : 'Room'}</dt><dd>{reservation.assignedRoom?.number || (isThai ? 'ยังไม่มอบหมาย' : 'Unassigned')}</dd></div>
        <div><dt>{isThai ? 'เข้าพัก' : 'Stay'}</dt><dd>{checkIn} → {checkOut}{nights === null ? '' : ` · ${nights} ${isThai ? 'คืน' : nights === 1 ? 'night' : 'nights'}`}</dd></div>
        <div><dt>{isThai ? 'สถานะ' : 'Status'}</dt><dd>{statusLabel(reservation.status, language)}</dd></div>
      </dl>

      <section className="folio-print-section">
        <h2>{isThai ? 'รายการค่าใช้จ่าย' : 'Charges'}</h2>
        <table>
          <thead><tr><th>{isThai ? 'วันที่' : 'Date'}</th><th>{isThai ? 'รายละเอียด' : 'Description'}</th><th>{isThai ? 'จำนวน' : 'Qty'}</th><th>{isThai ? 'ราคาต่อหน่วย' : 'Unit'}</th><th>{isThai ? 'รวม' : 'Amount'}</th></tr></thead>
          <tbody>
            {folio.charges.length === 0 ? <tr><td colSpan={5}>{isThai ? 'ไม่มีรายการค่าใช้จ่าย' : 'No charges posted.'}</td></tr> : folio.charges.map((charge) => (
              <tr className={charge.void ? 'is-void' : undefined} key={charge.id}>
                <td>{charge.date}</td>
                <td>{charge.description}<small>{statusLabel(charge.category, language)}{charge.void ? ` · ${isThai ? 'ยกเลิกแล้ว' : 'VOID'}` : ''}</small></td>
                <td>{charge.quantity}</td>
                <td>{money(charge.amountSatang, language, currency)}</td>
                <td>{money(charge.totalSatang, language, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="folio-print-section">
        <h2>{isThai ? 'การชำระเงิน' : 'Payments'}</h2>
        <table>
          <thead><tr><th>{isThai ? 'วันที่และเวลา' : 'Posted'}</th><th>{isThai ? 'วิธีชำระ' : 'Method'}</th><th>{isThai ? 'เลขอ้างอิง' : 'Reference'}</th><th>{isThai ? 'จำนวนเงิน' : 'Amount'}</th></tr></thead>
          <tbody>
            {folio.payments.length === 0 ? <tr><td colSpan={4}>{isThai ? 'ยังไม่มีการชำระเงิน' : 'No payments posted.'}</td></tr> : folio.payments.map((payment) => (
              <tr key={payment.id}>
                <td>{timestamp(payment.createdAt, language)}</td>
                <td>{payment.entryKind === 'REVERSAL' ? (isThai ? 'กลับรายการชำระ' : 'Payment reversal') : statusLabel(payment.method, language)}</td>
                <td>{payment.entryKind === 'REVERSAL' ? payment.reversalReason || '—' : payment.reference || '—'}</td>
                <td>{money(payment.amountSatang, language, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="folio-print-totals">
        <div><span>{isThai ? 'ยอดก่อนภาษี' : 'Subtotal'}</span><strong>{money(folio.subtotalSatang, language, currency)}</strong></div>
        <div><span>{isThai ? 'ภาษีที่บันทึกในโฟลิโอ' : 'Tax recorded in folio'}</span><strong>{money(folio.taxSatang, language, currency)}</strong></div>
        <div><span>{isThai ? 'ยอดรวม' : 'Total'}</span><strong>{money(folio.totalSatang, language, currency)}</strong></div>
        <div><span>{isThai ? 'ชำระแล้วสุทธิ' : 'Net paid'}</span><strong>{money(folio.paidSatang, language, currency)}</strong></div>
        <div className="folio-print-totals__balance"><span>{isThai ? 'ยอดคงเหลือ' : 'Balance due'}</span><strong>{money(folio.balanceSatang, language, currency)}</strong></div>
      </section>
      <footer className="folio-print-footer"><span>{isThai ? 'อัปเดตบัญชีล่าสุด' : 'Ledger updated'}: {timestamp(folio.updatedAt, language)}</span><span>{isThai ? 'จัดทำสำเนา' : 'Copy prepared'}: {timestamp(preparedAt, language)}</span></footer>
    </article>
  )
}
