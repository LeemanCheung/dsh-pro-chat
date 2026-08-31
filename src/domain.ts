import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { ProChatMessageSchema, ProChatSchema, ProChatSettingsSchema, ProTurnSchema } from './schema.ts'

export const proChatDomainSpec = defineDomain({
  name: 'pro_chat',
  version: 1,
  global: {
    schema: ProChatSettingsSchema,
    initial: { cdpTarget: '127.0.0.1:9222', revision: 0 },
  },
  tables: {
    chats: domainTable(ProChatSchema),
    messages: domainTable(ProChatMessageSchema),
    turns: domainTable(ProTurnSchema),
  },
})
