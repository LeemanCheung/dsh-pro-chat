import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { ChatIdSchema, OracleSessionIdSchema, ProChatMessageSchema, TurnIdSchema, type ProChatMessage } from './schema.ts'

const PendingFinalizationSchema = z.object({
  version: z.literal(1),
  turnId: TurnIdSchema,
  chatId: ChatIdSchema,
  oracleSessionId: OracleSessionIdSchema,
  response: ProChatMessageSchema,
}).strict().superRefine((value, ctx) => {
  if (value.response.chatId !== value.chatId) ctx.addIssue({ code: 'custom', path: ['response', 'chatId'], message: 'Pending response chatId does not match its journal.' })
  if (value.response.turnId !== value.turnId) ctx.addIssue({ code: 'custom', path: ['response', 'turnId'], message: 'Pending response turnId does not match its journal.' })
  if (value.response.role !== 'assistant') ctx.addIssue({ code: 'custom', path: ['response', 'role'], message: 'Pending response must be an assistant message.' })
  if (value.response.oracleSessionId !== value.oracleSessionId) ctx.addIssue({ code: 'custom', path: ['response', 'oracleSessionId'], message: 'Pending response Oracle session does not match its journal.' })
})

export type PendingFinalization = {
  version: 1
  turnId: string
  chatId: string
  oracleSessionId: string
  response: ProChatMessage
}

export type PendingFinalizationScan =
  | { ok: true; value: PendingFinalization }
  | { ok: false; turnId: string }

function pathFor(root: string, turnId: string, suffix = '.json'): string {
  const parsed = TurnIdSchema.parse(turnId)
  const pending = resolve(root, 'pending-finalizations')
  const target = resolve(pending, `${parsed}${suffix}`)
  const rel = relative(pending, target)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) {
    throw new Error('Pro Chat finalization sidecar path escaped its root.')
  }
  return target
}

export async function writePendingFinalization(root: string, value: PendingFinalization): Promise<void> {
  const parsed = PendingFinalizationSchema.parse(value)
  const finalPath = pathFor(root, parsed.turnId)
  const tempPath = pathFor(root, parsed.turnId, '.tmp')
  await mkdir(resolve(root, 'pending-finalizations'), { recursive: true })
  await writeFile(tempPath, JSON.stringify(parsed), 'utf8')
  await rename(tempPath, finalPath)
}

export async function readPendingFinalization(root: string, turnId: string): Promise<PendingFinalization | undefined> {
  try {
    const expectedTurnId = TurnIdSchema.parse(turnId)
    const parsed = PendingFinalizationSchema.parse(JSON.parse(await readFile(pathFor(root, expectedTurnId), 'utf8')))
    if (parsed.turnId !== expectedTurnId) throw new Error('Pending finalization filename does not match its body turnId.')
    return parsed
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw reason
  }
}

export async function listPendingFinalizations(root: string): Promise<PendingFinalizationScan[]> {
  const directory = resolve(root, 'pending-finalizations')
  const names = await readdir(directory).catch((reason: NodeJS.ErrnoException) => {
    if (reason.code === 'ENOENT') return []
    throw reason
  })
  const values: PendingFinalizationScan[] = []
  for (const name of names.sort()) {
    const match = /^([0-9a-f-]{36})\.json$/iu.exec(name)
    if (match?.[1] === undefined) continue
    try {
      const value = await readPendingFinalization(root, match[1])
      if (value !== undefined) values.push({ ok: true, value })
    } catch {
      // Keep the corrupt file in place for manual inspection. Its UUID filename is
      // sufficient for hydrate to lock the related turn without persisting raw data.
      values.push({ ok: false, turnId: match[1] })
    }
  }
  return values
}

export async function clearPendingFinalization(root: string, turnId: string): Promise<void> {
  await rm(pathFor(root, turnId), { force: true })
  await rm(pathFor(root, turnId, '.tmp'), { force: true })
}
