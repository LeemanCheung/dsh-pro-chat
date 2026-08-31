import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-subprocess'
import { proChatDomainSpec } from './domain.ts'
import { ProChatService } from './service.ts'
import { OracleBrowserTransport } from './transport.ts'

export * from './schema.ts'
export * from './domain.ts'
export * from './service.ts'
export * from './transport.ts'
export * from './remote-contract.ts'

export const name = 'dsh-pro-chat'
export const inject = ['storageDomain', 'subprocess']

export async function apply(ctx: Context): Promise<void> {
  const domain = await ctx.storageDomain.open(proChatDomainSpec)
  const transport = new OracleBrowserTransport(ctx.subprocess)
  const service = new ProChatService(ctx, domain, transport)
  await service.hydrate()
  ctx.effect(() => async () => {
    await service.shutdown()
    await domain.close()
  }, 'pro-chat: stop browser jobs and close durable storage')
}
