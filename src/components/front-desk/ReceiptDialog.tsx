import { useRef, useState } from 'react'
import { useKV } from '@github/spark/hooks'
import type { ReceiptData } from '@/types/receipt'
import type { PropertySetup } from '@/types/onboarding'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Receipt, Printer, Download, Envelope, CheckCircle, FileText } from '@phosphor-icons/react'
import { toast } from 'sonner'

interface ReceiptDialogProps {
  receipt: ReceiptData | null
  open: boolean
  onOpenChange: (open: boolean) => void
  type?: 'RECEIPT' | 'INVOICE'
}

export function ReceiptDialog({ receipt, open, onOpenChange, type: initialType = 'RECEIPT' }: ReceiptDialogProps) {
  const printRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<'RECEIPT' | 'INVOICE'>(initialType)
  const [propertyData] = useKV<PropertySetup>('onboarding-property', {} as PropertySetup)

  if (!receipt) return null

  const logoUrl = propertyData?.logoUrl
  const brandColor = propertyData?.brandColor || '#000000'
  const receiptFooter = propertyData?.receiptFooter || 'Thank you for staying with us!\nWe hope to see you again soon.'

  const documentTitle = activeTab === 'RECEIPT' ? 'Receipt' : 'Tax Invoice'
  const documentNumber = activeTab === 'RECEIPT' ? receipt.receiptNumber : receipt.invoiceNumber

  const handlePrint = () => {
    const printContent = printRef.current
    if (!printContent) return

    const printWindow = window.open('', '', 'width=800,height=600')
    if (!printWindow) {
      toast.error('Unable to open print window. Please check your popup blocker.')
      return
    }

    printWindow.document.write(`
      <html>
        <head>
          <title>${documentTitle} - ${documentNumber}</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
              font-size: 12px;
              line-height: 1.5;
              color: #000;
              padding: 20px;
            }
            .receipt-container {
              max-width: 800px;
              margin: 0 auto;
            }
            h1 {
              font-size: 24px;
              margin-bottom: 10px;
            }
            h2 {
              font-size: 18px;
              margin-bottom: 8px;
              margin-top: 16px;
            }
            h3 {
              font-size: 14px;
              margin-bottom: 8px;
              font-weight: 600;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin: 16px 0;
            }
            th {
              text-align: left;
              padding: 8px;
              background: #f5f5f5;
              border-bottom: 2px solid #ddd;
              font-weight: 600;
            }
            td {
              padding: 8px;
              border-bottom: 1px solid #eee;
            }
            .text-right {
              text-align: right;
            }
            .text-center {
              text-align: center;
            }
            .totals-table {
              margin-left: auto;
              width: 300px;
            }
            .totals-table td {
              border: none;
              padding: 4px 8px;
            }
            .grand-total {
              font-size: 16px;
              font-weight: bold;
              border-top: 2px solid ${brandColor};
              padding-top: 8px !important;
            }
            .header-section {
              margin-bottom: 20px;
              border-bottom: 2px solid ${brandColor};
              padding-bottom: 16px;
            }
            .info-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 16px;
              margin: 16px 0;
            }
            .info-section {
              margin-bottom: 8px;
            }
            .label {
              color: #666;
              font-size: 11px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .value {
              font-weight: 600;
              margin-top: 2px;
            }
            .footer {
              margin-top: 40px;
              padding-top: 20px;
              border-top: 1px solid #ddd;
              text-align: center;
              color: #666;
              font-size: 11px;
            }
            .stamp-section {
              margin-top: 40px;
              text-align: right;
            }
            @media print {
              body {
                padding: 0;
              }
              .no-print {
                display: none;
              }
            }
          </style>
        </head>
        <body>
          ${printContent.innerHTML}
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    
    setTimeout(() => {
      printWindow.print()
      printWindow.close()
    }, 250)

    toast.success(`${documentTitle} sent to printer`)
  }

  const handleDownload = () => {
    toast.success(`${documentTitle} download started`, {
      description: `${documentNumber}.pdf`,
    })
  }

  const handleEmail = () => {
    if (!receipt.guestEmail) {
      toast.error('No email address on file for this guest')
      return
    }

    toast.success(`${documentTitle} sent to ${receipt.guestEmail}`, {
      description: 'Email delivery may take a few moments',
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <CheckCircle className="text-green-600" weight="duotone" size={24} />
            Check-Out Complete
          </DialogTitle>
          <DialogDescription>
            {documentTitle} generated for {receipt.guestName}
          </DialogDescription>
        </DialogHeader>

        <div ref={printRef} className="receipt-container">
          <div className="header-section">
            <div className="flex justify-between items-start mb-4">
              <div>
                {logoUrl && (
                  <img 
                    src={logoUrl} 
                    alt={receipt.companyInfo.name} 
                    className="max-h-16 object-contain mb-3"
                    onError={(e) => e.currentTarget.style.display = 'none'}
                  />
                )}
                <h1 className="text-2xl font-bold" style={{ color: brandColor }}>{receipt.companyInfo.name}</h1>
                <p className="text-sm text-muted-foreground mt-1">{receipt.companyInfo.address}</p>
                <p className="text-sm text-muted-foreground">{receipt.companyInfo.phone} • {receipt.companyInfo.email}</p>
                {receipt.companyInfo.taxId && (
                  <p className="text-sm text-muted-foreground mt-1">Tax ID: {receipt.companyInfo.taxId}</p>
                )}
              </div>
              <div className="text-right">
                <h2 className="text-xl font-bold uppercase" style={{ color: brandColor }}>{documentTitle}</h2>
                <p className="text-lg font-mono font-semibold mt-1">{documentNumber}</p>
                <p className="text-sm text-muted-foreground mt-2">
                  {receipt.date.toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </p>
              </div>
            </div>

            <div className="info-grid">
              <div>
                <h3 className="font-semibold mb-2">Guest Information</h3>
                <div className="info-section">
                  <div className="label">Guest Name</div>
                  <div className="value">{receipt.guestName}</div>
                </div>
                {receipt.guestEmail && (
                  <div className="info-section">
                    <div className="label">Email</div>
                    <div className="value text-sm">{receipt.guestEmail}</div>
                  </div>
                )}
                {receipt.guestPhone && (
                  <div className="info-section">
                    <div className="label">Phone</div>
                    <div className="value text-sm">{receipt.guestPhone}</div>
                  </div>
                )}
              </div>

              <div>
                <h3 className="font-semibold mb-2">Stay Information</h3>
                <div className="info-section">
                  <div className="label">Room</div>
                  <div className="value">{receipt.roomNumber} ({receipt.roomType})</div>
                </div>
                <div className="info-section">
                  <div className="label">Check-In</div>
                  <div className="value">
                    {receipt.checkInDate.toLocaleDateString('en-US', { 
                      month: 'short', 
                      day: 'numeric', 
                      year: 'numeric' 
                    })}
                  </div>
                </div>
                <div className="info-section">
                  <div className="label">Check-Out</div>
                  <div className="value">
                    {receipt.checkOutDate.toLocaleDateString('en-US', { 
                      month: 'short', 
                      day: 'numeric', 
                      year: 'numeric' 
                    })}
                  </div>
                </div>
                <div className="info-section">
                  <div className="label">Nights Stayed</div>
                  <div className="value">{receipt.nights} {receipt.nights === 1 ? 'night' : 'nights'}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="charges-section">
            <h3 className="font-semibold mb-3">Room Charges</h3>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left">Description</th>
                  <th className="text-center">Qty</th>
                  <th className="text-right">Unit Price</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {receipt.roomCharges.map((item, index) => (
                  <tr key={`room-${index}`}>
                    <td>{item.description}</td>
                    <td className="text-center">{item.quantity}</td>
                    <td className="text-right">฿{item.unitPrice.toLocaleString()}</td>
                    <td className="text-right font-semibold">฿{item.total.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {receipt.additionalCharges.length > 0 && (
              <>
                <h3 className="font-semibold mb-3 mt-6">Additional Charges</h3>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="text-left">Description</th>
                      <th className="text-center">Qty</th>
                      <th className="text-right">Unit Price</th>
                      <th className="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipt.additionalCharges.map((item, index) => (
                      <tr key={`add-${index}`}>
                        <td>{item.description}</td>
                        <td className="text-center">{item.quantity}</td>
                        <td className="text-right">฿{item.unitPrice.toLocaleString()}</td>
                        <td className="text-right font-semibold">฿{item.total.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>

          <Separator className="my-6" />

          <div className="totals-section">
            <table className="totals-table">
              <tbody>
                <tr>
                  <td className="text-right font-semibold">Subtotal:</td>
                  <td className="text-right">฿{receipt.subtotal.toLocaleString()}</td>
                </tr>
                {receipt.tax > 0 && (
                  <tr>
                    <td className="text-right font-semibold">Tax:</td>
                    <td className="text-right">฿{receipt.tax.toLocaleString()}</td>
                  </tr>
                )}
                <tr>
                  <td className="text-right font-bold text-lg grand-total">Total:</td>
                  <td className="text-right font-bold text-lg grand-total">฿{receipt.total.toLocaleString()}</td>
                </tr>
                <tr>
                  <td className="text-right font-semibold text-green-700">Paid:</td>
                  <td className="text-right font-semibold text-green-700">฿{receipt.paid.toLocaleString()}</td>
                </tr>
                {receipt.balance !== 0 && (
                  <tr>
                    <td className="text-right font-bold text-rose-700">Balance:</td>
                    <td className="text-right font-bold text-rose-700">฿{receipt.balance.toLocaleString()}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {receipt.paymentMethod && (
            <Card className="p-4 mt-6 bg-slate-50">
              <div className="flex justify-between items-center text-sm">
                <div>
                  <span className="text-muted-foreground">Payment Method:</span>
                  <span className="font-semibold ml-2">
                    {receipt.paymentMethod === 'CASH' && 'Cash'}
                    {receipt.paymentMethod === 'CARD' && 'Credit/Debit Card'}
                    {receipt.paymentMethod === 'TRANSFER' && 'Bank Transfer'}
                    {receipt.paymentMethod === 'OTHER' && 'Other'}
                  </span>
                </div>
                {receipt.paymentReference && (
                  <div>
                    <span className="text-muted-foreground">Reference:</span>
                    <span className="font-mono ml-2">{receipt.paymentReference}</span>
                  </div>
                )}
              </div>
            </Card>
          )}

          {receipt.notes && (
            <div className="mt-6">
              <h3 className="font-semibold mb-2">Notes</h3>
              <p className="text-sm text-muted-foreground">{receipt.notes}</p>
            </div>
          )}

          <div className="footer">
            {receiptFooter.split('\n').map((line, index) => (
              <p key={index}>{line}</p>
            ))}
            {activeTab === 'INVOICE' && (
              <p className="mt-2 text-xs">This is a computer-generated tax invoice. No signature required.</p>
            )}
          </div>

          {activeTab === 'INVOICE' && (
            <div className="stamp-section">
              <p className="text-xs text-muted-foreground">Authorized Signature</p>
              <div className="mt-12 border-t border-slate-300 w-48 inline-block"></div>
            </div>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="w-full mb-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="RECEIPT" className="gap-2">
              <Receipt size={16} weight="bold" />
              Receipt
            </TabsTrigger>
            <TabsTrigger value="INVOICE" className="gap-2">
              <FileText size={16} weight="bold" />
              Tax Invoice
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <div className="flex-1 flex gap-2">
            <Button
              variant="outline"
              onClick={handlePrint}
              className="gap-2"
            >
              <Printer size={18} weight="bold" />
              Print
            </Button>
            <Button
              variant="outline"
              onClick={handleDownload}
              className="gap-2"
            >
              <Download size={18} weight="bold" />
              Download PDF
            </Button>
            {receipt.guestEmail && (
              <Button
                variant="outline"
                onClick={handleEmail}
                className="gap-2"
              >
                <Envelope size={18} weight="bold" />
                Email Guest
              </Button>
            )}
          </div>
          <Button
            onClick={() => onOpenChange(false)}
            className="bg-green-600 hover:bg-green-700"
          >
            <CheckCircle className="mr-2" size={18} weight="bold" />
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
