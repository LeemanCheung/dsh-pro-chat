import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const expectedRepository = 'git+https://github.com/LeemanCheung/dsh-pro-chat.git'
if (manifest.repository?.type !== 'git' || manifest.repository.url !== expectedRepository) {
  throw new Error('package repository metadata does not target LeemanCheung/dsh-pro-chat')
}
if (manifest.scripts?.prepack !== 'npm run check' || manifest.scripts?.prepublishOnly !== 'npm run check') {
  throw new Error('prepack and prepublishOnly must both execute the complete check gate')
}

const packCheck = await readFile(resolve(root, 'scripts', 'check-pack.mjs'), 'utf8')
if (!packCheck.includes("'--ignore-scripts'")) {
  throw new Error('pack allowlist must invoke its nested dry-run with --ignore-scripts to prevent lifecycle recursion')
}

const lockNames = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']
const presentLocks = []
for (const name of lockNames) {
  try {
    await access(resolve(root, name))
    presentLocks.push(name)
  } catch {}
}
if (JSON.stringify(presentLocks) !== JSON.stringify(['package-lock.json'])) {
  throw new Error(`standalone release requires exactly package-lock.json; found ${presentLocks.join(', ') || 'none'}`)
}
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'))
if (lock.name !== manifest.name || lock.version !== manifest.version
  || lock.packages?.['']?.name !== manifest.name || lock.packages?.['']?.version !== manifest.version) {
  throw new Error('package-lock root identity drifted from package.json')
}

for (const forbidden of ['RECOVERY_BASELINE.md']) {
  try {
    await access(resolve(root, forbidden))
    throw new Error(`${forbidden} is recovery-only and must not exist in the standalone snapshot`)
  } catch (reason) {
    if (reason instanceof Error && !('code' in reason && reason.code === 'ENOENT')) throw reason
  }
}

const ignore = await readFile(resolve(root, '.gitignore'), 'utf8')
for (const entry of ['node_modules/', '.playwright-cli/', 'typert-workspace/', '.impeccable*', 'RECOVERY_BASELINE.md', '*.tsbuildinfo']) {
  if (!ignore.split(/\r?\n/u).includes(entry)) throw new Error(`.gitignore is missing ${entry}`)
}
await access(resolve(root, '.github', 'workflows', 'ci.yml'))

const scanExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.yml', '.yaml', '.map'])
const excludedDirectories = new Set(['node_modules', '.playwright-cli', 'typert-workspace'])
const files = []
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) await walk(resolve(directory, entry.name))
      continue
    }
    if (!entry.isFile() || entry.name.startsWith('.impeccable')) continue
    if (scanExtensions.has(extname(entry.name)) || entry.name === '.gitignore') files.push(resolve(directory, entry.name))
  }
}
await walk(root)

const forbiddenPatterns = [
  { label: 'parent monorepo reference', pattern: /\.\.[\\/]dsh-plugins(?:[\\/]|$)/u },
  { label: 'Windows user absolute path', pattern: /[A-Za-z]:[\\/]Users[\\/]/iu },
  { label: 'POSIX user absolute path', pattern: /\/(?:home|Users)\/[^/\s"']+/u },
]
for (const file of files) {
  const content = await readFile(file, 'utf8')
  for (const { label, pattern } of forbiddenPatterns) {
    if (pattern.test(content)) throw new Error(`${label} remains in ${file.slice(root.length + 1)}`)
  }
}

console.log(`standalone release boundary ok: ${files.length} files, one npm lockfile, non-recursive lifecycle gates`)
