import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { URL } from 'node:url'

const source = readFileSync(new URL('../src-lite/app.tsx', import.meta.url), 'utf8')

test('Lite session transitions clear cached role-scoped data', () => {
  assert.match(source, /const authenticatedUser = await liteApi\.login\(identity, password\)[\s\S]*?queryClient\.clear\(\)[\s\S]*?setUser\(authenticatedUser\)/)
  assert.match(source, /await liteApi\.logout\(\)[\s\S]*?queryClient\.clear\(\)[\s\S]*?setUser\(null\)/)
  assert.match(source, /const expireSession = \(\) => \{[\s\S]*?queryClient\.clear\(\)[\s\S]*?setUser\(null\)/)
})
