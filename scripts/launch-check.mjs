/* global console, process */
import { spawn } from 'node:child_process'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n> ${command} ${args.join(' ')}`)
    const child = process.platform === 'win32'
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', [command, ...args].join(' ')], {
        stdio: 'inherit',
        shell: false,
        env: {
          ...process.env,
          ...options.env,
        },
      })
      : spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      env: {
        ...process.env,
        ...options.env,
      },
    })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}`))
    })
  })
}

const checks = [
  [npm, ['run', 'db:generate']],
  [npm, ['run', 'lint']],
  [npm, ['run', 'typecheck']],
  [npm, ['test']],
  [npm, ['run', 'test:e2e']],
  [npm, ['run', 'build']],
  [npm, ['audit', '--audit-level=high']],
]

for (const [command, args] of checks) {
  await run(command, args)
}

if (process.env.DATABASE_URL) {
  await run(npx, ['prisma', 'migrate', 'status'])
} else {
  console.log('\n> prisma migrate status skipped: DATABASE_URL is not configured in this environment.')
}

console.log('\nLaunch check passed.')
