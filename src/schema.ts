import { z } from 'zod'

export const ChatIdSchema = z.string().uuid()
export const TurnIdSchema = z.string().uuid()
export const OracleSessionIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u)
export const IsoTimeSchema = z.string().datetime()
export const CdpTargetSchema = z.string().trim().regex(/^(?:127\.0\.0\.1|localhost):(?:[1-9]\d{0,4})$/, 'CDP 地址只能是 localhost:端口或 127.0.0.1:端口。').superRefine((value, ctx) => {
  const port = Number(value.slice(value.lastIndexOf(':') + 1))
  if (!Number.isInteger(port) || port > 65_535) ctx.addIssue({ code: 'custom', message: 'CDP 端口必须在 1–65535 之间。' })
})

export const ChatStatusSchema = z.enum(['idle', 'running', 'failed', 'cancelled'])
export const TurnStateSchema = z.enum(['preparing', 'queued', 'running', 'finalizing', 'succeeded', 'failed', 'cancelled', 'interrupted', 'external-diverged'])
export const MessageRoleSchema = z.enum(['user', 'assistant'])
export const OracleScopeSchema = z.enum(['legacy-global', 'chat-scoped'])
export type OracleScope = z.infer<typeof OracleScopeSchema>
export const QuarantineArtifactSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('transcript'), presentAtArchive: z.boolean() }).strict(),
  z.object({ kind: z.literal('oracle-chat'), presentAtArchive: z.boolean() }).strict(),
  z.object({ kind: z.literal('oracle-session'), sessionId: OracleSessionIdSchema, presentAtArchive: z.boolean() }).strict(),
])
export type QuarantineArtifact = z.infer<typeof QuarantineArtifactSchema>
export const ProChatQuarantineSchema = z.object({
  opId: z.string().uuid(),
  phase: z.enum(['trash-pending', 'quarantined', 'restore-pending']),
  archivedAt: IsoTimeSchema,
  previousStatus: ChatStatusSchema,
  oracleScope: OracleScopeSchema,
  exactOracleSessionIds: z.array(OracleSessionIdSchema),
  // Older recovery-only records may not have the inventory. New tombstones always do;
  // restore fails closed when it is missing instead of guessing whether data was lost.
  artifacts: z.array(QuarantineArtifactSchema).optional(),
  lastError: z.string().trim().min(1).max(500).optional(),
}).strict()

export const ProChatDivergenceSchema = z.object({
  turnId: TurnIdSchema,
  at: IsoTimeSchema,
  oracleSessionId: OracleSessionIdSchema.optional(),
  reason: z.string().trim().min(1).max(500),
}).strict()
export type ProChatDivergence = z.infer<typeof ProChatDivergenceSchema>

export const ProChatSchema = z.object({
  id: ChatIdSchema,
  title: z.string().trim().min(1).max(120),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
  status: ChatStatusSchema,
  lastSeq: z.number().int().nonnegative(),
  oracleScope: OracleScopeSchema.optional(),
  latestOracleSessionId: OracleSessionIdSchema.optional(),
  currentTurnId: TurnIdSchema.optional(),
  lastError: z.string().trim().min(1).max(1_500).optional(),
  divergence: ProChatDivergenceSchema.optional(),
  quarantine: ProChatQuarantineSchema.optional(),
}).strict()
export type ProChat = z.infer<typeof ProChatSchema>

export const ProChatMessageSchema = z.object({
  id: z.string().uuid(),
  chatId: ChatIdSchema,
  seq: z.number().int().positive(),
  role: MessageRoleSchema,
  content: z.string().min(1).max(200_000),
  createdAt: IsoTimeSchema,
  turnId: TurnIdSchema.optional(),
  oracleSessionId: OracleSessionIdSchema.optional(),
}).strict()
export type ProChatMessage = z.infer<typeof ProChatMessageSchema>

export const TurnPreparationSchema = z.object({
  promptSeq: z.number().int().positive(),
  previousChat: z.object({
    title: z.string().trim().min(1).max(120),
    status: ChatStatusSchema,
    lastSeq: z.number().int().nonnegative(),
    updatedAt: IsoTimeSchema,
    latestOracleSessionId: OracleSessionIdSchema.optional(),
    currentTurnId: TurnIdSchema.optional(),
    lastError: z.string().trim().min(1).max(1_500).optional(),
    divergence: ProChatDivergenceSchema.optional(),
  }).strict(),
}).strict()

export const TurnFinalizationSchema = z.object({ response: ProChatMessageSchema }).strict()

export const ProTurnSchema = z.object({
  id: TurnIdSchema,
  chatId: ChatIdSchema,
  promptMessageId: z.string().uuid(),
  state: TurnStateSchema,
  createdAt: IsoTimeSchema,
  startedAt: IsoTimeSchema.optional(),
  finishedAt: IsoTimeSchema.optional(),
  resultMessageId: z.string().uuid().optional(),
  oracleSessionId: OracleSessionIdSchema.optional(),
  error: z.string().trim().min(1).max(1_500).optional(),
  preparation: TurnPreparationSchema.optional(),
  finalization: TurnFinalizationSchema.optional(),
}).strict().superRefine((value, ctx) => {
  const response = value.finalization?.response
  if (value.state === 'finalizing' && value.finalization === undefined) {
    ctx.addIssue({ code: 'custom', path: ['finalization'], message: 'FINALIZING turn requires a response journal.' })
  }
  if (value.state === 'finalizing' && value.oracleSessionId === undefined) {
    ctx.addIssue({ code: 'custom', path: ['oracleSessionId'], message: 'FINALIZING turn requires an Oracle session.' })
  }
  if (response === undefined) return
  if (response.chatId !== value.chatId) ctx.addIssue({ code: 'custom', path: ['finalization', 'response', 'chatId'], message: 'Finalizing response chatId does not match its turn.' })
  if (response.turnId !== value.id) ctx.addIssue({ code: 'custom', path: ['finalization', 'response', 'turnId'], message: 'Finalizing response turnId does not match its turn.' })
  if (response.role !== 'assistant') ctx.addIssue({ code: 'custom', path: ['finalization', 'response', 'role'], message: 'Finalizing response must be an assistant message.' })
  if (value.oracleSessionId === undefined || response.oracleSessionId !== value.oracleSessionId) {
    ctx.addIssue({ code: 'custom', path: ['finalization', 'response', 'oracleSessionId'], message: 'Finalizing response Oracle session does not match its turn.' })
  }
})
export type ProTurn = z.infer<typeof ProTurnSchema>

export const ProChatSettingsSchema = z.object({
  cdpTarget: CdpTargetSchema,
  revision: z.number().int().nonnegative(),
}).strict()
export type ProChatSettings = z.infer<typeof ProChatSettingsSchema>

export const CreateChatInputSchema = z.object({ title: z.string().trim().min(1).max(120).optional() }).strict()
export type CreateChatInput = z.infer<typeof CreateChatInputSchema>
export const SendInputSchema = z.object({ chatId: ChatIdSchema, content: z.string().trim().min(1).max(60_000) }).strict()
export type SendInput = z.infer<typeof SendInputSchema>
export const RenameInputSchema = z.object({ chatId: ChatIdSchema, title: z.string().trim().min(1).max(120) }).strict()
export type RenameInput = z.infer<typeof RenameInputSchema>
export const ChatIdInputSchema = z.object({ chatId: ChatIdSchema }).strict()
export type ChatIdInput = z.infer<typeof ChatIdInputSchema>
export const SaveSettingsInputSchema = z.object({ cdpTarget: CdpTargetSchema }).strict()
export type SaveSettingsInput = z.infer<typeof SaveSettingsInputSchema>

export const ProChatSummarySchema = ProChatSchema.pick({ id: true, title: true, createdAt: true, updatedAt: true, status: true, lastError: true, divergence: true, quarantine: true })
export type ProChatSummary = z.infer<typeof ProChatSummarySchema>

export const ProChatDetailSchema = z.object({
  chat: ProChatSchema,
  messages: z.array(ProChatMessageSchema),
  turns: z.array(ProTurnSchema),
}).strict()
export type ProChatDetail = z.infer<typeof ProChatDetailSchema>

export const TransportStatusSchema = z.object({
  cdpTarget: CdpTargetSchema,
  reachable: z.boolean(),
  oracleInstalled: z.boolean(),
  selectionVerified: z.boolean(),
  browser: z.string().max(240).optional(),
  modelLabel: z.string().max(120).optional(),
  thinkingLabel: z.string().max(120).optional(),
  message: z.string().max(500),
}).strict()
export type TransportStatus = z.infer<typeof TransportStatusSchema>

export const HandoffSchema = z.object({ text: z.string().min(1).max(600_000), messageCount: z.number().int().nonnegative() }).strict()
export type Handoff = z.infer<typeof HandoffSchema>

export const now = (): string => new Date().toISOString()
