import { describe, expect, it } from 'vitest'
import {
  assertNode24,
  assertOracleLineage,
  assertOracleParent,
  ExclusiveBrowserLease,
  oracleSessionPath,
  parseOracleSessionProof,
  parseOracleSubmissionProjection,
  safeOracleDiagnostic,
} from '../src/transport-support.ts'

const TARGET_A = 'A'.repeat(32)
const TARGET_B = 'B'.repeat(32)
const CONVERSATION = 'conversation-123'

function metadata(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'dsh-pro-chat-test',
    status: 'completed',
    mode: 'browser',
    model: 'gpt-5.6-sol',
    browser: {
      runtime: {
        chromeTargetId: TARGET_A,
        conversationId: CONVERSATION,
        tabUrl: `https://chatgpt.com/c/${CONVERSATION}`,
        promptSubmitted: true,
      },
      config: {
        remoteChrome: { host: '127.0.0.1', port: 9223 },
        keepBrowser: true,
      },
    },
    options: {},
    ...overrides,
  })
}

describe('transport support', () => {
  it('stores only allowlisted Oracle diagnostics', () => {
    const raw = 'ERROR: <html data-testid="secret">Bearer abc cookie=session-value business text</html>'
    const safe = safeOracleDiagnostic(raw)
    expect(safe).toBe('Oracle 浏览器桥接失败；详细诊断未写入 Pro Chat 数据。')
    expect(safe).not.toContain('secret')
    expect(safe).not.toContain('abc')
    expect(safeOracleDiagnostic('request timed out with page dump')).toContain('超时')
    expect(safeOracleDiagnostic('unclassified payload')).toBe('Oracle 浏览器桥接失败；详细诊断未写入 Pro Chat 数据。')
  })

  it('fails fast below Node 24', () => {
    expect(() => assertNode24('22.20.0')).toThrow(/Node\.js 24/)
    expect(() => assertNode24('24.15.0')).not.toThrow()
  })

  it('validates metadata and exact initial/follow-up lineage', () => {
    const initial = parseOracleSessionProof(metadata())
    expect(initial.conversationId).toBe(CONVERSATION)
    expect(initial.promptSubmitted).toBe(true)
    expect(() => assertOracleParent(initial, 'localhost:9223')).not.toThrow()
    expect(() => assertOracleLineage({ result: initial, proofTargetId: TARGET_A, cdpTarget: '127.0.0.1:9223' })).not.toThrow()
    expect(() => assertOracleLineage({ result: initial, proofTargetId: TARGET_B, cdpTarget: '127.0.0.1:9223' })).toThrow(/初始回合/)

    const child = parseOracleSessionProof(metadata({
      id: 'dsh-pro-turn-test',
      browser: {
        runtime: {
          chromeTargetId: TARGET_B,
          conversationId: CONVERSATION,
          tabUrl: `https://chatgpt.com/c/${CONVERSATION}`,
          promptSubmitted: true,
        },
        config: { remoteChrome: { host: '127.0.0.1', port: 9223 }, keepBrowser: true },
      },
      options: { followupSessionId: initial.id },
    }))
    expect(() => assertOracleLineage({
      result: child,
      parent: initial,
      proofTargetId: TARGET_A,
      cdpTarget: '127.0.0.1:9223',
    })).not.toThrow()
  })

  it('rejects unsafe, incomplete, and legacy metadata', () => {
    expect(() => parseOracleSessionProof(metadata({ status: 'running' }))).toThrow(/已完成/)
    expect(() => parseOracleSessionProof(metadata({ browser: {
      runtime: { chromeTargetId: TARGET_A, conversationId: CONVERSATION, tabUrl: `https://chatgpt.com/c/${CONVERSATION}`, promptSubmitted: false },
      config: { remoteChrome: { host: '127.0.0.1', port: 9223 }, keepBrowser: true },
    } }))).toThrow(/prompt/)
    expect(() => parseOracleSessionProof(metadata({ browser: {
      runtime: { chromeTargetId: TARGET_A, conversationId: CONVERSATION, tabUrl: `https://chatgpt.com/c/${CONVERSATION}`, promptSubmitted: true },
      config: { remoteChrome: { host: '127.0.0.1', port: 9223 }, keepBrowser: false },
    } }))).toThrow(/keepBrowser/)
    const recovered = parseOracleSessionProof(metadata({ browser: {
      runtime: { chromeTargetId: TARGET_A, conversationId: CONVERSATION, tabUrl: 'https://example.com/c/conversation-123', promptSubmitted: true },
      config: { remoteChrome: { host: '127.0.0.1', port: 9223 }, keepBrowser: true },
    } }))
    expect(recovered.tabUrl).toBe(`https://chatgpt.com/c/${CONVERSATION}`)
    expect(() => parseOracleSessionProof(metadata({ browser: {
      runtime: { chromeTargetId: TARGET_A, conversationId: '', tabUrl: 'https://example.com/c/conversation-123', promptSubmitted: true },
      config: { remoteChrome: { host: '127.0.0.1', port: 9223 }, keepBrowser: true },
    } }))).toThrow(/ChatGPT conversation/)
    expect(() => oracleSessionPath('C:/safe/oracle', '../outside')).toThrow(/格式/)
  })

  it('uses the Oracle 0.18 effective config and rejects duplicate config or URL drift', () => {
    const optionsOnly = JSON.parse(metadata()) as Record<string, any>
    optionsOnly.options.browserConfig = { ...optionsOnly.browser.config, url: 'https://chatgpt.com/g/project-shell' }
    delete optionsOnly.browser.config
    optionsOnly.browser.runtime.tabUrl = 'https://example.com/not-recoverable'
    expect(parseOracleSessionProof(JSON.stringify(optionsOnly)).remoteChrome.port).toBe(9223)
    expect(parseOracleSessionProof(JSON.stringify(optionsOnly)).tabUrl)
      .toBe(`https://chatgpt.com/g/project-shell/c/${CONVERSATION}`)

    const configConflict = JSON.parse(metadata()) as Record<string, any>
    configConflict.options.browserConfig = {
      remoteChrome: { host: '127.0.0.1', port: 9444 },
      keepBrowser: true,
    }
    expect(() => parseOracleSessionProof(JSON.stringify(configConflict))).toThrow(/两份 browserConfig 不一致/)

    const urlConflict = JSON.parse(metadata()) as Record<string, any>
    urlConflict.browser.harvest = { url: 'https://chatgpt.com/c/different-conversation' }
    expect(() => parseOracleSessionProof(JSON.stringify(urlConflict))).toThrow(/harvest URL.*runtime URL 不一致/)

    const invalidHarvest = JSON.parse(metadata()) as Record<string, any>
    invalidHarvest.browser.harvest = { url: 'https://example.com/c/different-conversation' }
    expect(parseOracleSessionProof(JSON.stringify(invalidHarvest)).tabUrl).toBe(`https://chatgpt.com/c/${CONVERSATION}`)

    const preferredHarvest = JSON.parse(metadata()) as Record<string, any>
    preferredHarvest.browser.harvest = { url: `https://chatgpt.com/c/${CONVERSATION}?from=harvest` }
    expect(parseOracleSessionProof(JSON.stringify(preferredHarvest)).tabUrl).toContain('from=harvest')

    const runtimeConflict = JSON.parse(metadata()) as Record<string, any>
    runtimeConflict.browser.runtime.chromeHost = '127.0.0.1'
    runtimeConflict.browser.runtime.chromePort = 9555
    expect(() => parseOracleSessionProof(JSON.stringify(runtimeConflict))).toThrow(/runtime Chrome.*browserConfig 不一致/)
  })

  it('projects prompt submission without requiring a completed session', () => {
    const submitted = JSON.parse(metadata({ status: 'error' })) as Record<string, any>
    expect(parseOracleSubmissionProjection(JSON.stringify(submitted))).toEqual({
      id: 'dsh-pro-chat-test',
      promptSubmitted: true,
    })
    submitted.browser.runtime.promptSubmitted = false
    expect(parseOracleSubmissionProjection(JSON.stringify(submitted)).promptSubmitted).toBe(false)
    delete submitted.browser.runtime.promptSubmitted
    expect(parseOracleSubmissionProjection(JSON.stringify(submitted)).promptSubmitted).toBeUndefined()
    submitted.browser.runtime.promptSubmitted = 'true'
    expect(() => parseOracleSubmissionProjection(JSON.stringify(submitted))).toThrow(/promptSubmitted/)
    expect(() => parseOracleSubmissionProjection('{broken')).toThrow(/有效 JSON/)
  })

  it('releases the exclusive lease after success and failure', async () => {
    const lease = new ExclusiveBrowserLease()
    let release!: () => void
    const pending = lease.run(() => new Promise<void>(resolve => { release = resolve }))
    expect(lease.busy).toBe(true)
    await expect(lease.run(async () => undefined)).rejects.toThrow(/正在进行/)
    release()
    await pending
    await expect(lease.run(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(lease.busy).toBe(false)
  })
})
