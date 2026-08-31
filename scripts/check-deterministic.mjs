import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const files = [
  'lib/index.js',
  'lib/index.js.map',
  'lib/client.js',
  'lib/client.js.map',
  'lib/typert.host.js',
  'lib/typert.remote-client.js',
]
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async file => [
  file,
  createHash('sha256').update(await readFile(resolve(root, file))).digest('hex'),
])))

const before = await hashes()
const npmCli = process.env.npm_execpath ?? resolve(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
for (const script of ['build:host', 'build:client']) {
  execFileSync(process.execPath, [npmCli, 'run', script], { cwd: root, env: process.env, stdio: 'pipe' })
}
const after = await hashes()
if (JSON.stringify(before) !== JSON.stringify(after)) {
  throw new Error(`generated output is nondeterministic:\n${JSON.stringify({ before, after }, null, 2)}`)
}
console.log(`deterministic rebuild ok: ${files.length} artifacts`)
