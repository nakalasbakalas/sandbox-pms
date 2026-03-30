import type { ReceiptData, ReceiptLineItem } from '@/types/receipt'
import type { CheckOutData, DepartureItem } from '@/types/front-desk'

export function generateReceiptFromCheckOut(
  departure: DepartureItem,
  checkOutData: CheckOutData
): ReceiptData {
  const now = new Date()
  const receiptNumber = `RCP-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
  const invoiceNumber = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`

  const roomCharges: ReceiptLineItem[] = [
    {
      description: `${departure.roomType} Room - Room ${departure.roomNumber}`,
      quantity: departure.nights,
      unitPrice: departure.folioTotal / departure.nights,
      total: departure.folioTotal,
    },
  ]

  const additionalCharges: ReceiptLineItem[] = []

  if (checkOutData.minibarCharges && checkOutData.minibarCharges > 0) {
    additionalCharges.push({
      description: 'Minibar Charges',
      quantity: 1,
      unitPrice: checkOutData.minibarCharges,
      total: checkOutData.minibarCharges,
    })
  }

  if (checkOutData.damageFees && checkOutData.damageFees > 0) {
    additionalCharges.push({
      description: 'Damage Fees',
      quantity: 1,
      unitPrice: checkOutData.damageFees,
      total: checkOutData.damageFees,
    })
  }

  if (checkOutData.additionalCharges) {
    checkOutData.additionalCharges.forEach((charge) => {
      additionalCharges.push({
        description: charge.description,
        quantity: 1,
        unitPrice: charge.amount,
        total: charge.amount,
      })
    })
  }

  const subtotal =
    roomCharges.reduce((sum, item) => sum + item.total, 0) +
    additionalCharges.reduce((sum, item) => sum + item.total, 0)

  const tax = 0
  const total = subtotal + tax

  const paid = checkOutData.balanceSettled ? total : departure.folioTotal - departure.balanceDue
  const balance = total - paid

  const checkInDate = new Date()
  checkInDate.setDate(checkInDate.getDate() - departure.nights)

  return {
    receiptNumber,
    invoiceNumber,
    date: now,
    reservationId: departure.reservationId,
    guestName: departure.guestName,
    guestEmail: undefined,
    guestPhone: undefined,
    roomNumber: departure.roomNumber,
    roomType: departure.roomType === 'TWIN' ? 'Twin Room' : 'Double Room',
    checkInDate,
    checkOutDate: new Date(),
    nights: departure.nights,
    roomCharges,
    additionalCharges,
    subtotal,
    tax,
    total,
    paid,
    balance,
    paymentMethod: checkOutData.paymentMethod,
    paymentReference: undefined,
    notes: checkOutData.additionalNotes,
    companyInfo: {
      name: 'Sandbox Hotel',
      address: '123 Beach Road, Patong, Phuket 83150, Thailand',
      phone: '+66 (0)76 123 4567',
      email: 'info@sandboxhotel.com',
      taxId: 'TAX-0123456789',
    },
  }
}
