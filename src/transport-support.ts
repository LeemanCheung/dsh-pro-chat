import { relative, resolve, sep } from 'node:path'

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u
const TARGET_ID = /^[A-Fa-f0-9]{8,128}$/u
const CONVERSATION_ID = /^[A-Za-z0-9-]{1,160}$/u
const CHATGPT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com'])

export type OracleSessionProof = {
  id: string
  model: 'gpt-5.6-sol'
  targetId: string
  conversationId: string
  tabUrl: string
  remoteChrome: { host: string; port: number }
  keepBrowser: boolean
  promptSubmitted: true
  followupSessionId?: string
}

export type OracleSubmissionProjection = {
  id: string
  promptSubmitted?: boolean
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

function field(container: unknown, key: string): unknown {
  return record(container)?.[key]
}

function canonicalJson(value: Record<string, unknown>): string {
  const normalize = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(normalize)
    const currentRecord = record(current)
    if (currentRecord === undefined) return current
    return Object.fromEntries(Object.keys(currentRecord).sort().map(key => [key, normalize(currentRecord[key])]))
  }
  return JSON.stringify(normalize(value))
}

function optionalRecord(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  const parsed = record(value)
  if (parsed === undefined) throw new Error(`${label} 不是有效对象。`)
  return parsed
}

type ConversationUrl = { id: string; url: string; canonical: string }

function parseConversationUrl(value: unknown): ConversationUrl | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  const conversationId = /\/c\/([A-Za-z0-9-]+)(?=\/|$)/u.exec(url.pathname)?.[1]
  if (url.protocol !== 'https:' || url.port || !CHATGPT_HOSTS.has(url.hostname)
    || conversationId === undefined || !CONVERSATION_ID.test(conversationId)) {
    return undefined
  }
  return {
    id: conversationId,
    url: value,
    canonical: `${url.origin}${url.pathname.replace(/\/+$/u, '')}`,
  }
}

function buildConversationUrl(conversationId: string, browserConfig: Record<string, unknown> | undefined): ConversationUrl {
  const configuredBase = field(browserConfig, 'url')
  const base = typeof configuredBase === 'string' ? configuredBase : 'https://chatgpt.com/'
  let url: URL
  try {
    url = new URL(base)
  } catch {
    throw new Error('Oracle 会话的 ChatGPT 基础 URL 无效。')
  }
  const root = url.pathname.replace(/\/+$/u, '')
  const built = parseConversationUrl(`${url.origin}${root === '/' ? '' : root}/c/${conversationId}`)
  if (built === undefined) throw new Error('Oracle 会话无法重建安全的 ChatGPT 对话 URL。')
  return built
}

export function safeOracleDiagnostic(text: string): string {
  const normalized = text.replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '').toLowerCase()
  if (/cancel(?:led)?|aborted/u.test(normalized)) return 'Oracle 浏览器控制器已取消。'
  if (/timed?\s*out|timeout|超时/u.test(normalized)) return 'Oracle 浏览器桥接超时；未把该轮结果写入 Pro Chat。'
  if (/no .*chatgpt.*tab|没有.*chatgpt.*标签页|no available .*tab/u.test(normalized)) {
    return '专用 Chrome 中没有可用的 ChatGPT 对话标签页。'
  }
  if (/gpt-?5\.6|\bpro\b|reasoning|thinking|model picker|selection|思考强度/u.test(normalized)) {
    return 'Oracle 无法确认 GPT-5.6 Sol + Pro；未把该轮结果写入 Pro Chat。'
  }
  if (/chrome|devtools|\bcdp\b|browser|浏览器/u.test(normalized)) {
    return 'Oracle 无法连接或控制专用 Chrome；未把该轮结果写入 Pro Chat。'
  }
  return 'Oracle 浏览器桥接失败；详细诊断未写入 Pro Chat 数据。'
}

export function assertNode24(version = process.versions.node): void {
  const major = Number(version.split('.')[0])
  if (!Number.isInteger(major) || major < 24) {
    throw new Error(`dsh-pro-chat 需要 Node.js 24 或更高版本；当前为 ${version}。`)
  }
}

export function oracleSessionPath(oracleHome: string, sessionId: string): string {
  if (!SESSION_ID.test(sessionId)) throw new Error('Oracle 会话标识格式无效。')
  const root = resolve(oracleHome, 'sessions')
  const candidate = resolve(root, sessionId, 'meta.json')
  const rel = relative(root, candidate)
  if (rel.startsWith(`..${sep}`) || rel === '..' || rel === '' || rel.startsWith(sep)) {
    throw new Error('Oracle 会话路径越界。')
  }
  return candidate
}

export function parseOracleSubmissionProjection(raw: string, expectedId?: string): OracleSubmissionProjection {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Oracle 会话元数据不是有效 JSON。')
  }
  const root = record(parsed)
  const id = root?.id
  if (typeof id !== 'string' || !SESSION_ID.test(id) || (expectedId !== undefined && id !== expectedId)) {
    throw new Error('Oracle 会话元数据标识不匹配。')
  }
  const promptSubmitted = field(field(root?.browser, 'runtime'), 'promptSubmitted')
  if (promptSubmitted !== undefined && typeof promptSubmitted !== 'boolean') {
    throw new Error('Oracle 会话的 promptSubmitted 投影无效。')
  }
  return { id, ...(promptSubmitted === undefined ? {} : { promptSubmitted }) }
}

export function parseOracleSessionProof(raw: string, expectedId?: string): OracleSessionProof {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Oracle 会话元数据不是有效 JSON。')
  }
  const root = record(parsed)
  const id = root?.id
  const mode = root?.mode
  const status = root?.status
  const browser = root?.browser
  const runtime = field(browser, 'runtime')
  const browserConfig = optionalRecord(field(browser, 'config'), 'Oracle browser.config')
  const options = root?.options
  const rootModel = root?.model
  const optionsModel = field(options, 'model')
  if (rootModel !== undefined && optionsModel !== undefined && rootModel !== optionsModel) {
    throw new Error('Oracle 会话的两份 model 不一致。')
  }
  const model = optionsModel ?? rootModel
  const optionsConfig = optionalRecord(field(options, 'browserConfig'), 'Oracle options.browserConfig')
  if (browserConfig !== undefined && optionsConfig !== undefined
    && canonicalJson(browserConfig) !== canonicalJson(optionsConfig)) {
    throw new Error('Oracle 会话的两份 browserConfig 不一致。')
  }
  const config = optionsConfig ?? browserConfig
  if (config === undefined) throw new Error('Oracle 会话缺少浏览器配置。')
  const targetId = field(runtime, 'chromeTargetId')
  const conversationId = field(runtime, 'conversationId')
  const promptSubmitted = field(runtime, 'promptSubmitted')
  const runtimeHost = field(runtime, 'chromeHost')
  const runtimePort = field(runtime, 'chromePort')
  const runtimeUrl = parseConversationUrl(field(runtime, 'tabUrl'))
  const harvestUrl = parseConversationUrl(field(field(browser, 'harvest'), 'url'))
  if (runtimeUrl !== undefined && harvestUrl !== undefined && runtimeUrl.canonical !== harvestUrl.canonical) {
    throw new Error('Oracle 会话的 harvest URL 与 runtime URL 不一致。')
  }
  const remoteChrome = field(config, 'remoteChrome')
  const keepBrowser = field(config, 'keepBrowser')
  const host = field(remoteChrome, 'host')
  const port = field(remoteChrome, 'port')
  const followupSessionId = field(options, 'followupSessionId')
  if (typeof id !== 'string' || !SESSION_ID.test(id) || (expectedId !== undefined && id !== expectedId)) {
    throw new Error('Oracle 会话元数据标识不匹配。')
  }
  if (status !== 'completed' || mode !== 'browser' || model !== 'gpt-5.6-sol') {
    throw new Error('Oracle 会话不是已完成的 GPT-5.6 Sol 浏览器会话。')
  }
  if (promptSubmitted !== true) throw new Error('Oracle 会话没有已提交 prompt 的可信证明。')
  if (typeof targetId !== 'string' || !TARGET_ID.test(targetId)) throw new Error('Oracle 会话缺少可信 Chrome target。')
  if (typeof conversationId !== 'string' || !CONVERSATION_ID.test(conversationId)) throw new Error('Oracle 会话缺少可信 ChatGPT conversation。')
  const resumeUrl = harvestUrl ?? runtimeUrl ?? buildConversationUrl(conversationId, config)
  if (resumeUrl.id !== conversationId) throw new Error('Oracle 会话未绑定到预期 ChatGPT 对话 URL。')
  if ((host !== '127.0.0.1' && host !== 'localhost') || typeof port !== 'number'
    || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Oracle 会话没有可信 loopback Chrome 配置。')
  }
  if ((runtimeHost !== undefined || runtimePort !== undefined)
    && (runtimeHost !== host || runtimePort !== port)) {
    throw new Error('Oracle 会话的 runtime Chrome 与 effective browserConfig 不一致。')
  }
  if (keepBrowser !== true) throw new Error('Oracle 会话未启用可复验的 keepBrowser 契约。')
  if (followupSessionId !== undefined && (typeof followupSessionId !== 'string' || !SESSION_ID.test(followupSessionId))) {
    throw new Error('Oracle follow-up 父会话标识无效。')
  }
  return {
    id,
    model,
    targetId,
    conversationId,
    tabUrl: resumeUrl.url,
    remoteChrome: { host, port },
    keepBrowser,
    promptSubmitted,
    ...(followupSessionId === undefined ? {} : { followupSessionId }),
  }
}

function normalizedCdpTarget(target: string): string {
  return target.replace(/^localhost:/u, '127.0.0.1:')
}

export function assertOracleParent(parent: OracleSessionProof, cdpTarget: string): void {
  const parentCdp = `${parent.remoteChrome.host}:${parent.remoteChrome.port}`
  if (normalizedCdpTarget(parentCdp) !== normalizedCdpTarget(cdpTarget)) {
    throw new Error('Oracle 父会话来自不同 Chrome 端点。')
  }
  if (!parent.keepBrowser) throw new Error('旧 Oracle 会话没有可复验的 keepBrowser 契约。')
}

export function assertOracleLineage(input: {
  result: OracleSessionProof
  proofTargetId: string
  cdpTarget: string
  parent?: OracleSessionProof
}): void {
  const { result, proofTargetId, cdpTarget, parent } = input
  if (parent === undefined && result.targetId !== proofTargetId) {
    throw new Error('Oracle 初始回合使用的 ChatGPT 标签页与发送前验证目标不一致。')
  }
  const actualCdp = `${result.remoteChrome.host}:${result.remoteChrome.port}`
  if (normalizedCdpTarget(actualCdp) !== normalizedCdpTarget(cdpTarget)) {
    throw new Error('Oracle 使用的 Chrome 端点与 Pro Chat 设置不一致。')
  }
  if (parent === undefined) {
    if (result.followupSessionId !== undefined) throw new Error('初始 Oracle 回合意外声明了 follow-up 父会话。')
    return
  }
  if (!parent.keepBrowser || !result.keepBrowser) throw new Error('Oracle follow-up 缺少可复验的 keepBrowser 契约。')
  if (result.followupSessionId !== parent.id) throw new Error('Oracle follow-up 没有绑定预期父会话。')
  if (result.conversationId !== parent.conversationId) throw new Error('Oracle follow-up 切换了 ChatGPT 对话。')
  assertOracleParent(parent, cdpTarget)
}

export class ExclusiveBrowserLease {
  private occupied = false

  get busy(): boolean {
    return this.occupied
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.occupied) throw new Error('已有一个 Pro Chat 浏览器操作正在进行。')
    this.occupied = true
    try {
      return await task()
    } finally {
      this.occupied = false
    }
  }
}
