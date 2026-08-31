import { z } from 'zod'
import type { InvocationDescriptor, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import {
  ChatIdInputSchema,
  CreateChatInputSchema,
  HandoffSchema,
  ProChatDetailSchema,
  ProChatSettingsSchema,
  ProChatSummarySchema,
  ProTurnSchema,
  RenameInputSchema,
  SaveSettingsInputSchema,
  SendInputSchema,
  TransportStatusSchema,
} from './schema.ts'

const input = (typeSymbol: string, schema: z.ZodType): InvocationDescriptor['parameters'] => [{
  name: 'input',
  wire: 'input',
  source: 'json',
  codec: { mode: 'strict', typeSymbol, schema },
}]

const direct = (
  method: string,
  resultSymbol: string,
  resultSchema: z.ZodType,
  parameters: InvocationDescriptor['parameters'] = [],
): InvocationDescriptor => ({
  id: `dsh-pro-chat#proChat/${method}`,
  service: 'proChat',
  namespace: 'proChat',
  method,
  invocation: { kind: 'direct' },
  parameters,
  result: { mode: 'strict', typeSymbol: resultSymbol, schema: resultSchema },
})

export const PRO_CHAT_INVOCATIONS: readonly InvocationDescriptor[] = [
  direct('cancel', 'dsh-pro-chat/types#ProChatSummary', ProChatSummarySchema, input('dsh-pro-chat/types#ChatIdInput', ChatIdInputSchema)),
  direct('createChat', 'dsh-pro-chat/types#ProChatSummary', ProChatSummarySchema, input('dsh-pro-chat/types#CreateChatInput', CreateChatInputSchema)),
  direct('deleteChat', 'dsh-pro-chat#proChat/deleteChat:result', z.boolean(), input('dsh-pro-chat/types#ChatIdInput', ChatIdInputSchema)),
  direct('exportHandoff', 'dsh-pro-chat/types#Handoff', HandoffSchema, input('dsh-pro-chat/types#ChatIdInput', ChatIdInputSchema)),
  direct('getChat', 'dsh-pro-chat/types#ProChatDetail', ProChatDetailSchema, input('dsh-pro-chat/types#ChatIdInput', ChatIdInputSchema)),
  direct('listArchivedChats', 'dsh-pro-chat/types#ProChatSummary[]', z.array(ProChatSummarySchema)),
  direct('listChats', 'dsh-pro-chat/types#ProChatSummary[]', z.array(ProChatSummarySchema)),
  direct('renameChat', 'dsh-pro-chat/types#ProChatSummary', ProChatSummarySchema, input('dsh-pro-chat/types#RenameInput', RenameInputSchema)),
  direct('restoreChat', 'dsh-pro-chat/types#ProChatSummary', ProChatSummarySchema, input('dsh-pro-chat/types#ChatIdInput', ChatIdInputSchema)),
  direct('saveSettings', 'dsh-pro-chat/types#ProChatSettings', ProChatSettingsSchema, input('dsh-pro-chat/types#SaveSettingsInput', SaveSettingsInputSchema)),
  direct('send', 'dsh-pro-chat/types#ProTurn', ProTurnSchema, input('dsh-pro-chat/types#SendInput', SendInputSchema)),
  direct('settings', 'dsh-pro-chat/types#ProChatSettings', ProChatSettingsSchema),
  direct('transportStatus', 'dsh-pro-chat/types#TransportStatus', TransportStatusSchema),
  direct('verifyTransport', 'dsh-pro-chat/types#TransportStatus', TransportStatusSchema),
]

export const TYPERT = {
  package: 'dsh-pro-chat',
  face: 'host',
  schemas: [],
  invocations: PRO_CHAT_INVOCATIONS,
  model: { services: [], events: [], objects: [] },
} as const

export const TYPERT_REMOTE: TypertRemoteContribution = {
  package: 'dsh-pro-chat',
  descriptors: PRO_CHAT_INVOCATIONS,
}

export default TYPERT_REMOTE
