/**
 * The desktop cast: one sprite per working agent, the overflow readout, and the
 * two mappings that turn crew status into an appearance.
 *
 * The rect reporting is pinned here rather than only in the hitbox suite because
 * the overlay is click-through except over reported rects: a sprite whose rect is
 * missing looks clickable and silently is not.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  CrewCast,
  castAppearance,
  motionPetState,
  restingPetState,
  sameCrewView,
} from './CrewCast'
import { CAST_PX } from './castLayout'
import { activeAnimFor } from './petAnim'
import { deriveCrewStatus, type CrewAgent, type StatusInput } from './crewStatus'

const agent = (id: string, state: CrewAgent['state'] = 'running'): CrewAgent => ({
  id: `slot-${id}`,
  slotKey: id,
  name: `Session ${id}`,
  kind: 'slot',
  state,
  since: 0,
})

describe('CrewCast', () => {
  it('renders one sprite per cast member', () => {
    render(<CrewCast ready cast={[agent('a'), agent('b')]} overflow={0} petPos={{ x: 100, y: 100 }}
      onSelect={vi.fn()} onRects={vi.fn()} />)
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('renders nothing for an empty cast', () => {
    render(<CrewCast ready cast={[]} overflow={0} petPos={{ x: 0, y: 0 }}
      onSelect={vi.fn()} onRects={vi.fn()} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('draws nothing until the companion position has loaded', () => {
    render(<CrewCast ready={false} cast={[agent('a'), agent('b')]} overflow={3}
      petPos={{ x: 100, y: 100 }} onSelect={vi.fn()} onRects={vi.fn()} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByText(/^\+/)).toBeNull()
  })

  it('reports NO rects until the companion position has loaded', () => {
    // The safety-critical half. `useDrag` defers the saved position behind a 300ms
    // timer plus an async IPC call, so until it lands `petPos` is the default
    // bottom-right corner — and a rect reported there makes a region of the user's
    // desktop swallow clicks with nothing drawn in it.
    const onRects = vi.fn()
    render(<CrewCast ready={false} cast={[agent('a'), agent('b')]} overflow={0}
      petPos={{ x: 100, y: 100 }} onSelect={vi.fn()} onRects={onRects} />)
    expect(onRects.mock.calls.at(-1)?.[0]).toEqual([])
  })

  it('reports the sprites once the position lands', () => {
    const onRects = vi.fn()
    const { rerender } = render(<CrewCast ready={false} cast={[agent('a')]} overflow={0}
      petPos={{ x: 100, y: 100 }} onSelect={vi.fn()} onRects={onRects} />)
    rerender(<CrewCast ready cast={[agent('a')]} overflow={0}
      petPos={{ x: 100, y: 100 }} onSelect={vi.fn()} onRects={onRects} />)
    expect(onRects.mock.calls.at(-1)?.[0]).toHaveLength(1)
  })

  it('names each sprite for screen readers', () => {
    render(<CrewCast ready cast={[agent('a')]} overflow={0} petPos={{ x: 0, y: 0 }}
      onSelect={vi.fn()} onRects={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Session a/ })).toBeTruthy()
  })

  it('reports one rect per sprite, sized to the sprite', () => {
    const onRects = vi.fn()
    render(<CrewCast ready cast={[agent('a'), agent('b')]} overflow={0} petPos={{ x: 0, y: 0 }}
      onSelect={vi.fn()} onRects={onRects} />)
    const rects = onRects.mock.calls.at(-1)?.[0]
    expect(rects).toHaveLength(2)
    for (const r of rects) expect({ w: r.w, h: r.h }).toEqual({ w: CAST_PX, h: CAST_PX })
  })

  it('offsets each reported rect from the companion position', () => {
    const onRects = vi.fn()
    render(<CrewCast ready cast={[agent('a')]} overflow={0} petPos={{ x: 500, y: 400 }}
      onSelect={vi.fn()} onRects={onRects} />)
    const [first] = onRects.mock.calls.at(-1)?.[0]
    expect(first.x).toBeLessThan(500)
  })

  it('reports an empty rect list for an empty cast', () => {
    const onRects = vi.fn()
    render(<CrewCast ready cast={[]} overflow={0} petPos={{ x: 0, y: 0 }}
      onSelect={vi.fn()} onRects={onRects} />)
    expect(onRects.mock.calls.at(-1)?.[0]).toEqual([])
  })

  it('calls onSelect with the slot key, not the agent id', async () => {
    const onSelect = vi.fn()
    render(<CrewCast ready cast={[agent('a')]} overflow={0} petPos={{ x: 0, y: 0 }}
      onSelect={onSelect} onRects={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /Session a/ }))
    expect(onSelect).toHaveBeenCalledWith('a')
  })

  it('renders an overflow badge when agents did not fit', () => {
    render(<CrewCast ready cast={[agent('a')]} overflow={3} petPos={{ x: 0, y: 0 }}
      onSelect={vi.fn()} onRects={vi.fn()} />)
    expect(screen.getByText('+3')).toBeTruthy()
  })

  it('renders no badge when nothing overflowed', () => {
    render(<CrewCast ready cast={[agent('a')]} overflow={0} petPos={{ x: 0, y: 0 }}
      onSelect={vi.fn()} onRects={vi.fn()} />)
    expect(screen.queryByText(/^\+/)).toBeNull()
  })

  it('reports no rect for the overflow badge — it is a readout, not a control', () => {
    const onRects = vi.fn()
    render(<CrewCast ready cast={[agent('a')]} overflow={9} petPos={{ x: 0, y: 0 }}
      onSelect={vi.fn()} onRects={onRects} />)
    expect(onRects.mock.calls.at(-1)?.[0]).toHaveLength(1)
  })
})

describe('castAppearance', () => {
  it('gives a running agent the busy pose', () => {
    expect(castAppearance('running').state).toBe('loading')
  })

  it('distinguishes an agent waiting on the user from one merely working', () => {
    expect(castAppearance('needs-input')).not.toEqual(castAppearance('running'))
  })

  it('marks the waiting agent as a question rather than a failure', () => {
    expect(castAppearance('needs-input').mood).toBe('curious')
    expect(castAppearance('running').mood).toBeUndefined()
  })
})

describe('sameCrewView', () => {
  const input = (slot: string, over: Partial<StatusInput> = {}): StatusInput => ({
    id: `slot-${slot}`,
    slotKey: slot,
    name: `Session ${slot}`,
    kind: 'slot',
    running: true,
    waitingForInput: false,
    pendingApproval: false,
    failed: false,
    unread: false,
    since: 0,
    ...over,
  })

  it('holds across two identical polls, so the overlay does not repaint on a timer', () => {
    expect(sameCrewView(deriveCrewStatus([input('a')]), deriveCrewStatus([input('a')]))).toBe(true)
  })

  it('holds when only an idle agent aged — the desktop draws nothing for it', () => {
    const a = deriveCrewStatus([input('a'), input('b', { running: false, since: 1 })])
    const b = deriveCrewStatus([input('a'), input('b', { running: false, since: 99 })])
    expect(sameCrewView(a, b)).toBe(true)
  })

  it('breaks when an agent joins, leaves, is renamed, or changes state', () => {
    const base = deriveCrewStatus([input('a')])
    expect(sameCrewView(base, deriveCrewStatus([]))).toBe(false)
    expect(sameCrewView(base, deriveCrewStatus([input('a'), input('b')]))).toBe(false)
    expect(sameCrewView(base, deriveCrewStatus([input('a', { name: 'Renamed' })]))).toBe(false)
    const waiting = deriveCrewStatus([input('a', { pendingApproval: true })])
    expect(sameCrewView(base, waiting)).toBe(false)
  })

  it('breaks when only the overflow count moved', () => {
    const five = [0, 1, 2, 3, 4].map((i) => input(String(i)))
    const six = [...five, input('5')]
    expect(sameCrewView(deriveCrewStatus(five), deriveCrewStatus(six))).toBe(false)
  })
})

describe('restingPetState', () => {
  it('wears the crew aggregate while the companion has no reaction of its own', () => {
    expect(restingPetState('running', 'idle')).toBe('loading')
    expect(restingPetState('ready', 'idle')).toBe('done')
    expect(restingPetState('blocked', 'idle')).toBe('error')
    expect(restingPetState('idle', 'idle')).toBe('idle')
  })

  it('lets a live reaction outrank the ambient aggregate', () => {
    expect(restingPetState('running', 'done')).toBe('done')
    expect(restingPetState('idle', 'error')).toBe('error')
  })

  it('never leaves a breathing phase for the aggregate', () => {
    expect(restingPetState('running', 'inhale')).toBe('inhale')
  })
})

describe('motionPetState — the ART may be held, the KEYFRAMES may not', () => {
  it('keeps a sustained aggregate driving its looping motion', () => {
    // ponder-loop is `infinite`, so holding it is the intent.
    expect(activeAnimFor({ state: motionPetState('running', 'idle') })).toBe('ponder-loop')
    expect(activeAnimFor({ state: motionPetState('needs-input', 'idle') })).toBe('ponder-loop')
  })

  it('plays celebrate ONCE on arriving at ready, via the reaction the arrival raises', () => {
    // The arrival is carried by the reaction, exactly as a completion bubble is.
    expect(activeAnimFor({ state: motionPetState('ready', 'done') })).toBe('celebrate')
  })

  it('stops celebrating once the arrival reaction has expired, while ready persists', () => {
    // NULL is the point, not just "not celebrate": `activeAnimFor` surfaces an idle
    // fidget only while the state is `idle`, so an aggregate that kept returning a
    // motion would starve the fidget for as long as the session stayed unread.
    // (kg-celebrate ends at neutral and is outside POSED_ANIMS, so holding it is
    // visually free — the inert companion is the whole cost.)
    expect(motionPetState('ready', 'idle')).toBe('idle')
    expect(activeAnimFor({ state: motionPetState('ready', 'idle') })).toBeNull()
  })

  it('stops shaking once the arrival reaction has expired, while blocked persists', () => {
    // `blocked` starves the fidget exactly as `ready` does, and can persist just as
    // long — a failed slot clears only when the user acts on it.
    expect(motionPetState('blocked', 'idle')).toBe('idle')
    expect(activeAnimFor({ state: motionPetState('blocked', 'idle') })).toBeNull()
  })

  it('still lets the resting ART show what a held one-shot state means', () => {
    // Motion settles; the pose does not. This is the pairing the split preserves.
    expect(restingPetState('ready', 'idle')).toBe('done')
    expect(restingPetState('blocked', 'idle')).toBe('error')
  })

  it('lets the idle fidget through once a one-shot aggregate has settled', () => {
    expect(activeAnimFor({ state: motionPetState('ready', 'idle'), idleAnim: 'look' })).toBe('look')
  })

  it('always yields to a live reaction, breathing phases included', () => {
    expect(motionPetState('running', 'error')).toBe('error')
    expect(motionPetState('ready', 'inhale')).toBe('inhale')
  })
})
