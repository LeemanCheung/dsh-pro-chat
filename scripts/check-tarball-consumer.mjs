import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const npmCli = process.env.npm_execpath ?? resolve(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const packedName = execFileSync(process.execPath, [npmCli, 'pack', '--silent'], {
  cwd: root,
  encoding: 'utf8',
}).trim().split(/\r?\n/u).at(-1)
const expectedName = `${manifest.name.replace(/^@/u, '').replaceAll('/', '-')}-${manifest.version}.tgz`
if (packedName !== expectedName || basename(packedName) !== packedName) {
  throw new Error(`npm pack returned an unexpected tarball name: ${packedName ?? 'none'}`)
}
const tarball = resolve(root, packedName)
const consumer = await mkdtemp(resolve(tmpdir(), 'dsh-pro-chat-consumer-'))
try {
  await writeFile(resolve(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }), 'utf8')
  execFileSync(process.execPath, [npmCli, 'install', '--ignore-scripts', '--no-save', '--no-fund', tarball], {
    cwd: consumer,
    stdio: 'pipe',
  })
  const smoke = [
    "await import('dsh-pro-chat')",
    "await import('dsh-pro-chat/typert')",
    "await import('dsh-pro-chat/remote')",
    "const client = import.meta.resolve('dsh-pro-chat/client')",
    "if (!client.includes('/lib/client.js')) throw new Error('client export did not resolve to lib/client.js')",
    "console.log('tarball consumer exports ok')",
  ].join(';')
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', smoke], {
    cwd: consumer,
    encoding: 'utf8',
  }).trim()
  if (output !== 'tarball consumer exports ok') throw new Error(`unexpected consumer smoke output: ${output}`)
  console.log(`tarball consumer smoke ok: ${packedName}`)
} finally {
  await rm(consumer, { recursive: true, force: true })
  await rm(tarball, { force: true })
}
