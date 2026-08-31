import React, { useEffect, useRef, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { TYPERT_REMOTE as proChatRemote } from '../remote-contract.ts'
import type { Handoff, ProChatDetail, ProChatSettings, ProChatSummary, ProTurn, TransportStatus } from '../schema.ts'
import { RefreshSelectionCoordinator } from './refresh-selection.ts'
import styles from './pro-chat.module.css'

export const inject = ['remote', 'slots']

type RemoteResult<T> = { ok: true; value: T } | { ok: false; error: { message: string } }
type RawApi = {
  listChats(): Promise<RemoteResult<ProChatSummary[]>>
  listArchivedChats(): Promise<RemoteResult<ProChatSummary[]>>
  getChat(input: { chatId: string }): Promise<RemoteResult<ProChatDetail>>
  createChat(input: { title?: string }): Promise<RemoteResult<ProChatSummary>>
  renameChat(input: { chatId: string; title: string }): Promise<RemoteResult<ProChatSummary>>
  deleteChat(input: { chatId: string }): Promise<RemoteResult<boolean>>
  restoreChat(input: { chatId: string }): Promise<RemoteResult<ProChatSummary>>
  send(input: { chatId: string; content: string }): Promise<RemoteResult<ProTurn>>
  cancel(input: { chatId: string }): Promise<RemoteResult<ProChatSummary>>
  settings(): Promise<RemoteResult<ProChatSettings>>
  saveSettings(input: { cdpTarget: string }): Promise<RemoteResult<ProChatSettings>>
  transportStatus(): Promise<RemoteResult<TransportStatus>>
  verifyTransport(): Promise<RemoteResult<TransportStatus>>
  exportHandoff(input: { chatId: string }): Promise<RemoteResult<Handoff>>
}
type Api = {
  listChats(): Promise<ProChatSummary[]>
  listArchivedChats(): Promise<ProChatSummary[]>
  getChat(input: { chatId: string }): Promise<ProChatDetail>
  createChat(input: { title?: string }): Promise<ProChatSummary>
  renameChat(input: { chatId: string; title: string }): Promise<ProChatSummary>
  deleteChat(input: { chatId: string }): Promise<boolean>
  restoreChat(input: { chatId: string }): Promise<ProChatSummary>
  send(input: { chatId: string; content: string }): Promise<ProTurn>
  cancel(input: { chatId: string }): Promise<ProChatSummary>
  settings(): Promise<ProChatSettings>
  saveSettings(input: { cdpTarget: string }): Promise<ProChatSettings>
  transportStatus(): Promise<TransportStatus>
  verifyTransport(): Promise<TransportStatus>
  exportHandoff(input: { chatId: string }): Promise<Handoff>
}
type DockProps = { api: Api; inputActions: { setDraft(text: string): void } }

const unwrap = async <T,>(pending: Promise<RemoteResult<T>>): Promise<T> => {
  const result = await pending
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function apiFrom(raw: RawApi): Api {
  return {
    listChats: () => unwrap(raw.listChats()),
    listArchivedChats: () => unwrap(raw.listArchivedChats()),
    getChat: input => unwrap(raw.getChat(input)),
    createChat: input => unwrap(raw.createChat(input)),
    renameChat: input => unwrap(raw.renameChat(input)),
    deleteChat: input => unwrap(raw.deleteChat(input)),
    restoreChat: input => unwrap(raw.restoreChat(input)),
    send: input => unwrap(raw.send(input)),
    cancel: input => unwrap(raw.cancel(input)),
    settings: () => unwrap(raw.settings()),
    saveSettings: input => unwrap(raw.saveSettings(input)),
    transportStatus: () => unwrap(raw.transportStatus()),
    verifyTransport: () => unwrap(raw.verifyTransport()),
    exportHandoff: input => unwrap(raw.exportHandoff(input)),
  }
}

function failure(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function stamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function statusLabel(status: ProChatSummary['status']): string {
  return ({ idle: '就绪', running: 'Pro 思考中', failed: '需处理', cancelled: '已取消' })[status]
}

export function ProChatView({ api, inputActions }: DockProps): React.ReactElement {
  const [chats, setChats] = useState<ProChatSummary[]>([])
  const [archivedChats, setArchivedChats] = useState<ProChatSummary[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [detail, setDetail] = useState<ProChatDetail>()
  const [settings, setSettings] = useState<ProChatSettings>()
  const [cdpTarget, setCdpTarget] = useState('127.0.0.1:9222')
  const [transport, setTransport] = useState<TransportStatus>()
  const [prompt, setPrompt] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState<'handoff' | 'delete'>()
  const selectionRef = useRef(new RefreshSelectionCoordinator())
  const busyRef = useRef(false)
  const workbenchRef = useRef<HTMLDivElement>(null)
  const newChatButtonRef = useRef<HTMLButtonElement>(null)
  const cancelConfirmationRef = useRef<HTMLButtonElement>(null)
  const handoffButtonRef = useRef<HTMLButtonElement>(null)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const confirmationTriggerRef = useRef<HTMLButtonElement | null>(null)

  const selected = detail?.chat
  const running = selected?.status === 'running'
  const continuationBlocked = selected?.divergence !== undefined
  const canSend = Boolean(prompt.trim() && !running && !continuationBlocked && transport?.reachable && transport.oracleInstalled && transport.selectionVerified)

  const refresh = async (preferredId = selectionRef.current.selectedId): Promise<boolean> => {
    const ticket = selectionRef.current.beginRefresh(preferredId)
    let nextChats: ProChatSummary[]
    let nextArchived: ProChatSummary[]
    let nextSettings: ProChatSettings
    let nextTransport: TransportStatus
    let nextId: string | undefined
    let nextDetail: ProChatDetail | undefined
    try {
      [nextChats, nextArchived, nextSettings, nextTransport] = await Promise.all([
        api.listChats(), api.listArchivedChats(), api.settings(), api.transportStatus(),
      ])
      nextId = preferredId !== undefined && nextChats.some(chat => chat.id === preferredId) ? preferredId : nextChats[0]?.id
      nextDetail = nextId === undefined ? undefined : await api.getChat({ chatId: nextId })
    } catch (reason) {
      if (!selectionRef.current.ownsRefresh(ticket)) return false
      throw reason
    }
    if (!selectionRef.current.commitRefresh(ticket, nextId)) return false
    setChats(nextChats)
    setArchivedChats(nextArchived)
    setSettings(nextSettings)
    setCdpTarget(current => current === '127.0.0.1:9222' && nextSettings.cdpTarget !== current ? nextSettings.cdpTarget : current)
    setTransport(nextTransport)
    if (nextId === undefined) {
      setSelectedId(undefined)
      setDetail(undefined)
      return true
    }
    setSelectedId(nextId)
    setDetail(nextDetail!)
    setTitle(nextDetail!.chat.title)
    return true
  }

  useEffect(() => {
    let mounted = true
    const load = (): void => {
      if (busyRef.current) return
      void refresh().then(committed => { if (mounted && committed) setError('') }).catch(reason => { if (mounted) setError(failure(reason)) })
    }
    load()
    const timer = setInterval(load, 5_000)
    return () => { mounted = false; clearInterval(timer) }
  }, [api])

  useEffect(() => {
    if (confirmation !== undefined) cancelConfirmationRef.current?.focus()
  }, [confirmation])

  useEffect(() => {
    const workbench = workbenchRef.current
    if (confirmation !== undefined) workbench?.setAttribute('inert', '')
    else workbench?.removeAttribute('inert')
    return () => workbench?.removeAttribute('inert')
  }, [confirmation])

  useEffect(() => { setConfirmation(undefined) }, [selectedId])

  const run = (name: string, task: () => Promise<void>, onSettled?: () => void): void => {
    if (busyRef.current) return
    // Every foreground action owns the visible result/error surface. This makes
    // any five-second refresh that started earlier inert, even for actions that
    // do not change the selected chat (probe, settings, handoff, or cancel).
    selectionRef.current.beginMutation()
    busyRef.current = true
    setBusy(name)
    setError('')
    setNotice('')
    void task().catch(reason => setError(failure(reason))).finally(() => {
      busyRef.current = false
      setBusy('')
      if (onSettled !== undefined) window.setTimeout(onSettled, 0)
    })
  }

  const create = (): void => run('create', async () => {
    const epoch = selectionRef.current.beginMutation()
    const chat = await api.createChat({})
    const nextDetail = await api.getChat({ chatId: chat.id })
    if (!selectionRef.current.commitMutation(epoch, chat.id)) return
    setChats(current => [chat, ...current.filter(item => item.id !== chat.id)])
    setSelectedId(chat.id)
    setDetail(nextDetail)
    setTitle(chat.title)
    setNotice('已创建持久化 Pro 对话。')
  })

  const send = (): void => run('send', async () => {
    const epoch = selectionRef.current.beginMutation()
    const content = prompt.trim()
    if (!content) return
    let chatId = selectionRef.current.selectedId
    if (chatId === undefined) {
      const chat = await api.createChat({})
      chatId = chat.id
      const nextDetail = await api.getChat({ chatId })
      if (!selectionRef.current.commitMutation(epoch, chatId)) return
      setChats(current => [chat, ...current.filter(item => item.id !== chat.id)])
      setSelectedId(chatId)
      setDetail(nextDetail)
      setTitle(nextDetail.chat.title)
    }
    await api.send({ chatId, content })
    setPrompt('')
    setNotice('已交给 ChatGPT 网页 UI。Pro 推理可能需要较长时间；请勿关闭专用 Chrome。')
    if (selectionRef.current.selectedId === chatId) await refresh(chatId)
  })

  const choose = (id: string): void => run('load', async () => {
    const epoch = selectionRef.current.beginMutation()
    const next = await api.getChat({ chatId: id })
    if (!selectionRef.current.commitMutation(epoch, id)) return
    setSelectedId(id)
    setDetail(next)
    setTitle(next.chat.title)
  })

  const saveTitle = (): void => {
    if (selected === undefined || !title.trim() || title.trim() === selected.title) return
    run('title', async () => {
      const epoch = selectionRef.current.beginMutation()
      const updated = await api.renameChat({ chatId: selected.id, title: title.trim() })
      if (!selectionRef.current.commitMutation(epoch, selected.id)) return
      setTitle(updated.title)
      await refresh(selected.id)
    })
  }

  const handoff = (): void => {
    if (selected === undefined) return
    confirmationTriggerRef.current = handoffButtonRef.current
    setConfirmation('handoff')
  }

  const closeConfirmation = (restoreFocus = true): void => {
    const trigger = confirmationTriggerRef.current
    setConfirmation(undefined)
    if (restoreFocus) window.setTimeout(() => trigger?.focus(), 0)
  }

  const confirmHandoff = (): void => {
    if (selected === undefined) return
    closeConfirmation(false)
    run('handoff', async () => {
      const exported = await api.exportHandoff({ chatId: selected.id })
      inputActions.setDraft(exported.text)
      setNotice(`已将 ${exported.messageCount} 条完整消息导入当前 DSH 草稿。请审阅后手动发送以继续工作。`)
    }, () => handoffButtonRef.current?.focus())
  }

  const remove = (): void => {
    if (selected === undefined || running) return
    confirmationTriggerRef.current = deleteButtonRef.current
    setConfirmation('delete')
  }

  const confirmRemove = (): void => {
    if (selected === undefined || running) return
    let removed = false
    closeConfirmation(false)
    run('delete', async () => {
      const epoch = selectionRef.current.beginMutation()
      await api.deleteChat({ chatId: selected.id })
      if (!selectionRef.current.commitMutation(epoch, undefined)) return
      removed = true
      setSelectedId(undefined)
      setDetail(undefined)
      setNotice('已将本地 Pro Chat 记录、转录和 Oracle 会话移入可恢复回收区。ChatGPT 网页上的会话不会被删除。')
      await refresh()
    }, () => (removed ? newChatButtonRef.current : deleteButtonRef.current)?.focus())
  }

  const restore = (chatId: string): void => run('restore', async () => {
    const epoch = selectionRef.current.beginMutation()
    const restored = await api.restoreChat({ chatId })
    const nextDetail = await api.getChat({ chatId: restored.id })
    if (!selectionRef.current.commitMutation(epoch, restored.id)) return
    setSelectedId(restored.id)
    setDetail(nextDetail)
    setTitle(nextDetail.chat.title)
    setNotice('已从本机回收区恢复 Pro Chat 及其精确关联的本地资产。')
    await refresh(restored.id)
  })

  const transportReady = Boolean(transport?.reachable && transport.oracleInstalled && transport.selectionVerified)
  const statusClass = transportReady ? styles.connected : styles.disconnected

  return <section className={styles.dock} aria-label="ChatGPT Pro 工作台" aria-busy={Boolean(busy)}>
    <div ref={workbenchRef} className={styles.workbench} aria-hidden={confirmation !== undefined ? 'true' : undefined}>
      <aside className={styles.library} aria-label="持久化 Pro 对话列表">
        <div className={styles.libraryHead}><span>ARCHIVE</span><button ref={newChatButtonRef} type="button" className={styles.ghost} onClick={create} disabled={Boolean(busy)}>新建</button></div><small className={styles.archiveCount}>{chats.length} 个持久化对话</small>
        <div className={styles.chatList}>
          {chats.length === 0 && <p className={styles.emptyList}>还没有对话。创建后，消息和回复会保留在本机 DSH 数据域中。</p>}
          {chats.map(chat => <button key={chat.id} type="button" disabled={Boolean(busy)} className={`${styles.chatRow} ${chat.id === selectedId ? styles.selected : ''}`} onClick={() => choose(chat.id)} aria-current={chat.id === selectedId ? 'true' : undefined}>
            <span>{chat.title}</span><small>{statusLabel(chat.status)} · {stamp(chat.updatedAt)}</small>
          </button>)}
        </div>
        <details className={styles.trash}>
          <summary>本机回收区 · {archivedChats.length}</summary>
          {archivedChats.length === 0
            ? <p>回收区为空。默认不会自动永久清理。</p>
            : <div>{archivedChats.map(chat => <div key={chat.id} className={styles.trashRow}><span>{chat.title}</span><button type="button" className={styles.ghost} disabled={Boolean(busy)} onClick={() => restore(chat.id)}>恢复</button></div>)}</div>}
          <p>仅恢复或保留本机数据；不会修改 ChatGPT 网页对话。旧版未记录血缘的 Oracle 残留不会按目录名猜测处理。</p>
        </details>
        <details className={styles.setup}>
          <summary>连接专用 Chrome</summary>
          <p>CDP 仅允许本机回环地址。不要暴露端口、复制 Cookie 或使用日常浏览器配置文件。</p>
          <label>CDP 地址<input value={cdpTarget} inputMode="text" spellCheck={false} onChange={event => setCdpTarget(event.currentTarget.value)} /></label>
          <div className={styles.setupActions}><button type="button" className={styles.ghost} disabled={Boolean(busy)} onClick={() => run('settings', async () => { const saved = await api.saveSettings({ cdpTarget: cdpTarget.trim() }); setSettings(saved); setNotice('已保存本机 CDP 地址。') })}>保存地址</button><button type="button" className={styles.ghost} disabled={Boolean(busy)} onClick={() => run('probe', async () => { setTransport(await api.verifyTransport()); setNotice('已主动验证本机 Chrome 的模型与思考档位；未发送模型请求。') })}>检查连接</button></div>
          <code className={styles.command}>chrome.exe --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir=&quot;%LOCALAPPDATA%\DSH\ChromePro&quot; https://chatgpt.com/</code>
          <p>在这个专用 Chrome 中手动登录 ChatGPT Pro；插件从不读取或存储 Cookie、OAuth token 或会话凭据。</p>
        </details>
      </aside>

      <main className={styles.editor}>
        <div className={styles.editorHead}>
          <div><p>WEB-SIGNED SESSION</p>{selected ? <input className={styles.title} value={title} maxLength={120} onChange={event => setTitle(event.currentTarget.value)} onBlur={saveTitle} aria-label="对话名称" /> : <h2>开始一个 Pro 对话</h2>}</div>
          {selected && <div className={styles.editorActions}><span className={`${styles.turnState} ${styles[`state${selected.status}`]}`}>{statusLabel(selected.status)}</span><button ref={handoffButtonRef} type="button" className={styles.handoff} disabled={Boolean(busy) || selected.lastSeq === 0} onClick={handoff}>导入 DSH 草稿</button>{running && <button type="button" className={styles.cancel} disabled={Boolean(busy)} onClick={() => run('cancel', async () => { await api.cancel({ chatId: selected.id }); setNotice('已请求停止 Oracle 浏览器控制器；系统会按网页提示词是否已提交决定“取消”或“需人工核对”。'); await refresh() })}>取消</button>}<button ref={deleteButtonRef} type="button" className={styles.delete} disabled={Boolean(busy) || running} onClick={remove}>移至本机回收区</button></div>}
        </div>
        {transport && <p className={`${styles.transportNote} ${statusClass}`} data-ready={transportReady ? 'true' : 'false'}>{transport.message}{transport.modelLabel ? ` · ${transport.modelLabel}` : ''}{transport.thinkingLabel ? ` · ${transport.thinkingLabel}` : ''}{transport.browser ? ` · ${transport.browser}` : ''}</p>}
        {(error || notice) && <p className={error ? styles.error : styles.notice} role={error ? 'alert' : 'status'}>{error || notice}</p>}
        {selected?.lastError && <p className={styles.error} role={selected.divergence ? 'alert' : 'status'}>{selected.lastError}{selected.divergence ? ' 继续发送已在 Host 端锁定；请人工检查 ChatGPT 网页，或新建独立 Pro 对话。' : ''}</p>}
        <div className={styles.transcript} aria-live="polite">
          {detail?.messages.length === 0 && <div className={styles.emptyTranscript}><strong>从真实 ChatGPT Pro 开始</strong><p>首次发送时，Oracle 会在网页中选择 GPT-5.6 Sol，并验证 Pro 思考档位；任一步无法验证都会失败，不会静默降档。</p></div>}
          {detail?.messages.map(message => <article key={message.id} className={`${styles.message} ${message.role === 'user' ? styles.user : styles.assistant}`}><header><span>{message.role === 'user' ? '你' : 'ChatGPT Pro'}</span><time dateTime={message.createdAt}>{stamp(message.createdAt)}</time></header><pre>{message.content}</pre></article>)}
          {selected?.status === 'running' && <div className={styles.running}><i /><span>ChatGPT 正在进行 Pro 推理。可切换回“对话”标签；此对话会持续保存状态。</span></div>}
        </div>
        <form className={styles.composer} onSubmit={event => { event.preventDefault(); send() }}>
          <label htmlFor="pro-chat-prompt">发送到 ChatGPT Pro</label>
          <textarea id="pro-chat-prompt" value={prompt} maxLength={60_000} placeholder={continuationBlocked ? '该对话已锁定续发，避免重复提交。请人工核对网页或新建独立 Pro 对话。' : '写下要交给 ChatGPT Pro 的任务；提示词只通过本机子进程 stdin 传递。'} onChange={event => setPrompt(event.currentTarget.value)} disabled={running || continuationBlocked || Boolean(busy)} />
          <div><span>{continuationBlocked ? '网页会话可能已推进；本地未闭合前不会自动重发。' : '不会使用 OpenAI API Key；这会驱动你已登录的专用 ChatGPT 网页会话。'}</span><button type="submit" className={styles.send} disabled={!canSend || Boolean(busy)}>{running ? 'Pro 思考中…' : continuationBlocked ? '已锁定续发' : '发送到 Pro'}</button></div>
        </form>
      </main>
    </div>
    {confirmation !== undefined && <div className={styles.confirmationBackdrop}><div className={styles.confirmation} role="alertdialog" aria-modal="true" aria-labelledby="pro-chat-confirm-title" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); closeConfirmation(); return }
      if (event.key !== 'Tab') return
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      if (buttons.length === 0) return
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.shiftKey ? (index <= 0 ? buttons.length - 1 : index - 1) : (index + 1) % buttons.length
      event.preventDefault()
      buttons[next]?.focus()
    }}>
      <strong id="pro-chat-confirm-title">{confirmation === 'handoff' ? '确认替换当前 DSH 草稿' : '确认移至本机回收区'}</strong>
      <p>{confirmation === 'handoff'
        ? '将用完整 Pro Chat 上下文替换当前草稿，但不会自动发送。请先保存草稿中尚未提交的内容。'
        : '本机索引、转录，以及按对话隔离或有精确会话血缘记录的 Oracle 本地资产会移入可恢复回收区；ChatGPT 网页对话不会删除。'}</p>
      <div><button ref={cancelConfirmationRef} type="button" className={styles.ghost} onClick={() => closeConfirmation()}>取消</button><button type="button" className={confirmation === 'handoff' ? styles.handoff : styles.delete} onClick={confirmation === 'handoff' ? confirmHandoff : confirmRemove}>{confirmation === 'handoff' ? '替换草稿' : '移至回收区'}</button></div>
    </div></div>}
  </section>
}

type ViewSlotRuntime = {
  inject(name: 'conversation.view', factory: () => () => void): void
  register(options: { name: 'conversation.view'; id: string; order: number; label: string; inject: () => { api: Api } }, component: typeof ProChatView): () => void
}

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(proChatRemote)
  const remote = ctx.get('remote.proChat') as RawApi | undefined
  if (remote === undefined) {
    await disposeRemote()
    throw new Error('Pro Chat Remote namespace did not mount')
  }
  const api = apiFrom(remote)
  const views = ctx.slots as unknown as ViewSlotRuntime
  views.inject('conversation.view', () => views.register({ name: 'conversation.view', id: 'pro-chat', order: 20, label: 'Pro Chat', inject: () => ({ api }) }, ProChatView))
  return disposeRemote
}
