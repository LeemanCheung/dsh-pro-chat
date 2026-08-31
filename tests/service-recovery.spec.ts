import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OracleSubmittedUnverifiedError, ProChatService } from '../lib/index.js'
import { ProChatSchema, ProTurnSchema, type ProChat, type ProChatMessage, type ProTurn } from '../src/schema.ts'

const CHAT_ID = '11111111-1111-4111-8111-111111111111'
const TURN_ID = '22222222-2222-4222-8222-222222222222'
const PROMPT_ID = '33333333-3333-4333-8333-333333333333'
const RESPONSE_ID = '44444444-4444-4444-8444-444444444444'

class FakeTable<T> {
  constructor(
    readonly map = new Map<string, T>(),
    private readonly fail?: () => void,
    private readonly beforePut?: (key: string, value: T) => Promise<void>,
  ) {}
  get(key: string): T | undefined { return this.map.get(key) }
  entries(): IterableIterator<[string, T]> { return new Map(this.map).entries() }
  keys(): IterableIterator<string> { return new Map(this.map).keys() }
  get size(): number { return this.map.size }
  async put(key: string, value: T): Promise<void> { this.fail?.(); await this.beforePut?.(key, value); this.map.set(key, structuredClone(value)) }
  async delete(key: string): Promise<boolean> { this.fail?.(); return this.map.delete(key) }
  async update(key: string, fn: (value: T) => T): Promise<T> {
    const current = this.map.get(key)
    if (current === undefined) throw new Error('missing')
    const next = fn(current)
    await this.put(key, next)
    return next
  }
}

function baseChat(): ProChat {
  return {
    id: CHAT_ID,
    title: 'baseline',
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z',
    status: 'idle',
    lastSeq: 0,
    oracleScope: 'chat-scoped',
  }
}

function harness(options: {
  failAt?: number
  failFrom?: number
  root?: string
  chatBeforePut?: (key: string, value: ProChat) => Promise<void>
  transportRun?: (input: Record<string, unknown>) => Promise<{ oracleSessionId: string; markdown: string; outputPath: string }>
} = {}) {
  let writes = 0
  const fail = (): void => {
    writes += 1
    if (writes === options.failAt || (options.failFrom !== undefined && writes >= options.failFrom)) throw new Error(`injected-${writes}`)
  }
  const chats = new FakeTable<ProChat>(new Map([[CHAT_ID, baseChat()]]), fail, options.chatBeforePut)
  const messages = new FakeTable<ProChatMessage>(new Map(), fail)
  const turns = new FakeTable<ProTurn>(new Map(), fail)
  const domain = {
    table(name: 'chats' | 'messages' | 'turns') { return { chats, messages, turns }[name] },
    global: { get: () => ({ cdpTarget: '127.0.0.1:9223', revision: 1 }), set: async () => undefined },
  }
  const service = Object.create(ProChatService.prototype) as ProChatService
  Object.assign(service as unknown as Record<string, unknown>, {
    root: options.root ?? join(tmpdir(), 'unused-pro-chat-root'),
    domain,
    transport: {
      busy: false,
      status: async () => ({ cdpTarget: '127.0.0.1:9223', reachable: false, oracleInstalled: true, selectionVerified: false, message: 'offline' }),
      verifyStatus: async () => ({ cdpTarget: '127.0.0.1:9223', reachable: false, oracleInstalled: true, selectionVerified: false, message: 'offline' }),
      run: options.transportRun ?? (async () => { throw new Error('transport must not run') }),
    },
    active: new Map(),
    mutations: new Set(),
  })
  return { service, chats, messages, turns, active: (service as unknown as { active: Map<string, unknown> }).active }
}

describe('ProChatService recovery', () => {
  it.each([1, 2, 3, 4])('rolls a failed prepare boundary %i back to the original chat', async failAt => {
    const state = harness({ failAt })
    await expect(state.service.send({ chatId: CHAT_ID, content: 'do work' })).rejects.toThrow(/injected/)
    expect(state.chats.get(CHAT_ID)).toEqual(baseChat())
    expect(state.messages.size).toBe(0)
    expect(state.turns.size).toBe(0)
    expect(state.active.size).toBe(0)
  })

  it('replays PREPARING rollback idempotently', async () => {
    const state = harness()
    const original = baseChat()
    const prompt: ProChatMessage = {
      id: PROMPT_ID, chatId: CHAT_ID, seq: 1, role: 'user', content: 'prompt', createdAt: '2026-08-31T00:01:00.000Z',
    }
    const turn: ProTurn = {
      id: TURN_ID,
      chatId: CHAT_ID,
      promptMessageId: PROMPT_ID,
      state: 'preparing',
      createdAt: prompt.createdAt,
      preparation: {
        promptSeq: 1,
        previousChat: {
          title: original.title,
          status: original.status,
          lastSeq: original.lastSeq,
          updatedAt: original.updatedAt,
        },
      },
    }
    state.chats.map.set(CHAT_ID, { ...original, status: 'running', lastSeq: 1, currentTurnId: TURN_ID })
    state.messages.map.set(`${CHAT_ID}:0000000001:${PROMPT_ID}`, prompt)
    state.turns.map.set(TURN_ID, turn)
    await (state.service as unknown as { rollbackPreparation(id: string): Promise<void> }).rollbackPreparation(TURN_ID)
    await (state.service as unknown as { rollbackPreparation(id: string): Promise<void> }).rollbackPreparation(TURN_ID)
    expect(state.chats.get(CHAT_ID)).toEqual(original)
    expect(state.messages.size).toBe(0)
    expect(state.turns.size).toBe(0)
  })

  it('replays FINALIZING to one response and one succeeded turn', async () => {
    const state = harness()
    const response: ProChatMessage = {
      id: RESPONSE_ID,
      chatId: CHAT_ID,
      seq: 2,
      role: 'assistant',
      content: 'reply',
      createdAt: '2026-08-31T00:02:00.000Z',
      turnId: TURN_ID,
      oracleSessionId: 'oracle-session-1',
    }
    state.chats.map.set(CHAT_ID, { ...baseChat(), status: 'running', lastSeq: 1, currentTurnId: TURN_ID })
    state.turns.map.set(TURN_ID, {
      id: TURN_ID,
      chatId: CHAT_ID,
      promptMessageId: PROMPT_ID,
      state: 'finalizing',
      createdAt: '2026-08-31T00:01:00.000Z',
      startedAt: '2026-08-31T00:01:01.000Z',
      oracleSessionId: 'oracle-session-1',
      finalization: { response },
    })
    const finalize = (state.service as unknown as { finalizeTurn(id: string): Promise<void> }).finalizeTurn.bind(state.service)
    await finalize(TURN_ID)
    await finalize(TURN_ID)
    expect(state.messages.size).toBe(1)
    expect(state.chats.get(CHAT_ID)).toMatchObject({ status: 'idle', lastSeq: 2, latestOracleSessionId: 'oracle-session-1' })
    expect(state.turns.get(TURN_ID)).toMatchObject({ state: 'succeeded', resultMessageId: RESPONSE_ID, oracleSessionId: 'oracle-session-1' })
  })

  it('rejects a cross-chat FINALIZING domain journal before writing any response', async () => {
    const state = harness()
    const response: ProChatMessage = {
      id: RESPONSE_ID,
      chatId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      seq: 2,
      role: 'assistant',
      content: 'must not cross chats',
      createdAt: '2026-08-31T00:02:00.000Z',
      turnId: TURN_ID,
      oracleSessionId: 'oracle-cross-domain',
    }
    const invalid = {
      id: TURN_ID,
      chatId: CHAT_ID,
      promptMessageId: PROMPT_ID,
      state: 'finalizing' as const,
      createdAt: '2026-08-31T00:01:00.000Z',
      oracleSessionId: 'oracle-cross-domain',
      finalization: { response },
    }
    expect(() => ProTurnSchema.parse(invalid)).toThrow(/chatId|turn/i)
    state.turns.map.set(TURN_ID, invalid)
    await expect((state.service as unknown as { finalizeTurn(id: string): Promise<void> }).finalizeTurn(TURN_ID)).rejects.toThrow(/血缘/)
    expect(state.messages.size).toBe(0)
  })

  it('locks an incomplete FINALIZING journal instead of treating it as retryable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-incomplete-finalizing-'))
    const state = harness({ root })
    const incomplete = {
      id: TURN_ID,
      chatId: CHAT_ID,
      promptMessageId: PROMPT_ID,
      state: 'finalizing' as const,
      createdAt: '2026-08-31T00:01:00.000Z',
    }
    expect(() => ProTurnSchema.parse(incomplete)).toThrow(/FINALIZING|finalization|Oracle/i)
    state.chats.map.set(CHAT_ID, { ...baseChat(), status: 'running', lastSeq: 1, currentTurnId: TURN_ID })
    state.turns.map.set(TURN_ID, incomplete)
    await state.service.hydrate()
    expect(state.turns.get(TURN_ID)?.state).toBe('external-diverged')
    expect(state.chats.get(CHAT_ID)?.divergence).toMatchObject({ turnId: TURN_ID })
  })

  it('returns the committed QUEUED turn and never reintroduces the PREPARING journal', async () => {
    let release!: () => void
    const transportGate = new Promise<void>(resolve => { release = resolve })
    const state = harness({
      transportRun: async () => {
        await transportGate
        throw new Error('safe pre-submit failure')
      },
    })
    const queued = await state.service.send({ chatId: CHAT_ID, content: 'do work' })
    expect(queued).toMatchObject({ state: 'queued', preparation: undefined })
    expect(state.turns.get(queued.id)).toMatchObject({ state: 'running', preparation: undefined })
    release()
    const active = state.active.get(CHAT_ID) as { promise: Promise<void> }
    await active.promise
    expect(state.turns.get(queued.id)?.preparation).toBeUndefined()
  })

  it('contains persistent background storage failures without an unhandled rejection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-persistent-failure-'))
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const state = harness({
      root,
      failFrom: 7,
      transportRun: async () => {
        await gate
        return { oracleSessionId: 'oracle-session-persistent', markdown: 'reply', outputPath: join(root, 'reply.md') }
      },
    })
    const observed: unknown[] = []
    const listener = (reason: unknown): void => { observed.push(reason) }
    process.on('unhandledRejection', listener)
    try {
      const queued = await state.service.send({ chatId: CHAT_ID, content: 'do work' })
      const active = state.active.get(CHAT_ID) as { promise: Promise<void> }
      release()
      await expect(active.promise).resolves.toBeUndefined()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(observed).toEqual([])
      expect(state.turns.get(queued.id)).toMatchObject({ state: 'finalizing', preparation: undefined })
      expect((await readdir(join(root, 'pending-finalizations'))).some(name => name === `${queued.id}.json`)).toBe(true)
    } finally {
      process.off('unhandledRejection', listener)
    }
  })

  it('recovers a validated response from the sidecar when the first FINALIZING put fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-finalization-'))
    const state = harness({
      root,
      failAt: 6,
      transportRun: async () => ({ oracleSessionId: 'oracle-session-2', markdown: 'validated reply', outputPath: join(root, 'reply.md') }),
    })
    const queued = await state.service.send({ chatId: CHAT_ID, content: 'do work' })
    const active = state.active.get(CHAT_ID) as { promise: Promise<void> }
    await active.promise
    expect(state.turns.get(queued.id)).toMatchObject({ state: 'succeeded', oracleSessionId: 'oracle-session-2' })
    expect([...state.messages.map.values()].some(message => message.role === 'assistant' && message.content === 'validated reply')).toBe(true)
    expect(await readdir(join(root, 'pending-finalizations'))).toEqual([])
  })

  it('locks continuation when a validated web result cannot create its recovery sidecar', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'pro-chat-sidecar-fail-'))
    const root = join(parent, 'not-a-directory')
    await writeFile(root, 'blocks mkdir')
    const state = harness({
      root,
      transportRun: async () => ({ oracleSessionId: 'oracle-session-3', markdown: 'validated reply', outputPath: join(parent, 'reply.md') }),
    })
    const queued = await state.service.send({ chatId: CHAT_ID, content: 'do work' })
    const active = state.active.get(CHAT_ID) as { promise: Promise<void> }
    await active.promise
    expect(state.turns.get(queued.id)).toMatchObject({ state: 'external-diverged', oracleSessionId: 'oracle-session-3' })
    expect(state.chats.get(CHAT_ID)?.divergence).toMatchObject({ turnId: queued.id, oracleSessionId: 'oracle-session-3' })
    const counts = { messages: state.messages.size, turns: state.turns.size }
    await expect(state.service.send({ chatId: CHAT_ID, content: 'must not retry' })).rejects.toThrow(/禁止自动续发|防止重复提交/)
    expect({ messages: state.messages.size, turns: state.turns.size }).toEqual(counts)
  })

  it('persists a post-submit selection verification exception as external-diverged', async () => {
    const state = harness({
      transportRun: async () => {
        throw new OracleSubmittedUnverifiedError(
          'Oracle 已返回结果，但回合结束后的 ChatGPT 标签页复验发生异常。',
          'oracle-post-submit-verify',
        )
      },
    })
    const queued = await state.service.send({ chatId: CHAT_ID, content: 'must not retry after post-submit verify throws' })
    const active = state.active.get(CHAT_ID) as { promise: Promise<void> }
    await expect(active.promise).resolves.toBeUndefined()
    expect(state.turns.get(queued.id)).toMatchObject({
      state: 'external-diverged',
      oracleSessionId: 'oracle-post-submit-verify',
    })
    expect(state.chats.get(CHAT_ID)?.divergence).toMatchObject({
      turnId: queued.id,
      oracleSessionId: 'oracle-post-submit-verify',
    })
    await expect(state.service.send({ chatId: CHAT_ID, content: 'must not retry' })).rejects.toThrow(/禁止自动续发|防止重复提交/)
  })

  it('persists an observed Oracle session before transport completion', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let observedPersisted!: () => void
    const persisted = new Promise<void>(resolve => { observedPersisted = resolve })
    let state!: ReturnType<typeof harness>
    state = harness({
      transportRun: async input => {
        const onSessionObserved = input.onSessionObserved as ((oracleSessionId: string) => Promise<void>) | undefined
        await onSessionObserved?.('oracle-live-domain')
        const running = [...state.turns.map.values()].at(-1)
        expect(running).toMatchObject({ state: 'running', oracleSessionId: 'oracle-live-domain' })
        observedPersisted()
        await gate
        throw new OracleSubmittedUnverifiedError('stop after observation', 'oracle-live-domain')
      },
    })
    const queued = await state.service.send({ chatId: CHAT_ID, content: 'observe session while running' })
    await expect(Promise.race([
      persisted,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Domain persistence waited for transport exit')), 1_000)),
    ])).resolves.toBeUndefined()
    expect(state.turns.get(queued.id)).toMatchObject({ state: 'running', oracleSessionId: 'oracle-live-domain' })
    release()
    const active = state.active.get(CHAT_ID) as { promise: Promise<void> }
    await expect(active.promise).resolves.toBeUndefined()
    expect(state.turns.get(queued.id)).toMatchObject({ state: 'external-diverged', oracleSessionId: 'oracle-live-domain' })
  })

  it('replays an atomic pending response during hydrate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-hydrate-finalization-'))
    const state = harness({ root })
    const response: ProChatMessage = {
      id: RESPONSE_ID, chatId: CHAT_ID, seq: 2, role: 'assistant', content: 'replayed',
      createdAt: '2026-08-31T00:02:00.000Z', turnId: TURN_ID, oracleSessionId: 'oracle-session-4',
    }
    state.chats.map.set(CHAT_ID, { ...baseChat(), status: 'running', lastSeq: 1, currentTurnId: TURN_ID })
    state.turns.map.set(TURN_ID, {
      id: TURN_ID, chatId: CHAT_ID, promptMessageId: PROMPT_ID, state: 'running',
      createdAt: '2026-08-31T00:01:00.000Z', oracleSessionId: 'oracle-session-4',
    })
    const { writePendingFinalization } = await import('../src/finalization-store.ts')
    await writePendingFinalization(root, { version: 1, turnId: TURN_ID, chatId: CHAT_ID, oracleSessionId: 'oracle-session-4', response })
    await state.service.hydrate()
    expect(state.turns.get(TURN_ID)).toMatchObject({ state: 'succeeded', resultMessageId: RESPONSE_ID })
    expect(state.chats.get(CHAT_ID)).toMatchObject({ status: 'idle', latestOracleSessionId: 'oracle-session-4' })
    expect(await readdir(join(root, 'pending-finalizations'))).toEqual([])
  })

  it('turns an open restart state into a durable divergence lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-hydrate-open-'))
    const state = harness({ root })
    state.chats.map.set(CHAT_ID, { ...baseChat(), status: 'running', lastSeq: 1, currentTurnId: TURN_ID })
    state.turns.map.set(TURN_ID, {
      id: TURN_ID, chatId: CHAT_ID, promptMessageId: PROMPT_ID, state: 'running',
      createdAt: '2026-08-31T00:01:00.000Z', oracleSessionId: 'oracle-session-5',
    })
    await state.service.hydrate()
    expect(state.turns.get(TURN_ID)?.state).toBe('external-diverged')
    expect(state.chats.get(CHAT_ID)?.divergence).toMatchObject({ turnId: TURN_ID, oracleSessionId: 'oracle-session-5' })
    await expect(state.service.send({ chatId: CHAT_ID, content: 'must not retry' })).rejects.toThrow(/禁止自动续发|防止重复提交/)
  })

  it('serializes per-chat mutations before either side can act on stale state', async () => {
    let release!: () => void
    let entered!: () => void
    const enteredPut = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    let held = true
    const state = harness({
      chatBeforePut: async () => {
        if (!held) return
        held = false
        entered()
        await gate
      },
    })
    const rename = state.service.renameChat({ chatId: CHAT_ID, title: 'renamed' })
    await enteredPut
    await expect(state.service.deleteChat({ chatId: CHAT_ID })).rejects.toThrow(/持久化操作/)
    release()
    await expect(rename).resolves.toMatchObject({ title: 'renamed' })
  })

  it('cancels during durable preparation without ever launching the browser runner', async () => {
    let release!: () => void
    let entered!: () => void
    const enteredPut = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    let held = true
    let transportRuns = 0
    const state = harness({
      chatBeforePut: async () => {
        if (!held) return
        held = false
        entered()
        await gate
      },
      transportRun: async () => {
        transportRuns += 1
        throw new Error('transport must not launch after prepare-time cancel')
      },
    })
    const sending = state.service.send({ chatId: CHAT_ID, content: 'cancel before runner' })
    await enteredPut
    const cancelling = state.service.cancel({ chatId: CHAT_ID })
    release()
    await expect(sending).resolves.toMatchObject({ state: 'cancelled' })
    await expect(cancelling).resolves.toMatchObject({ status: 'cancelled' })
    expect(transportRuns).toBe(0)
    expect([...state.turns.map.values()].at(-1)).toMatchObject({ state: 'cancelled' })
  })

  it('waits for the prepare rollback barrier during shutdown', async () => {
    let release!: () => void
    let entered!: () => void
    const enteredPut = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    let held = true
    let transportRuns = 0
    const state = harness({
      chatBeforePut: async () => {
        if (!held) return
        held = false
        entered()
        await gate
      },
      transportRun: async () => {
        transportRuns += 1
        throw new Error('transport must not run during prepare shutdown')
      },
    })
    const sending = state.service.send({ chatId: CHAT_ID, content: 'shutdown during prepare' })
    await enteredPut
    let shutdownSettled = false
    const shuttingDown = state.service.shutdown().then(() => { shutdownSettled = true })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(shutdownSettled).toBe(false)
    release()
    await expect(sending).resolves.toMatchObject({ state: 'cancelled' })
    await expect(shuttingDown).resolves.toBeUndefined()
    expect(transportRuns).toBe(0)
  })

  it('rejects a new send after shutdown has synchronously closed the admission gate', async () => {
    let transportRuns = 0
    const state = harness({
      transportRun: async () => {
        transportRuns += 1
        throw new Error('transport must not start after shutdown admission closes')
      },
    })
    const shuttingDown = state.service.shutdown()
    await expect(state.service.send({ chatId: CHAT_ID, content: 'too late' })).rejects.toThrow(/正在关闭|拒绝启动/)
    await expect(shuttingDown).resolves.toBeUndefined()
    expect(transportRuns).toBe(0)
    expect(state.active.size).toBe(0)
    expect(state.messages.size).toBe(0)
    expect(state.turns.size).toBe(0)
  })

  it.each(['running', 'succeeded'] as const)('locks a %s turn when response and Domain Oracle lineage conflict', async stateName => {
    const state = harness()
    const response: ProChatMessage = {
      id: RESPONSE_ID,
      chatId: CHAT_ID,
      seq: 2,
      role: 'assistant',
      content: 'conflicting persisted response',
      createdAt: '2026-08-31T00:02:00.000Z',
      turnId: TURN_ID,
      oracleSessionId: 'oracle-response-b',
    }
    state.chats.map.set(CHAT_ID, {
      ...baseChat(),
      status: stateName === 'running' ? 'running' : 'idle',
      lastSeq: 2,
      ...(stateName === 'running' ? { currentTurnId: TURN_ID } : { latestOracleSessionId: 'oracle-domain-a' }),
    })
    state.messages.map.set(`${CHAT_ID}:0000000002:${RESPONSE_ID}`, response)
    state.turns.map.set(TURN_ID, {
      id: TURN_ID,
      chatId: CHAT_ID,
      promptMessageId: PROMPT_ID,
      state: stateName,
      createdAt: '2026-08-31T00:01:00.000Z',
      oracleSessionId: 'oracle-domain-a',
      ...(stateName === 'succeeded' ? { resultMessageId: RESPONSE_ID, finishedAt: response.createdAt } : {}),
    })
    await (state.service as unknown as { reconcileChat(id: string): Promise<ProChat | undefined> }).reconcileChat(CHAT_ID)
    expect(state.turns.get(TURN_ID)).toMatchObject({ state: 'external-diverged', oracleSessionId: 'oracle-domain-a' })
    expect(state.chats.get(CHAT_ID)?.divergence).toMatchObject({ turnId: TURN_ID, oracleSessionId: 'oracle-domain-a' })
    await expect(state.service.send({ chatId: CHAT_ID, content: 'must not follow the wrong session' })).rejects.toThrow(/禁止自动续发|防止重复提交/)
  })

  it('preserves an older lineage divergence when a newer turn already succeeded', async () => {
    const state = harness()
    const newerTurnId = randomUuidFor(900)
    const newerResponseId = randomUuidFor(901)
    const olderResponse: ProChatMessage = {
      id: RESPONSE_ID,
      chatId: CHAT_ID,
      seq: 2,
      role: 'assistant',
      content: 'older conflicting response',
      createdAt: '2026-08-31T00:02:00.000Z',
      turnId: TURN_ID,
      oracleSessionId: 'oracle-older-response-b',
    }
    const newerResponse: ProChatMessage = {
      id: newerResponseId,
      chatId: CHAT_ID,
      seq: 4,
      role: 'assistant',
      content: 'newer valid response',
      createdAt: '2026-08-31T00:04:00.000Z',
      turnId: newerTurnId,
      oracleSessionId: 'oracle-newer-valid',
    }
    state.chats.map.set(CHAT_ID, {
      ...baseChat(),
      status: 'idle',
      lastSeq: 4,
      updatedAt: newerResponse.createdAt,
      latestOracleSessionId: 'oracle-newer-valid',
    })
    state.messages.map.set(`${CHAT_ID}:0000000002:${RESPONSE_ID}`, olderResponse)
    state.messages.map.set(`${CHAT_ID}:0000000004:${newerResponseId}`, newerResponse)
    state.turns.map.set(TURN_ID, {
      id: TURN_ID,
      chatId: CHAT_ID,
      promptMessageId: PROMPT_ID,
      state: 'running',
      createdAt: '2026-08-31T00:01:00.000Z',
      oracleSessionId: 'oracle-older-domain-a',
    })
    state.turns.map.set(newerTurnId, {
      id: newerTurnId,
      chatId: CHAT_ID,
      promptMessageId: randomUuidFor(902),
      state: 'succeeded',
      createdAt: '2026-08-31T00:03:00.000Z',
      finishedAt: newerResponse.createdAt,
      resultMessageId: newerResponseId,
      oracleSessionId: 'oracle-newer-valid',
    })
    await (state.service as unknown as { reconcileChat(id: string): Promise<ProChat | undefined> }).reconcileChat(CHAT_ID)
    expect(state.turns.get(TURN_ID)).toMatchObject({ state: 'external-diverged', oracleSessionId: 'oracle-older-domain-a' })
    expect(state.turns.get(newerTurnId)).toMatchObject({ state: 'succeeded', oracleSessionId: 'oracle-newer-valid' })
    expect(state.chats.get(CHAT_ID)).toMatchObject({
      status: 'failed',
      divergence: { turnId: TURN_ID, oracleSessionId: 'oracle-older-domain-a' },
    })
    await expect(state.service.send({ chatId: CHAT_ID, content: 'must remain locked' })).rejects.toThrow(/禁止自动续发|防止重复提交/)
  })

  it('isolates a corrupt sidecar and locks only its related chat during hydrate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-corrupt-sidecar-'))
    const state = harness({ root })
    state.chats.map.set(CHAT_ID, { ...baseChat(), status: 'running', lastSeq: 1, currentTurnId: TURN_ID })
    state.turns.map.set(TURN_ID, {
      id: TURN_ID, chatId: CHAT_ID, promptMessageId: PROMPT_ID, state: 'running',
      createdAt: '2026-08-31T00:01:00.000Z', oracleSessionId: 'oracle-corrupt-sidecar',
    })
    await mkdir(join(root, 'pending-finalizations'), { recursive: true })
    await writeFile(join(root, 'pending-finalizations', `${TURN_ID}.json`), '{broken', 'utf8')
    await expect(state.service.hydrate()).resolves.toBeUndefined()
    expect(state.turns.get(TURN_ID)?.state).toBe('external-diverged')
    expect(state.chats.get(CHAT_ID)?.divergence).toMatchObject({ turnId: TURN_ID })
    expect(await readFile(join(root, 'pending-finalizations', `${TURN_ID}.json`), 'utf8')).toBe('{broken')
  })

  it('binds a sidecar filename to its body turn and preserves observed Domain lineage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-sidecar-filename-'))
    const state = harness({ root })
    state.chats.map.set(CHAT_ID, { ...baseChat(), status: 'running', lastSeq: 1, currentTurnId: TURN_ID, latestOracleSessionId: 'oracle-parent' })
    state.turns.map.set(TURN_ID, {
      id: TURN_ID, chatId: CHAT_ID, promptMessageId: PROMPT_ID, state: 'running',
      createdAt: '2026-08-31T00:01:00.000Z', oracleSessionId: 'oracle-observed',
    })
    const otherTurnId = 'abababab-abab-4bab-8bab-abababababab'
    const body = {
      version: 1,
      turnId: otherTurnId,
      chatId: CHAT_ID,
      oracleSessionId: 'oracle-other',
      response: {
        id: RESPONSE_ID, chatId: CHAT_ID, seq: 2, role: 'assistant', content: 'misfiled',
        createdAt: '2026-08-31T00:02:00.000Z', turnId: otherTurnId, oracleSessionId: 'oracle-other',
      },
    }
    await mkdir(join(root, 'pending-finalizations'), { recursive: true })
    await writeFile(join(root, 'pending-finalizations', `${TURN_ID}.json`), JSON.stringify(body), 'utf8')
    const { readPendingFinalization } = await import('../src/finalization-store.ts')
    await expect(readPendingFinalization(root, TURN_ID)).rejects.toThrow(/filename|turnId/i)
    await state.service.hydrate()
    expect(state.turns.get(TURN_ID)).toMatchObject({ state: 'external-diverged', oracleSessionId: 'oracle-observed' })
    expect(state.chats.get(CHAT_ID)).toMatchObject({ latestOracleSessionId: 'oracle-parent', divergence: { oracleSessionId: 'oracle-observed' } })
  })

  it('never overwrites an already observed Oracle session from a sidecar', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-sidecar-oracle-conflict-'))
    const state = harness({ root })
    state.chats.map.set(CHAT_ID, { ...baseChat(), status: 'running', lastSeq: 1, currentTurnId: TURN_ID, latestOracleSessionId: 'oracle-parent' })
    state.turns.map.set(TURN_ID, {
      id: TURN_ID, chatId: CHAT_ID, promptMessageId: PROMPT_ID, state: 'running',
      createdAt: '2026-08-31T00:01:00.000Z', oracleSessionId: 'oracle-observed',
    })
    const response: ProChatMessage = {
      id: RESPONSE_ID, chatId: CHAT_ID, seq: 2, role: 'assistant', content: 'conflicting lineage',
      createdAt: '2026-08-31T00:02:00.000Z', turnId: TURN_ID, oracleSessionId: 'oracle-other',
    }
    const { writePendingFinalization } = await import('../src/finalization-store.ts')
    await writePendingFinalization(root, {
      version: 1, turnId: TURN_ID, chatId: CHAT_ID, oracleSessionId: 'oracle-other', response,
    })
    await state.service.hydrate()
    expect(state.turns.get(TURN_ID)).toMatchObject({ state: 'external-diverged', oracleSessionId: 'oracle-observed' })
    expect(state.chats.get(CHAT_ID)).toMatchObject({ latestOracleSessionId: 'oracle-parent', divergence: { oracleSessionId: 'oracle-observed' } })
    expect(state.messages.size).toBe(0)
  })

  it('rejects a pending response whose chat, turn, role, or Oracle lineage diverges', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-cross-lineage-'))
    const { writePendingFinalization } = await import('../src/finalization-store.ts')
    const mismatchedResponse: ProChatMessage = {
      id: RESPONSE_ID,
      chatId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      seq: 2,
      role: 'assistant',
      content: 'must not cross chats',
      createdAt: '2026-08-31T00:02:00.000Z',
      turnId: TURN_ID,
      oracleSessionId: 'oracle-cross-lineage',
    }
    await expect(writePendingFinalization(root, {
      version: 1,
      turnId: TURN_ID,
      chatId: CHAT_ID,
      oracleSessionId: 'oracle-cross-lineage',
      response: mismatchedResponse,
    })).rejects.toThrow(/chatId|journal/i)
  })

  it('archives chat-scoped conversations with more than 100 Oracle turns without an invalid exact-id list', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-long-trash-'))
    const state = harness({ root })
    for (let index = 0; index < 101; index += 1) {
      const id = `${index.toString(16).padStart(8, '0')}-1111-4111-8111-${index.toString(16).padStart(12, '0')}`
      state.turns.map.set(id, {
        id,
        chatId: CHAT_ID,
        promptMessageId: randomUuidFor(index + 200),
        state: 'succeeded',
        createdAt: new Date(Date.UTC(2026, 7, 31, 0, 0, index)).toISOString(),
        oracleSessionId: `oracle-${index}`,
        resultMessageId: randomUuidFor(index + 400),
      })
    }
    await state.service.deleteChat({ chatId: CHAT_ID })
    expect(state.chats.get(CHAT_ID)?.quarantine?.exactOracleSessionIds).toEqual([])
    expect(state.chats.get(CHAT_ID)?.quarantine?.artifacts?.map(item => item.kind)).toEqual(['transcript', 'oracle-chat'])
  })

  it('archives with a durable tombstone, hides from normal list, and restores', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-service-trash-'))
    const state = harness({ root })
    await mkdir(join(root, 'transcripts', CHAT_ID), { recursive: true })
    await mkdir(join(root, 'oracle-chats', CHAT_ID), { recursive: true })
    await writeFile(join(root, 'transcripts', CHAT_ID, 'turn.md'), 'reply')
    await writeFile(join(root, 'oracle-chats', CHAT_ID, 'meta.json'), 'meta')
    expect(await state.service.deleteChat({ chatId: CHAT_ID })).toBe(true)
    const archived = state.chats.get(CHAT_ID)
    expect(archived?.quarantine?.phase).toBe('quarantined')
    expect(await state.service.listChats()).toEqual([])
    expect(await state.service.listArchivedChats()).toHaveLength(1)
    const trash = join(root, 'trash', CHAT_ID, archived!.quarantine!.opId)
    expect(await readFile(join(trash, 'transcripts', CHAT_ID, 'turn.md'), 'utf8')).toBe('reply')
    expect(await readFile(join(trash, 'oracle-chat', 'meta.json'), 'utf8')).toBe('meta')
    await state.service.restoreChat({ chatId: CHAT_ID })
    expect(state.chats.get(CHAT_ID)?.quarantine).toBeUndefined()
    expect(await state.service.listChats()).toHaveLength(1)
    expect(await readFile(join(root, 'transcripts', CHAT_ID, 'turn.md'), 'utf8')).toBe('reply')
  })

  it('preserves a divergence lock through archive and restore', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-diverged-trash-'))
    const state = harness({ root })
    state.chats.map.set(CHAT_ID, {
      ...baseChat(),
      status: 'failed',
      lastError: 'requires inspection',
      divergence: { turnId: TURN_ID, at: '2026-08-31T00:01:00.000Z', oracleSessionId: 'oracle-unverified', reason: 'submitted unverified' },
    })
    state.turns.map.set(TURN_ID, {
      id: TURN_ID, chatId: CHAT_ID, promptMessageId: PROMPT_ID, state: 'external-diverged',
      createdAt: '2026-08-31T00:00:30.000Z', finishedAt: '2026-08-31T00:01:00.000Z',
      oracleSessionId: 'oracle-unverified', error: 'submitted unverified',
    })
    await state.service.deleteChat({ chatId: CHAT_ID })
    await state.service.restoreChat({ chatId: CHAT_ID })
    expect(state.chats.get(CHAT_ID)?.divergence).toMatchObject({ turnId: TURN_ID, oracleSessionId: 'oracle-unverified' })
    await expect(state.service.send({ chatId: CHAT_ID, content: 'must not retry' })).rejects.toThrow(/禁止自动续发|防止重复提交/)
  })

  it('restores a formerly running tombstone as external-diverged, never as fake running', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-running-trash-'))
    const state = harness({ root })
    state.chats.map.set(CHAT_ID, { ...baseChat(), status: 'running', lastSeq: 1, currentTurnId: TURN_ID })
    state.turns.map.set(TURN_ID, {
      id: TURN_ID, chatId: CHAT_ID, promptMessageId: PROMPT_ID, state: 'queued',
      createdAt: '2026-08-31T00:01:00.000Z', oracleSessionId: 'oracle-running-trash',
    })
    await state.service.deleteChat({ chatId: CHAT_ID })
    const restored = await state.service.restoreChat({ chatId: CHAT_ID })
    expect(restored).toMatchObject({ status: 'failed', divergence: { turnId: TURN_ID, oracleSessionId: 'oracle-running-trash' } })
    expect(state.turns.get(TURN_ID)?.state).toBe('external-diverged')
    expect(state.active.size).toBe(0)
    await expect(state.service.send({ chatId: CHAT_ID, content: 'must not retry' })).rejects.toThrow(/禁止自动续发|防止重复提交/)
  })

  it('retains a schema-valid complete tombstone when running restore repair fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-running-restore-fail-'))
    const state = harness({ root, failAt: 3 })
    const quarantine = {
      opId: '77777777-7777-4777-8777-777777777777',
      phase: 'quarantined' as const,
      archivedAt: '2026-08-31T00:02:00.000Z',
      previousStatus: 'running' as const,
      oracleScope: 'chat-scoped' as const,
      exactOracleSessionIds: [],
      artifacts: [
        { kind: 'transcript' as const, presentAtArchive: false },
        { kind: 'oracle-chat' as const, presentAtArchive: false },
      ],
    }
    state.chats.map.set(CHAT_ID, { ...baseChat(), status: 'idle', quarantine })
    state.turns.map.set(TURN_ID, {
      id: TURN_ID, chatId: CHAT_ID, promptMessageId: PROMPT_ID, state: 'queued',
      createdAt: '2026-08-31T00:01:00.000Z', oracleSessionId: 'oracle-restore-fail',
    })
    await expect(state.service.restoreChat({ chatId: CHAT_ID })).rejects.toThrow(/injected-3/)
    const retained = state.chats.get(CHAT_ID)
    expect(() => ProChatSchema.parse(retained)).not.toThrow()
    expect(retained?.quarantine).toMatchObject({
      opId: quarantine.opId,
      phase: 'restore-pending',
      archivedAt: quarantine.archivedAt,
      previousStatus: 'running',
      oracleScope: 'chat-scoped',
      exactOracleSessionIds: [],
    })
    const retried = await state.service.restoreChat({ chatId: CHAT_ID })
    expect(retried).toMatchObject({ status: 'failed', divergence: { turnId: TURN_ID, oracleSessionId: 'oracle-restore-fail' } })
  })
})

function randomUuidFor(value: number): string {
  const hex = value.toString(16).padStart(12, '0')
  return `aaaaaaaa-aaaa-4aaa-8aaa-${hex}`
}
