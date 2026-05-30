/* global console, process */
import { spawn } from 'node:child_process'

export function bin(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name
}

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      ...options.env,
    }
    const display = options.display || `${command} ${args.join(' ')}`
    if (options.stdio !== 'pipe') console.log(`\n> ${display}`)

    const child = process.platform === 'win32'
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', [command, ...args].join(' ')], {
        stdio: options.stdio || 'inherit',
        shell: false,
        env,
      })
      : spawn(command, args, {
        stdio: options.stdio || 'inherit',
        shell: false,
        env,
      })

    let stdout = ''
    let stderr = ''
    if (child.stdout) child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    if (child.stderr) child.stderr.on('data', (chunk) => { stderr += chunk.toString() })

    child.on('exit', (code) => {
      const result = { code, stdout, stderr }
      if (code === 0 || options.allowFailure) resolve(result)
      else reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}`))
    })
    child.on('error', reject)
  })
}
