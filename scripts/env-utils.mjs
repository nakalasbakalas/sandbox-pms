/* global process */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function parseEnvLine(line) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null

  const separatorIndex = trimmed.indexOf('=')
  if (separatorIndex < 1) return null

  const key = trimmed.slice(0, separatorIndex).trim()
  let value = trimmed.slice(separatorIndex + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  return { key, value }
}

export function loadEnvDefaults(files = ['.env', '.env.local']) {
  for (const file of files) {
    loadEnvFile(file)
  }
}

export function loadEnvFile(file) {
  const path = resolve(process.cwd(), file)
  if (!existsSync(path)) return

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const parsed = parseEnvLine(line)
    if (!parsed) continue
    if (process.env[parsed.key] === undefined || process.env[parsed.key] === '') {
      process.env[parsed.key] = parsed.value
    }
  }
}
