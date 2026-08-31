import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const npmCli = process.env.npm_execpath ?? resolve(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
// This script also runs from prepack/prepublishOnly via `npm run check`.
// The nested dry-run must suppress lifecycle scripts or npm would recursively
// enter prepack forever before it can report the concrete file list.
const output = execFileSync(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--dry-run', '--json'], { cwd: root, encoding: 'utf8' })
const [report] = JSON.parse(output)
if (report?.name !== manifest.name || report.version !== manifest.version) throw new Error('pack identity drifted from package.json')

// Keep the broad npm `files` globs stable, then validate their concrete expansion
// below. The concrete allowlist is what prevents a stale lib chunk from shipping.
const expectedFilesDeclaration = [
  'lib/*.js', 'lib/*.d.ts', 'lib/*.js.map', 'lib/*.d.ts.map',
  'lib/typert.host.js', 'lib/typert.host.d.ts',
  'lib/typert.remote-client.js', 'lib/typert.remote-client.d.ts',
  'cordis.patch.yml', 'README.md', 'README.zh-CN.md', 'CHANGELOG.md', 'LICENSE',
]
if (JSON.stringify(manifest.files) !== JSON.stringify(expectedFilesDeclaration)) {
  throw new Error('package.json files policy drifted; update the explicit pack contract before changing it')
}

function exportTargets(value) {
  if (typeof value === 'string') return [value]
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('package export has an unsupported shape')
  return Object.values(value).flatMap(exportTargets)
}

const exported = [...new Set(Object.values(manifest.exports).flatMap(exportTargets).map(target => {
  if (!target.startsWith('./') || target.includes('\\') || target.split('/').includes('..')) {
    throw new Error(`package export escapes the package root: ${target}`)
  }
  return target.slice(2)
}))].sort()
const expectedExports = [
  'lib/client.d.ts', 'lib/client.js',
  'lib/index.d.ts', 'lib/index.js',
  'lib/typert.host.d.ts', 'lib/typert.host.js',
  'lib/typert.remote-client.d.ts', 'lib/typert.remote-client.js',
  'package.json',
].sort()
if (JSON.stringify(exported) !== JSON.stringify(expectedExports)) {
  throw new Error(`package exports drifted:\n${JSON.stringify({ expected: expectedExports, actual: exported }, null, 2)}`)
}

const allowed = new Set([
  'package.json',
  'cordis.patch.yml',
  'README.md',
  'README.zh-CN.md',
  'CHANGELOG.md',
  'LICENSE',
  ...exported,
  ...exported.filter(path => path.endsWith('.js')).map(path => `${path}.map`),
  // Host/Typert declarations are compiler-emitted with maps. client.d.ts is a
  // deliberate handwritten build artifact and therefore has no declaration map.
  'lib/index.d.ts.map',
  'lib/typert.host.d.ts.map',
  'lib/typert.remote-client.d.ts.map',
])
const paths = report.files.map(file => file.path.replaceAll('\\', '/'))
if (new Set(paths).size !== paths.length) throw new Error('pack report contains duplicate paths')
const missing = [...allowed].filter(path => !paths.includes(path)).sort()
const unexpected = paths.filter(path => !allowed.has(path)).sort()
if (missing.length > 0 || unexpected.length > 0) {
  throw new Error(`pack contents differ from the strict allowlist:\n${JSON.stringify({ missing, unexpected }, null, 2)}`)
}
for (const target of exported) {
  if (!paths.includes(target)) throw new Error(`pack omitted exported target ${target}`)
}
console.log(`strict pack allowlist ok: ${paths.length} entries, ${report.size} bytes`)
