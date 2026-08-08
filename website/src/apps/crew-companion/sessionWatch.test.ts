/**
 * The watcher's status SNAPSHOT, driven by a fake socket.
 *
 * The completion half of this module is covered by
 * `src/test/CrewCompanionSessionWatch.test.ts`; these tests are about the second
 * thing the watcher now answers — "what is the crew doing right now" — which the
 * desktop cast reads every frame.
 *
 * The load-bearing case is the last one: the snapshot must EMPTY when the socket
 * drops. A frozen snapshot would leave the pet reporting work that no longer has
 * anywhere to run, which is worse than reporting nothing.
 */
import { describe, it, expect, vi } from 'vitest'

import { watchSessions } from './sessionWatch'

/** A stand-in for the gateway socket that lets a test push frames by hand. */
function fakeSocket() {
  return {
    onopen: null as null | (() => void),
    onmessage: null as null | ((ev: { data: string }) => void),
    onclose: null as null | (() => void),
    onerror: null as null | (() => void),
    close: vi.fn(),
  }
}

type FakeSocket = ReturnType<typeof fakeSocket>

function send(ws: FakeSocket, type: string, data: unknown) {
  ws.onmessage?.({ data: JSON.stringify({ type, data }) })
}

function watch(ws: FakeSocket) {
  return watchSessions({
    onDone: vi.fn(),
    isSilent: () => false,
    connect: () => ws as unknown as WebSocket,
  })
}

describe('watchSessions snapshot', () => {
  it('starts empty', () => {
    const ws = fakeSocket()
    const w = watch(ws)
    expect(w.snapshot()).toEqual([])
    w.stop()
  })

  it('reports a running slot with its title', () => {
    const ws = fakeSocket()
    const w = watch(ws)
    send(ws, 'slots', [{ key: 'a', running: true, title: 'Fix the parser' }])
    const snap = w.snapshot()
    expect(snap).toHaveLength(1)
    expect(snap[0]).toMatchObject({ slotKey: 'a', name: 'Fix the parser', running: true })
    w.stop()
  })

  it('reports every slot as a chat slot, never a cron or a subagent', () => {
    // This transport only ever sees chat slots, and `kind` is what keeps crons and
    // subagents off the desktop cast, so emitting it wrong would put them there.
    const ws = fakeSocket()
    const w = watch(ws)
    send(ws, 'slots', [{ key: 'a', running: true, title: 'A' }])
    expect(w.snapshot()[0].kind).toBe('slot')
    w.stop()
  })

  it('marks a slot pending approval', () => {
    const ws = fakeSocket()
    const w = watch(ws)
    send(ws, 'slots', [{ key: 'a', running: true, title: 'A' }])
    send(ws, 'approval', { slot: 'a' })
    expect(w.snapshot()[0].pendingApproval).toBe(true)
    w.stop()
  })

  it('clears pending approval when it resolves', () => {
    const ws = fakeSocket()
    const w = watch(ws)
    send(ws, 'slots', [{ key: 'a', running: true, title: 'A' }])
    send(ws, 'approval', { slot: 'a' })
    send(ws, 'approval_resolved', { id: 'x' })
    expect(w.snapshot()[0].pendingApproval).toBe(false)
    w.stop()
  })

  it('marks a slot failed on an error-role message', () => {
    const ws = fakeSocket()
    const w = watch(ws)
    send(ws, 'slots', [{ key: 'a', running: true, title: 'A' }])
    send(ws, 'chat_message', { slot: 'a', role: 'error', content: 'boom' })
    expect(w.snapshot()[0].failed).toBe(true)
    w.stop()
  })

  it('reports a finished turn as unread until the next one starts', () => {
    const ws = fakeSocket()
    const w = watch(ws)
    send(ws, 'slots', [{ key: 'a', running: true, title: 'A' }])
    send(ws, 'chat_done', { slot: 'a' })
    expect(w.snapshot()[0]).toMatchObject({ running: false, unread: true })
    send(ws, 'chat_status', { slot: 'a' })
    expect(w.snapshot()[0]).toMatchObject({ running: true, unread: false })
    w.stop()
  })

  it('keeps a failure recorded when a later status frame lands in the same turn', () => {
    // The gateway repeats `chat_status` as the status line changes, so only the
    // FIRST one of a turn may clear the previous turn's outcome.
    const ws = fakeSocket()
    const w = watch(ws)
    send(ws, 'chat_status', { slot: 'a', status: 'Thinking…' })
    send(ws, 'chat_message', { slot: 'a', role: 'error', content: 'boom' })
    send(ws, 'chat_status', { slot: 'a', status: 'Still going…' })
    expect(w.snapshot()[0].failed).toBe(true)
    w.stop()
  })

  it('empties the snapshot when the socket closes, rather than freezing it', () => {
    const ws = fakeSocket()
    const w = watch(ws)
    send(ws, 'slots', [{ key: 'a', running: true, title: 'A' }])
    ws.onclose?.()
    expect(w.snapshot()).toEqual([])
    w.stop()
  })

  it('empties the snapshot once the caller stops watching', () => {
    const ws = fakeSocket()
    const w = watch(ws)
    send(ws, 'slots', [{ key: 'a', running: true, title: 'A' }])
    w.stop()
    expect(w.snapshot()).toEqual([])
  })
})
