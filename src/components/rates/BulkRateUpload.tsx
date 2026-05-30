import { useState, useRef } from 'react'
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

interface RateUploadRow {
  roomType: string
  date: string
  rate: number
  reason?: string
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
}

export function BulkRateUpload() {
  const [roomTypes] = useKV<RoomType[]>('room-types-config', [])
  const [rateOverrides, setRateOverrides] = useKV<RateOverride[]>('rate-overrides', [])
  
  const [showUploadDialog, setShowUploadDialog] = useState(false)
  const [uploadedData, setUploadedData] = useState<RateUploadRow[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const parseCSV = (text: string): RateUploadRow[] => {
    const lines = text.trim().split('\n')
    if (lines.length < 2) {
      toast.error('CSV file is empty or invalid')
      return []
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
    const roomTypeIndex = headers.findIndex(h => h.includes('room') && h.includes('type'))
    const dateIndex = headers.findIndex(h => h.includes('date'))
    const rateIndex = headers.findIndex(h => h.includes('rate') || h.includes('price'))
    const reasonIndex = headers.findIndex(h => h.includes('reason') || h.includes('note'))

    if (roomTypeIndex === -1 || dateIndex === -1 || rateIndex === -1) {
      toast.error('CSV must have columns: Room Type, Date, Rate')
      return []
    }

    const rows: RateUploadRow[] = []
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      const values = line.split(',').map(v => v.trim())
      const errors: string[] = []
      
      const roomTypeName = values[roomTypeIndex] || ''
      const dateStr = values[dateIndex] || ''
      const rateStr = values[rateIndex] || ''
      const reason = reasonIndex !== -1 ? values[reasonIndex] : ''

      let parsedDate: Date | null = null
      const dateFormats = ['yyyy-MM-dd', 'MM/dd/yyyy', 'dd/MM/yyyy', 'MMM d, yyyy']
      
      for (const fmt of dateFormats) {
        try {
          const d = parse(dateStr, fmt, new Date())
          if (isValid(d)) {
            parsedDate = d
            break
          }
        } catch {}
      }

      if (!parsedDate) {
        errors.push('Invalid date format')
      }

      const rate = parseFloat(rateStr)
      if (isNaN(rate) || rate <= 0) {
        errors.push('Invalid rate value')
      }

      const roomType = roomTypes.find(rt => 
        rt.name.toLowerCase().includes(roomTypeName.toLowerCase()) ||
        rt.id.toLowerCase() === roomTypeName.toLowerCase()
      )

      if (!roomType) {
        errors.push('Room type not found')
      }

      rows.push({
        roomType: roomTypeName,
        date: parsedDate ? format(parsedDate, 'yyyy-MM-dd') : dateStr,
        rate: rate || 0,
        reason: reason || 'Bulk upload',
        isValid: errors.length === 0,
        errors
      })
    }

    return rows
  }

  const handleFileUpload = (file: File) => {
    if (!file) return

    const fileName = file.name.toLowerCase()
    const isCSV = fileName.endsWith('.csv')
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls')

    if (!isCSV && !isExcel) {
      toast.error('Please upload a CSV or Excel file')
      return
    }

    const reader = new FileReader()
    
    reader.onload = (e) => {
      const text = e.target?.result as string
      if (!text) {
        toast.error('Failed to read file')
        return
      }

      const parsedData = parseCSV(text)
      
      if (parsedData.length === 0) {
        toast.error('No valid data found in file')
        return
      }

      setUploadedData(parsedData)
      setShowUploadDialog(true)
      
      const validCount = parsedData.filter(r => r.isValid).length
      const invalidCount = parsedData.length - validCount
      
      toast.success(`Parsed ${parsedData.length} rows (${validCount} valid, ${invalidCount} invalid)`)
    }

    reader.onerror = () => {
      toast.error('Failed to read file')
    }

    reader.readAsText(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    
    const file = e.dataTransfer.files[0]
    if (file) {
      handleFileUpload(file)
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
      handleFileUpload(file)
    }
  }

  const handleImport = () => {
    const validRows = uploadedData.filter(r => r.isValid)
    
    if (validRows.length === 0) {
      toast.error('No valid rows to import')
      return
    }

    const newOverrides: RateOverride[] = validRows.map(row => {
      const roomType = roomTypes.find(rt => 
        rt.name.toLowerCase().includes(row.roomType.toLowerCase()) ||
        rt.id.toLowerCase() === row.roomType.toLowerCase()
      )!

      return {
        id: `override_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        roomTypeId: roomType.id,
        date: row.date,
        rate: row.rate,
        reason: row.reason || 'Bulk upload'
      }
    })

    const existingMap = new Map(
      rateOverrides.map(o => [`${o.roomTypeId}_${o.date}`, o])
    )

    newOverrides.forEach(override => {
      const key = `${override.roomTypeId}_${override.date}`
      existingMap.set(key, override)
    })

    setRateOverrides(Array.from(existingMap.values()))
    
    toast.success(`Successfully imported ${validRows.length} rate overrides`)
    setShowUploadDialog(false)
    setUploadedData([])
  }

  const downloadTemplate = () => {
    const headers = ['Room Type', 'Date', 'Rate', 'Reason']
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

  const validCount = uploadedData.filter(r => r.isValid).length
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
            Drag and drop your CSV or Excel file here, or click to browse
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
          </AlertDescription>
        </Alert>

        <div className="mt-4 grid grid-cols-3 gap-4">
          <Card className="p-4">
            <div className="text-sm text-muted-foreground mb-1">Supported Room Types</div>
            <div className="space-y-1">
              {roomTypes.map(rt => (
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
                  <TableHead>Room Type</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Rate</TableHead>
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
                    <TableCell>{row.roomType}</TableCell>
                    <TableCell>{row.date}</TableCell>
                    <TableCell>฿{row.rate.toLocaleString()}</TableCell>
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
