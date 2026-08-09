import { describe, it, expect } from 'vitest'
import { deriveCrewStatus, DESKTOP_CAST_CAP, type StatusInput } from './crewStatus'

/** A slot with nothing happening. Spread and override one field per test. */
const base: StatusInput = {
  id: 'slot-a', slotKey: 'a', name: 'A', kind: 'slot',
  running: false, waitingForInput: false, pendingApproval: false,
  failed: false, unread: false, since: 0,
}

describe('deriveCrewStatus — per-agent state', () => {
  it('maps a pending approval to needs-input', () => {
    const { agents } = deriveCrewStatus([{ ...base, running: true, pendingApproval: true }])
    expect(agents[0].state).toBe('needs-input')
  })

  it('maps waiting-for-input to needs-input even when not running', () => {
    const { agents } = deriveCrewStatus([{ ...base, waitingForInput: true }])
    expect(agents[0].state).toBe('needs-input')
  })

  it('prefers needs-input over failed when both are set', () => {
    const { agents } = deriveCrewStatus([{ ...base, waitingForInput: true, failed: true }])
    expect(agents[0].state).toBe('needs-input')
  })

  it('maps failed to blocked', () => {
    const { agents } = deriveCrewStatus([{ ...base, failed: true }])
    expect(agents[0].state).toBe('blocked')
  })

  it('maps finished-with-unread to ready', () => {
    const { agents } = deriveCrewStatus([{ ...base, unread: true }])
    expect(agents[0].state).toBe('ready')
  })

  it('does not report ready while still running', () => {
    const { agents } = deriveCrewStatus([{ ...base, running: true, unread: true }])
    expect(agents[0].state).toBe('running')
  })

  it('maps a quiet slot to idle', () => {
    const { agents } = deriveCrewStatus([base])
    expect(agents[0].state).toBe('idle')
  })
})

describe('deriveCrewStatus — aggregate', () => {
  it('is idle for an empty crew', () => {
    expect(deriveCrewStatus([]).aggregate).toBe('idle')
  })

  it('takes the highest-priority state present', () => {
    const { aggregate } = deriveCrewStatus([
      { ...base, id: 'slot-a', slotKey: 'a', running: true },
      { ...base, id: 'slot-b', slotKey: 'b', failed: true },
      { ...base, id: 'slot-c', slotKey: 'c', waitingForInput: true },
    ])
    expect(aggregate).toBe('needs-input')
  })

  it('ranks blocked above ready', () => {
    const { aggregate } = deriveCrewStatus([
      { ...base, id: 'slot-a', slotKey: 'a', unread: true },
      { ...base, id: 'slot-b', slotKey: 'b', failed: true },
    ])
    expect(aggregate).toBe('blocked')
  })

  it('ranks ready above running', () => {
    const { aggregate } = deriveCrewStatus([
      { ...base, id: 'slot-a', slotKey: 'a', running: true },
      { ...base, id: 'slot-b', slotKey: 'b', unread: true },
    ])
    expect(aggregate).toBe('ready')
  })
})

describe('deriveCrewStatus — cast membership', () => {
  it('includes running agents', () => {
    const { cast } = deriveCrewStatus([{ ...base, running: true }])
    expect(cast.map(a => a.id)).toEqual(['slot-a'])
  })

  it('includes an approval-blocked turn, which has not stopped running', () => {
    const { cast } = deriveCrewStatus([{ ...base, running: true, pendingApproval: true }])
    expect(cast.map(a => a.id)).toEqual(['slot-a'])
  })

  it('excludes ready, blocked and idle agents', () => {
    const { cast, agents } = deriveCrewStatus([
      { ...base, id: 'slot-a', slotKey: 'a', unread: true },
      { ...base, id: 'slot-b', slotKey: 'b', failed: true },
      { ...base, id: 'slot-c', slotKey: 'c' },
    ])
    expect(cast).toEqual([])
    expect(agents).toHaveLength(3)
  })

  it('caps the cast and reports the remainder as overflow', () => {
    const many = Array.from({ length: DESKTOP_CAST_CAP + 3 }, (_, i) => ({
      ...base, id: `slot-${i}`, slotKey: String(i), name: `A${i}`, running: true,
    }))
    const { cast, overflow } = deriveCrewStatus(many)
    expect(cast).toHaveLength(DESKTOP_CAST_CAP)
    expect(overflow).toBe(3)
  })

  it('lets a needs-input agent displace a running one at the cap', () => {
    const running = Array.from({ length: DESKTOP_CAST_CAP }, (_, i) => ({
      ...base, id: `run-${i}`, slotKey: `r${i}`, running: true, since: 0,
    }))
    const waiting = {
      ...base, id: 'waiting', slotKey: 'w', running: true, pendingApproval: true, since: 99,
    }
    const { cast } = deriveCrewStatus([...running, waiting])
    expect(cast.map(a => a.id)).toContain('waiting')
    expect(cast).toHaveLength(DESKTOP_CAST_CAP)
  })

  it('breaks ties within a priority by longest in state', () => {
    const { agents } = deriveCrewStatus([
      { ...base, id: 'newer', slotKey: 'n', running: true, since: 500 },
      { ...base, id: 'older', slotKey: 'o', running: true, since: 100 },
    ])
    expect(agents.map(a => a.id)).toEqual(['older', 'newer'])
  })
})

describe('deriveCrewStatus — cast membership by kind', () => {
  it('keeps a running cron out of the cast while still counting it', () => {
    // A cron runs on a schedule with nobody watching; a sprite for it would wander
    // the desktop on the clock's behalf rather than the user's. It is still crew,
    // so the world lists it and the pet's aggregate reflects it.
    const { cast, agents, aggregate } = deriveCrewStatus([{ ...base, kind: 'cron', running: true }])
    expect(cast).toEqual([])
    expect(agents).toHaveLength(1)
    expect(agents[0].state).toBe('running')
    expect(aggregate).toBe('running')
  })

  it('keeps a running subagent out of the cast while still counting it', () => {
    // A spawned subagent belongs to the session that spawned it, which already has
    // its own sprite; casting both would double-count one piece of work.
    const { cast, agents, aggregate } = deriveCrewStatus([
      { ...base, kind: 'spawn', running: true },
    ])
    expect(cast).toEqual([])
    expect(agents).toHaveLength(1)
    expect(aggregate).toBe('running')
  })

  it('keeps them out at the highest-priority state too, not only while running', () => {
    // "Never cast members regardless of state" — needs-input is the state that would
    // otherwise force its way in, so it is the one worth pinning.
    const { cast, aggregate } = deriveCrewStatus([
      { ...base, id: 'cron-a', slotKey: 'c', kind: 'cron', running: true, pendingApproval: true },
      { ...base, id: 'spawn-a', slotKey: 's', kind: 'spawn', running: true, waitingForInput: true },
    ])
    expect(cast).toEqual([])
    expect(aggregate).toBe('needs-input')
  })

  it('casts only the chat slots when kinds are mixed', () => {
    const { cast, agents } = deriveCrewStatus([
      { ...base, id: 'slot-a', slotKey: 'a', running: true },
      { ...base, id: 'cron-a', slotKey: 'c', kind: 'cron', running: true },
      { ...base, id: 'spawn-a', slotKey: 's', kind: 'spawn', running: true },
    ])
    expect(cast.map((a) => a.id)).toEqual(['slot-a'])
    expect(agents).toHaveLength(3)
  })

  it('carries the kind onto the derived agent, so a renderer can label it', () => {
    const { agents } = deriveCrewStatus([{ ...base, kind: 'cron' }])
    expect(agents[0].kind).toBe('cron')
  })
})

describe('deriveCrewStatus — degradation', () => {
  it('returns an idle, empty crew when the transport has nothing', () => {
    const s = deriveCrewStatus([])
    expect(s).toEqual({ agents: [], aggregate: 'idle', cast: [], overflow: 0 })
  })
})
