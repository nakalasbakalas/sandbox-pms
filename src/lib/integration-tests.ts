export interface IntegrationTest {
  name: string
  category: 'CHECK_IN' | 'CHECK_OUT' | 'RESERVATION' | 'PAYMENT' | 'HOUSEKEEPING' | 'CHANNEL_SYNC' | 'REPORTING'
  description: string
  steps: string[]
  expectedOutcomes: string[]
  dataStoresAffected: string[]
}

export const integrationTests: IntegrationTest[] = [
  {
    name: 'Complete Check-In Flow',
    category: 'CHECK_IN',
    description: 'Verify check-in updates all related modules',
    steps: [
      'Navigate to Front Desk view',
      'Select a pending arrival',
      'Open Check-In Dialog',
      'Verify guest information',
      'Assign available room',
      'Collect payment/deposit',
      'Complete check-in',
    ],
    expectedOutcomes: [
      'Reservation status changes to CHECKED_IN',
      'Room status changes to OCCUPIED_CLEAN on Board',
      'New folio created in Cashier view',
      'Inventory decreases for room type',
      'Channel availability updates (if auto-sync enabled)',
      'Room shows guest name on Board',
      'Housekeeping view shows room as occupied',
    ],
    dataStoresAffected: [
      'reservations',
      'pms-rooms',
      'folios',
      'inventory-snapshots',
      'inventory-sync-events',
    ],
  },
  {
    name: 'Complete Check-Out Flow',
    category: 'CHECK_OUT',
    description: 'Verify check-out updates all related modules and triggers housekeeping',
    steps: [
      'Navigate to Front Desk view',
      'Select an occupied room departure',
      'Open Check-Out Dialog',
      'Review folio charges',
      'Process final payment',
      'Complete check-out',
    ],
    expectedOutcomes: [
      'Reservation status changes to CHECKED_OUT',
      'Room status changes to VACANT_DIRTY on Board',
      'Folio status changes to CLOSED',
      'Inventory increases for room type',
      'Channel availability updates',
      'Housekeeping notification sent (if enabled)',
      'Room appears in housekeeping priority queue',
      'Room ready notification pending',
    ],
    dataStoresAffected: [
      'reservations',
      'pms-rooms',
      'folios',
      'inventory-snapshots',
      'inventory-sync-events',
      'automated-message-log',
      'internal-messages',
    ],
  },
  {
    name: 'Room Cleaning Workflow',
    category: 'HOUSEKEEPING',
    description: 'Verify room cleaning updates Board and sends notifications',
    steps: [
      'Navigate to Housekeeping view',
      'Select a VACANT_DIRTY room',
      'Mark room as CLEANING',
      'Complete cleaning',
      'Mark room as CLEAN',
    ],
    expectedOutcomes: [
      'Room status changes to VACANT_CLEAN on Board',
      'Room available for assignment in Front Desk',
      'Room ready notification sent (if arrival pending)',
      'Last cleaned timestamp updated',
      'Room removed from housekeeping priority queue',
    ],
    dataStoresAffected: [
      'pms-rooms',
      'room-ready-notification-logs',
    ],
  },
  {
    name: 'New Reservation Creation',
    category: 'RESERVATION',
    description: 'Verify new reservation appears across all views and syncs inventory',
    steps: [
      'Navigate to Reservations view or Board',
      'Click New Reservation button',
      'Fill in guest details',
      'Select dates and room type',
      'Set rate and confirm',
      'Save reservation',
    ],
    expectedOutcomes: [
      'Reservation appears in Reservations list',
      'Reservation appears on Board timeline',
      'Guest profile created if new',
      'Inventory decreases for date range',
      'Channel sync event triggered',
      'Reservation added to unassigned list (if no room assigned)',
    ],
    dataStoresAffected: [
      'reservations',
      'reservations-data',
      'guests',
      'unassigned-reservations',
      'inventory-snapshots',
      'inventory-sync-events',
    ],
  },
  {
    name: 'Bulk Reservation Edit',
    category: 'RESERVATION',
    description: 'Verify bulk operations update multiple reservations efficiently',
    steps: [
      'Navigate to Reservations view',
      'Enable selection mode',
      'Select multiple reservations',
      'Open Bulk Edit dialog',
      'Apply status change or rate adjustment',
      'Confirm changes',
    ],
    expectedOutcomes: [
      'All selected reservations updated',
      'Board reflects all changes',
      'Inventory adjusted for all affected dates',
      'Channel sync batches updates efficiently',
      'Audit log records bulk operation',
    ],
    dataStoresAffected: [
      'reservations',
      'reservations-data',
      'inventory-snapshots',
      'inventory-sync-events',
    ],
  },
  {
    name: 'Bulk Room Assignment',
    category: 'RESERVATION',
    description: 'Verify bulk room assignment updates all reservations',
    steps: [
      'Navigate to Reservations view',
      'Filter for unassigned reservations',
      'Select multiple reservations',
      'Open Bulk Room Assignment dialog',
      'Auto-assign or manually assign rooms',
      'Confirm assignments',
    ],
    expectedOutcomes: [
      'All reservations assigned to rooms',
      'Rooms marked as RESERVED on Board',
      'Unassigned reservations list cleared',
      'Room numbers visible in Reservations view',
    ],
    dataStoresAffected: [
      'reservations',
      'reservations-data',
      'unassigned-reservations',
      'pms-rooms',
    ],
  },
  {
    name: 'Payment Processing',
    category: 'PAYMENT',
    description: 'Verify payment updates folio, reservation, and accounting',
    steps: [
      'Navigate to Cashier view',
      'Select an open folio',
      'Click Add Payment',
      'Enter payment amount and method',
      'Submit payment',
    ],
    expectedOutcomes: [
      'Folio balance reduces by payment amount',
      'Payment appears in folio payment history',
      'Reservation deposit status updates',
      'Board removes deposit pending indicator',
      'Accounting dashboard revenue increases',
      'Daily summary includes payment',
    ],
    dataStoresAffected: [
      'folios',
      'reservations',
      'accounting-entries',
    ],
  },
  {
    name: 'Manual Accounting Entry',
    category: 'PAYMENT',
    description: 'Verify manual transactions appear in reports',
    steps: [
      'Navigate to Cashier view',
      'Go to Accounting Dashboard tab',
      'Click Manual Entry button',
      'Enter transaction details (category, amount, description)',
      'Submit entry',
    ],
    expectedOutcomes: [
      'Transaction appears in accounting dashboard',
      'Daily revenue total updates',
      'Category breakdown reflects new entry',
      'Reports view includes transaction',
    ],
    dataStoresAffected: [
      'accounting-entries',
    ],
  },
  {
    name: 'Channel Inventory Sync',
    category: 'CHANNEL_SYNC',
    description: 'Verify inventory changes sync to all enabled channels',
    steps: [
      'Navigate to Channels view',
      'Verify auto-sync is enabled',
      'Perform inventory-affecting action (check-in, check-out, new reservation)',
      'Wait for sync batch window (30 seconds)',
      'Check sync logs and channel health',
    ],
    expectedOutcomes: [
      'Sync event recorded in events log',
      'All enabled channels show SUCCESS status',
      'Inventory calendar reflects changes',
      'Sync latency under 35 seconds',
      'No errors in sync logs',
    ],
    dataStoresAffected: [
      'inventory-sync-events',
      'inventory-sync-logs',
      'channel-inventory-states',
    ],
  },
  {
    name: 'Rate Push to Channels',
    category: 'CHANNEL_SYNC',
    description: 'Verify rate changes push to OTA channels',
    steps: [
      'Navigate to Rates view',
      'Modify a rate plan',
      'Enable automatic rate push (if not already)',
      'Trigger manual rate push',
      'Check rate push logs',
    ],
    expectedOutcomes: [
      'Rate push initiated for all enabled channels',
      'Channel-specific markups applied',
      'Push logs show SUCCESS status',
      'Rate Parity Panel shows no discrepancies',
      'OTA channels reflect new rates',
    ],
    dataStoresAffected: [
      'rate-plans',
      'rate-push-logs',
    ],
  },
  {
    name: 'OTA Reservation Import',
    category: 'CHANNEL_SYNC',
    description: 'Verify OTA reservations import correctly with conflict detection',
    steps: [
      'Navigate to Channels view',
      'Go to Reservation Import tab',
      'Click Fetch New Reservations',
      'Review pending imports',
      'Resolve any conflicts',
      'Import clean reservations',
    ],
    expectedOutcomes: [
      'OTA reservations fetched successfully',
      'Conflicts detected and flagged',
      'Clean imports added to reservations',
      'Inventory adjusted automatically',
      'Imported reservations appear on Board',
    ],
    dataStoresAffected: [
      'reservations',
      'unassigned-reservations',
      'inventory-snapshots',
    ],
  },
  {
    name: 'Night Audit Execution',
    category: 'REPORTING',
    description: 'Verify night audit executes all steps and updates all modules',
    steps: [
      'Navigate to Night Audit view',
      'Click Run Night Audit',
      'Monitor progress through all steps',
      'Review completion status',
      'Check generated reports',
    ],
    expectedOutcomes: [
      'System date rolled over',
      'Room charges posted to all occupied rooms',
      'No-shows marked and inventory released',
      'Occupancy statistics calculated',
      'Payments reconciled',
      'Data backup created',
      'Daily reports generated',
      'Audit log recorded',
    ],
    dataStoresAffected: [
      'folios',
      'reservations',
      'inventory-snapshots',
      'night-audit-logs',
    ],
  },
  {
    name: 'Print Functions',
    category: 'REPORTING',
    description: 'Verify all print functions work correctly',
    steps: [
      'Navigate to Housekeeping view',
      'Click Print Housekeeping Report',
      'Navigate to Reservations view',
      'Click Print Reservations List',
      'Navigate to Cashier view',
      'Select a folio and print',
      'Complete a check-out and print receipt',
    ],
    expectedOutcomes: [
      'Housekeeping report opens in print dialog',
      'Reservations list formatted for printing',
      'Folio shows all charges and payments',
      'Receipt includes all required information',
      'All prints use property branding',
    ],
    dataStoresAffected: [
      'None (read-only operations)',
    ],
  },
  {
    name: 'Automated Messaging',
    category: 'HOUSEKEEPING',
    description: 'Verify automated messages send on configured triggers',
    steps: [
      'Navigate to Settings',
      'Configure Automated Messaging (enable housekeeping alerts)',
      'Perform a check-out',
      'Monitor LINE messages',
      'Mark room as clean',
      'Check for room ready notification',
    ],
    expectedOutcomes: [
      'Housekeeping alert sent on check-out',
      'Message includes room number and priority',
      'Room ready notification sent when cleaned',
      'Messages logged for audit',
      'Correct LINE groups receive messages',
    ],
    dataStoresAffected: [
      'housekeeping-automation-config',
      'automated-message-log',
      'internal-messages',
    ],
  },
  {
    name: 'Visual Density Toggle',
    category: 'REPORTING',
    description: 'Verify density toggle applies system-wide',
    steps: [
      'Click density toggle in header',
      'Observe transition animation',
      'Navigate through all views',
      'Verify spacing changes persist',
      'Refresh browser',
    ],
    expectedOutcomes: [
      'Smooth transition animation plays',
      'All views reflect density change',
      'Tables, cards, forms adjust spacing',
      'Preference persists after refresh',
      'Keyboard shortcut (Cmd/Ctrl+Shift+D) works',
    ],
    dataStoresAffected: [
      'app-density',
    ],
  },
]

export function getIntegrationTestsByCategory(category: IntegrationTest['category']): IntegrationTest[] {
  return integrationTests.filter(test => test.category === category)
}

export function getAllDataStoresUsed(): string[] {
  const stores = new Set<string>()
  integrationTests.forEach(test => {
    test.dataStoresAffected.forEach(store => stores.add(store))
  })
  return Array.from(stores).sort()
}

export function generateTestingChecklist(): string {
  let markdown = '# Integration Testing Checklist\n\n'
  
  const categories = Array.from(new Set(integrationTests.map(t => t.category)))
  
  categories.forEach(category => {
    markdown += `## ${category.replace(/_/g, ' ')}\n\n`
    const tests = getIntegrationTestsByCategory(category)
    tests.forEach(test => {
      markdown += `### ${test.name}\n`
      markdown += `${test.description}\n\n`
      markdown += `**Steps:**\n`
      test.steps.forEach((step, i) => {
        markdown += `${i + 1}. ${step}\n`
      })
      markdown += '\n**Expected Outcomes:**\n'
      test.expectedOutcomes.forEach(outcome => {
        markdown += `- [ ] ${outcome}\n`
      })
      markdown += `\n**Data Stores Affected:** ${test.dataStoresAffected.join(', ')}\n\n`
      markdown += '---\n\n'
    })
  })
  
  return markdown
}
