import type { TaxConfiguration, TaxRate } from '@/types/onboarding'
import type { TaxBreakdown, ReceiptLineItem } from '@/types/receipt'

export interface TaxCalculationResult {
  subtotal: number
  totalTax: number
  grandTotal: number
  taxBreakdown: TaxBreakdown[]
}

const THAILAND_DEFAULT_TAXES: TaxRate[] = [
  {
    id: 'vat',
    name: 'VAT',
    rate: 7,
    appliesTo: 'ALL',
    included: true
  },
  {
    id: 'service',
    name: 'Service Charge',
    rate: 10,
    appliesTo: 'ALL',
    included: true
  }
]

export function getDefaultTaxConfiguration(): TaxConfiguration {
  return {
    enabled: true,
    pricesIncludeTax: true,
    taxes: THAILAND_DEFAULT_TAXES
  }
}

function categorizeTaxApplicability(
  category: ReceiptLineItem['category'] | undefined,
  taxAppliesTo: TaxRate['appliesTo']
): boolean {
  if (taxAppliesTo === 'ALL') return true
  if (!category) return taxAppliesTo === 'ALL'
  
  switch (taxAppliesTo) {
    case 'ROOM':
      return category === 'ROOM' || category === 'EXTRA_GUEST' || category === 'CHILD_FEE'
    case 'FOOD':
      return category === 'FOOD'
    case 'BEVERAGE':
      return category === 'BEVERAGE'
    case 'EXTRAS':
      return category === 'FOOD' || category === 'BEVERAGE' || category === 'OTHER'
    default:
      return false
  }
}

export function calculateTaxes(
  items: ReceiptLineItem[],
  taxConfig?: TaxConfiguration
): TaxCalculationResult {
  if (!taxConfig || !taxConfig.enabled || taxConfig.taxes.length === 0) {
    const subtotal = items.reduce((sum, item) => sum + item.total, 0)
    return {
      subtotal,
      totalTax: 0,
      grandTotal: subtotal,
      taxBreakdown: []
    }
  }

  const { pricesIncludeTax, taxes } = taxConfig
  const taxBreakdown: TaxBreakdown[] = []
  let subtotal: number
  let totalTax = 0

  if (pricesIncludeTax) {
    const totalGross = items.reduce((sum, item) => sum + item.total, 0)
    
    const cumulativeTaxRate = taxes.reduce((sum, tax) => sum + tax.rate, 0)
    const taxMultiplier = cumulativeTaxRate / 100
    
    subtotal = totalGross / (1 + taxMultiplier)
    
    taxes.forEach(tax => {
      const applicableItems = items.filter(item => 
        categorizeTaxApplicability(item.category, tax.appliesTo)
      )
      
      if (applicableItems.length === 0) return
      
      const baseAmountForThisTax = applicableItems.reduce((sum, item) => sum + item.total, 0) / (1 + taxMultiplier)
      const taxAmount = baseAmountForThisTax * (tax.rate / 100)
      
      totalTax += taxAmount
      taxBreakdown.push({
        name: tax.name,
        rate: tax.rate,
        baseAmount: baseAmountForThisTax,
        taxAmount
      })
    })
  } else {
    subtotal = items.reduce((sum, item) => sum + item.total, 0)
    
    taxes.forEach(tax => {
      const applicableItems = items.filter(item => 
        categorizeTaxApplicability(item.category, tax.appliesTo)
      )
      
      if (applicableItems.length === 0) return
      
      const baseAmountForThisTax = applicableItems.reduce((sum, item) => sum + item.total, 0)
      const taxAmount = baseAmountForThisTax * (tax.rate / 100)
      
      totalTax += taxAmount
      taxBreakdown.push({
        name: tax.name,
        rate: tax.rate,
        baseAmount: baseAmountForThisTax,
        taxAmount
      })
    })
  }

  const grandTotal = pricesIncludeTax ? items.reduce((sum, item) => sum + item.total, 0) : subtotal + totalTax

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    totalTax: Math.round(totalTax * 100) / 100,
    grandTotal: Math.round(grandTotal * 100) / 100,
    taxBreakdown: taxBreakdown.map(breakdown => ({
      ...breakdown,
      baseAmount: Math.round(breakdown.baseAmount * 100) / 100,
      taxAmount: Math.round(breakdown.taxAmount * 100) / 100
    }))
  }
}

export function calculateTaxExclusive(
  grossAmount: number,
  taxRate: number
): { net: number; tax: number } {
  const net = grossAmount / (1 + taxRate / 100)
  const tax = grossAmount - net
  return {
    net: Math.round(net * 100) / 100,
    tax: Math.round(tax * 100) / 100
  }
}

export function calculateTaxInclusive(
  netAmount: number,
  taxRate: number
): { gross: number; tax: number } {
  const tax = netAmount * (taxRate / 100)
  const gross = netAmount + tax
  return {
    gross: Math.round(gross * 100) / 100,
    tax: Math.round(tax * 100) / 100
  }
}

export function formatTaxRate(rate: number): string {
  return `${rate}%`
}

export function getTaxSummary(taxBreakdown: TaxBreakdown[]): string {
  if (taxBreakdown.length === 0) return 'No taxes applied'
  
  return taxBreakdown
    .map(tax => `${tax.name} (${formatTaxRate(tax.rate)}): ฿${tax.taxAmount.toLocaleString()}`)
    .join(', ')
}
