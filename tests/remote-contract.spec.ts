import { describe, expect, it } from 'vitest'
import { PRO_CHAT_INVOCATIONS, TYPERT, TYPERT_REMOTE } from '../src/remote-contract.ts'

describe('source-owned Remote contract', () => {
  it('keeps Host and Client descriptors on one exact method set', () => {
    const methods = PRO_CHAT_INVOCATIONS.map(descriptor => descriptor.method)
    expect(methods).toEqual([
      'cancel',
      'createChat',
      'deleteChat',
      'exportHandoff',
      'getChat',
      'listArchivedChats',
      'listChats',
      'renameChat',
      'restoreChat',
      'saveSettings',
      'send',
      'settings',
      'transportStatus',
      'verifyTransport',
    ])
    expect(TYPERT.invocations).toBe(PRO_CHAT_INVOCATIONS)
    expect(TYPERT_REMOTE.descriptors).toBe(PRO_CHAT_INVOCATIONS)
    expect(TYPERT.model).toEqual({ services: [], events: [], objects: [] })
  })

  it('uses strict boundary schemas for tombstones and new turn states', () => {
    const list = PRO_CHAT_INVOCATIONS.find(item => item.method === 'listArchivedChats')!
    expect(list.result.schema.parse([{
      id: '11111111-1111-4111-8111-111111111111',
      title: 'archived',
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
      status: 'idle',
      quarantine: {
        opId: '22222222-2222-4222-8222-222222222222',
        phase: 'quarantined',
        archivedAt: '2026-08-31T00:00:00.000Z',
        previousStatus: 'idle',
        oracleScope: 'chat-scoped',
        exactOracleSessionIds: [],
      },
    }])).toHaveLength(1)
    const send = PRO_CHAT_INVOCATIONS.find(item => item.method === 'send')!
    expect(send.result.schema.parse({
      id: '33333333-3333-4333-8333-333333333333',
      chatId: '11111111-1111-4111-8111-111111111111',
      promptMessageId: '44444444-4444-4444-8444-444444444444',
      state: 'external-diverged',
      createdAt: '2026-08-31T00:00:00.000Z',
    }).state).toBe('external-diverged')
  })
})
