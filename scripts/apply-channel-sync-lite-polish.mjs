#!/usr/bin/env node
/* global console, process */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const path = resolve(process.cwd(), 'server/availability-queue.mjs')
let content = await readFile(path, 'utf8')

function replaceOnce(search, replacement) {
  const first = content.indexOf(search)
  if (first === -1) throw new Error('Expected availability queue polish block was not found.')
  if (content.indexOf(search, first + search.length) !== -1) throw new Error('Availability queue polish block is not unique.')
  content = content.slice(0, first) + replacement + content.slice(first + search.length)
}

replaceOnce(
  `        permissionDecision: {
          allowed: true,
          queueSource: QUEUE_SOURCE,`,
  `        permissionDecision: {
          allowed: true,
          approvalRequired: true,
          requiredApprovalRole: 'HOTEL_MANAGER',
          riskLevel: 'HIGH',
          reason: 'Manual availability delivery requires hotel manager or owner approval and provider confirmation.',
          queueSource: QUEUE_SOURCE,`,
)

replaceOnce(
  'availability change queued for owner approval; no external write executed.',
  'availability change queued for manager/owner approval; no external write executed.',
)

replaceOnce(
  'Pending owner approval record was not found.',
  'Pending manager/owner approval record was not found.',
)

await writeFile(path, content)
console.log('updated server/availability-queue.mjs metadata and approval wording')
