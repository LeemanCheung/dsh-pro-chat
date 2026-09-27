import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function checkCommittedArtifacts(directory = root) {
  const gitPaths = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8' })
    .split('\0').filter(Boolean)
  const changed = gitPaths(['diff', '--name-only', '--no-ext-diff', '--no-textconv', '-z', 'HEAD', '--', 'lib'])
  const staged = gitPaths(['diff', '--cached', '--name-only', '--no-ext-diff', '--no-textconv', '-z', 'HEAD', '--', 'lib'])
  // Do not use --exclude-standard: ignored build outputs are still uncommitted artifacts.
  const added = gitPaths(['ls-files', '--others', '-z', '--', 'lib'])
  const drift = [...new Set([...changed, ...staged, ...added])].sort()
  if (drift.length > 0) {
    throw new Error(`Rebuilt or staged lib differs from committed artifacts:\n${drift.join('\n')}\nRun npm run build and commit all lib changes together with their source.`)
  }
  return 'rebuilt and staged lib match committed artifacts (including added files)'
}

// Native resolution also canonicalizes Windows path casing, including junction entry paths.
if (process.argv[1] && realpathSync.native(resolve(process.argv[1])) === realpathSync.native(fileURLToPath(import.meta.url))) {
  console.log(checkCommittedArtifacts())
}
