import type { ReceiptData, ReceiptLineItem } from '@/types/receipt'
import type { CheckOutData, DepartureItem } from '@/types/front-desk'
import type { PropertySetup } from '@/types/onboarding'
import { calculateTaxes, getDefaultTaxConfiguration } from './tax-calculator'

export function generateReceiptFromCheckOut(
  departure: DepartureItem,
  checkOutData: CheckOutData,
  propertySetup?: PropertySetup
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
      category: 'ROOM'
    },
  ]

  const additionalCharges: ReceiptLineItem[] = []

  if (checkOutData.minibarCharges && checkOutData.minibarCharges > 0) {
    additionalCharges.push({
      description: 'Minibar Charges',
      quantity: 1,
      unitPrice: checkOutData.minibarCharges,
      total: checkOutData.minibarCharges,
      category: 'BEVERAGE'
    })
  }

  if (checkOutData.damageFees && checkOutData.damageFees > 0) {
    additionalCharges.push({
      description: 'Damage Fees',
      quantity: 1,
      unitPrice: checkOutData.damageFees,
      total: checkOutData.damageFees,
      category: 'DAMAGE'
    })
  }

  if (checkOutData.additionalCharges) {
    checkOutData.additionalCharges.forEach((charge) => {
      additionalCharges.push({
        description: charge.description,
        quantity: 1,
        unitPrice: charge.amount,
        total: charge.amount,
        category: 'OTHER'
      })
    })
  }

  const allItems = [...roomCharges, ...additionalCharges]
  
  const taxConfig = propertySetup?.taxConfiguration || getDefaultTaxConfiguration()
  const taxCalculation = calculateTaxes(allItems, taxConfig)

  const paid = checkOutData.balanceSettled ? taxCalculation.grandTotal : departure.folioTotal - departure.balanceDue
  const balance = taxCalculation.grandTotal - paid

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
    roomType: departure.roomType === 'TWIN' ? 'Standard Twin' : 'Superior Double',
    checkInDate,
    checkOutDate: new Date(),
    nights: departure.nights,
    roomCharges,
    additionalCharges,
    subtotal: taxCalculation.subtotal,
    tax: taxCalculation.totalTax,
    taxBreakdown: taxCalculation.taxBreakdown,
    total: taxCalculation.grandTotal,
    paid,
    balance,
    paymentMethod: checkOutData.paymentMethod,
    paymentReference: undefined,
    notes: checkOutData.additionalNotes,
    companyInfo: {
      name: propertySetup?.name || 'Property name',
      address: propertySetup?.address || '',
      phone: propertySetup?.phone || '',
      email: propertySetup?.email || '',
      taxId: propertySetup?.taxId || '',
    },
  }
}
