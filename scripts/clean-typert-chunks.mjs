import { readdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lib = resolve(root, 'lib')
for (const name of await readdir(lib).catch(() => [])) {
  if (!/^remote-contract-[A-Za-z0-9_-]+\.js(?:\.map)?$/u.test(name)) continue
  const target = resolve(lib, name)
  if (!target.startsWith(`${lib}\\`) && !target.startsWith(`${lib}/`)) throw new Error('Typert cleanup escaped lib.')
  await rm(target, { force: true })
}
