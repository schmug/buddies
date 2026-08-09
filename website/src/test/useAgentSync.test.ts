/**
 * `useAgentSync` reads two per-slot maps out of Redux. `failedSlots` is a plain
 * object, so a raw `map[key]` lookup resolves through `Object.prototype` and a
 * slot whose key happens to be `constructor`/`toString`/`valueOf` would report
 * a failure that no error frame ever recorded — and that no clear path could
 * ever remove, because the guarded write path never created an own property.
 * Slot keys are derived from user-supplied titles and channel names, so these
 * are reachable without an attacker.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { Provider } from 'react-redux'
import { createTestStore } from './helpers'
import { sseSlots, markSlotUnread } from '../store/dashboardSlice'
import { sseChatMessage } from '../store/chatSlice'
import { useAgentSync } from '../hooks/useAgentSync'

// Never resolve: the cron/spawn pollers only add `extras`, and leaving them
// pending keeps the hook's state to the slot-derived agents under test.
vi.mock('../api/client', () => ({
  api: {
    crons: vi.fn(() => new Promise(() => {})),
    spawnList: vi.fn(() => new Promise(() => {})),
  },
}))

/** Object.prototype members reachable as a slot key. */
const PROTOTYPE_KEYS = ['constructor', 'toString', 'valueOf', 'hasOwnProperty']

function renderAgents(store: ReturnType<typeof createTestStore>) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(Provider, { store, children })
  return renderHook(() => useAgentSync(), { wrapper }).result.current.agents
}

describe('useAgentSync prototype-named slot keys', () => {
  it('does not mark a healthy slot failed because its key names a prototype member', () => {
    const store = createTestStore()
    store.dispatch(sseSlots(PROTOTYPE_KEYS.map(key => ({ key, messages: 1, running: false }))))
    const agents = renderAgents(store)
    expect(agents.map(a => a.failed)).toEqual(PROTOTYPE_KEYS.map(() => false))
  })

  it('does not mark such a slot unread either', () => {
    const store = createTestStore()
    store.dispatch(sseSlots(PROTOTYPE_KEYS.map(key => ({ key, messages: 1, running: false }))))
    const agents = renderAgents(store)
    expect(agents.map(a => a.unread)).toEqual(PROTOTYPE_KEYS.map(() => false))
  })

  it('still reports a real failure and a real unread', () => {
    const store = createTestStore()
    store.dispatch(sseSlots([{ key: 'chat-1', messages: 1, running: false }]))
    store.dispatch(sseChatMessage({ slot: 'chat-1', role: 'error', content: 'boom' }))
    store.dispatch(markSlotUnread('chat-1'))
    const agents = renderAgents(store)
    expect(agents[0].failed).toBe(true)
    expect(agents[0].unread).toBe(true)
  })
})
