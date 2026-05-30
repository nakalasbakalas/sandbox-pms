import generatePayload from 'promptpay-qr'
import QRCode from 'qrcode'

export interface PromptPayConfig {
  phoneNumber: string
  idCard?: string
  taxId?: string
  eWallet?: string
}

export interface PromptPayQROptions {
  identifier: string
  amount: number
  additionalData?: string
}

export function formatPromptPayPhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, '')
  
  if (cleaned.startsWith('66')) {
    cleaned = '0' + cleaned.substring(2)
  } else if (cleaned.startsWith('+66')) {
    cleaned = '0' + cleaned.substring(3)
  } else if (!cleaned.startsWith('0')) {
    cleaned = '0' + cleaned
  }
  
  return cleaned
}

export async function generatePromptPayQR(options: PromptPayQROptions): Promise<string> {
  const { identifier, amount, additionalData } = options
  
  const payload = generatePayload(identifier, { amount })
  
  const qrDataURL = await QRCode.toDataURL(payload, {
    type: 'image/png',
    width: 400,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#FFFFFF'
    },
    errorCorrectionLevel: 'M'
  })
  
  return qrDataURL
}

export async function generatePromptPayQRSVG(options: PromptPayQROptions): Promise<string> {
  const { identifier, amount } = options
  
  const payload = generatePayload(identifier, { amount })
  
  const svg = await QRCode.toString(payload, {
    type: 'svg',
    width: 400,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#FFFFFF'
    },
    errorCorrectionLevel: 'M'
  })
  
  return svg
}

export function validatePromptPayPhone(phone: string): boolean {
  const cleaned = phone.replace(/\D/g, '')
  return /^(0[689]\d{8}|66[689]\d{8})$/.test(cleaned)
}

export function validatePromptPayTaxId(taxId: string): boolean {
  const cleaned = taxId.replace(/\D/g, '')
  return cleaned.length === 13
}

export function calculatePromptPayChecksum(payload: string): string {
  const crc16ccitt = (data: string): number => {
    let crc = 0xFFFF
    for (let i = 0; i < data.length; i++) {
      crc ^= data.charCodeAt(i) << 8
      for (let j = 0; j < 8; j++) {
        if (crc & 0x8000) {
          crc = (crc << 1) ^ 0x1021
        } else {
          crc = crc << 1
        }
      }
    }
    return crc & 0xFFFF
  }
  
  const checksum = crc16ccitt(payload)
  return checksum.toString(16).toUpperCase().padStart(4, '0')
}

export interface PromptPayQRMetadata {
  identifier: string
  amount: number
  currency: string
  countryCode: string
  merchantName?: string
  city?: string
  postalCode?: string
  billNumber?: string
  reference?: string
  terminalId?: string
}

export function parsePromptPayPayload(payload: string): Partial<PromptPayQRMetadata> {
  const metadata: Partial<PromptPayQRMetadata> = {
    currency: 'THB',
    countryCode: 'TH'
  }
  
  let index = 0
  while (index < payload.length) {
    const tag = payload.substring(index, index + 2)
    const lengthStr = payload.substring(index + 2, index + 4)
    const length = parseInt(lengthStr, 10)
    
    if (isNaN(length)) break
    
    const value = payload.substring(index + 4, index + 4 + length)
    
    if (tag === '54') {
      metadata.amount = parseFloat(value)
    } else if (tag === '53') {
      metadata.currency = value === '764' ? 'THB' : value
    } else if (tag === '58') {
      metadata.countryCode = value
    }
    
    index += 4 + length
  }
  
  return metadata
}
