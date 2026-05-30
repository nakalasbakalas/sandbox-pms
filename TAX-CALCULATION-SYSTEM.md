# Automatic Tax Calculation System

## Overview

The Sandbox Hotel PMS now includes a sophisticated automatic tax calculation and breakdown system on receipts and invoices. This system is designed specifically for Thai hospitality operations with VAT and service charge requirements, but is flexible enough to accommodate any tax structure.

## Features

### 1. **Automatic Tax Calculation**
- Real-time tax calculation during checkout
- Support for multiple tax rates (VAT, Service Charge, etc.)
- Tax-inclusive or tax-exclusive pricing models
- Category-specific tax application

### 2. **Detailed Tax Breakdown**
- Line-by-line tax calculation
- Clear breakdown showing:
  - Subtotal (base amount)
  - Individual tax amounts with rates
  - Combined total tax
  - Grand total
- Receipt and invoice views

### 3. **Configurable Tax Rates**
- Define multiple tax rates
- Set tax name and percentage
- Configure which charge categories each tax applies to:
  - All Charges
  - Room Charges Only
  - Food Only
  - Beverage Only
  - Food, Beverage & Extras

### 4. **Tax-Inclusive Pricing**
- Thailand-standard tax-inclusive pricing
- Automatic calculation of base amount from gross
- Clear display of tax components

## Default Configuration (Thailand)

By default, the system is configured for Thai hospitality:

```typescript
VAT: 7% (applies to all charges)
Service Charge: 10% (applies to all charges)
Prices Include Tax: Yes (Thai standard)
```

This results in a 17% combined tax rate that is already included in displayed prices.

## Usage

### For Front Desk Staff

**During Check-Out:**
1. Complete the check-out process as normal
2. Add any additional charges (minibar, damage fees, etc.)
3. The system automatically:
   - Calculates taxes based on charge categories
   - Shows breakdown in the receipt
   - Includes proper tax amounts in totals

**Receipt Display:**
- Subtotal shows the base amount before tax
- Each tax is listed with its rate and amount
- Total Tax shows the combined amount
- Grand Total shows the final amount due

### For Managers (Settings)

**Configuring Tax Settings:**
1. Navigate to Settings → Tax
2. Toggle "Enable Tax Calculation" on/off
3. Set "Prices Include Tax" based on your pricing model
4. Add, edit, or remove tax rates
5. Save changes

**Example Configurations:**

**Standard Thailand:**
- VAT: 7% on all charges
- Service: 10% on all charges
- Prices include tax: Yes

**Room-Only Tax:**
- Room Tax: 10% on room charges only
- Prices include tax: No

**Mixed Taxation:**
- VAT: 7% on all charges
- Service: 10% on food & beverage only
- Prices include tax: Yes

## Technical Implementation

### Tax Calculator Module

Location: `/src/lib/tax-calculator.ts`

**Key Functions:**

```typescript
calculateTaxes(items: ReceiptLineItem[], taxConfig?: TaxConfiguration): TaxCalculationResult
```
- Calculates all taxes for a list of items
- Returns subtotal, total tax, grand total, and breakdown

```typescript
getDefaultTaxConfiguration(): TaxConfiguration
```
- Returns Thai standard tax configuration

### Receipt Types

**TaxBreakdown:**
```typescript
{
  name: string          // e.g., "VAT", "Service Charge"
  rate: number          // e.g., 7, 10
  baseAmount: number    // Amount tax is calculated on
  taxAmount: number     // Actual tax amount
}
```

**ReceiptData (Enhanced):**
```typescript
{
  // ... other fields
  subtotal: number              // Base amount before tax
  tax: number                   // Total combined tax
  taxBreakdown: TaxBreakdown[]  // Individual tax details
  total: number                 // Grand total
}
```

### Tax Settings Component

Location: `/src/components/settings/TaxSettings.tsx`

Features:
- Toggle tax calculation on/off
- Toggle tax-inclusive pricing
- Add/remove/edit tax rates
- Real-time example calculation
- Visual combined rate display

## Receipt Display

### Tax-Inclusive Example

```
Subtotal:              ฿854.70
  VAT (7%):           ฿59.83
  Service (10%):      ฿85.47
Total Tax:            ฿145.30
────────────────────────────
Total:              ฿1,000.00
```

### Tax-Exclusive Example

```
Subtotal:            ฿1,000.00
  VAT (7%):            ฿70.00
  Service (10%):      ฿100.00
Total Tax:            ฿170.00
────────────────────────────
Total:              ฿1,170.00
```

## Calculation Logic

### Tax-Inclusive Calculation

When prices include tax, the system:
1. Takes the gross amount (displayed price)
2. Calculates the base amount: `base = gross / (1 + taxRate/100)`
3. Calculates each tax: `taxAmount = base × (taxRate/100)`
4. Grand total equals the original gross amount

**Example:**
- Displayed price: ฿1,000
- Combined tax rate: 17%
- Base: ฿1,000 / 1.17 = ฿854.70
- VAT (7%): ฿854.70 × 0.07 = ฿59.83
- Service (10%): ฿854.70 × 0.10 = ฿85.47
- Total: ฿1,000.00

### Tax-Exclusive Calculation

When prices don't include tax, the system:
1. Takes the base amount (displayed price)
2. Calculates each tax: `taxAmount = base × (taxRate/100)`
3. Adds all taxes to get grand total

**Example:**
- Base price: ฿1,000
- VAT (7%): ฿1,000 × 0.07 = ฿70
- Service (10%): ฿1,000 × 0.10 = ฿100
- Total: ฿1,170

## Category-Based Taxation

Different charges can have different tax treatments:

**Charge Categories:**
- `ROOM` - Room charges, extra guest fees, child fees
- `FOOD` - Food charges
- `BEVERAGE` - Beverage charges, minibar
- `DAMAGE` - Damage fees
- `OTHER` - Miscellaneous charges

**Tax Application:**
- `ALL` - Applies to all categories
- `ROOM` - Applies to room-related charges only
- `FOOD` - Applies to food only
- `BEVERAGE` - Applies to beverages only
- `EXTRAS` - Applies to food, beverage, and other extras

## Best Practices

### For Thai Operations

1. **Keep prices tax-inclusive** - This is the Thai standard and what guests expect
2. **Use 7% VAT + 10% Service** - Standard Thai hotel taxation
3. **Show tax breakdown on invoices** - Required for tax invoice compliance
4. **Include tax ID on receipts** - Use the property tax ID from settings

### For International Operations

1. **Choose appropriate pricing model** - Tax-inclusive or exclusive based on local practice
2. **Configure taxes accurately** - Match local tax laws
3. **Update tax rates promptly** - When regulations change
4. **Provide clear documentation** - Ensure guests understand charges

## Compliance Features

### Tax Invoice Requirements

The system generates proper tax invoices with:
- Unique invoice number
- Date and time
- Property tax ID
- Guest information
- Detailed charge breakdown
- Individual tax amounts and rates
- Total tax clearly shown
- Computer-generated disclaimer

### Audit Trail

All tax calculations are:
- Based on saved configuration at checkout time
- Immutable once generated
- Stored with full breakdown details
- Available for reporting and auditing

## Troubleshooting

### Tax Not Calculating

1. Check Settings → Tax → "Enable Tax Calculation" is ON
2. Verify tax rates are configured (not 0%)
3. Ensure charge categories are set correctly
4. Check that tax applies to the charge categories

### Incorrect Tax Amounts

1. Verify the "Prices Include Tax" setting matches your pricing model
2. Check individual tax rates are correct
3. Review category assignments for charges
4. Use the example calculator in settings to verify logic

### Tax Not Showing on Receipt

1. Ensure checkout was completed after tax configuration
2. Check that receipt is using the latest version
3. Verify taxBreakdown is populated in receipt data

## Future Enhancements

Planned features:
- Room type specific tax rates
- Date-based tax rate changes
- Tax exemption for certain guest types
- Multi-currency tax calculation
- Export tax reports for accounting
- Integration with accounting systems

## Support

For questions or issues with the tax system:
1. Review this documentation
2. Check Settings → Tax for configuration
3. Test with example calculations
4. Review receipt output carefully
5. Consult with your accounting team for compliance

---

**Last Updated:** December 2024  
**Version:** 1.0.0  
**Tested For:** Thailand hospitality operations
