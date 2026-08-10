/**
 * The main companion replays its head-cock while the crew waits on the user.
 *
 * `.kg-anim-curious` is a 2000ms one-shot whose 100% keyframe is its 0% keyframe, and
 * `needs-input` is the only aggregate that persists until a person acts — so without a
 * replay the companion settles to neutral and holds still for the one condition that
 * exists to be noticed, while the `running` sprites beside it bob forever on an
 * infinite `ponder-loop`. pet.tsx replays it by bumping the reaction epoch that
 * PetAvatar keys its animated span on, which remounts the node and re-fires the
 * keyframes.
 *
 * Asserted on NODE IDENTITY across the interval, never on a class name. The class is
 * `kg-anim-curious` both when the replay works and when it is broken, so a class
 * assertion passes over a dead feature; the remount is the whole mechanism.
 *
 * pet.tsx exports no component — it calls `createRoot` at module scope — so the
 * companion is driven through the file's OWN entry point rather than rendered: that
 * mount is guarded by `document.getElementById('companion-root')`, so supplying the
 * host and importing the module renders the real tree. Hence the module import per
 * test, behind `vi.resetModules()`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from '@testing-library/react'

import type { StatusInput } from '../apps/crew-companion/crewStatus'
import { ATTENTION_REPLAY_MS } from '../apps/crew-companion/petAnim'

/** Mutable so a test can say what the crew is doing before the companion mounts. */
const watcher = vi.hoisted(() => ({ snapshot: [] as unknown[] }))

// The real one copies the dashboard's stylesheet variables over the network, and
// gates the mount on resolving. None of the companion's motion depends on it.
vi.mock('../apps/crew-companion/dashboardTheme', () => ({
  adoptDashboardTheme: () => Promise.resolve(),
  watchThemeChanges: () => () => {},
  applyThemeId: () => {},
  extractStylesheetHrefs: () => [],
}))

// The real watcher owns a WebSocket; only its `snapshot()` reaches the companion.
vi.mock('../apps/crew-companion/sessionWatch', () => ({
  watchSessions: () => ({ stop: () => {}, snapshot: () => watcher.snapshot }),
}))

/*
 * Put the companion where a user who has dragged it would leave it: away from both
 * edges. `useDrag` restores the saved position shortly after mount and DOCKS at the
 * left edge when there is none, and `activeAnimFor` gates every motion on `!docked`
 * — so without this the companion is tucked at an edge and wears no motion at all,
 * which is a different behaviour from the one under test.
 */
vi.mock('../apps/crew-companion/petBridge', async (importOriginal) => {
  const real = await importOriginal<typeof import('../apps/crew-companion/petBridge')>()
  return {
    ...real,
    petBridge: {
      ...real.petBridge,
      getWindowPosition: () => Promise.resolve({
        x: Math.round(window.innerWidth / 2),
        y: Math.round(window.innerHeight / 2),
      }),
    },
  }
})

const agent = (over: Partial<StatusInput>): StatusInput => ({
  id: 'a',
  slotKey: 'a',
  name: 'Session a',
  kind: 'slot',
  running: false,
  waitingForInput: false,
  pendingApproval: false,
  failed: false,
  unread: false,
  since: 0,
  ...over,
})

/** Mount the real companion through pet.tsx's own module-scope entry point. */
async function mountCompanion(): Promise<void> {
  const host = document.createElement('div')
  host.id = 'companion-root'
  document.body.appendChild(host)
  await act(async () => {
    await import('../apps/crew-companion/pet')
  })
  // The render itself is a microtask: it runs in `adoptDashboardTheme().then(...)`.
  await act(async () => {})
}

/**
 * Run one full replay interval.
 *
 * Also what settles the crew: pet.tsx re-derives the aggregate from the watcher on
 * its own poll, which is shorter than this, so one interval is enough to land it
 * without this test naming a cadence pet.tsx does not export.
 */
async function replayInterval(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ATTENTION_REPLAY_MS)
  })
}

/** The companion's own animated span — `.cc-pet` excludes the cast sprites. */
const companionAnim = () => document.querySelector('.cc-pet span[aria-hidden] > span')

describe('pet.tsx replays the companion head-cock while the crew waits on the user', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    watcher.snapshot = []
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('remounts the animated node once per replay interval', async () => {
    watcher.snapshot = [agent({ waitingForInput: true })]
    await mountCompanion()
    await replayInterval()

    const first = companionAnim()
    expect(first?.className).toContain('kg-anim-curious')

    await replayInterval()
    const second = companionAnim()
    expect(second?.className).toContain('kg-anim-curious')
    expect(second).not.toBe(first)

    await replayInterval()
    expect(companionAnim()).not.toBe(second)
  })

  it('never churns the node while the crew is merely running', async () => {
    // `ponder-loop` is infinite, so a remount would restart the bob from 0% at an
    // arbitrary point in its cycle and read as a stutter. Only the held one-shot is
    // replayed, which is what the `cockingRef` guard on the bump is for.
    watcher.snapshot = [agent({ running: true })]
    await mountCompanion()
    await replayInterval()

    const busy = companionAnim()
    expect(busy?.className).toContain('kg-anim-ponder-loop')

    await replayInterval()
    await replayInterval()
    expect(companionAnim()).toBe(busy)
  })
})
