import { addDays, format } from 'date-fns'

export function generateSampleRateCSV(): string {
  const headers = ['Room Type', 'Date', 'Rate', 'Reason']
  const today = new Date()
  
  const rows = [
    ['Deluxe Room', format(addDays(today, 30), 'yyyy-MM-dd'), '2800', 'High season pricing'],
    ['Superior Room', format(addDays(today, 30), 'yyyy-MM-dd'), '3300', 'High season pricing'],
    ['Suite', format(addDays(today, 30), 'yyyy-MM-dd'), '4800', 'High season pricing'],
    
    ['Deluxe Room', format(addDays(today, 60), 'yyyy-MM-dd'), '2200', 'Low season discount'],
    ['Superior Room', format(addDays(today, 60), 'yyyy-MM-dd'), '2700', 'Low season discount'],
    ['Suite', format(addDays(today, 60), 'yyyy-MM-dd'), '4200', 'Low season discount'],
    
    ['Deluxe Room', format(new Date(today.getFullYear(), 11, 24), 'yyyy-MM-dd'), '3500', 'Christmas Eve premium'],
    ['Superior Room', format(new Date(today.getFullYear(), 11, 24), 'yyyy-MM-dd'), '4200', 'Christmas Eve premium'],
    ['Suite', format(new Date(today.getFullYear(), 11, 24), 'yyyy-MM-dd'), '6000', 'Christmas Eve premium'],
    
    ['Deluxe Room', format(new Date(today.getFullYear(), 11, 31), 'yyyy-MM-dd'), '4000', 'New Year Eve premium'],
    ['Superior Room', format(new Date(today.getFullYear(), 11, 31), 'yyyy-MM-dd'), '5000', 'New Year Eve premium'],
    ['Suite', format(new Date(today.getFullYear(), 11, 31), 'yyyy-MM-dd'), '7000', 'New Year Eve premium'],
  ]

  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n')
}

export function generateSeasonalRatesCSV(): string {
  const headers = ['Room Type', 'Date', 'Rate', 'Reason']
  const today = new Date()
  const year = today.getFullYear()
  
  const summerStart = new Date(year, 5, 1)
  const summerEnd = new Date(year, 7, 31)
  const winterStart = new Date(year, 11, 1)
  const winterEnd = new Date(year + 1, 1, 28)
  
  const rows: string[][] = []
  
  const roomTypes = [
    { name: 'Deluxe Room', summerRate: 2800, winterRate: 3200 },
    { name: 'Superior Room', summerRate: 3400, winterRate: 3800 },
    { name: 'Suite', summerRate: 5000, winterRate: 5500 }
  ]
  
  for (let d = new Date(summerStart); d <= summerEnd; d = addDays(d, 7)) {
    roomTypes.forEach(rt => {
      rows.push([rt.name, format(d, 'yyyy-MM-dd'), rt.summerRate.toString(), 'Summer season'])
    })
  }
  
  for (let d = new Date(winterStart); d <= winterEnd; d = addDays(d, 7)) {
    roomTypes.forEach(rt => {
      rows.push([rt.name, format(d, 'yyyy-MM-dd'), rt.winterRate.toString(), 'Winter holiday season'])
    })
  }

  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n')
}

export function generateWeekendPremiumCSV(): string {
  const headers = ['Room Type', 'Date', 'Rate', 'Reason']
  const today = new Date()
  const rows: string[][] = []
  
  const roomTypes = [
    { name: 'Deluxe Room', rate: 3000 },
    { name: 'Superior Room', rate: 3500 },
    { name: 'Suite', rate: 5200 }
  ]
  
  for (let i = 0; i < 90; i++) {
    const date = addDays(today, i)
    const dayOfWeek = date.getDay()
    
    if (dayOfWeek === 5 || dayOfWeek === 6) {
      roomTypes.forEach(rt => {
        rows.push([rt.name, format(date, 'yyyy-MM-dd'), rt.rate.toString(), 'Weekend premium'])
      })
    }
  }

  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n')
}
