/* global console, URL */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

const dashboard = await source('src/components/cashier/AccountingDashboard.tsx')
const reconciliation = await source('src/components/cashier/CashReconciliation.tsx')

for (const [name, file, demoComponent] of [
  ['Accounting dashboard', dashboard, 'AccountingDashboardDemo'],
  ['Cash reconciliation', reconciliation, 'CashReconciliationDemo'],
]) {
  assert.match(file, /import \{ SERVER_API_ENABLED \} from ['"]@\/lib\/pms-api-client['"]/, `${name} knows whether it is running against the server`)
  assert.match(file, new RegExp(`export function ${name === 'Accounting dashboard' ? 'AccountingDashboard' : 'CashReconciliation'}\\(\\) \\{[\\s\\S]{0,500}?return SERVER_API_ENABLED \\? <[^>]+/> : <${demoComponent} />`), `${name} blocks its KV implementation in server mode`)
  const demoStart = file.indexOf(`function ${demoComponent}()`)
  assert.ok(demoStart >= 0, `${name} retains its explicit demo implementation`)
  assert.equal((file.slice(0, demoStart).match(/useKV\(/g) || []).length, 0, `${name} does not invoke browser KV before the server-mode gate`)
  assert.ok(file.slice(demoStart).includes('useKV<'), `${name} only reaches Spark KV inside its demo implementation`)
}

console.log('Cashier accounting server-mode authority gates passed.')
