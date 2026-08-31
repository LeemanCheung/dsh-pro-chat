import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { RefreshSelectionCoordinator } from '../src/client/refresh-selection.ts'

describe('Pro Chat refresh selection coordinator', () => {
  it('keeps the displayed chat committed when choose or create detail loading fails', () => {
    const selection = new RefreshSelectionCoordinator('chat-a')
    selection.beginMutation()
    // A failed detail request never calls commitMutation.
    expect(selection.selectedId).toBe('chat-a')
  })

  it('rejects a five-second refresh that was already running when send begins', () => {
    const selection = new RefreshSelectionCoordinator('chat-a')
    const refresh = selection.beginRefresh()
    const send = selection.beginMutation()
    expect(selection.commitRefresh(refresh, 'chat-b')).toBe(false)
    expect(selection.ownsMutation(send)).toBe(true)
    expect(selection.selectedId).toBe('chat-a')
  })

  it('rejects stale refresh success and failure ownership after an explicit selection change', () => {
    const selection = new RefreshSelectionCoordinator('chat-a')
    const refresh = selection.beginRefresh()
    const choose = selection.beginMutation()
    expect(selection.commitMutation(choose, 'chat-b')).toBe(true)
    expect(selection.ownsRefresh(refresh)).toBe(false)
    expect(selection.commitRefresh(refresh, 'chat-a')).toBe(false)
    expect(selection.selectedId).toBe('chat-b')
  })

  it('allows only the latest unchanged refresh to commit', () => {
    const selection = new RefreshSelectionCoordinator('chat-a')
    const first = selection.beginRefresh()
    const second = selection.beginRefresh()
    expect(selection.commitRefresh(first, 'chat-b')).toBe(false)
    expect(selection.commitRefresh(second, 'chat-a')).toBe(true)
  })

  it('does not restart the five-second refresh effect after selection state changes', async () => {
    const source = await readFile(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
    expect(source).toContain('}, [api])')
    expect(source).not.toContain('}, [api, selectedId])')
  })

  it('invalidates a delayed refresh before every foreground action owns the result surface', async () => {
    const source = await readFile(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
    expect(source).toMatch(/const run =[^]*if \(busyRef\.current\) return\s+[^]*selectionRef\.current\.beginMutation\(\)\s+busyRef\.current = true/u)
  })
})
