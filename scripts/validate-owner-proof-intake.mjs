/* global Buffer, console, process */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_TEMPLATE_PATH = '.codex/owner-proof-intake.local.json'

const REQUIRED_AREAS = [
  ['productionUsersAuthRbac', 'production users/auth/RBAC/logout proof'],
  ['roomInventory', 'real room inventory source proof'],
  ['workflowAcceptance', 'workflow acceptance or staging decision'],
  ['secretsRecoveryRollbackWaf', 'secret/recovery/rollback/WAF proof'],
  ['bookingInboxReview', 'staff booking-inbox parser review'],
]

function hasFlag(name) {
  return process.argv.includes(name)
}

function argValue(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  return process.argv[index + 1]
}

function fail(message) {
  throw new Error(message)
}

function nullableString(value) {
  if (value === undefined || value === null) return null
  const normalized = String(value).trim()
  return normalized ? normalized : null
}

function template() {
  return {
    generatedAt: new Date().toISOString(),
    purpose: 'Sandbox PMS owner-proof intake; keep this file local/untracked until redacted and approved.',
    redactionConfirmed: false,
    preparedBy: {
      initials: '',
      role: '',
      date: '',
    },
    productionUsersAuthRbac: {
      owner: '',
      date: '',
      verdict: 'open',
      approvedUsers: [
        {
          loginIdentifierMasked: 'n***@e***.com',
          displayInitials: 'AB',
          role: 'ADMIN',
          active: true,
          approvingOwner: '',
          approvalDate: '',
        },
      ],
      credentialedProof: [
        {
          role: 'ADMIN',
          host: 'https://book.sandboxhotel.com',
          checkedAt: '',
          firstAuthenticatedCheck: '/api/auth/me returned 200',
          logoutCheck: '/api/auth/me returned 401 after logout',
        },
      ],
      denialProof: [
        {
          underprivilegedRole: 'HOUSEKEEPING',
          attemptedTarget: '/settings',
          expectedStatus: 401,
          observedStatus: 401,
        },
      ],
      bootstrapSetupTokenDecision: {
        action: 'rotated | disabled | retained',
        owner: '',
        date: '',
        expiryIfRetained: '',
        reasonIfRetained: '',
      },
    },
    roomInventory: {
      owner: '',
      date: '',
      verdict: 'open',
      sourceOfTruth: 'PMS admin setup | onboarding import | reviewed export',
      notFakeSeedConfirmedBy: '',
      aggregateCounts: [
        {
          roomTypeLabel: 'redacted or approved label',
          count: 0,
          activeStatus: 'active',
        },
      ],
      statusDistribution: [
        {
          status: 'VACANT_CLEAN',
          count: 0,
        },
      ],
    },
    workflowAcceptance: {
      owner: '',
      date: '',
      verdict: 'open',
      evidenceTarget: 'local disposable | staging | controlled production-like',
      localOnlyAccepted: false,
      stagingRequired: false,
      workflowsCovered: [
        'reservation create/update/cancel',
        'invalid date rejection',
        'room assignment safety',
        'check-in/out',
        'payment or folio recording',
        'housekeeping update',
        'audit/timeline entries',
      ],
    },
    secretsRecoveryRollbackWaf: {
      owner: '',
      date: '',
      verdict: 'open',
      renderSecretInventory: [
        {
          key: 'SESSION_SECRET',
          status: 'configured',
          rotationStatus: 'current | rotate before launch | retained with expiry',
        },
      ],
      rollbackOwner: '',
      rollbackDeputy: '',
      databaseRecoveryOwner: '',
      latestRecoveryPointEvidence: '',
      wafRateLimitEvidence: {
        provider: 'Cloudflare',
        zoneOrAccount: '',
        protectedHostnames: ['book.sandboxhotel.com'],
        ruleIds: [],
        thresholdsOrActions: '',
        nonDestructiveTestResult: '',
      },
      legacyKeyDecisions: [
        {
          key: 'ADMIN_PASSWORD',
          action: 'remove | rotate | retain',
          reason: '',
          expiryIfRetained: '',
        },
      ],
    },
    bookingInboxReview: {
      owner: '',
      date: '',
      verdict: 'open',
      reviewedTabs: ['Needs Review', 'Errors', 'Processed', 'Ignored'],
      parserQualityAccepted: false,
      acceptedGaps: '',
      notes: 'Do not include raw email bodies, guest PII, payment details, message ids, or credentials.',
    },
  }
}

function usage() {
  return `Usage:
  npm.cmd run owner-proof:validate -- --init-template
  npm.cmd run owner-proof:validate -- --file .\\.codex\\owner-proof-intake.local.json
  npm.cmd run owner-proof:validate -- --file .\\.codex\\owner-proof-intake.local.json --require-complete
  type .\\.codex\\owner-proof-intake.local.json | npm.cmd run owner-proof:validate -- --stdin

Options:
  --init-template           Write a local ignored JSON template to ${DEFAULT_TEMPLATE_PATH}.
  --template-path <path>    Template output path. Default: ${DEFAULT_TEMPLATE_PATH}.
  --file <path>             Validate proof JSON from a local file.
  --stdin                   Validate proof JSON from stdin.
  --require-complete        Exit non-zero unless all P0 areas have non-open verdicts.
`
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8').trim()
}

async function loadInput() {
  const filePath = argValue('--file')
  if (filePath) return JSON.parse(await readFile(resolve(filePath), 'utf8'))
  if (hasFlag('--stdin')) return JSON.parse(await readStdin())
  fail('Proof input is required. Pass --file <local-json>, --stdin, or --init-template.')
}

async function initTemplate() {
  const outputPath = resolve(argValue('--template-path') || DEFAULT_TEMPLATE_PATH)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(template(), null, 2)}\n`, { flag: 'wx' })
  return {
    generatedAt: new Date().toISOString(),
    purpose: 'owner-proof intake template generation',
    path: outputPath,
    redactionBoundary: 'local ignored template; do not commit until redacted and validated',
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function secretFindings(value, path = '$') {
  const findings = []
  if (Array.isArray(value)) {
    value.forEach((item, index) => findings.push(...secretFindings(item, `${path}[${index}]`)))
    return findings
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) findings.push(...secretFindings(child, `${path}.${key}`))
    return findings
  }
  if (typeof value !== 'string') return findings

  const text = value.trim()
  if (!text) return findings
  const lower = text.toLowerCase()
  const explicitlyRedacted = lower.includes('redacted') || lower.includes('omitted')
  const patterns = [
    ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['OpenAI-style API key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
    ['GitHub token literal', /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/],
    ['Render API token literal', /\brnd_[A-Za-z0-9]{20,}\b/i],
    ['bearer token literal', /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i],
    ['cookie/session literal', /\b(?:cookie|session|sandbox_hotel_session)\b\s*[:=]\s*[^&\s,;}"']{8,}/i],
    ['password assignment', /\bpassword\b\s*[:=]\s*[^&\s,;}"']{4,}/i],
    ['secret assignment', /\bsecret\b\s*[:=]\s*[^&\s,;}"']{8,}/i],
    ['raw PostgreSQL URL', /postgres(?:ql)?:\/\/[^:\s"'`]+:[^@\s"'`]+@[^/\s:"'`]+/i],
  ]

  for (const [label, regex] of patterns) {
    if (regex.test(text) && !explicitlyRedacted) findings.push(`${path} contains ${label}`)
  }

  return findings
}

function verdictFor(area) {
  const verdict = nullableString(area?.verdict)
  return verdict ? verdict.toLowerCase() : 'open'
}

function validateProof(proof, { requireComplete = false } = {}) {
  if (!isObject(proof)) fail('Owner proof intake must be a JSON object.')

  const findings = secretFindings(proof)
  const missingAreas = []
  const openAreas = []
  const closedAreas = []

  for (const [key, label] of REQUIRED_AREAS) {
    if (!isObject(proof[key])) {
      missingAreas.push(label)
      continue
    }
    const verdict = verdictFor(proof[key])
    if (['closed', 'accepted', 'accepted-risk', 'complete'].includes(verdict)) closedAreas.push(label)
    else openAreas.push(label)
  }

  if (proof.redactionConfirmed !== true) {
    findings.push('$.redactionConfirmed must be true after owner review and before evidence is accepted')
  }
  if (requireComplete && (missingAreas.length || openAreas.length)) {
    findings.push(`--require-complete failed; open or missing areas: ${[...missingAreas, ...openAreas].join('; ')}`)
  }

  return {
    generatedAt: new Date().toISOString(),
    purpose: 'redacted owner-proof intake validation',
    redaction: {
      secretValues: findings.length === 0 ? 'no secret-shaped values detected' : 'findings require cleanup',
      rawProofEchoed: false,
    },
    summary: {
      requiredAreas: REQUIRED_AREAS.length,
      closedAreas: closedAreas.length,
      openAreas: openAreas.length,
      missingAreas: missingAreas.length,
      complete: missingAreas.length === 0 && openAreas.length === 0,
    },
    closedAreas,
    openAreas,
    missingAreas,
    findings,
  }
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(usage())
    return
  }
  if (hasFlag('--init-template')) {
    console.log(JSON.stringify(await initTemplate(), null, 2))
    return
  }

  const proof = await loadInput()
  const result = validateProof(proof, { requireComplete: hasFlag('--require-complete') })
  console.log(JSON.stringify(result, null, 2))
  if (result.findings.length > 0) process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}

export { secretFindings, template, validateProof }
