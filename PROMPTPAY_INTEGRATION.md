# PromptPay QR Payment Integration

## Overview

This PMS now includes full PromptPay QR payment integration for Thailand. PromptPay is Thailand's national instant payment system that allows customers to pay using QR codes scanned with any Thai banking app.

## Features

### 1. Real QR Code Generation
- Uses `promptpay-qr` library for EMVCo-compliant QR payload generation
- Uses `qrcode` library for high-quality QR code rendering
- Generates scannable QR codes that work with all Thai banking apps

### 2. Configurable PromptPay ID
- Admin can configure the hotel's PromptPay phone number in Settings > Tax & Payments
- Phone number validation (Thai mobile numbers)
- Automatic formatting (handles +66, 66, 0 prefixes)
- Test QR generation to verify setup

### 3. Payment Workflow Integration
- Integrated into check-in deposit collection
- Integrated into check-out payment collection
- Automatic amount calculation
- Transaction reference tracking
- 5-minute QR expiry timer

### 4. User Experience
- Clean, compact QR display
- Copy-to-clipboard for PromptPay ID
- Clear instructions in Thai context
- Loading states during QR generation
- Error handling and validation

## How to Configure

1. Go to **Settings** > **Tax & Payments** tab
2. Find the **PromptPay Settings** card
3. Enter your PromptPay-registered phone number (e.g., 081-234-5678)
4. Click **Save**
5. Click **Generate Test QR** to verify
6. Scan with your banking app to test

## Supported Phone Number Formats

- `0812345678` (standard Thai format)
- `081-234-5678` (with dashes)
- `+66812345678` (international format)
- `66812345678` (without plus)

All formats are automatically normalized to the correct format for QR generation.

## How Staff Use It

### During Check-In (Deposit Collection)
1. Staff selects **PromptPay/QR** as payment method
2. QR code automatically generates with deposit amount
3. Guest scans QR with their banking app
4. Guest completes payment in their app
5. Staff enters the transaction reference number
6. Staff clicks **Confirm Payment**

### During Check-Out (Balance Payment)
1. System calculates balance due
2. Staff selects **PromptPay/QR** payment method
3. QR code generates with exact balance amount
4. Guest scans and pays
5. Staff confirms with transaction reference
6. Check-out completes

## Technical Implementation

### Libraries Used
- `promptpay-qr@5.0.0` - Generates EMVCo-compliant PromptPay payloads
- `qrcode@1.5.4` - Renders QR codes as PNG images

### Key Files
- `/src/lib/promptpay.ts` - PromptPay utility functions
- `/src/components/front-desk/PromptPayQR.tsx` - QR display component
- `/src/components/front-desk/PaymentCollection.tsx` - Payment method selector
- `/src/components/settings/PromptPaySettings.tsx` - Admin configuration

### Data Storage
- PromptPay ID stored in: `hotel-promptpay-id` (KV store)
- Format: Normalized Thai phone number (e.g., "0812345678")

## QR Code Specifications

- **Format**: EMVCo QR Code
- **Error Correction**: Medium (M)
- **Size**: 400x400 pixels
- **Margin**: 2 modules
- **Encoding**: UTF-8
- **Currency**: THB (Thai Baht, code 764)
- **Country**: TH (Thailand)

## Security & Compliance

- QR codes expire after 5 minutes
- Transaction references are required for audit trail
- All transactions are logged with payment method
- No sensitive banking data is stored
- Uses official PromptPay standard (Thailand National ITMX)

## Supported Banking Apps

All Thai banks that support PromptPay, including:
- SCB Easy (Siam Commercial Bank)
- Krungthai NEXT (Krungthai Bank)
- Bangkok Bank Mobile Banking
- K PLUS (Kasikorn Bank)
- Krungsri Mobile Banking
- TMB Touch
- And all other Thai bank apps

## Testing

To test the integration:

1. Configure a test PromptPay number in Settings
2. Generate a test QR for ฿100
3. Scan with Thai banking app
4. **DO NOT complete payment** (test mode)
5. Verify amount displays correctly
6. Verify PromptPay ID is correct

## Troubleshooting

### QR Won't Generate
- Check PromptPay ID is configured in Settings
- Verify phone number format is valid
- Check browser console for errors

### QR Won't Scan
- Ensure sufficient brightness/contrast
- Try zooming the QR code on screen
- Verify PromptPay ID is correctly registered with a bank

### Amount Is Wrong
- Check the reservation folio calculations
- Verify tax calculations are correct
- Review any manual charges

## Future Enhancements

Possible future additions:
- Automatic payment verification via banking API
- Bulk QR generation for invoices
- QR code printing on receipts
- Payment status webhooks
- Multi-merchant support for larger properties

## API Reference

### `generatePromptPayQR(options)`
Generates a PromptPay QR code as PNG data URL.

```typescript
const qr = await generatePromptPayQR({
  identifier: '0812345678',  // PromptPay phone number
  amount: 1500.00            // Amount in THB
})
// Returns: "data:image/png;base64,..."
```

### `formatPromptPayPhone(phone)`
Normalizes phone number to PromptPay format.

```typescript
formatPromptPayPhone('+66812345678')  // Returns: '0812345678'
formatPromptPayPhone('081-234-5678')  // Returns: '0812345678'
```

### `validatePromptPayPhone(phone)`
Validates Thai mobile phone number.

```typescript
validatePromptPayPhone('0812345678')  // Returns: true
validatePromptPayPhone('1234567890')  // Returns: false
```

## Notes

- PromptPay is Thailand-specific and requires Thai bank accounts
- QR payments are instant (typically < 5 seconds)
- No transaction fees for PromptPay transfers
- Daily limits apply based on customer's bank settings
- Payments are irreversible (similar to cash)

## Support

For PromptPay-specific issues:
- Contact your bank to verify PromptPay registration
- Ensure phone number is correctly registered
- Check daily transfer limits with your bank

For PMS integration issues:
- Check Settings > Tax & Payments configuration
- Review browser console for errors
- Verify amount calculations in folio
