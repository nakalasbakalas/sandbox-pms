/* global console, process */
import { createPasswordHash } from '../server/security.mjs'

const password = process.argv[2]

if (!password) {
  console.error('Usage: node scripts/hash-password.mjs "long-production-password"')
  process.exit(1)
}

console.log(createPasswordHash(password))
