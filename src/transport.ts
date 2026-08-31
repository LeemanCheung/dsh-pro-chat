import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import CDP from 'chrome-remote-interface'
import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { OracleScope, ProChatSettings, TransportStatus } from './schema.ts'
import {
  assertNode24,
  assertOracleLineage,
  assertOracleParent,
  ExclusiveBrowserLease,
  oracleSessionPath,
  parseOracleSessionProof,
  parseOracleSubmissionProjection,
  safeOracleDiagnostic,
  type OracleSessionProof,
  type OracleSubmissionProjection,
} from './transport-support.ts'

const require = createRequire(import.meta.url)
const ORACLE_VERSION = '0.18.0'
const OUTPUT_LIMIT = 2_000_000

type SelectionProof = {
  readonly verified: boolean
  readonly targetId?: string
  readonly modelLabel?: string
  readonly thinkingLabel?: string
  readonly reason?: string
}

type BrowserTarget = { id: string; type: string; url: string }
type SessionObservation = { oracleSessionId?: string; failure?: unknown }
type BrowserClient = {
  Runtime: { evaluate(input: { expression: string; returnByValue: boolean }): Promise<{ result: { value?: unknown } }> }
  close(): Promise<void>
}
export type BrowserControl = {
  list(input: { host: string; port: number }): Promise<BrowserTarget[]>
  version(input: { host: string; port: number }): Promise<{ Browser: string }>
  connect(input: { host: string; port: number; target: BrowserTarget }): Promise<BrowserClient>
}
export type OracleTransportDependencies = {
  browser?: BrowserControl
  delay?: (milliseconds: number) => Promise<void>
  now?: () => number
  readText?: (path: string) => Promise<string>
  resolveCli?: () => Promise<{ cliPath: string }>
}

const defaultBrowser: BrowserControl = {
  list: input => CDP.List(input) as Promise<BrowserTarget[]>,
  version: input => CDP.Version(input),
  connect: input => CDP({ host: input.host, port: input.port, target: input.target.id }) as unknown as Promise<BrowserClient>,
}

export class OracleBrowserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OracleBrowserError'
  }
}

export class OracleBrowserCancelledError extends OracleBrowserError {
  constructor() {
    super('ChatGPT Pro 回合已取消。浏览器控制器已停止；ChatGPT 服务器端可能仍在完成该轮推理。')
    this.name = 'OracleBrowserCancelledError'
  }
}

export class OracleSubmittedUnverifiedError extends OracleBrowserError {
  constructor(message: string, readonly oracleSessionId?: string) {
    super(message)
    this.name = 'OracleSubmittedUnverifiedError'
  }
}

export interface OracleRunRequest {
  readonly chatId: string
  readonly turnId: string
  readonly prompt: string
  readonly previousOracleSessionId?: string
  readonly settings: ProChatSettings
  readonly dataRoot: string
  readonly oracleScope: OracleScope
  readonly signal: AbortSignal
  readonly onHandle?: (handle: SubprocessHandle) => void
  readonly onSessionObserved?: (oracleSessionId: string) => void | Promise<void>
}

export interface OracleRunResult {
  readonly oracleSessionId: string
  readonly markdown: string
  readonly outputPath: string
}

type OraclePackage = { version?: unknown; bin?: { oracle?: unknown } }

function stripAnsi(text: string): string {
  return text.replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
}

function sessionIdFrom(stdout: string): string | undefined {
  const match = /^Session:\s+([^\r\n]+)$/mu.exec(stripAnsi(stdout))
  return match?.[1]?.trim() || undefined
}

function parseCdpTarget(value: string): { host: string; port: number } {
  const separator = value.lastIndexOf(':')
  return { host: value.slice(0, separator), port: Number(value.slice(separator + 1)) }
}

const OPEN_SELECTION_EXPRESSION = String.raw`(() => {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const visible = node => {
    const rect = node?.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0);
  };
  const dispatchClick = target => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const common = { bubbles: true, cancelable: true, view: window };
      const event = type.startsWith('pointer') && 'PointerEvent' in window
        ? new PointerEvent(type, { ...common, pointerId: 1, pointerType: 'mouse' })
        : new MouseEvent(type, common);
      target.dispatchEvent(event);
    }
  };
  const buttons = Array.from(document.querySelectorAll('form button[aria-haspopup="menu"], button.__composer-pill[aria-haspopup="menu"]')).filter(visible);
  const trigger = buttons.find(button => {
    const label = normalize((button.textContent || '') + ' ' + (button.getAttribute('aria-label') || ''));
    return /^pro$/i.test(label) || /thinking|intelligence|reasoning|思考强度|思考/i.test(label);
  });
  if (!trigger) return { found: false };
  if (trigger.getAttribute('aria-expanded') !== 'true') dispatchClick(trigger);
  return { found: true };
})()`

const READ_SELECTION_EXPRESSION = String.raw`(() => {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const simple = document.querySelector('[data-testid="composer-model-picker-slider-simple-view"]');
  const simpleText = normalize((simple?.textContent || '') + ' ' + (simple?.getAttribute?.('aria-label') || ''));
  const advanced = document.querySelector('[data-testid="composer-model-picker-slider-advanced-view"]');
  const checked = advanced?.querySelector('[role="menuitemradio"][aria-checked="true"], [role="menuitemradio"][data-state="checked"]');
  const modelText = normalize((checked?.textContent || '') + ' ' + (checked?.getAttribute?.('aria-label') || ''));
  const pro = /(?:^|\s)pro(?:\s|,|，|$)/i.test(simpleText);
  const sol = /gpt\s*-?\s*5[.\s-]?6\s*-?\s*sol/i.test(modelText);
  return {
    verified: pro && sol,
    modelLabel: modelText.slice(0, 120),
    thinkingLabel: simpleText.slice(0, 120),
    reason: pro && sol ? '' : '请在该 ChatGPT 标签页把模型设为 GPT-5.6 Sol，并把思考强度滑块设为 Pro。'
  };
})()`

const CLOSE_SELECTION_EXPRESSION = String.raw`(() => {
  try {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
  } catch {}
  return true;
})()`

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))
}

export class OracleBrowserTransport {
  private readonly browser: BrowserControl
  private readonly wait: (milliseconds: number) => Promise<void>
  private readonly nowMs: () => number
  private readonly readText: (path: string) => Promise<string>
  private readonly resolveCliOverride: (() => Promise<{ cliPath: string }>) | undefined
  private readonly lease = new ExclusiveBrowserLease()
  private cachedProof?: { cdpTarget: string; proof: SelectionProof; expiresAt: number }

  constructor(private readonly subprocess: SubprocessRuntime, dependencies: OracleTransportDependencies = {}) {
    this.browser = dependencies.browser ?? defaultBrowser
    this.wait = dependencies.delay ?? defaultDelay
    this.nowMs = dependencies.now ?? Date.now
    this.readText = dependencies.readText ?? (path => readFile(path, 'utf8'))
    this.resolveCliOverride = dependencies.resolveCli
  }

  get busy(): boolean {
    return this.lease.busy
  }

  async status(settings: ProChatSettings): Promise<TransportStatus> {
    let oracleInstalled = false
    try {
      await this.resolveCli()
      oracleInstalled = true
    } catch {
      // The UI gives an actionable installation message without exposing package paths.
    }
    const { host, port } = parseCdpTarget(settings.cdpTarget)
    try {
      const version = await this.browser.version({ host, port })
      const browser = version.Browser.slice(0, 240)
      const cached = this.cachedProof?.cdpTarget === settings.cdpTarget
        && this.cachedProof.expiresAt >= this.nowMs() ? this.cachedProof.proof : undefined
      return {
        cdpTarget: settings.cdpTarget,
        reachable: true,
        oracleInstalled,
        selectionVerified: cached?.verified === true,
        browser,
        ...(cached?.modelLabel === undefined ? {} : { modelLabel: cached.modelLabel }),
        ...(cached?.thinkingLabel === undefined ? {} : { thinkingLabel: cached.thinkingLabel }),
        message: cached?.verified
          ? oracleInstalled
            ? '专用 Chrome 已连接；最近一次主动检查验证了 GPT-5.6 Sol + Pro。发送前仍会重新验证。'
            : 'Chrome 与 Pro 选择最近已验证，但 Oracle 运行依赖尚未安装。'
          : this.lease.busy
            ? '专用 Chrome 已连接；Pro 回合运行中，自动状态检查不会触碰 ChatGPT 页面。'
            : '专用 Chrome 已连接。请点击“检查连接”主动验证 GPT-5.6 Sol + Pro；自动轮询不会点击页面。',
      }
    } catch {
      return {
        cdpTarget: settings.cdpTarget,
        reachable: false,
        oracleInstalled,
        selectionVerified: false,
        message: '无法连接专用 Chrome。请先启动带 loopback CDP 的专用 Chrome 并完成 ChatGPT 登录。',
      }
    }
  }

  async verifyStatus(settings: ProChatSettings): Promise<TransportStatus> {
    if (this.lease.busy) return this.status(settings)
    return this.lease.run(async () => {
      const passive = await this.status(settings)
      if (!passive.reachable || !passive.oracleInstalled) return passive
      const proof = await this.verifySelection(settings)
      if (proof.verified) this.rememberProof(settings, proof)
      return {
        ...passive,
        selectionVerified: proof.verified,
        ...(proof.modelLabel === undefined ? {} : { modelLabel: proof.modelLabel }),
        ...(proof.thinkingLabel === undefined ? {} : { thinkingLabel: proof.thinkingLabel }),
        message: proof.verified
          ? '专用 Chrome 已连接，并已主动验证 GPT-5.6 Sol + Pro。发送前仍会在同一目标重新验证。'
          : proof.reason ?? '已连接 Chrome，但尚未验证 GPT-5.6 Sol + Pro 思考强度。',
      }
    })
  }

  async run(request: OracleRunRequest): Promise<OracleRunResult> {
    return this.lease.run(() => this.runExclusive(request))
  }

  private async runExclusive(request: OracleRunRequest): Promise<OracleRunResult> {
    const { cliPath } = await this.resolveCli()
    const oracleHome = request.oracleScope === 'chat-scoped'
      ? join(request.dataRoot, 'oracle-chats', request.chatId)
      : join(request.dataRoot, 'oracle')
    const parent = request.previousOracleSessionId === undefined
      ? undefined : await this.readSessionProof(oracleHome, request.previousOracleSessionId)
    if (parent !== undefined) {
      try {
        assertOracleParent(parent, request.settings.cdpTarget)
      } catch (reason) {
        throw new OracleBrowserError(reason instanceof Error ? reason.message : 'Oracle 父会话验证失败。')
      }
    }
    const proof = await this.verifySelection(request.settings, parent === undefined
      ? undefined : { targetId: parent.targetId, conversationId: parent.conversationId })
    if (!proof.verified || proof.targetId === undefined) {
      throw new OracleBrowserError(proof.reason ?? '未能在同一 ChatGPT 标签页验证 GPT-5.6 Sol + Pro，已拒绝发送。')
    }
    this.rememberProof(request.settings, proof)
    const transcriptDir = join(request.dataRoot, 'transcripts', request.chatId)
    await mkdir(oracleHome, { recursive: true })
    await mkdir(transcriptDir, { recursive: true })
    const outputPath = resolve(transcriptDir, `${request.turnId}.md`)
    const shortId = request.turnId.slice(0, 8)
    const requestedSessionId = request.previousOracleSessionId === undefined
      ? `dsh-pro-chat-${shortId}` : `dsh-pro-turn-${shortId}`
    const argv = request.previousOracleSessionId === undefined
      ? [
          process.execPath, cliPath,
          '--engine', 'browser',
          '--remote-chrome', request.settings.cdpTarget,
          '--browser-tab', proof.targetId,
          '--model', 'gpt-5.6-sol',
          '--browser-model-strategy', 'current',
          '--browser-timeout', '60m',
          '--browser-keep-browser',
          '--browser-archive', 'never',
          '--write-output', outputPath,
          '--slug', requestedSessionId,
          '--no-notify',
          '--wait',
          '--prompt', '-',
        ]
      : [
          process.execPath, cliPath,
          '--followup', request.previousOracleSessionId,
          '--write-output', outputPath,
          '--slug', requestedSessionId,
          '--no-notify',
          '--wait',
          '--prompt', '-',
        ]
    const handle = this.subprocess.spawn({
      argv,
      cwd: request.dataRoot,
      env: {
        ORACLE_HOME_DIR: oracleHome,
        ORACLE_NO_DETACH: '1',
        NO_COLOR: '1',
        OPENAI_API_KEY: undefined,
      },
      stdio: {
        stdin: { data: request.prompt },
        stdout: { maxBytes: OUTPUT_LIMIT },
        stderr: { maxBytes: 256_000 },
      },
      graceMs: 5_000,
      signal: request.signal,
    })
    let handleObservationFailure: unknown
    try {
      request.onHandle?.(handle)
    } catch (reason) {
      handleObservationFailure = reason
    }
    let processSettled = false
    const observationPromise = this.observeSessionWhileRunning(
      handle,
      oracleHome,
      request.onSessionObserved,
      () => processSettled,
    )
    let outcome: Awaited<typeof handle.done> | undefined
    let completionFailure: unknown
    try {
      outcome = await handle.done
    } catch (reason) {
      completionFailure = reason
    } finally {
      processSettled = true
    }
    const observation = await observationPromise.catch((failure): SessionObservation => ({ failure }))
    const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    const parsedSessionId = sessionIdFrom(stdout)
    const finalSessionId = parsedSessionId === undefined ? undefined : this.validSessionId(oracleHome, parsedSessionId)
    const oracleSessionId = observation.oracleSessionId ?? finalSessionId
    const observationFailure = handleObservationFailure ?? observation.failure
      ?? (observation.oracleSessionId !== undefined && finalSessionId !== undefined
        && observation.oracleSessionId !== finalSessionId
        ? new Error('Oracle 会话标识在运行期间发生变化。') : undefined)
    const submission = await this.readSubmissionProjection(
      oracleHome,
      oracleSessionId ?? requestedSessionId,
    ).catch(() => undefined)
    const diagnosticInput = stderr || stdout || (completionFailure instanceof Error ? completionFailure.message : String(completionFailure ?? ''))
    const diagnostic = safeOracleDiagnostic(diagnosticInput)
    if (observationFailure !== undefined) {
      const message = 'Oracle 已返回会话标识，但 Pro Chat 无法持久记录该标识；该轮不会接入本地对话。'
      if (submission?.promptSubmitted === false) throw new OracleBrowserError(message)
      throw new OracleSubmittedUnverifiedError(message, oracleSessionId)
    }
    if (request.signal.aborted) {
      if (submission?.promptSubmitted === false) throw new OracleBrowserCancelledError()
      throw new OracleSubmittedUnverifiedError(
        submission?.promptSubmitted === true
          ? 'Oracle 浏览器控制器已停止，但 ChatGPT prompt 已提交；请勿自动重发。'
          : 'Oracle 浏览器控制器已停止，且无法证明 ChatGPT prompt 尚未提交；请勿自动重发。',
        oracleSessionId,
      )
    }
    if (completionFailure !== undefined || outcome?.exitCode !== 0) {
      if (submission?.promptSubmitted === false) throw new OracleBrowserError(diagnostic)
      throw new OracleSubmittedUnverifiedError(
        submission?.promptSubmitted === true
          ? diagnostic
          : 'Oracle 浏览器桥接失败，且无法证明 prompt 尚未提交；请勿自动重发。',
        oracleSessionId,
      )
    }
    if (oracleSessionId === undefined) {
      if (submission?.promptSubmitted === false) {
        throw new OracleBrowserError('Oracle 回合结束但未返回会话标识，且 metadata 明确显示 prompt 未提交。')
      }
      throw new OracleSubmittedUnverifiedError(
        submission?.promptSubmitted === true
          ? 'Oracle 回合已提交 prompt，但未返回会话标识；该结果不会写入 Pro Chat。'
          : 'Oracle 回合未返回会话标识，且无法证明 prompt 尚未提交；请勿自动重发。',
      )
    }
    let resultProof: OracleSessionProof
    try {
      resultProof = await this.readSessionProof(oracleHome, oracleSessionId)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Oracle 会话元数据验证失败。'
      if (submission?.promptSubmitted === false) throw new OracleBrowserError(message)
      throw new OracleSubmittedUnverifiedError(message, oracleSessionId)
    }
    try {
      assertOracleLineage({
        result: resultProof,
        proofTargetId: proof.targetId,
        cdpTarget: request.settings.cdpTarget,
        ...(parent === undefined ? {} : { parent }),
      })
    } catch (reason) {
      throw new OracleSubmittedUnverifiedError(reason instanceof Error ? reason.message : 'Oracle 会话血缘验证失败。', oracleSessionId)
    }
    let after: SelectionProof
    try {
      after = await this.verifySelection(request.settings, {
        targetId: resultProof.targetId,
        conversationId: resultProof.conversationId,
      })
    } catch {
      throw new OracleSubmittedUnverifiedError(
        'Oracle 已返回结果，但回合结束后的 ChatGPT 标签页复验发生异常；该结果不会写入聊天记录，请勿自动重发。',
        oracleSessionId,
      )
    }
    if (!after.verified) throw new OracleSubmittedUnverifiedError('Oracle 已返回结果，但回合结束后无法在其实际标签页再次验证 GPT-5.6 Sol + Pro；该结果不会写入聊天记录。', oracleSessionId)
    this.rememberProof(request.settings, after)
    let markdown: string
    try {
      markdown = await this.readText(outputPath)
    } catch {
      throw new OracleSubmittedUnverifiedError('Oracle 回合结束，但指定的结果文件不可读。该轮不会写入聊天记录。', oracleSessionId)
    }
    if (!markdown.trim()) throw new OracleSubmittedUnverifiedError('Oracle 回合结束，但指定的结果文件为空。该轮不会写入聊天记录。', oracleSessionId)
    if (markdown.length > 200_000) throw new OracleSubmittedUnverifiedError('Oracle 回复超过 200,000 字符，已保留外部会话血缘但未写入 Pro Chat。', oracleSessionId)
    return { oracleSessionId, markdown, outputPath }
  }

  private async verifySelection(
    settings: ProChatSettings,
    expected?: { targetId?: string; conversationId?: string },
  ): Promise<SelectionProof> {
    const { host, port } = parseCdpTarget(settings.cdpTarget)
    const targets = (await this.browser.list({ host, port }))
      .filter(item => item.type === 'page' && /^https:\/\/chatgpt\.com\/(?:$|c\/)/u.test(item.url))
      .filter(item => expected?.targetId === undefined || item.id === expected.targetId)
      .filter(item => expected?.conversationId === undefined
        || /^https:\/\/chatgpt\.com\/c\/([^/?#]+)/u.exec(item.url)?.[1] === expected.conversationId)
      .reverse()
    if (targets.length === 0) return {
      verified: false,
      reason: expected === undefined
        ? '专用 Chrome 中没有可用的 ChatGPT 标签页。'
        : '未找到与持久 Oracle 会话血缘一致的 ChatGPT 标签页。',
    }
    if (targets.length > 1) return {
      verified: false,
      reason: '找到多个符合条件的 ChatGPT 标签页；请只保留一个明确目标后重试。',
    }
    let firstFailure: SelectionProof | undefined
    for (const target of targets) {
      const client = await this.browser.connect({ host, port, target })
      let menuOpened = false
      try {
        const opened = await client.Runtime.evaluate({ expression: OPEN_SELECTION_EXPRESSION, returnByValue: true })
        const openValue = opened.result.value
        if (openValue === null || typeof openValue !== 'object' || (openValue as Record<string, unknown>).found !== true) {
          firstFailure ??= { verified: false, targetId: target.id, reason: '未找到 ChatGPT 思考强度控件。' }
          continue
        }
        menuOpened = true
        await this.wait(700)
        const evaluated = await client.Runtime.evaluate({ expression: READ_SELECTION_EXPRESSION, returnByValue: true })
        const value = evaluated.result.value
        if (value === null || typeof value !== 'object') {
          firstFailure ??= { verified: false, targetId: target.id, reason: '无法读取 ChatGPT 模型与思考强度状态。' }
          continue
        }
        const record = value as Record<string, unknown>
        const proof: SelectionProof = {
          verified: record.verified === true,
          targetId: target.id,
          ...(typeof record.modelLabel === 'string' ? { modelLabel: record.modelLabel.slice(0, 120) } : {}),
          ...(typeof record.thinkingLabel === 'string' ? { thinkingLabel: record.thinkingLabel.slice(0, 120) } : {}),
          ...(typeof record.reason === 'string' && record.reason ? { reason: record.reason.slice(0, 300) } : {}),
        }
        const currentTarget = (await this.browser.list({ host, port })).find(item => item.id === target.id)
        if (currentTarget?.url !== target.url) {
          firstFailure ??= { verified: false, targetId: target.id, reason: '验证期间 ChatGPT 标签页目标或 URL 发生变化。' }
          continue
        }
        if (proof.verified) return proof
        firstFailure ??= proof
      } catch {
        firstFailure ??= { verified: false, targetId: target.id, reason: 'ChatGPT 标签页未响应模型验证，请保持该页打开并重试。' }
      } finally {
        if (menuOpened) {
          await client.Runtime.evaluate({ expression: CLOSE_SELECTION_EXPRESSION, returnByValue: true }).catch(() => undefined)
        }
        await client.close().catch(() => undefined)
      }
    }
    return firstFailure ?? { verified: false, reason: '未能验证 ChatGPT 模型与思考强度状态。' }
  }

  private async resolveCli(): Promise<{ cliPath: string }> {
    assertNode24()
    if (this.resolveCliOverride !== undefined) return this.resolveCliOverride()
    let packagePath: string
    try {
      packagePath = require.resolve('@steipete/oracle/package.json')
    } catch {
      throw new OracleBrowserError('未安装固定版本的 Oracle 浏览器桥接依赖。请重新安装 dsh-pro-chat。')
    }
    let parsed: OraclePackage
    try {
      parsed = JSON.parse(await this.readText(packagePath)) as OraclePackage
    } catch {
      throw new OracleBrowserError('无法读取 Oracle 浏览器桥接依赖的包信息。')
    }
    if (parsed.version !== ORACLE_VERSION || typeof parsed.bin?.oracle !== 'string') {
      throw new OracleBrowserError(`需要 Oracle ${ORACLE_VERSION}，当前安装版本不兼容。请重新安装 dsh-pro-chat。`)
    }
    return { cliPath: resolve(dirname(packagePath), parsed.bin.oracle) }
  }

  private rememberProof(settings: ProChatSettings, proof: SelectionProof): void {
    if (!proof.verified) return
    this.cachedProof = { cdpTarget: settings.cdpTarget, proof, expiresAt: this.nowMs() + 60_000 }
  }

  private async readSessionProof(oracleHome: string, sessionId: string): Promise<OracleSessionProof> {
    try {
      return parseOracleSessionProof(await this.readText(oracleSessionPath(oracleHome, sessionId)), sessionId)
    } catch (reason) {
      throw new OracleBrowserError(reason instanceof Error ? reason.message : '无法验证 Oracle 会话元数据。')
    }
  }

  private validSessionId(oracleHome: string, sessionId: string): string | undefined {
    try {
      void oracleSessionPath(oracleHome, sessionId)
      return sessionId
    } catch {
      return undefined
    }
  }

  private async readSubmissionProjection(oracleHome: string, sessionId: string): Promise<OracleSubmissionProjection> {
    return parseOracleSubmissionProjection(
      await this.readText(oracleSessionPath(oracleHome, sessionId)),
      sessionId,
    )
  }

  private async observeSessionWhileRunning(
    handle: SubprocessHandle,
    oracleHome: string,
    onObserved: OracleRunRequest['onSessionObserved'],
    isSettled: () => boolean,
  ): Promise<SessionObservation> {
    const reader = handle.collected.stdout
    let offset = 0
    let trailingLine = ''
    while (true) {
      const read = reader?.readFrom(offset)
      if (read?.lossy) trailingLine = ''
      const text = read?.text ?? ''
      const combined = `${trailingLine}${text}`
      const parsed = sessionIdFrom(combined)
      if (typeof read?.nextOffset === 'number') offset = read.nextOffset
      else if (text) offset += Buffer.byteLength(text)
      const lastLineBreak = Math.max(combined.lastIndexOf('\n'), combined.lastIndexOf('\r'))
      trailingLine = (lastLineBreak < 0 ? combined : combined.slice(lastLineBreak + 1)).slice(-512)
      if (parsed !== undefined) {
        const oracleSessionId = this.validSessionId(oracleHome, parsed)
        if (oracleSessionId === undefined) {
          return { failure: new Error('Oracle 在运行期间输出了无效的会话标识。') }
        }
        try {
          await onObserved?.(oracleSessionId)
          return { oracleSessionId }
        } catch (failure) {
          return { oracleSessionId, failure }
        }
      }
      if (isSettled()) return {}
      await this.wait(250)
    }
  }
}
