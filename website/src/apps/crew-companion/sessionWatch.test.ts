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
import { describe, it, expect, vi, afterEach } from 'vitest'

import { watchSessions } from './sessionWatch'
import { deriveCrewStatus } from './crewStatus'

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

/**
 * Watch through `ws`, with the connection ESTABLISHED.
 *
 * The open handshake is fired deliberately rather than incidentally: a socket that
 * has been constructed but never opened delivers no frames, and the snapshot has to
 * tell that apart from a live connection.
 */
function watch(ws: FakeSocket, now?: () => number) {
  const w = watchSessions({
    onDone: vi.fn(),
    isSilent: () => false,
    connect: () => ws as unknown as WebSocket,
    now,
  })
  ws.onopen?.()
  return w
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

  it('clears pending approval once the answered turn moves again', () => {
    // The resolve frame carries only an id, so it cannot clear a named slot; the
    // approval lifts when the gateway's own account of the session says so — here
    // the resumed turn's status frame, and in the frame-reconciliation tests below
    // the authoritative `pending_approval` flag.
    const ws = fakeSocket()
    const w = watch(ws)
    send(ws, 'slots', [{ key: 'a', running: true, title: 'A' }])
    send(ws, 'approval', { slot: 'a' })
    send(ws, 'approval_resolved', { id: 'x' })
    send(ws, 'chat_status', { slot: 'a', status: 'Running the tool…' })
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

/**
 * The `slots` frame is the gateway's FULL list, and the only authority on what
 * exists and what each session is doing. Everything else on this socket is a delta
 * that can be missed; reconciling against the frame is what stops a missed delta
 * from becoming a permanent lie about the crew.
 */
describe('watchSessions snapshot — reconciled against the slots frame', () => {
  afterEach(() => { vi.useRealTimers() })

  it('reports a session waiting on the user, which the frame does carry', () => {
    // `waiting_for_input` is computed in the backend's serialize_slots (turn ended,
    // no options, no approval, last conversational message from the assistant) and
    // rides the same frame. Dropping it hides the one state the pet exists to show.
    const ws = fakeSocket()
    const w = watch(ws)
    send(ws, 'slots', [{ key: 'a', running: false, waiting_for_input: true, title: 'A' }])
    expect(w.snapshot()[0].waitingForInput).toBe(true)
    expect(deriveCrewStatus(w.snapshot()).aggregate).toBe('needs-input')
    w.stop()
  })

  it('drops a session the gateway no longer lists', () => {
    // A deleted session that stayed `ready` would outrank every running one and pin
    // the pet there for good, and the world would render a character for nothing.
    const ws = fakeSocket()
    const w = watch(ws)
    send(ws, 'slots', [{ key: 'a', running: true, title: 'A' }, { key: 'b', title: 'B' }])
    send(ws, 'chat_done', { slot: 'a' })
    send(ws, 'slots', [{ key: 'b', title: 'B' }])
    expect(w.snapshot().map((s) => s.slotKey)).toEqual(['b'])
    expect(deriveCrewStatus(w.snapshot()).aggregate).toBe('idle')
    w.stop()
  })

  it('stops reporting running when the frame says the session is not', () => {
    // Without this a single missed `chat_done` pins the session to running forever,
    // holding one of the four cast places against every other agent.
    const ws = fakeSocket()
    const w = watch(ws)
    send(ws, 'slots', [{ key: 'a', running: true, title: 'A' }])
    send(ws, 'slots', [{ key: 'a', running: false, title: 'A' }])
    expect(w.snapshot()[0].running).toBe(false)
    w.stop()
  })

  it('keeps another session blocked when one approval resolves', () => {
    // The resolve frame carries only an id, so it cannot say which session was
    // answered. Clearing both would go quiet about a session still blocked on the
    // user — the exact thing this feature exists to surface.
    const ws = fakeSocket()
    const w = watch(ws)
    send(ws, 'slots', [
      { key: 'a', running: true, title: 'A' },
      { key: 'b', running: true, title: 'B' },
    ])
    send(ws, 'approval', { id: 'a1', slot: 'a' })
    send(ws, 'approval', { id: 'a2', slot: 'b' })
    send(ws, 'approval_resolved', { id: 'a1', approved: true })
    const byKey = Object.fromEntries(w.snapshot().map((s) => [s.slotKey, s.pendingApproval]))
    expect(byKey.b).toBe(true)
    expect(deriveCrewStatus(w.snapshot()).aggregate).toBe('needs-input')
    w.stop()
  })

  it('takes pending approval from the frame, both ways', () => {
    // Joining mid-approval means the `approval` frame is already gone; the flag on
    // the slots frame is the only way to learn about it, and to learn it cleared.
    const ws = fakeSocket()
    const w = watch(ws)
    send(ws, 'slots', [{ key: 'a', running: true, pending_approval: true, title: 'A' }])
    expect(w.snapshot()[0].pendingApproval).toBe(true)
    send(ws, 'slots', [{ key: 'a', running: true, pending_approval: false, title: 'A' }])
    expect(w.snapshot()[0].pendingApproval).toBe(false)
    w.stop()
  })

  it('stays empty while a reconnect is only attempted, never established', () => {
    // `open()` assigns the socket before the handshake, and `onopen` need never
    // fire. Keying emptiness on assignment would serve pre-drop state for as long
    // as the gateway stayed down — which is what the empty rule exists to prevent.
    vi.useFakeTimers()
    const first = fakeSocket()
    const second = fakeSocket()
    let nth = 0
    const w = watchSessions({
      onDone: vi.fn(),
      isSilent: () => false,
      connect: () => (nth++ === 0 ? first : second) as unknown as WebSocket,
    })
    first.onopen?.()
    send(first, 'slots', [{ key: 'a', running: true, title: 'A' }])
    first.onclose?.()
    expect(w.snapshot()).toEqual([])
    // The retry runs and hands back a socket that never completes its handshake.
    vi.advanceTimersByTime(60_000)
    expect(w.snapshot()).toEqual([])
    w.stop()
  })

  it('remembers a failed turn until the session next starts running', () => {
    // The gate erases the failure as it rules on the bubble, so without its own
    // memory the snapshot reports a broken turn exactly like a successful one.
    const ws = fakeSocket()
    const w = watch(ws)
    send(ws, 'slots', [{ key: 'a', running: true, title: 'A' }])
    send(ws, 'chat_message', { slot: 'a', role: 'error', content: 'boom' })
    send(ws, 'chat_done', { slot: 'a' })
    expect(w.snapshot()[0].failed).toBe(true)
    expect(deriveCrewStatus(w.snapshot()).aggregate).toBe('blocked')
    send(ws, 'chat_status', { slot: 'a' })
    expect(w.snapshot()[0].failed).toBe(false)
    w.stop()
  })

  it('tells a broken turn apart from a clean one after both have ended', () => {
    const ws = fakeSocket()
    const w = watch(ws)
    send(ws, 'slots', [
      { key: 'a', running: true, title: 'A' },
      { key: 'b', running: true, title: 'B' },
    ])
    send(ws, 'chat_message', { slot: 'a', role: 'error', content: 'boom' })
    send(ws, 'chat_done', { slot: 'a' })
    send(ws, 'chat_done', { slot: 'b' })
    const states = Object.fromEntries(
      deriveCrewStatus(w.snapshot()).agents.map((a) => [a.slotKey, a.state]),
    )
    expect(states).toEqual({ a: 'blocked', b: 'ready' })
    w.stop()
  })

  it('holds `since` steady while nothing about a session changes', () => {
    // `since` is the tie-break that keeps the longest-waiting agent first, so a
    // re-stamp on every repeated frame would shuffle the cast on the pet's desktop.
    let t = 1_000
    const ws = fakeSocket()
    const w = watch(ws, () => t)
    send(ws, 'slots', [{ key: 'a', running: true, title: 'A' }])
    const first = w.snapshot()[0].since
    t = 9_000
    send(ws, 'slots', [{ key: 'a', running: true, title: 'A' }])
    send(ws, 'slots', [{ key: 'a', running: true, title: 'A' }])
    expect(w.snapshot()[0].since).toBe(first)
    // A real change of condition does move it.
    send(ws, 'slots', [{ key: 'a', running: false, title: 'A' }])
    expect(w.snapshot()[0].since).toBe(9_000)
    w.stop()
  })
})
