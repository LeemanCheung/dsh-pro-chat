import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { checkCommittedArtifacts } from '../scripts/check-committed.mjs'

describe('committed build artifacts', () => {
  let directory: string
  let template: string
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' })
  const write = (path: string, content: string) => writeFileSync(resolve(directory, path), content)
  const createFixture = () => mkdtempSync(resolve(tmpdir(), 'dsh-pro-chat-committed-'))
  const cleanup = (path: string) => {
    const expectedPrefix = resolve(tmpdir(), 'dsh-pro-chat-committed-')
    if (!path?.startsWith(expectedPrefix)) throw new Error('Fixture cleanup escaped its temporary directory')
    rmSync(path, { recursive: true, force: true })
  }

  beforeAll(() => {
    directory = template = createFixture()
    git('init', '--template=')
    git('config', 'core.autocrlf', 'true')
    git('config', 'core.hooksPath', '.git/hooks')
    mkdirSync(resolve(directory, 'lib'))
    mkdirSync(resolve(directory, 'src'))
    mkdirSync(resolve(directory, 'scripts'))
    write('scripts/check-committed.mjs', readFileSync(new URL('../scripts/check-committed.mjs', import.meta.url), 'utf8'))
    write('.gitattributes', readFileSync(new URL('../.gitattributes', import.meta.url), 'utf8'))
    write('lib/index.js', 'export const answer = 42\n')
    write('src/index.ts', 'export const answer: number = 42\n')
    git('add', '.gitattributes', 'lib/index.js', 'src/index.ts')
    git('-c', 'commit.gpgsign=false', '-c', 'user.name=CI Fixture', '-c', 'user.email=ci-fixture@example.invalid', 'commit', '-qm', 'fixture')
  }, 60_000)

  beforeEach(() => {
    directory = createFixture()
    cpSync(template, directory, { recursive: true })
  }, 30_000)
  afterEach(() => cleanup(directory), 30_000)
  afterAll(() => cleanup(template), 30_000)

  it('accepts matching artifacts without gating unrelated source edits', () => {
    write('src/index.ts', 'export const answer: number = 43\n')
    expect(() => checkCommittedArtifacts(directory)).not.toThrow()
  }, 30_000)

  it.each(['modified', 'staged', 'deleted'])('rejects a %s tracked artifact', kind => {
    if (kind === 'deleted') rmSync(resolve(directory, 'lib/index.js'))
    else write('lib/index.js', 'export const answer = 43\n')
    if (kind === 'staged') git('add', 'lib/index.js')
    expect(() => checkCommittedArtifacts(directory)).toThrow('lib/index.js')
  }, 30_000)

  it.each(['untracked', 'ignored', 'staged'])('rejects an added %s artifact', kind => {
    write('lib/new.js', 'export const surprise = true\n')
    if (kind === 'ignored') write('.gitignore', 'lib/new.js\n')
    if (kind === 'staged') git('add', 'lib/new.js')
    expect(() => checkCommittedArtifacts(directory)).toThrow('lib/new.js')
  }, 30_000)

  it('keeps source checkout LF with autocrlf and ignores plain CRLF-only artifact differences', () => {
    git('checkout-index', '--force', '--', 'src/index.ts')
    expect(readFileSync(resolve(directory, 'src/index.ts'), 'utf8')).toBe('export const answer: number = 42\n')
    write('lib/index.js', 'export const answer = 42\r\n')
    expect(() => checkCommittedArtifacts(directory)).not.toThrow()
  }, 30_000)

  it('rejects dirty artifacts when the real CLI starts through a directory alias', () => {
    write('lib/index.js', 'export const answer = 43\n')
    const aliasRoot = createFixture()
    const alias = resolve(aliasRoot, 'checkout')
    let linked = false
    try {
      symlinkSync(directory, alias, process.platform === 'win32' ? 'junction' : 'dir')
      linked = true
      const entry = resolve(alias, 'scripts/check-committed.mjs')
      const entries = process.platform === 'win32' ? [entry, entry.toLowerCase()] : [entry]
      for (const entryPath of entries) {
        const result = spawnSync(process.execPath, [entryPath], { cwd: alias, encoding: 'utf8' })
        expect(result.error).toBeUndefined()
        expect(result.status).toBe(1)
        expect(result.stderr).toContain('lib/index.js')
      }
    } finally {
      // Remove only the link before recursively cleaning its owned container.
      if (linked) unlinkSync(alias)
      cleanup(aliasRoot)
    }
  }, 30_000)
})
