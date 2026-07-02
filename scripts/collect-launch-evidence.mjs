/* global console, process */
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const outDir = join(root, 'docs', 'launch', 'evidence')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const outPath = join(outDir, `LAUNCH_EVIDENCE_${stamp}.md`)

const envKeys = [
  'NODE_ENV',
  'DATABASE_URL',
  'E2E_DATABASE_URL',
  'ALLOW_DB_E2E',
  'SESSION_SECRET',
  'VITE_PMS_API_MODE',
  'APP_URL',
  'ALLOWED_ORIGINS',
  'SEED_MODE',
  'SEED_USERS_JSON',
  'ALLOW_PROD_ROOM_ONBOARDING',
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_CHANNEL_SECRET',
]

function capture(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim() || '(no output)'
  } catch (error) {
    const stdout = error?.stdout?.toString?.().trim()
    const stderr = error?.stderr?.toString?.().trim()
    return [
      `FAILED: ${command} ${args.join(' ')}`,
      stdout,
      stderr,
    ].filter(Boolean).join('\n')
  }
}

function envStatus(key) {
  if (!Object.prototype.hasOwnProperty.call(process.env, key)) return 'missing'
  if (process.env[key] === '') return 'empty'
  if (key === 'ALLOW_DB_E2E') return process.env[key] === 'true' ? 'true' : 'configured-not-true'
  if (key === 'ALLOW_PROD_ROOM_ONBOARDING') return process.env[key] === 'true' ? 'true' : 'configured-not-true'
  return 'configured-redacted'
}

function tableEscape(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
}

const gitSha = capture('git', ['rev-parse', 'HEAD'])
const gitBranch = capture('git', ['branch', '--show-current'])
const gitStatus = capture('git', ['status', '--short'])
const nodeVersion = process.version
const npmVersion = capture(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'])

const envRows = envKeys
  .map((key) => `| ${tableEscape(key)} | ${tableEscape(envStatus(key))} |`)
  .join('\n')

const content = `# Launch Evidence Snapshot

Generated: ${new Date().toISOString()}

This file is a non-destructive evidence template. It intentionally records only environment-variable presence, never secret values.

## Checkout

| Item | Value |
| --- | --- |
| Branch | ${tableEscape(gitBranch)} |
| Commit | ${tableEscape(gitSha)} |
| Node | ${tableEscape(nodeVersion)} |
| npm | ${tableEscape(npmVersion)} |

## Non-secret environment presence

| Variable | Status |
| --- | --- |
${envRows}

## Working tree status

\`\`\`text
${gitStatus}
\`\`\`

## Commands to run and paste below

Paste redacted output under each command. Do not paste production secrets, raw database URLs, session cookies, bearer tokens, or screenshots containing secrets.

### npm run db:doctor

Status: not run in this snapshot.

\`\`\`text
<redacted output here>
\`\`\`

### npm run typecheck

Status: not run in this snapshot.

\`\`\`text
<output here>
\`\`\`

### npm run lint

Status: not run in this snapshot.

\`\`\`text
<output here>
\`\`\`

### npm test

Status: not run in this snapshot.

\`\`\`text
<output here>
\`\`\`

### npm run test:e2e

Status: not run in this snapshot.

\`\`\`text
<output here>
\`\`\`

### npm run test:e2e:db

Status: not run in this snapshot.

Safety decision: DB-mutating E2E must use a disposable/staging database with ALLOW_DB_E2E=true, or be explicitly recorded as local-only proof. Never run against production.

\`\`\`text
<redacted output here>
\`\`\`

### npm run build

Status: not run in this snapshot.

\`\`\`text
<output here>
\`\`\`

### npm run prod:preflight

Status: not run in this snapshot.

\`\`\`text
<redacted output here>
\`\`\`

### npm run render:validate

Status: not run in this snapshot.

\`\`\`text
<output here>
\`\`\`

### npm run live:check

Status: not run in this snapshot.

\`\`\`text
<redacted output here>
\`\`\`

### npm run launch:check

Status: not run in this snapshot.

\`\`\`text
<redacted output here>
\`\`\`

### git diff --check

Status: not run in this snapshot.

\`\`\`text
<output here>
\`\`\`

## Manual proof checklist

- [ ] Production users and role access verified.
- [ ] Logout/session clearing verified.
- [ ] Unauthorized route access blocked.
- [ ] Unauthorized protected API mutation blocked.
- [ ] Bootstrap credential path rotated, disabled, or removed.
- [ ] Real room inventory proved.
- [ ] Core reservation/update/cancel/check-in/check-out/payment/housekeeping workflow proved.
- [ ] Secret inventory is redacted and rotation dates are recorded.
- [ ] Rollback, deputy, and database recovery owners are named.
- [ ] Live environment secret/recovery proof is captured without secret values.
- [ ] WAF/rate-limit posture is captured or formally deferred.
- [ ] LINE, OTA automation, and payments posture decisions are captured.
- [ ] Browser cold-start status is fixed or documented.
- [ ] Thai/English/tablet/manual ops acceptance is captured.

## Conclusion

Status: draft snapshot. Replace this line with pass/fail summary after commands and manual proof are complete.
`

await mkdir(outDir, { recursive: true })
await writeFile(outPath, content, 'utf8')
console.log(`Created ${outPath}`)
