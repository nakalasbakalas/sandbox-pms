export interface ReceiptLineItem {
  description: string
  quantity: number
  unitPrice: number
  total: number
  category?: 'ROOM' | 'FOOD' | 'BEVERAGE' | 'EXTRA_GUEST' | 'CHILD_FEE' | 'DAMAGE' | 'OTHER'
}

export interface TaxBreakdown {
  name: string
  rate: number
  baseAmount: number
  taxAmount: number
}

export interface ReceiptData {
  receiptNumber: string
  invoiceNumber: string
  date: Date
  reservationId: string
  guestName: string
  guestEmail?: string
  guestPhone?: string
  roomNumber: string
  roomType: string
  checkInDate: Date
  checkOutDate: Date
  nights: number
  roomCharges: ReceiptLineItem[]
  additionalCharges: ReceiptLineItem[]
  subtotal: number
  tax: number
  taxBreakdown: TaxBreakdown[]
  total: number
  paid: number
  balance: number
  paymentMethod?: 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER'
  paymentReference?: string
  notes?: string
  companyInfo: {
    name: string
    address: string
    phone: string
    email: string
    taxId?: string
  }
}
