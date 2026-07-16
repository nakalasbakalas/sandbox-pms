/* global console, process */
import { readFile, stat } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = resolve(repoRoot, 'dist-lite')
const manifestPath = resolve(outputRoot, '.vite', 'manifest.json')
const DEFAULT_LIMIT_KIB = 250

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function cliLimit(argv = process.argv.slice(2), env = process.env) {
  const index = argv.indexOf('--limit-kib')
  const argument = index >= 0 ? argv[index + 1] : undefined
  return positiveNumber(argument ?? env.LITE_ENTRY_GZIP_LIMIT_KIB, DEFAULT_LIMIT_KIB)
}

function outputFilePath(file) {
  const candidate = resolve(outputRoot, String(file || ''))
  const outside = relative(outputRoot, candidate)
  if (!file || isAbsolute(outside) || outside.startsWith('..')) {
    throw new Error(`Lite manifest contains an invalid output path: ${String(file || '(missing)')}`)
  }
  return candidate
}

export function collectInitialJavaScript(manifest) {
  const entries = Object.entries(manifest || {}).filter(([, item]) => item?.isEntry)
  if (entries.length === 0) throw new Error('Lite Vite manifest does not contain an application entry.')

  const files = new Set()
  const visited = new Set()
  const visit = (key) => {
    if (visited.has(key)) return
    visited.add(key)
    const item = manifest[key]
    if (!item) throw new Error(`Lite Vite manifest import is missing: ${key}`)
    if (String(item.file || '').endsWith('.js')) files.add(item.file)
    for (const importedKey of item.imports || []) visit(importedKey)
  }
  for (const [key] of entries) visit(key)
  return [...files].sort()
}

export async function measureLiteInitialJavaScript(options = {}) {
  const manifest = JSON.parse(await readFile(options.manifestPath || manifestPath, 'utf8'))
  const files = collectInitialJavaScript(manifest)
  const measured = []
  for (const file of files) {
    const path = outputFilePath(file)
    const source = await readFile(path)
    const fileStat = await stat(path)
    measured.push({
      file,
      rawBytes: fileStat.size,
      gzipBytes: gzipSync(source).byteLength,
    })
  }
  return {
    files: measured,
    rawBytes: measured.reduce((sum, item) => sum + item.rawBytes, 0),
    gzipBytes: measured.reduce((sum, item) => sum + item.gzipBytes, 0),
  }
}

async function main() {
  const limitKiB = cliLimit()
  const limitBytes = Math.floor(limitKiB * 1024)
  const result = await measureLiteInitialJavaScript()
  const gzipKiB = result.gzipBytes / 1024
  console.log(`PMS Lite initial JavaScript: ${gzipKiB.toFixed(2)} KiB gzip / ${limitKiB} KiB limit.`)
  for (const file of result.files) {
    console.log(`- ${file.file}: ${(file.gzipBytes / 1024).toFixed(2)} KiB gzip`)
  }
  if (result.gzipBytes > limitBytes) {
    throw new Error(
      `PMS Lite initial JavaScript exceeds the ${limitKiB} KiB gzip budget by ${((result.gzipBytes - limitBytes) / 1024).toFixed(2)} KiB.`,
    )
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
