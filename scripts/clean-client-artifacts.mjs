import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lib = resolve(root, 'lib')
for (const name of ['client.ts.map', 'tsconfig.tsbuildinfo', 'tsconfig.client.tsbuildinfo']) {
  const target = resolve(lib, name)
  if (!target.startsWith(`${lib}\\`) && !target.startsWith(`${lib}/`)) throw new Error('Client cleanup escaped lib.')
  await rm(target, { force: true })
}
