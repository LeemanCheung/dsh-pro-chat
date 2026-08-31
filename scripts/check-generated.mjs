import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lib = resolve(root, 'lib')
const sourceRoot = resolve(root, 'src')
const dependencyRoot = resolve(root, 'node_modules')
const isInside = (parent, candidate) => candidate === parent
  || candidate.startsWith(`${parent}/`) || candidate.startsWith(`${parent}\\`)
const required = [
  'index.js', 'index.js.map', 'index.d.ts',
  'client.js', 'client.js.map', 'client.d.ts',
  'typert.host.js', 'typert.host.d.ts',
  'typert.remote-client.js', 'typert.remote-client.d.ts',
]
for (const name of required) await access(resolve(lib, name))

for (const mapName of ['index.js.map', 'client.js.map']) {
  const map = JSON.parse(await readFile(resolve(lib, mapName), 'utf8'))
  for (const [index, source] of map.sources.entries()) {
    if (isAbsolute(source) || /^[A-Za-z]:[\\/]/u.test(source)) throw new Error(`${mapName} contains an absolute source path: ${source}`)
    const candidate = resolve(lib, source)
    if (!isInside(sourceRoot, candidate) && !isInside(dependencyRoot, candidate)) {
      throw new Error(`${mapName} source escapes standalone src/node_modules ownership: ${source}`)
    }
    if (!isInside(sourceRoot, candidate)) continue
    const [actual, embedded] = await Promise.all([
      readFile(candidate, 'utf8'),
      Promise.resolve(map.sourcesContent?.[index]),
    ])
    if (typeof embedded !== 'string') throw new Error(`${mapName} omitted sourcesContent for ${source}`)
    const normalize = value => value.replace(/\r\n?/gu, '\n')
    if (normalize(actual) !== normalize(embedded)) throw new Error(`${mapName} drifted from ${source}`)
  }
}

const stale = (await readdir(lib)).filter(name => /^remote-contract-[A-Za-z0-9_-]+\.js(?:\.map)?$/u.test(name))
if (stale.length > 0) throw new Error(`stale Typert chunks: ${stale.join(', ')}`)

const [{ TYPERT }, { TYPERT_REMOTE }] = await Promise.all([
  import(pathToFileURL(resolve(lib, 'typert.host.js')).href + `?v=${Date.now()}`),
  import(pathToFileURL(resolve(lib, 'typert.remote-client.js')).href + `?v=${Date.now()}`),
])
const hostMethods = TYPERT.invocations.map(item => item.method)
const clientMethods = TYPERT_REMOTE.descriptors.map(item => item.method)
if (JSON.stringify(hostMethods) !== JSON.stringify(clientMethods)) throw new Error('Host/Client Remote methods drifted')
if (!hostMethods.includes('verifyTransport') || !hostMethods.includes('restoreChat') || !hostMethods.includes('listArchivedChats')) {
  throw new Error('Remote recovery methods are missing')
}
console.log(`generated artifacts match source: ${hostMethods.length} Remote methods`)
