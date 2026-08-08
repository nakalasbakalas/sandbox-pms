import assert from 'node:assert/strict'
import { generateRevenueData } from '../src/hooks/use-reports-data'

const day = (offset: number) => new Date(2026, 0, 1 + offset)
const rooms = [{ id: 'room-1', number: '101', operationalStatus: 'AVAILABLE', roomType: { id: 'twin', code: 'TWIN' } }]
const reservations = [{
  id: 'reservation-750',
  status: 'CONFIRMED',
  checkIn: day(0),
  checkOut: day(1),
  createdAt: day(0),
  roomType: { id: 'twin', code: 'TWIN', name: 'Twin' },
  totalAmount: 749.99,
  totalAmountSatang: '75000',
  depositAmount: 225,
  depositAmountSatang: '22500',
  depositPaid: true,
  folio: {
    total: 749.99,
    totalSatang: '75000',
    paid: 250,
    paidSatang: '25000',
    balance: 499.99,
    balanceSatang: '50000',
    payments: [{ amount: 249.99, amountSatang: '25000' }],
    charges: [{
      category: 'EXTRA_GUEST',
      date: day(0).toISOString(),
      total: 0,
      totalSatang: '1',
    }],
  },
}, {
  id: 'reservation-multi-night',
  status: 'CONFIRMED',
  checkIn: day(0),
  checkOut: day(2),
  createdAt: day(0),
  roomType: { id: 'twin', code: 'TWIN', name: 'Twin' },
  totalAmount: 100,
  totalAmountSatang: '10001',
  depositAmount: 30,
  depositAmountSatang: '3000',
  depositPaid: false,
  folio: {
    total: 100,
    totalSatang: '10001',
    paid: 0,
    paidSatang: '0',
    balance: 100,
    balanceSatang: '10001',
    payments: [],
    charges: [],
  },
}]

const report = generateRevenueData(
  { from: day(0), to: day(1) },
  rooms as Parameters<typeof generateRevenueData>[1],
  reservations as Parameters<typeof generateRevenueData>[2],
)
const rowTotal = report.dailyStats.reduce((sum, row) => sum + BigInt(row.totalRevenueSatang), 0n)
assert.equal(BigInt(report.summary.totalRevenueSatang), rowTotal, 'report total equals the sum of row-level exact totals')
assert.equal(report.dailyStats[0].roomRevenueSatang, '80001', 'THB 750 and the first allocated rounding satang remain exact')
assert.equal(report.dailyStats[0].extrasRevenueSatang, '1', 'one-satang extra charge remains exact')
assert.equal(report.dailyStats[0].totalRevenueSatang, '80002', 'row total is exact before display conversion')
assert.equal(report.dailyStats[1].roomRevenueSatang, '5000', 'multi-night remainder allocation reconciles exactly')
assert.equal(report.summary.outstandingBalanceSatang, '60001', 'partial balances accumulate as exact satang')
assert.equal(report.summary.depositsCollectedSatang, '22500')
assert.equal(report.summary.depositsPendingSatang, '3000')

console.log('Exact report authority tests passed.')
