/* global console, URL */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/hooks/use-auth.tsx', import.meta.url), 'utf8')

assert.match(
  source,
  /const serverAuthGeneration = useRef\(0\)/,
  'server authentication tracks request generations',
)
assert.match(
  source,
  /if \(SERVER_AUTH_ENABLED\) \{\s+const generation = serverAuthGeneration\.current \+ 1\s+serverAuthGeneration\.current = generation\s+const result = await serverLogin[\s\S]*?if \(generation !== serverAuthGeneration\.current\) return false/,
  'interactive login supersedes an in-flight bootstrap request',
)
assert.match(
  source,
  /const generation = serverAuthGeneration\.current \+ 1\s+serverAuthGeneration\.current = generation\s+let active = true\s+serverMe\(\)[\s\S]*?if \(!active \|\| generation !== serverAuthGeneration\.current\) return[\s\S]*?\.catch\(\(\) => \{\s+if \(!active \|\| generation !== serverAuthGeneration\.current\) return/,
  'both successful and failed bootstrap responses are ignored once superseded',
)
assert.match(
  source,
  /if \(SERVER_AUTH_ENABLED\) \{\s+serverAuthGeneration\.current \+= 1\s+void serverLogout\(\)/,
  'logout invalidates every in-flight server authentication request',
)
assert.doesNotMatch(
  source,
  /if \(SERVER_AUTH_ENABLED\)[\s\S]{0,300}writeBrowserStorage\(AUTH_USER_STORAGE_KEY/,
  'server authentication never writes the authenticated identity to browser storage',
)

console.log('Server authentication authority checks passed.')
