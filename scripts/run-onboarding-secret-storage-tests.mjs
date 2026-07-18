/* global console, URL */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/hooks/use-onboarding.ts', import.meta.url), 'utf8')

assert.match(
  source,
  /SERVER_AUTH_ENABLED \? SERVER_ONBOARDING_STATE_KEY : 'onboarding:state'/,
  'server onboarding uses its separate, credential-free persisted state key',
)
assert.match(
  source,
  /const \{ password, confirmPassword, \.\.\.persistedUser \} = user/,
  'server admin updates separate credentials from persisted fields before writing state',
)
assert.match(
  source,
  /setTransientServerAdminCredentials\(\{ password, confirmPassword \}\)/,
  'server credentials are kept in the transient subscription store',
)
assert.match(
  source,
  /adminUser: \{[\s\S]*password: '',[\s\S]*confirmPassword: ''/,
  'the persisted server onboarding state removes both credential fields',
)
assert.match(
  source,
  /removeLegacyOnboardingCredentials\(\)[\s\S]*?await completeServerSetup[\s\S]*?finally \{[\s\S]*?removeLegacyOnboardingCredentials\(\)/,
  'legacy credential-bearing storage is cleared before and after server setup attempts',
)
assert.match(
  source,
  /const setState = [\s\S]*?SERVER_AUTH_ENABLED \? withoutAdminCredentials\(resolved\) : resolved/,
  'every server onboarding state update is sanitized before browser persistence',
)
assert.match(
  source,
  /setServerSetupStatus\([\s\S]*?clearTransientServerAdminCredentials\(\)[\s\S]*?deleteStoredState\(\)[\s\S]*?return[\s\S]*?setPropertyData/,
  'successful server setup clears its draft and returns before demo operational stores are written',
)

console.log('Onboarding server credential storage checks passed.')
