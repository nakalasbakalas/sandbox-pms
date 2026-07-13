/* global console, process */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const outputDirectory = resolve(process.cwd(), 'dist-lite')
const manifestPath = resolve(outputDirectory, '.vite', 'manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const entry = Object.values(manifest).find((item) => item?.isEntry)

if (!entry?.file || !/^assets\/[A-Za-z0-9._-]+\.js$/.test(entry.file)) {
  throw new Error('Lite build manifest does not contain a safe JavaScript entry asset.')
}

const commitSha = String(process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT_SHA || '').trim().toLowerCase()
const metadata = {
  uiVariant: 'lite',
  buildTime: new Date().toISOString(),
  assetIdentifier: entry.file,
  commitSha: /^[0-9a-f]{7,40}$/.test(commitSha) ? commitSha : null,
}

await writeFile(resolve(outputDirectory, 'release-meta.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
console.log(`Lite release metadata written for ${metadata.assetIdentifier}.`)
