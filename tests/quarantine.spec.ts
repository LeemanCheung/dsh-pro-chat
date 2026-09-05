import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { quarantineChatFiles, restoreChatFiles, snapshotChatArtifacts } from '../src/quarantine.ts'
import type { ProChat, ProTurn } from '../src/schema.ts'

const CHAT_ID = '11111111-1111-4111-8111-111111111111'
const TURN_ID = '22222222-2222-4222-8222-222222222222'
const OP_ID = '33333333-3333-4333-8333-333333333333'

function chat(scope: 'legacy-global' | 'chat-scoped', exact: string[] = []): ProChat {
  return {
    id: CHAT_ID,
    title: 'test',
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z',
    status: 'idle',
    lastSeq: 0,
    oracleScope: scope,
    quarantine: {
      opId: OP_ID,
      phase: 'trash-pending',
      archivedAt: '2026-08-31T00:00:00.000Z',
      previousStatus: 'idle',
      oracleScope: scope,
      exactOracleSessionIds: exact,
    },
  }
}

async function withInventory(root: string, value: ProChat, exactOracleSessionIds: string[] = []): Promise<ProChat> {
  const artifacts = await snapshotChatArtifacts({
    root,
    chat: value,
    turns,
    exactOracleSessionIds,
  })
  return {
    ...value,
    quarantine: { ...value.quarantine!, artifacts },
  }
}

const turns: ProTurn[] = [{
  id: TURN_ID,
  chatId: CHAT_ID,
  promptMessageId: '44444444-4444-4444-8444-444444444444',
  state: 'succeeded',
  createdAt: '2026-08-31T00:00:00.000Z',
  oracleSessionId: 'oracle-exact',
  resultMessageId: '55555555-5555-4555-8555-555555555555',
}]

describe('recoverable chat artifacts', () => {
  it('moves and restores a chat-scoped Oracle home idempotently', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-trash-'))
    await mkdir(join(root, 'transcripts', CHAT_ID), { recursive: true })
    await mkdir(join(root, 'oracle-chats', CHAT_ID), { recursive: true })
    await writeFile(join(root, 'transcripts', CHAT_ID, 'turn.md'), 'reply')
    await writeFile(join(root, 'oracle-chats', CHAT_ID, 'meta.json'), 'metadata')
    const input = { root, chat: await withInventory(root, chat('chat-scoped'), ['ignored-chat-scoped-id']), turns }
    expect(input.chat.quarantine?.artifacts).toEqual([
      { kind: 'transcript', presentAtArchive: true },
      { kind: 'oracle-chat', presentAtArchive: true },
    ])
    await quarantineChatFiles(input)
    await quarantineChatFiles(input)
    expect(await readFile(join(root, 'trash', CHAT_ID, OP_ID, 'transcripts', CHAT_ID, 'turn.md'), 'utf8')).toBe('reply')
    expect(await readFile(join(root, 'trash', CHAT_ID, OP_ID, 'oracle-chat', 'meta.json'), 'utf8')).toBe('metadata')
    await restoreChatFiles(input)
    await restoreChatFiles(input)
    expect(await readFile(join(root, 'transcripts', CHAT_ID, 'turn.md'), 'utf8')).toBe('reply')
    expect(await readFile(join(root, 'oracle-chats', CHAT_ID, 'meta.json'), 'utf8')).toBe('metadata')
  }, 15_000)

  it('moves only exact persisted legacy Oracle ids and never guesses slugs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-legacy-trash-'))
    await mkdir(join(root, 'oracle', 'sessions', 'oracle-exact'), { recursive: true })
    await mkdir(join(root, 'oracle', 'sessions', `dsh-pro-chat-${TURN_ID.slice(0, 8)}`), { recursive: true })
    await writeFile(join(root, 'oracle', 'sessions', 'oracle-exact', 'meta.json'), 'exact')
    await writeFile(join(root, 'oracle', 'sessions', `dsh-pro-chat-${TURN_ID.slice(0, 8)}`, 'sentinel.txt'), 'leave-me')
    const input = { root, chat: await withInventory(root, chat('legacy-global', ['oracle-exact']), ['oracle-exact']), turns }
    await quarantineChatFiles(input)
    expect(await readFile(join(root, 'trash', CHAT_ID, OP_ID, 'oracle-sessions', 'oracle-exact', 'meta.json'), 'utf8')).toBe('exact')
    expect(await readFile(join(root, 'oracle', 'sessions', `dsh-pro-chat-${TURN_ID.slice(0, 8)}`, 'sentinel.txt'), 'utf8')).toBe('leave-me')
  })

  it('fails closed when source and trash target both exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-trash-conflict-'))
    await mkdir(join(root, 'transcripts', CHAT_ID), { recursive: true })
    await mkdir(join(root, 'trash', CHAT_ID, OP_ID, 'transcripts', CHAT_ID), { recursive: true })
    const value = await withInventory(root, chat('chat-scoped'))
    await expect(quarantineChatFiles({ root, chat: value, turns })).rejects.toThrow(/同时存在/)
  })

  it('fails restore closed when the durable artifact ledger is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-trash-no-ledger-'))
    await expect(restoreChatFiles({ root, chat: chat('chat-scoped'), turns })).rejects.toThrow(/缺少资产清单/)
  })

  it('fails restore closed when an originally present artifact is missing from both locations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-trash-lost-'))
    await mkdir(join(root, 'transcripts', CHAT_ID), { recursive: true })
    await mkdir(join(root, 'oracle-chats', CHAT_ID), { recursive: true })
    await writeFile(join(root, 'transcripts', CHAT_ID, 'turn.md'), 'reply')
    await writeFile(join(root, 'oracle-chats', CHAT_ID, 'meta.json'), 'metadata')
    const value = await withInventory(root, chat('chat-scoped'))
    const input = { root, chat: value, turns }
    await quarantineChatFiles(input)
    await rm(join(root, 'trash', CHAT_ID, OP_ID, 'oracle-chat'), { recursive: true, force: true })
    await expect(restoreChatFiles(input)).rejects.toThrow(/均缺失/)
  })

  it('treats an originally absent artifact as idempotent only while both locations remain absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-trash-absent-'))
    const value = await withInventory(root, chat('chat-scoped'))
    expect(value.quarantine?.artifacts).toEqual([
      { kind: 'transcript', presentAtArchive: false },
      { kind: 'oracle-chat', presentAtArchive: false },
    ])
    await quarantineChatFiles({ root, chat: value, turns })
    await restoreChatFiles({ root, chat: value, turns })
  })

  it('refuses a source Junction or symlink without touching its target', async ({ skip }) => {
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-trash-link-'))
    const outside = await mkdtemp(join(tmpdir(), 'pro-chat-outside-'))
    await writeFile(join(outside, 'sentinel.txt'), 'unchanged')
    await mkdir(join(root, 'transcripts'), { recursive: true })
    try {
      await symlink(outside, join(root, 'transcripts', CHAT_ID), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (reason) {
      skip(`platform cannot create directory links: ${String(reason)}`)
      return
    }
    await expect(snapshotChatArtifacts({
      root,
      chat: chat('chat-scoped'),
      turns,
      exactOracleSessionIds: [],
    })).rejects.toThrow(/符号链接|真实位置越界/)
    expect(await readFile(join(outside, 'sentinel.txt'), 'utf8')).toBe('unchanged')
  })

  it('refuses an intermediate Junction even when its target remains inside the root', async ({ skip }) => {
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-trash-intermediate-link-'))
    const backing = join(root, 'backing-transcripts')
    await mkdir(join(backing, CHAT_ID), { recursive: true })
    try {
      await symlink(backing, join(root, 'transcripts'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (reason) {
      skip(`platform cannot create directory links: ${String(reason)}`)
      return
    }
    await expect(snapshotChatArtifacts({
      root,
      chat: chat('chat-scoped'),
      turns,
      exactOracleSessionIds: [],
    })).rejects.toThrow(/符号链接|Junction/)
  })

  it('refuses a broken leaf link instead of treating it as absent', async ({ skip }) => {
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-trash-broken-link-'))
    await mkdir(join(root, 'transcripts'), { recursive: true })
    const missingTarget = join(root, 'missing-target')
    try {
      await symlink(missingTarget, join(root, 'transcripts', CHAT_ID), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (reason) {
      skip(`platform cannot create broken directory links: ${String(reason)}`)
      return
    }
    await expect(snapshotChatArtifacts({
      root,
      chat: chat('chat-scoped'),
      turns,
      exactOracleSessionIds: [],
    })).rejects.toThrow(/符号链接|Junction/)
  })
})
