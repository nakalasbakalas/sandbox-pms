/* global console, process */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const requiredDocs = [
  'LAUNCH_CHECKLIST.md',
  'docs/launch/CODEX_LAUNCH_FINISH_PACKET.md',
  'docs/launch/LAUNCH_PROOF_MATRIX.md',
  'docs/launch/CURRENT_STATUS_INDEX.md',
  'README.md',
  'docs/launch-scope-decisions.md',
  'docs/live-environment-proof.md',
]
const evidenceDir = join(root, 'docs', 'launch', 'evidence')
const failures = []

function rel(path) {
  return relative(root, path).replaceAll('\\', '/')
}

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return result.status === 0 ? result.stdout.trim() : ''
}

function collectMarkdownFiles(dir) {
  if (!existsSync(dir)) return []

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) return collectMarkdownFiles(fullPath)
    return entry.isFile() && entry.name.endsWith('.md') ? [fullPath] : []
  })
}

function collectGitWorktreeFiles() {
  const output = runGit(['ls-files', '--cached', '--others', '--exclude-standard'])
  if (!output) return []

  return output
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file) => file.replaceAll('\\', '/') !== 'package-lock.json')
}

function readTextFile(file) {
  const fullPath = join(root, file)
  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) return null

  const content = readFileSync(fullPath)
  if (content.includes(0)) return null
  return content.toString('utf8')
}

function checkRequiredDocs() {
  console.log('\nRequired launch docs:')
  for (const doc of requiredDocs) {
    const fullPath = join(root, doc)
    const ok = existsSync(fullPath) && statSync(fullPath).isFile()
    console.log(`- ${ok ? 'present' : 'missing'} ${doc}`)
    if (!ok) failures.push(`Missing required launch doc: ${doc}`)
  }
}

function checkEvidenceFiles() {
  console.log('\nLaunch evidence files:')
  if (!existsSync(evidenceDir)) {
    failures.push('Missing docs/launch/evidence directory.')
    console.log('- missing docs/launch/evidence')
    return
  }

  const files = readdirSync(evidenceDir)
    .filter((name) => name.endsWith('.md'))
    .sort()

  if (files.length === 0) {
    failures.push('No launch evidence markdown files found.')
    console.log('- none')
    return
  }

  for (const file of files) console.log(`- ${file}`)
}

function secretPatternFailures(file, text) {
  const fileFailures = []
  const patterns = [
    {
      label: 'private key block',
      regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    },
    {
      label: 'OpenAI-style API key',
      regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
    },
    {
      label: 'GitHub token literal',
      regex: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/,
    },
    {
      label: 'bearer token literal',
      regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{30,}/i,
    },
    {
      label: 'Render API token literal',
      regex: /\brnd_[A-Za-z0-9]{20,}\b/i,
    },
  ]

  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      if (pattern.regex.test(line)) {
        fileFailures.push(`${file}:${index + 1} contains ${pattern.label}`)
      }
    }

    const databaseUrls = line.matchAll(/postgres(?:ql)?:\/\/([^:\s"'`]+):([^@\s"'`]+)@([^/\s:"'`]+)(?::\d+)?\/([^?\s"'`]+)/gi)
    for (const match of databaseUrls) {
      const password = decodeURIComponent(match[2] || '')
      const host = String(match[3] || '').toLowerCase()
      const database = String(match[4] || '').toLowerCase()
      const placeholderPassword = /^(password|pass|sandbox|user|example|changeme|\*\*\*)$/i.test(password)
      const localOrExampleHost = ['localhost', '127.0.0.1', 'db.internal', 'host'].includes(host) || host.endsWith('.test')

      if (!placeholderPassword && !localOrExampleHost && database.includes('sandbox')) {
        fileFailures.push(`${file}:${index + 1} contains unredacted production-like PostgreSQL URL password`)
      }
    }
  })

  return fileFailures
}

function checkSecretShapedEvidence() {
  const scanTargets = [
    join(root, 'LAUNCH_CHECKLIST.md'),
    join(root, 'docs', 'live-environment-proof.md'),
    ...collectMarkdownFiles(join(root, 'docs', 'launch')),
  ].filter((path, index, paths) => existsSync(path) && paths.indexOf(path) === index)

  console.log('\nLaunch evidence secret hygiene scan:')
  let findingCount = 0
  for (const file of scanTargets) {
    const fileFailures = secretPatternFailures(rel(file), readFileSync(file, 'utf8'))
    findingCount += fileFailures.length
    failures.push(...fileFailures)
  }

  if (findingCount === 0) {
    console.log('- no unredacted secret-shaped values found in launch evidence docs')
  }
}

function checkCurrentTreeSecretHygiene() {
  const files = collectGitWorktreeFiles()
  let scanned = 0
  let findingCount = 0

  console.log('\nCurrent tree secret hygiene scan:')
  for (const file of files) {
    const text = readTextFile(file)
    if (text === null) continue

    scanned += 1
    const fileFailures = secretPatternFailures(file.replaceAll('\\', '/'), text)
    findingCount += fileFailures.length
    failures.push(...fileFailures)
  }

  if (findingCount === 0) {
    console.log(`- no high-confidence unredacted production secret-shaped values found in ${scanned} tracked/unignored text files`)
  }
}

const branch = runGit(['branch', '--show-current']) || '(detached)'
const commit = runGit(['rev-parse', 'HEAD']) || '(unknown)'
const status = runGit(['status', '--short'])
const dirtyFiles = status ? status.split(/\r?\n/).filter(Boolean) : []

console.log('Sandbox Hotel PMS launch evidence inventory')
console.log(`Branch: ${branch}`)
console.log(`Commit: ${commit}`)
console.log(`Dirty worktree entries: ${dirtyFiles.length}`)

checkRequiredDocs()
checkEvidenceFiles()
checkSecretShapedEvidence()
checkCurrentTreeSecretHygiene()

if (failures.length) {
  console.error('\nLaunch evidence inventory failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log('\nLaunch evidence inventory passed.')
}
