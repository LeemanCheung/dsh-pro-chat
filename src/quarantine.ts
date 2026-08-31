import { lstat, mkdir, realpath, rename } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import type { ProChat, ProTurn, QuarantineArtifact } from './schema.ts'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u

type ArtifactPath = {
  key: string
  live: string
  trash: string
  presentAtArchive: boolean
}

function contained(root: string, ...parts: string[]): string {
  const absoluteRoot = resolve(root)
  const candidate = resolve(absoluteRoot, ...parts)
  const rel = relative(absoluteRoot, candidate)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) {
    throw new Error('Pro Chat 回收路径越界。')
  }
  return candidate
}

function isMissing(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason
    && ((reason as { code?: unknown }).code === 'ENOENT' || (reason as { code?: unknown }).code === 'ENOTDIR')
}

async function statNoFollow(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path)
  } catch (reason) {
    if (isMissing(reason)) return undefined
    throw reason
  }
}

function assertInside(root: string, candidate: string, message: string): void {
  const rel = relative(root, candidate)
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new Error(message)
}

/** Inspect an artifact directory without following a missing or broken leaf. */
async function inspectArtifactPath(root: string, path: string): Promise<boolean> {
  const absoluteRoot = resolve(root)
  const candidate = resolve(path)
  assertInside(absoluteRoot, candidate, 'Pro Chat 回收路径越界。')

  const rootStat = await statNoFollow(absoluteRoot)
  if (rootStat === undefined || !rootStat.isDirectory()) throw new Error('Pro Chat 数据根目录不可用。')
  const rootReal = await realpath(absoluteRoot)
  const rel = relative(absoluteRoot, candidate)
  const components = rel.split(/[\\/]+/u).filter(Boolean)
  let current = absoluteRoot
  for (let index = 0; index < components.length; index += 1) {
    current = resolve(current, components[index]!)
    const stat = await statNoFollow(current)
    if (stat === undefined) return false
    if (stat.isSymbolicLink()) throw new Error('Pro Chat 不会访问或移动符号链接或 Junction。')
    const currentReal = await realpath(current)
    assertInside(rootReal, currentReal, 'Pro Chat 回收路径的真实位置越界。')
    if (!stat.isDirectory()) {
      throw new Error(index === components.length - 1
        ? 'Pro Chat 回收资产不是目录。'
        : 'Pro Chat 回收路径包含非目录父项。')
    }
  }
  return true
}

function exactLegacyIds(values: string[]): string[] {
  const result = [...new Set(values)].sort()
  for (const value of result) {
    if (!SAFE_ID.test(value)) throw new Error('Oracle 会话标识格式无效。')
  }
  return result
}

function liveArtifactPaths(input: {
  root: string
  chat: ProChat
  exactOracleSessionIds: string[]
}): Array<{ artifact: Omit<QuarantineArtifact, 'presentAtArchive'>; live: string }> {
  const { root, chat } = input
  if (!SAFE_ID.test(chat.id)) throw new Error('Pro Chat 对话标识格式无效。')
  const scope = chat.oracleScope ?? 'legacy-global'
  return [
    {
      artifact: { kind: 'transcript' },
      live: contained(root, 'transcripts', chat.id),
    },
    ...(scope === 'chat-scoped'
      ? [{
          artifact: { kind: 'oracle-chat' } as const,
          live: contained(root, 'oracle-chats', chat.id),
        }]
      : exactLegacyIds(input.exactOracleSessionIds).map(sessionId => ({
          artifact: { kind: 'oracle-session' as const, sessionId },
          live: contained(root, 'oracle', 'sessions', sessionId),
        }))),
  ]
}

/** Capture the exact pre-tombstone inventory without reading artifact contents. */
export async function snapshotChatArtifacts(input: {
  root: string
  chat: ProChat
  turns: ProTurn[]
  exactOracleSessionIds: string[]
}): Promise<QuarantineArtifact[]> {
  const planned = liveArtifactPaths(input)
  const artifacts: QuarantineArtifact[] = []
  for (const item of planned) {
    artifacts.push({ ...item.artifact, presentAtArchive: await inspectArtifactPath(input.root, item.live) } as QuarantineArtifact)
  }
  return artifacts
}

function artifactPaths(input: { root: string; chat: ProChat; turns: ProTurn[] }): ArtifactPath[] {
  const { root, chat } = input
  const quarantine = chat.quarantine
  if (!SAFE_ID.test(chat.id) || quarantine === undefined || !SAFE_ID.test(quarantine.opId)) {
    throw new Error('Pro Chat 回收标识无效。')
  }
  if (quarantine.artifacts === undefined) {
    throw new Error('Pro Chat 回收记录缺少资产清单，已拒绝移动或恢复。')
  }
  const trashRoot = contained(root, 'trash', chat.id, quarantine.opId)
  const paths: ArtifactPath[] = []
  const seen = new Set<string>()
  for (const artifact of quarantine.artifacts) {
    const key = artifact.kind === 'oracle-session' ? `${artifact.kind}:${artifact.sessionId}` : artifact.kind
    if (seen.has(key)) throw new Error('Pro Chat 回收资产清单包含重复项。')
    seen.add(key)
    if (artifact.kind === 'transcript') {
      paths.push({
        key,
        live: contained(root, 'transcripts', chat.id),
        trash: contained(trashRoot, 'transcripts', chat.id),
        presentAtArchive: artifact.presentAtArchive,
      })
    } else if (artifact.kind === 'oracle-chat') {
      if (quarantine.oracleScope !== 'chat-scoped') throw new Error('Pro Chat 回收资产清单与 Oracle 范围不一致。')
      paths.push({
        key,
        live: contained(root, 'oracle-chats', chat.id),
        trash: contained(trashRoot, 'oracle-chat'),
        presentAtArchive: artifact.presentAtArchive,
      })
    } else {
      if (quarantine.oracleScope !== 'legacy-global' || !SAFE_ID.test(artifact.sessionId)) {
        throw new Error('Pro Chat 回收资产清单与 Oracle 范围不一致。')
      }
      paths.push({
        key,
        live: contained(root, 'oracle', 'sessions', artifact.sessionId),
        trash: contained(trashRoot, 'oracle-sessions', artifact.sessionId),
        presentAtArchive: artifact.presentAtArchive,
      })
    }
  }
  if (!seen.has('transcript')) throw new Error('Pro Chat 回收资产清单缺少 transcript。')
  if (quarantine.oracleScope === 'chat-scoped') {
    if (!seen.has('oracle-chat') || paths.some(item => item.key.startsWith('oracle-session:'))) {
      throw new Error('Pro Chat 回收资产清单缺少 chat-scoped Oracle 目录。')
    }
  } else {
    if (seen.has('oracle-chat')) throw new Error('Legacy Pro Chat 回收清单不能包含 chat-scoped Oracle 目录。')
    const actual = paths.filter(item => item.key.startsWith('oracle-session:')).map(item => item.key.slice('oracle-session:'.length)).sort()
    const expected = exactLegacyIds(quarantine.exactOracleSessionIds)
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Legacy Pro Chat 回收资产清单与精确 Oracle 会话不一致。')
  }
  return paths
}

async function moveExpected(root: string, from: string, to: string, presentAtArchive: boolean): Promise<void> {
  let sourceExists = await inspectArtifactPath(root, from)
  let targetExists = await inspectArtifactPath(root, to)
  if (!presentAtArchive) {
    if (!sourceExists && !targetExists) return
    throw new Error('原本不存在的 Pro Chat 回收资产意外出现在源或目标位置。')
  }
  if (!sourceExists && targetExists) return
  if (!sourceExists && !targetExists) throw new Error('原本存在的 Pro Chat 回收资产在源与目标位置均缺失。')
  if (sourceExists && targetExists) throw new Error('Pro Chat 回收源与目标同时存在，需要人工检查。')

  await mkdir(dirname(to), { recursive: true })
  // Recheck after creating parents and immediately before rename.
  sourceExists = await inspectArtifactPath(root, from)
  targetExists = await inspectArtifactPath(root, to)
  if (!sourceExists || targetExists) {
    if (!sourceExists && targetExists) return
    if (!sourceExists) throw new Error('原本存在的 Pro Chat 回收资产在移动前消失。')
    throw new Error('Pro Chat 回收目标在移动前已出现，需要人工检查。')
  }
  await rename(from, to)
}

/** Idempotently move only artifacts recorded in the durable tombstone ledger. */
export async function quarantineChatFiles(input: { root: string; chat: ProChat; turns: ProTurn[] }): Promise<void> {
  for (const item of artifactPaths(input)) {
    await moveExpected(input.root, item.live, item.trash, item.presentAtArchive)
  }
}

/** Idempotently restore ledger-owned artifacts before clearing the durable tombstone. */
export async function restoreChatFiles(input: { root: string; chat: ProChat; turns: ProTurn[] }): Promise<void> {
  for (const item of artifactPaths(input).reverse()) {
    await moveExpected(input.root, item.trash, item.live, item.presentAtArchive)
  }
}
