import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  OracleBrowserTransport,
  OracleBrowserCancelledError,
  OracleBrowserError,
  OracleSubmittedUnverifiedError,
  type BrowserControl,
} from '../src/transport.ts'

const TARGET_A = 'A'.repeat(32)
const TARGET_B = 'B'.repeat(32)
const TARGET_C = 'C'.repeat(32)
const CONVERSATION = 'conversation-123'
const SETTINGS = { cdpTarget: '127.0.0.1:9223', revision: 1 }

function meta(input: {
  id: string
  targetId: string
  followupSessionId?: string
  keepBrowser?: boolean
  status?: string
  promptSubmitted?: boolean
  omitPromptSubmitted?: boolean
  conversationId?: string
  runtimeUrl?: string
  harvestUrl?: string
  optionsConfig?: Record<string, unknown>
}): string {
  const conversationId = input.conversationId ?? CONVERSATION
  const config = {
    remoteChrome: { host: '127.0.0.1', port: 9223 },
    keepBrowser: input.keepBrowser ?? true,
  }
  return JSON.stringify({
    id: input.id,
    status: input.status ?? 'completed',
    mode: 'browser',
    model: 'gpt-5.6-sol',
    browser: {
      runtime: {
        chromeTargetId: input.targetId,
        conversationId,
        tabUrl: input.runtimeUrl ?? `https://chatgpt.com/c/${conversationId}`,
        ...(input.omitPromptSubmitted ? {} : { promptSubmitted: input.promptSubmitted ?? true }),
      },
      config,
      ...(input.harvestUrl === undefined ? {} : { harvest: { url: input.harvestUrl } }),
    },
    options: {
      ...(input.followupSessionId === undefined ? {} : { followupSessionId: input.followupSessionId }),
      ...(input.optionsConfig === undefined ? {} : { browserConfig: input.optionsConfig }),
    },
  })
}

function browserHarness(targets: () => Array<{ id: string; type: string; url: string }>) {
  const calls = { list: 0, version: 0, connect: 0, evaluate: 0, close: 0, connectedTargetIds: [] as string[] }
  const browser: BrowserControl = {
    async list() { calls.list += 1; return targets() },
    async version() { calls.version += 1; return { Browser: 'Chrome/152' } },
    async connect(input) {
      calls.connect += 1
      calls.connectedTargetIds.push(input.target.id)
      return {
        Runtime: {
          async evaluate({ expression }) {
            calls.evaluate += 1
            if (expression.includes('form button[aria-haspopup')) return { result: { value: { found: true } } }
            if (expression.includes('composer-model-picker-slider-simple-view')) {
              return { result: { value: {
                verified: true,
                modelLabel: 'GPT-5.6 Sol',
                thinkingLabel: 'Pro',
                reason: '',
              } } }
            }
            return { result: { value: true } }
          },
        },
        async close() { calls.close += 1 },
      }
    },
  }
  return { browser, calls }
}

function fakeSubprocess(
  stdout: string,
  onSpawn?: (argv: string[]) => void,
  result: { exitCode?: number; stderr?: string; reject?: Error } = {},
) {
  return {
    spawn(input: { argv: string[] }) {
      onSpawn?.(input.argv)
      return {
        done: result.reject === undefined
          ? Promise.resolve({ exitCode: result.exitCode ?? 0 })
          : Promise.reject(result.reject),
        collected: {
          stdout: { readFrom: () => ({ text: stdout }) },
          stderr: { readFrom: () => ({ text: result.stderr ?? '' }) },
        },
      }
    },
  }
}

function initialRunInput(
  dataRoot: string,
  turnId: string,
  signal: AbortSignal,
  onSessionObserved?: (oracleSessionId: string) => void | Promise<void>,
): Parameters<OracleBrowserTransport['run']>[0] {
  return {
    chatId: '11111111-1111-4111-8111-111111111111',
    turnId,
    prompt: 'test',
    settings: SETTINGS,
    dataRoot,
    oracleScope: 'chat-scoped',
    signal,
    ...(onSessionObserved === undefined ? {} : { onSessionObserved }),
  }
}

describe('OracleBrowserTransport', () => {
  it('keeps automatic status passive and active verification explicit', async () => {
    const target = { id: TARGET_A, type: 'page', url: `https://chatgpt.com/c/${CONVERSATION}` }
    const harness = browserHarness(() => [target])
    let now = 1_000
    const transport = new OracleBrowserTransport(fakeSubprocess('') as never, {
      browser: harness.browser,
      delay: async () => undefined,
      now: () => now,
      resolveCli: async () => ({ cliPath: 'oracle.js' }),
    })
    const passive = await transport.status(SETTINGS)
    expect(passive.reachable).toBe(true)
    expect(passive.selectionVerified).toBe(false)
    expect(harness.calls.connect).toBe(0)
    expect(harness.calls.evaluate).toBe(0)

    const verified = await transport.verifyStatus(SETTINGS)
    expect(verified.selectionVerified).toBe(true)
    expect(harness.calls.evaluate).toBe(3)
    now += 30_000
    expect((await transport.status(SETTINGS)).selectionVerified).toBe(true)
    expect(harness.calls.evaluate).toBe(3)
    now += 31_000
    expect((await transport.status(SETTINGS)).selectionVerified).toBe(false)
    expect(harness.calls.evaluate).toBe(3)
  })

  it('fails active proof closed when multiple ChatGPT tabs are ambiguous', async () => {
    const harness = browserHarness(() => [
      { id: TARGET_A, type: 'page', url: 'https://chatgpt.com/' },
      { id: TARGET_B, type: 'page', url: `https://chatgpt.com/c/${CONVERSATION}` },
    ])
    const transport = new OracleBrowserTransport(fakeSubprocess('') as never, {
      browser: harness.browser,
      delay: async () => undefined,
      resolveCli: async () => ({ cliPath: 'oracle.js' }),
    })
    const result = await transport.verifyStatus(SETTINGS)
    expect(result.selectionVerified).toBe(false)
    expect(result.message).toMatch(/多个/)
    expect(harness.calls.connect).toBe(0)
  })

  it('pins an initial run to one target and verifies generated metadata', async () => {
    const target = { id: TARGET_A, type: 'page', url: `https://chatgpt.com/c/${CONVERSATION}` }
    const harness = browserHarness(() => [target])
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-transport-'))
    const sessionId = 'dsh-pro-chat-test'
    let argv: string[] = []
    let observedSessionId: string | undefined
    const transport = new OracleBrowserTransport(fakeSubprocess(`Session: ${sessionId}\n`, value => { argv = value }) as never, {
      browser: harness.browser,
      delay: async () => undefined,
      resolveCli: async () => ({ cliPath: 'oracle.js' }),
      readText: async path => path.endsWith('meta.json')
        ? (expect(observedSessionId).toBe(sessionId), meta({ id: sessionId, targetId: TARGET_A }))
        : 'DSH_PRO_OK',
    })
    const result = await transport.run({
      chatId: '11111111-1111-4111-8111-111111111111',
      turnId: '22222222-2222-4222-8222-222222222222',
      prompt: 'test',
      settings: SETTINGS,
      dataRoot: root,
      oracleScope: 'chat-scoped',
      signal: new AbortController().signal,
      onSessionObserved: value => { observedSessionId = value },
    })
    expect(result.oracleSessionId).toBe(sessionId)
    expect(argv).toContain('--browser-keep-browser')
    expect(argv.slice(argv.indexOf('--browser-tab'), argv.indexOf('--browser-tab') + 2)).toEqual(['--browser-tab', TARGET_A])
    expect(harness.calls.evaluate).toBe(6)
  })

  it('persists the Oracle session id while the subprocess is still running', async () => {
    const sessionId = 'dsh-pro-chat-live-observation'
    const harness = browserHarness(() => [{ id: TARGET_A, type: 'page', url: `https://chatgpt.com/c/${CONVERSATION}` }])
    let resolveDone!: (value: { exitCode: number }) => void
    let doneSettled = false
    const done = new Promise<{ exitCode: number }>(resolve => { resolveDone = resolve }).then(value => {
      doneSettled = true
      return value
    })
    const subprocess = {
      spawn() {
        return {
          done,
          collected: {
            stdout: { readFrom: () => ({ text: `Session: ${sessionId}\n` }) },
            stderr: { readFrom: () => ({ text: '' }) },
          },
        }
      },
    }
    let observed!: () => void
    const observedGate = new Promise<void>(resolve => { observed = resolve })
    const transport = new OracleBrowserTransport(subprocess as never, {
      browser: harness.browser,
      delay: async () => undefined,
      resolveCli: async () => ({ cliPath: 'oracle.js' }),
      readText: async path => path.endsWith('meta.json')
        ? meta({ id: sessionId, targetId: TARGET_A })
        : 'validated output',
    })
    const pending = transport.run(initialRunInput(
      await mkdtemp(join(tmpdir(), 'pro-chat-live-observation-')),
      '23232323-2323-4232-8232-232323232323',
      new AbortController().signal,
      value => {
        expect(value).toBe(sessionId)
        observed()
      },
    ))
    await expect(Promise.race([
      observedGate,
      new Promise((_, reject) => setTimeout(() => reject(new Error('session observation waited for process exit')), 1_000)),
    ])).resolves.toBeUndefined()
    expect(doneSettled).toBe(false)
    resolveDone({ exitCode: 0 })
    await expect(pending).resolves.toMatchObject({ oracleSessionId: sessionId, markdown: 'validated output' })
  })

  it('classifies a thrown post-target proof as submitted-unverified', async () => {
    const sessionId = 'dsh-pro-chat-post-proof-error'
    const target = { id: TARGET_A, type: 'page', url: `https://chatgpt.com/c/${CONVERSATION}` }
    const harness = browserHarness(() => [target])
    const list = harness.browser.list.bind(harness.browser)
    harness.browser.list = async input => {
      if (harness.calls.list >= 2) throw new Error('post-proof list failed')
      return list(input)
    }
    const transport = new OracleBrowserTransport(fakeSubprocess(`Session: ${sessionId}\n`) as never, {
      browser: harness.browser,
      delay: async () => undefined,
      resolveCli: async () => ({ cliPath: 'oracle.js' }),
      readText: async path => path.endsWith('meta.json')
        ? meta({ id: sessionId, targetId: TARGET_A, promptSubmitted: true })
        : 'validated output',
    })
    await expect(transport.run(initialRunInput(
      await mkdtemp(join(tmpdir(), 'pro-chat-post-proof-error-')),
      '25252525-2525-4252-8252-252525252525',
      new AbortController().signal,
    ))).rejects.toMatchObject({ name: 'OracleSubmittedUnverifiedError', oracleSessionId: sessionId })
  })

  it('pins follow-up preflight to the exact parent when several tabs share one conversation', async () => {
    let afterSpawn = false
    const harness = browserHarness(() => [
      { id: TARGET_A, type: 'page', url: `https://chatgpt.com/c/${CONVERSATION}` },
      { id: TARGET_B, type: 'page', url: `https://chatgpt.com/c/${CONVERSATION}` },
      ...(afterSpawn ? [{ id: TARGET_C, type: 'page', url: `https://chatgpt.com/c/${CONVERSATION}` }] : []),
    ])
    const root = await mkdtemp(join(tmpdir(), 'pro-chat-followup-'))
    const parentId = 'dsh-pro-chat-parent'
    const childId = 'dsh-pro-turn-child'
    let argv: string[] = []
    const transport = new OracleBrowserTransport(fakeSubprocess(`Session: ${childId}\n`, value => { argv = value; afterSpawn = true }) as never, {
      browser: harness.browser,
      delay: async () => undefined,
      resolveCli: async () => ({ cliPath: 'oracle.js' }),
      readText: async path => {
        if (path.endsWith(`${parentId}\\meta.json`) || path.endsWith(`${parentId}/meta.json`)) {
          return meta({ id: parentId, targetId: TARGET_B })
        }
        if (path.endsWith('meta.json')) return meta({ id: childId, targetId: TARGET_C, followupSessionId: parentId })
        return 'DSH_FOLLOWUP_OK'
      },
    })
    const result = await transport.run({
      chatId: '11111111-1111-4111-8111-111111111111',
      turnId: '33333333-3333-4333-8333-333333333333',
      prompt: 'follow up',
      previousOracleSessionId: parentId,
      settings: SETTINGS,
      dataRoot: root,
      oracleScope: 'chat-scoped',
      signal: new AbortController().signal,
    })
    expect(result.oracleSessionId).toBe(childId)
    expect(argv.slice(argv.indexOf('--followup'), argv.indexOf('--followup') + 2)).toEqual(['--followup', parentId])
    expect(harness.calls.evaluate).toBe(6)
    expect(harness.calls.connectedTargetIds).toEqual([TARGET_B, TARGET_C])
  })

  it('does not downgrade to another tab when the exact parent target is missing', async () => {
    const harness = browserHarness(() => [
      { id: TARGET_B, type: 'page', url: `https://chatgpt.com/c/${CONVERSATION}` },
    ])
    const parentId = 'dsh-pro-chat-missing-target'
    let spawns = 0
    const transport = new OracleBrowserTransport(fakeSubprocess('', () => { spawns += 1 }) as never, {
      browser: harness.browser,
      delay: async () => undefined,
      resolveCli: async () => ({ cliPath: 'oracle.js' }),
      readText: async () => meta({ id: parentId, targetId: TARGET_A }),
    })
    await expect(transport.run({
      chatId: '11111111-1111-4111-8111-111111111111',
      turnId: '34343434-3434-4343-8343-343434343434',
      prompt: 'follow up',
      previousOracleSessionId: parentId,
      settings: SETTINGS,
      dataRoot: await mkdtemp(join(tmpdir(), 'pro-chat-missing-target-')),
      oracleScope: 'chat-scoped',
      signal: new AbortController().signal,
    })).rejects.toThrow(/血缘一致/)
    expect(spawns).toBe(0)
    expect(harness.calls.connect).toBe(0)
  })

  it('rejects legacy follow-up metadata before spawning Oracle', async () => {
    const harness = browserHarness(() => [{ id: TARGET_A, type: 'page', url: `https://chatgpt.com/c/${CONVERSATION}` }])
    let spawns = 0
    const transport = new OracleBrowserTransport(fakeSubprocess('', () => { spawns += 1 }) as never, {
      browser: harness.browser,
      delay: async () => undefined,
      resolveCli: async () => ({ cliPath: 'oracle.js' }),
      readText: async () => meta({ id: 'legacy-parent', targetId: TARGET_A, keepBrowser: false }),
    })
    await expect(transport.run({
      chatId: '11111111-1111-4111-8111-111111111111',
      turnId: '44444444-4444-4444-8444-444444444444',
      prompt: 'follow up',
      previousOracleSessionId: 'legacy-parent',
      settings: SETTINGS,
      dataRoot: await mkdtemp(join(tmpdir(), 'pro-chat-legacy-')),
      oracleScope: 'legacy-global',
      signal: new AbortController().signal,
    })).rejects.toThrow(/keepBrowser/)
    expect(spawns).toBe(0)
    expect(harness.calls.evaluate).toBe(0)
  })

  it.each([
    ['browser config', () => meta({
      id: 'conflicted-parent',
      targetId: TARGET_A,
      optionsConfig: { remoteChrome: { host: '127.0.0.1', port: 9444 }, keepBrowser: true },
    })],
    ['resume URL', () => meta({
      id: 'conflicted-parent',
      targetId: TARGET_A,
      harvestUrl: 'https://chatgpt.com/c/another-conversation',
    })],
  ])('rejects conflicting parent %s before spawning Oracle', async (_label, parentMetadata) => {
    const harness = browserHarness(() => [{ id: TARGET_A, type: 'page', url: `https://chatgpt.com/c/${CONVERSATION}` }])
    let spawns = 0
    const transport = new OracleBrowserTransport(fakeSubprocess('', () => { spawns += 1 }) as never, {
      browser: harness.browser,
      delay: async () => undefined,
      resolveCli: async () => ({ cliPath: 'oracle.js' }),
      readText: async () => parentMetadata(),
    })
    await expect(transport.run({
      chatId: '11111111-1111-4111-8111-111111111111',
      turnId: '55555555-5555-4555-8555-555555555555',
      prompt: 'follow up',
      previousOracleSessionId: 'conflicted-parent',
      settings: SETTINGS,
      dataRoot: await mkdtemp(join(tmpdir(), 'pro-chat-conflict-')),
      oracleScope: 'chat-scoped',
      signal: new AbortController().signal,
    })).rejects.toThrow(/不一致/)
    expect(spawns).toBe(0)
    expect(harness.calls.evaluate).toBe(0)
  })

  it('treats a header-only pre-submit failure as an ordinary browser failure', async () => {
    const sessionId = 'dsh-pro-chat-pre-submit'
    const harness = browserHarness(() => [{ id: TARGET_A, type: 'page', url: `https://chatgpt.com/c/${CONVERSATION}` }])
    const transport = new OracleBrowserTransport(fakeSubprocess(`Session: ${sessionId}\n`, undefined, {
      exitCode: 1,
      stderr: 'ERROR: browser setup failed',
    }) as never, {
      browser: harness.browser,
      delay: async () => undefined,
      resolveCli: async () => ({ cliPath: 'oracle.js' }),
      readText: async () => meta({ id: sessionId, targetId: TARGET_A, status: 'error', promptSubmitted: false }),
    })
    let caught: unknown
    try {
      await transport.run({
        chatId: '11111111-1111-4111-8111-111111111111',
        turnId: '66666666-6666-4666-8666-666666666666',
        prompt: 'test',
        settings: SETTINGS,
        dataRoot: await mkdtemp(join(tmpdir(), 'pro-chat-pre-submit-')),
        oracleScope: 'chat-scoped',
        signal: new AbortController().signal,
      })
    } catch (reason) {
      caught = reason
    }
    expect(caught).toBeInstanceOf(OracleBrowserError)
    expect(caught).not.toBeInstanceOf(OracleSubmittedUnverifiedError)
  })

  it('classifies a rejected subprocess with submitted metadata as unverified', async () => {
    const sessionId = 'dsh-pro-chat-submitted-error'
    const harness = browserHarness(() => [{ id: TARGET_A, type: 'page', url: `https://chatgpt.com/c/${CONVERSATION}` }])
    const transport = new OracleBrowserTransport(fakeSubprocess(`Session: ${sessionId}\n`, undefined, {
      reject: new Error('handle.done rejected'),
    }) as never, {
      browser: harness.browser,
      delay: async () => undefined,
      resolveCli: async () => ({ cliPath: 'oracle.js' }),
      readText: async () => meta({ id: sessionId, targetId: TARGET_A, status: 'error', promptSubmitted: true }),
    })
    await expect(transport.run({
      chatId: '11111111-1111-4111-8111-111111111111',
      turnId: '77777777-7777-4777-8777-777777777777',
      prompt: 'test',
      settings: SETTINGS,
      dataRoot: await mkdtemp(join(tmpdir(), 'pro-chat-submitted-error-')),
      oracleScope: 'chat-scoped',
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ name: 'OracleSubmittedUnverifiedError', oracleSessionId: sessionId })
  })

  it('classifies a nonzero exit with submitted metadata as unverified', async () => {
    const sessionId = 'dsh-pro-chat-submitted-nonzero'
    const harness = browserHarness(() => [{ id: TARGET_A, type: 'page', url: `https://chatgpt.com/c/${CONVERSATION}` }])
    const transport = new OracleBrowserTransport(fakeSubprocess(`Session: ${sessionId}\n`, undefined, {
      exitCode: 1,
      stderr: 'ERROR: response collection failed',
    }) as never, {
      browser: harness.browser,
      delay: async () => undefined,
      resolveCli: async () => ({ cliPath: 'oracle.js' }),
      readText: async () => meta({ id: sessionId, targetId: TARGET_A, status: 'error', promptSubmitted: true }),
    })
    await expect(transport.run({
      chatId: '11111111-1111-4111-8111-111111111111',
      turnId: '78787878-7878-4787-8787-787878787878',
      prompt: 'test',
      settings: SETTINGS,
      dataRoot: await mkdtemp(join(tmpdir(), 'pro-chat-submitted-nonzero-')),
      oracleScope: 'chat-scoped',
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ name: 'OracleSubmittedUnverifiedError', oracleSessionId: sessionId })
  })

  it('classifies abort after prompt submission as unverified instead of cancelled', async () => {
    const sessionId = 'dsh-pro-chat-submitted-abort'
    const controller = new AbortController()
    const harness = browserHarness(() => [{ id: TARGET_A, type: 'page', url: `https://chatgpt.com/c/${CONVERSATION}` }])
    const transport = new OracleBrowserTransport(fakeSubprocess(`Session: ${sessionId}\n`, () => controller.abort(), {
      exitCode: 1,
    }) as never, {
      browser: harness.browser,
      delay: async () => undefined,
      resolveCli: async () => ({ cliPath: 'oracle.js' }),
      readText: async () => meta({ id: sessionId, targetId: TARGET_A, status: 'error', promptSubmitted: true }),
    })
    await expect(transport.run({
      chatId: '11111111-1111-4111-8111-111111111111',
      turnId: '88888888-8888-4888-8888-888888888888',
      prompt: 'test',
      settings: SETTINGS,
      dataRoot: await mkdtemp(join(tmpdir(), 'pro-chat-submitted-abort-')),
      oracleScope: 'chat-scoped',
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'OracleSubmittedUnverifiedError', oracleSessionId: sessionId })
  })

  it('keeps an explicitly pre-submit abort as an ordinary cancellation', async () => {
    const sessionId = 'dsh-pro-chat-pre-submit-abort'
    const controller = new AbortController()
    const harness = browserHarness(() => [{ id: TARGET_A, type: 'page', url: `https://chatgpt.com/c/${CONVERSATION}` }])
    const transport = new OracleBrowserTransport(fakeSubprocess(`Session: ${sessionId}\n`, () => controller.abort(), {
      exitCode: 1,
    }) as never, {
      browser: harness.browser,
      delay: async () => undefined,
      resolveCli: async () => ({ cliPath: 'oracle.js' }),
      readText: async () => meta({ id: sessionId, targetId: TARGET_A, status: 'error', promptSubmitted: false }),
    })
    await expect(transport.run({
      chatId: '11111111-1111-4111-8111-111111111111',
      turnId: '89898989-8989-4898-8989-898989898989',
      prompt: 'test',
      settings: SETTINGS,
      dataRoot: await mkdtemp(join(tmpdir(), 'pro-chat-pre-submit-abort-')),
      oracleScope: 'chat-scoped',
      signal: controller.signal,
    })).rejects.toBeInstanceOf(OracleBrowserCancelledError)
  })

  it('fails a rejected subprocess closed when prompt submission is unknown', async () => {
    const sessionId = 'dsh-pro-chat-unknown-reject'
    const harness = browserHarness(() => [{ id: TARGET_A, type: 'page', url: `https://chatgpt.com/c/${CONVERSATION}` }])
    const transport = new OracleBrowserTransport(fakeSubprocess(`Session: ${sessionId}\n`, undefined, {
      reject: new Error('handle.done rejected'),
    }) as never, {
      browser: harness.browser,
      delay: async () => undefined,
      resolveCli: async () => ({ cliPath: 'oracle.js' }),
      readText: async () => meta({ id: sessionId, targetId: TARGET_A, status: 'error', omitPromptSubmitted: true }),
    })
    await expect(transport.run(initialRunInput(
      await mkdtemp(join(tmpdir(), 'pro-chat-unknown-reject-')),
      '90909090-9090-4909-8909-909090909090',
      new AbortController().signal,
    ))).rejects.toMatchObject({ name: 'OracleSubmittedUnverifiedError', oracleSessionId: sessionId })
  })

  it('fails an abort closed when prompt submission is unknown', async () => {
    const sessionId = 'dsh-pro-chat-unknown-abort'
    const controller = new AbortController()
    const harness = browserHarness(() => [{ id: TARGET_A, type: 'page', url: `https://chatgpt.com/c/${CONVERSATION}` }])
    const transport = new OracleBrowserTransport(fakeSubprocess(`Session: ${sessionId}\n`, () => controller.abort(), {
      exitCode: 1,
    }) as never, {
      browser: harness.browser,
      delay: async () => undefined,
      resolveCli: async () => ({ cliPath: 'oracle.js' }),
      readText: async () => meta({ id: sessionId, targetId: TARGET_A, status: 'error', omitPromptSubmitted: true }),
    })
    await expect(transport.run(initialRunInput(
      await mkdtemp(join(tmpdir(), 'pro-chat-unknown-abort-')),
      '91919191-9191-4919-8919-919191919191',
      controller.signal,
    ))).rejects.toMatchObject({ name: 'OracleSubmittedUnverifiedError', oracleSessionId: sessionId })
  })

  it('fails closed when session observation fails and submission is unknown', async () => {
    const sessionId = 'dsh-pro-chat-observation-failed'
    const harness = browserHarness(() => [{ id: TARGET_A, type: 'page', url: `https://chatgpt.com/c/${CONVERSATION}` }])
    const transport = new OracleBrowserTransport(fakeSubprocess(`Session: ${sessionId}\n`) as never, {
      browser: harness.browser,
      delay: async () => undefined,
      resolveCli: async () => ({ cliPath: 'oracle.js' }),
      readText: async () => meta({ id: sessionId, targetId: TARGET_A, omitPromptSubmitted: true }),
    })
    await expect(transport.run(initialRunInput(
      await mkdtemp(join(tmpdir(), 'pro-chat-observation-failed-')),
      '92929292-9292-4929-8929-929292929292',
      new AbortController().signal,
      async () => { throw new Error('observation persistence failed') },
    ))).rejects.toMatchObject({ name: 'OracleSubmittedUnverifiedError', oracleSessionId: sessionId })
  })

  it('fails closed when the complete proof is unreadable and submission is unknown', async () => {
    const sessionId = 'dsh-pro-chat-proof-unknown'
    const harness = browserHarness(() => [{ id: TARGET_A, type: 'page', url: `https://chatgpt.com/c/${CONVERSATION}` }])
    const transport = new OracleBrowserTransport(fakeSubprocess(`Session: ${sessionId}\n`) as never, {
      browser: harness.browser,
      delay: async () => undefined,
      resolveCli: async () => ({ cliPath: 'oracle.js' }),
      readText: async () => meta({ id: sessionId, targetId: TARGET_A, omitPromptSubmitted: true }),
    })
    await expect(transport.run(initialRunInput(
      await mkdtemp(join(tmpdir(), 'pro-chat-proof-unknown-')),
      '93939393-9393-4939-8939-939393939393',
      new AbortController().signal,
    ))).rejects.toMatchObject({ name: 'OracleSubmittedUnverifiedError', oracleSessionId: sessionId })
  })

  it('uses the deterministic slug projection when submitted output has no Session line', async () => {
    const turnId = '99999999-9999-4999-8999-999999999999'
    const requestedSessionId = 'dsh-pro-chat-99999999'
    const harness = browserHarness(() => [{ id: TARGET_A, type: 'page', url: `https://chatgpt.com/c/${CONVERSATION}` }])
    const transport = new OracleBrowserTransport(fakeSubprocess('', undefined, { exitCode: 1 }) as never, {
      browser: harness.browser,
      delay: async () => undefined,
      resolveCli: async () => ({ cliPath: 'oracle.js' }),
      readText: async path => path.endsWith('meta.json')
        ? meta({ id: requestedSessionId, targetId: TARGET_A, status: 'error', promptSubmitted: true })
        : '',
    })
    await expect(transport.run({
      chatId: '11111111-1111-4111-8111-111111111111',
      turnId,
      prompt: 'test',
      settings: SETTINGS,
      dataRoot: await mkdtemp(join(tmpdir(), 'pro-chat-no-session-line-')),
      oracleScope: 'chat-scoped',
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ name: 'OracleSubmittedUnverifiedError', oracleSessionId: undefined })
  })

  it('fails closed when neither a Session line nor readable submission metadata exists', async () => {
    const harness = browserHarness(() => [{ id: TARGET_A, type: 'page', url: `https://chatgpt.com/c/${CONVERSATION}` }])
    const transport = new OracleBrowserTransport(fakeSubprocess('', undefined, { exitCode: 1 }) as never, {
      browser: harness.browser,
      delay: async () => undefined,
      resolveCli: async () => ({ cliPath: 'oracle.js' }),
      readText: async () => { throw new Error('missing metadata') },
    })
    await expect(transport.run(initialRunInput(
      await mkdtemp(join(tmpdir(), 'pro-chat-no-session-unknown-')),
      '94949494-9494-4949-8949-949494949494',
      new AbortController().signal,
    ))).rejects.toMatchObject({ name: 'OracleSubmittedUnverifiedError', oracleSessionId: undefined })
  })
})
