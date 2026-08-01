import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { useKV } from '@github/spark/hooks'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Upload,
  FileArrowDown,
  CheckCircle,
  Warning,
  X,
  FileCsv,
  FileXls,
  Info,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { format, parse, isValid } from 'date-fns'

type SourceStatus = 'CONFIRMED' | 'PROJECTED'

interface RateUploadRow {
  roomType: string
  date: string
  rate: number
  reason?: string
  demandTier?: string
  rateMultiplier?: number
  sourceStatus?: SourceStatus
  reviewRepriceDate?: string
  sourceVersion?: string
  isValid: boolean
  errors: string[]
}
interface RoomType {
  id: string
  name: string
  baseRate: number
}

interface RateOverride {
  id: string
  roomTypeId: string
  date: string
  rate: number
  reason: string
  demandTier?: string
  rateMultiplier?: number
  sourceStatus?: SourceStatus
  reviewRepriceDate?: string
  sourceVersion?: string
}

const DATE_FORMATS = ['yyyy-MM-dd', 'MM/dd/yyyy', 'dd/MM/yyyy', 'MMM d, yyyy', 'MMM d,yy']

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitCsvLine(line: string): string[] {
  const values: string[] = []
  let value = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"' && next === '"') {
      value += '"'
      index += 1
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === ',' && !inQuotes) {
      values.push(value)
      value = ''
      continue
    }

    value += char
  }

  values.push(value)
  return values.map((item) => item.trim())
}

function parseDateValue(value: unknown, rowLabel: string): { date: string; error?: string } {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const parsed = value
    return { date: format(parsed, 'yyyy-MM-dd') }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const excelDate = XLSX.SSF.parse_date_code(value)
    if (excelDate) {
      const parsed = new Date(Date.UTC(excelDate.y, excelDate.m - 1, excelDate.d))
      return { date: format(parsed, 'yyyy-MM-dd') }
    }
  }

  const raw = String(value ?? '').trim()
  if (!raw) return { date: '', error: `Row ${rowLabel}: Missing date` }

  for (const formatPattern of DATE_FORMATS) {
    const candidate = parse(raw, formatPattern, new Date())
    if (isValid(candidate)) {
      return { date: format(candidate, 'yyyy-MM-dd') }
    }
  }

  const candidate = new Date(raw)
  if (Number.isFinite(candidate.getTime())) {
    return { date: format(candidate, 'yyyy-MM-dd') }
  }

  return { date: '', error: `Row ${rowLabel}: Invalid date format` }
}

function parseRateValue(value: unknown, rowLabel: string): { rate: number; error?: string } {
  const normalized = String(value ?? '').replace(/,/g, '').trim()
  const rate = Number.parseFloat(normalized)

  if (!Number.isFinite(rate) || rate <= 0) {
    return { rate: 0, error: `Row ${rowLabel}: Invalid rate value` }
  }

  return { rate: Math.round(rate) }
}

function parseMultiplierValue(value: unknown, rowLabel: string): { multiplier?: number; error?: string } {
  const normalized = String(value ?? '').replace(/,/g, '').trim()
  if (!normalized) return { }

  const multiplier = Number.parseFloat(normalized)
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    return { error: `Row ${rowLabel}: Invalid rate multiplier` }
  }

  return { multiplier: Number(multiplier.toFixed(6)) }
}

function normalizeSourceStatus(value: unknown): SourceStatus {
  const normalized = String(value ?? '').trim().toUpperCase()
  return normalized === 'CONFIRMED' ? 'CONFIRMED' : 'PROJECTED'
}

function findHeaderIndex(headers: string[], test: (header: string) => boolean) {
  return headers.findIndex((header) => test(normalizeHeader(header)))
}

function parseRows(
  rows: Array<Record<string, unknown>>,
  headers: string[],
  roomTypes: RoomType[],
  source: string,
): RateUploadRow[] {
  const roomTypeIndex = findHeaderIndex(headers, (value) => value.includes('room') && value.includes('type'))
  const dateIndex = findHeaderIndex(headers, (value) => value.includes('date'))
  const rateIndex = findHeaderIndex(headers, (value) => value.includes('rate') || value.includes('price'))
  const reasonIndex = findHeaderIndex(headers, (value) => value.includes('reason') || value.includes('note'))
  const demandTierIndex = findHeaderIndex(headers, (value) => value.includes('demand') && value.includes('tier'))
  const multiplierIndex = findHeaderIndex(headers, (value) => value.includes('rate') && value.includes('multiplier'))
  const statusIndex = findHeaderIndex(headers, (value) => value.includes('status'))
  const reviewRepriceIndex = findHeaderIndex(headers, (value) => value.includes('review') && value.includes('reprice'))
  const sourceVersionIndex = findHeaderIndex(headers, (value) => value.includes('source') && value.includes('version'))

  if (roomTypeIndex === -1 || dateIndex === -1 || rateIndex === -1) {
    throw new Error(`${source} must include columns: Room Type, Date, Rate`)
  }

  return rows
    .map((row, rowOffset) => {
      const rowLabel = `${rowOffset + 1}`
      const rawValues = headers.map((header) => row[header] ?? '')
      const roomTypeName = String(rawValues[roomTypeIndex] || '').trim()
      const dateValue = rawValues[dateIndex]
      const rateValue = rawValues[rateIndex]
      const reason = reasonIndex === -1 ? '' : String(rawValues[reasonIndex] || '').trim()
      const demandTier = demandTierIndex === -1 ? '' : String(rawValues[demandTierIndex] || '').trim()
      const rawMultiplier = multiplierIndex === -1 ? '' : rawValues[multiplierIndex]
      const status = statusIndex === -1 ? 'CONFIRMED' : String(rawValues[statusIndex] || 'CONFIRMED')
      const reviewRepriceDateValue = reviewRepriceIndex === -1 ? '' : rawValues[reviewRepriceIndex]
      const sourceVersion = sourceVersionIndex === -1 ? '' : String(rawValues[sourceVersionIndex] || '').trim()

      const errors: string[] = []
      const dateResult = parseDateValue(dateValue, rowLabel)
      const rateResult = parseRateValue(rateValue, rowLabel)
      const multiplierResult = parseMultiplierValue(rawMultiplier, rowLabel)
      const reviewRepriceResult = reviewRepriceDateValue
        ? parseDateValue(reviewRepriceDateValue, rowLabel)
        : { date: '' }

      if (dateResult.error) errors.push(dateResult.error)
      if (rateResult.error) errors.push(rateResult.error)
      if (multiplierResult.error) errors.push(multiplierResult.error || `Row ${rowLabel}: Invalid rate multiplier`)
      if (reviewRepriceDateValue && reviewRepriceResult.error) errors.push(reviewRepriceResult.error)

      const roomType = roomTypes.find((type) =>
        type.name.toLowerCase().includes(roomTypeName.toLowerCase()) ||
        type.id.toLowerCase() === roomTypeName.toLowerCase()
      )

      if (!roomType) {
        errors.push(`Row ${rowLabel}: Room type not found`)
      }

      return {
        roomType: roomTypeName,
        date: dateResult.date,
        rate: rateResult.rate,
        reason: reason || 'Bulk upload',
        demandTier: demandTier || undefined,
        rateMultiplier: multiplierResult.multiplier,
        sourceStatus: normalizeSourceStatus(status),
        reviewRepriceDate: reviewRepriceResult.date,
        sourceVersion: sourceVersion || undefined,
        isValid: errors.length === 0,
        errors,
      }
    })
}

function normalizeCSVRows(text: string): string[][] {
  const lines = text.trim().split(/\r?\n/)
  return lines.map(splitCsvLine)
}

function parseCSVFile(text: string, roomTypes: RoomType[]): RateUploadRow[] {
  const rows = normalizeCSVRows(text)
  if (rows.length < 2) {
    throw new Error('CSV file is empty or invalid')
  }

  const headers = rows[0].map(normalizeHeader)
  const rawRows = rows.slice(1).map((row) => {
    const rowRecord: Record<string, unknown> = {}
    row.forEach((cell, index) => {
      rowRecord[headers[index] || `column_${index}`] = cell
    })
    return rowRecord
  })

  return parseRows(rawRows, headers, roomTypes, 'CSV')
}

export function BulkRateUpload() {
  const [roomTypes] = useKV<RoomType[]>('room-types-config', [])
  const [rateOverrides, setRateOverrides] = useKV<RateOverride[]>('rate-overrides', [])

  const [showUploadDialog, setShowUploadDialog] = useState(false)
  const [uploadedData, setUploadedData] = useState<RateUploadRow[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const parseXlsxBuffer = async (buffer: ArrayBuffer): Promise<RateUploadRow[]> => {
    const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' })
    const worksheetName = workbook.SheetNames.includes('365 Calendar')
      ? '365 Calendar'
      : workbook.SheetNames[0]

    if (!worksheetName) {
      throw new Error('Excel workbook has no sheets')
    }

    const worksheet = workbook.Sheets[worksheetName]
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      raw: true,
      defval: '',
      blankrows: false,
    })
    const headers = rawRows.length > 0 ? Object.keys(rawRows[0]) : []
    const parsed = parseRows(rawRows, headers, roomTypes, 'Excel')
    if (parsed.length === 0) {
      throw new Error('No data rows found in worksheet')
    }
    return parsed
  }

  const handleFileUpload = async (file: File) => {
    if (!file) return

    const fileName = file.name.toLowerCase()
    const isCSV = fileName.endsWith('.csv')
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls')

    if (!isCSV && !isExcel) {
      toast.error('Please upload a CSV or Excel file')
      return
    }

    try {
      let parsedData: RateUploadRow[] = []

      if (isCSV) {
        const text = await file.text()
        parsedData = parseCSVFile(text, roomTypes)
      } else {
        const buffer = await file.arrayBuffer()
        parsedData = await parseXlsxBuffer(buffer)
      }

      if (parsedData.length === 0) {
        toast.error('No valid data found in file')
        return
      }

      setUploadedData(parsedData)
      setShowUploadDialog(true)

      const validCount = parsedData.filter((r) => r.isValid).length
      const invalidCount = parsedData.length - validCount
      toast.success(`Parsed ${parsedData.length} rows (${validCount} valid, ${invalidCount} invalid)`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to read file')
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const file = e.dataTransfer.files[0]
    if (file) {
      void handleFileUpload(file)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      void handleFileUpload(file)
    }
  }

  const handleImport = () => {
    const validRows = uploadedData.filter((r) => r.isValid)

    if (validRows.length === 0) {
      toast.error('No valid rows to import')
      return
    }

    const newOverrides: RateOverride[] = validRows.map((row) => {
      const roomType = roomTypes.find((rt) =>
        rt.name.toLowerCase().includes(row.roomType.toLowerCase()) ||
        rt.id.toLowerCase() === row.roomType.toLowerCase()
      )!

      return {
        id: `override_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        roomTypeId: roomType.id,
        date: row.date,
        rate: row.rate,
        reason: row.reason || 'Bulk upload',
        demandTier: row.demandTier,
        rateMultiplier: row.rateMultiplier,
        sourceStatus: row.sourceStatus || 'CONFIRMED',
        reviewRepriceDate: row.reviewRepriceDate,
        sourceVersion: row.sourceVersion
      }
    })

    const existingMap = new Map(
      rateOverrides.map((o) => [`${o.roomTypeId}_${o.date}_${o.sourceStatus || 'CONFIRMED'}`, o])
    )

    newOverrides.forEach((override) => {
      const key = `${override.roomTypeId}_${override.date}_${override.sourceStatus || 'CONFIRMED'}`
      existingMap.set(key, override)
    })

    setRateOverrides(Array.from(existingMap.values()))

    toast.success(`Successfully imported ${validRows.length} rate overrides`)
    setShowUploadDialog(false)
    setUploadedData([])
  }

  const downloadTemplate = () => {
    const headers = [
      'Room Type',
      'Date',
      'Rate',
      'Reason',
      'Demand Tier',
      'Rate Multiplier',
      'Source Status',
      'Review / Reprice Date',
      'Source Version',
    ]
    const csv = `${headers.join(',')}\n`

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'rate-upload-template.csv'
    link.click()
    URL.revokeObjectURL(url)

    toast.success('Template downloaded')
  }

  const validCount = uploadedData.filter((r) => r.isValid).length
  const invalidCount = uploadedData.length - validCount

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Bulk Rate Upload</CardTitle>
            <CardDescription>Upload seasonal pricing from CSV or Excel files</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <FileArrowDown className="w-4 h-4 mr-2" />
              Download Template
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div
          className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
            isDragging ? 'border-primary bg-primary/5' : 'border-border'
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">Upload Rate File</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Drag and drop your CSV or Excel file here, or click to browse.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button onClick={() => fileInputRef.current?.click()}>
            Select File
          </Button>

          <div className="mt-6 flex items-center justify-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <FileCsv className="w-4 h-4" />
              CSV
            </div>
            <div className="flex items-center gap-2">
              <FileXls className="w-4 h-4" />
              Excel
            </div>
          </div>
        </div>

      <Alert className="mt-4">
          <Info className="w-4 h-4" />
          <AlertDescription>
            <strong>File Format:</strong> Your file should have columns for Room Type, Date, Rate, and optionally Reason.
            Date formats supported: YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY, or MMM D, YYYY.
            Demand calendar uploads may also include Demand Tier, Rate Multiplier, Source Status, Review / Reprice Date, and Source Version.
          </AlertDescription>
        </Alert>

        <div className="mt-4 grid grid-cols-3 gap-4">
          <Card className="p-4">
            <div className="text-sm text-muted-foreground mb-1">Supported Room Types</div>
            <div className="space-y-1">
              {roomTypes.map((rt) => (
                <Badge key={rt.id} variant="outline" className="mr-2">
                  {rt.name}
                </Badge>
              ))}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-muted-foreground mb-1">Date Formats</div>
            <div className="text-xs space-y-1">
              <div>• 2024-12-25</div>
              <div>• 12/25/2024</div>
              <div>• 25/12/2024</div>
              <div>• Dec 25, 2024</div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-muted-foreground mb-1">Rate Format</div>
            <div className="text-xs space-y-1">
              <div>• Numbers only</div>
              <div>• Positive numeric values</div>
              <div>• No currency symbols</div>
            </div>
          </Card>
        </div>
      </CardContent>

      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Review Import Data</DialogTitle>
            <DialogDescription>
              Review the parsed data before importing. Invalid rows will be skipped.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-4 mb-4">
            <Badge variant="default" className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              {validCount} Valid
            </Badge>
            {invalidCount > 0 && (
              <Badge variant="destructive" className="flex items-center gap-2">
                <Warning className="w-4 h-4" />
                {invalidCount} Invalid
              </Badge>
            )}
          </div>

          <ScrollArea className="h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
              <TableHead className="w-12">Status</TableHead>
              <TableHead>Status Tag</TableHead>
              <TableHead>Room Type</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead>Demand</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Errors</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {uploadedData.map((row, index) => (
              <TableRow key={index} className={!row.isValid ? 'bg-destructive/5' : ''}>
                    <TableCell>
                      {row.isValid ? (
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      ) : (
                        <X className="w-4 h-4 text-destructive" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={row.sourceStatus === 'CONFIRMED' ? 'default' : 'secondary'}
                        className="text-xs"
                      >
                        {row.sourceStatus || 'CONFIRMED'}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.roomType}</TableCell>
                    <TableCell>{row.date}</TableCell>
                    <TableCell>฿{row.rate.toLocaleString()}</TableCell>
                    <TableCell className="text-xs">
                      {row.demandTier || '-'}
                      {row.rateMultiplier ? ` (${row.rateMultiplier})` : ''}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.reason || '-'}
                    </TableCell>
                    <TableCell>
                      {row.errors.length > 0 && (
                        <div className="space-y-1">
                          {row.errors.map((error, i) => (
                            <Badge key={i} variant="destructive" className="text-xs">
                              {error}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowUploadDialog(false)
              setUploadedData([])
            }}>
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={validCount === 0}
            >
              Import {validCount} Rate{validCount !== 1 ? 's' : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
