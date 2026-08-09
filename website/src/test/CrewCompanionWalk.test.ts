/**
 * Walk geometry, tested at the pure-function layer (like the bubble layout) so the
 * rAF/React shell around it does not have to be simulated.
 *
 * These pin the numbers the desktop app shipped — 6ms/px floored at 800ms, ±6°
 * diagonal tilt — that make a hop in the overlay feel identical to the one that
 * shipped in the standalone app. The idle fidget drives `walkPath` with these.
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  walkDirFor,
  walkTiltFor,
  walkDurationMs,
  WALK_MIN_DIST,
} from '../apps/crew-companion/walkMath'

/** A hop is never shorter than this (HOP_MIN), so WALK_MIN_DIST must sit below it. */
const HOP_FLOOR = 30

describe('walkDirFor', () => {
  it('faces left when the target is to the left, right otherwise', () => {
    expect(walkDirFor(500, 100)).toBe(-1)
    expect(walkDirFor(100, 500)).toBe(1)
    // A zero-length leg is not "left".
    expect(walkDirFor(300, 300)).toBe(1)
  })

  it('only ever returns -1 or 1', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -2000, max: 2000 }),
        fc.integer({ min: -2000, max: 2000 }),
        (a, b) => {
          expect([-1, 1]).toContain(walkDirFor(a, b))
        },
      ),
      { numRuns: 100 },
    )
  })
})

describe('walkTiltFor', () => {
  it('a straight horizontal leg does not tilt', () => {
    expect(walkTiltFor(0, 200, 400, 200)).toBe(0)
    expect(walkTiltFor(400, 200, 0, 200)).toBe(0)
  })

  it('a straight vertical leg does not tilt (90° is outside the diagonal bands)', () => {
    expect(walkTiltFor(200, 0, 200, 400)).toBe(0)
  })

  it('a 45° leg tilts, clamped to ±6°', () => {
    const t = walkTiltFor(0, 0, 100, 100)
    expect(t).not.toBe(0)
    expect(Math.abs(t)).toBeLessThanOrEqual(6)
  })

  it('tilt is always within ±6° for any leg', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -2000, max: 2000 }),
        fc.integer({ min: -2000, max: 2000 }),
        fc.integer({ min: -2000, max: 2000 }),
        fc.integer({ min: -2000, max: 2000 }),
        (x1, y1, x2, y2) => {
          const t = walkTiltFor(x1, y1, x2, y2)
          expect(t).toBeGreaterThanOrEqual(-6)
          expect(t).toBeLessThanOrEqual(6)
        },
      ),
      { numRuns: 200 },
    )
  })
})

describe('walkDurationMs', () => {
  it('is never below the 800ms floor', () => {
    expect(walkDurationMs(0, 0, 0, 0)).toBe(800)
    expect(walkDurationMs(0, 0, 10, 0)).toBe(800)
  })

  it('is 6ms per pixel once past the floor', () => {
    // 200px * 6 = 1200ms, above the 800 floor.
    expect(walkDurationMs(0, 0, 200, 0)).toBe(1200)
  })

  it('always returns at least 800 and matches the max(800, dist*6) formula', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -2000, max: 2000 }),
        fc.integer({ min: -2000, max: 2000 }),
        fc.integer({ min: -2000, max: 2000 }),
        fc.integer({ min: -2000, max: 2000 }),
        (x1, y1, x2, y2) => {
          const dist = Math.hypot(x2 - x1, y2 - y1)
          const d = walkDurationMs(x1, y1, x2, y2)
          expect(d).toBeGreaterThanOrEqual(800)
          expect(d).toBe(Math.max(800, dist * 6))
        },
      ),
      { numRuns: 200 },
    )
  })
})

describe('WALK_MIN_DIST', () => {
  it('is a small positive skip threshold, below the hop floor', () => {
    expect(WALK_MIN_DIST).toBeGreaterThan(0)
    expect(WALK_MIN_DIST).toBeLessThan(HOP_FLOOR)
  })
})

// ── the companion page wires the system in additively ───────────────────────
// Guards the brief's requirement: the fidget/walk system is ADDED, the roaming
// "wander" invention is GONE, and the bubble and playful-motion wiring that already
// lived in pet.tsx is left intact.

describe('pet.tsx wiring', () => {
  const SOURCE = readFileSync(
    resolve(__dirname, '../apps/crew-companion/pet.tsx'),
    'utf-8',
  )

  it('mounts the walk, idle-fidget and random-clip hooks', () => {
    expect(SOURCE).toContain('useWalking(')
    expect(SOURCE).toContain('useIdleFidget(')
    expect(SOURCE).toContain('useRandomClips(')
  })

  it('no longer references the deleted roaming "wander" invention', () => {
    expect(SOURCE).not.toContain('useWander')
    expect(SOURCE).not.toContain('wanderMath')
    expect(SOURCE).not.toContain('dockEdgeFor')
  })

  it('still wires the bubble placement it always had', () => {
    expect(SOURCE).toMatch(/pickBubblePlacement|nextBubble/)
  })

  it('still wires the playful idle motion', () => {
    expect(SOURCE).toContain('usePlayfulMotion')
  })

  it('docks by checking the edge when a walk ends', () => {
    expect(SOURCE).toContain('handleWalkEnd')
  })

  it('honours reduced motion at the gate', () => {
    expect(SOURCE).toContain('prefers-reduced-motion')
  })

  it('SUBSCRIBES to the reduced-motion query rather than reading it once', () => {
    // Read at render, the preference only refreshes when something else re-renders
    // the companion — and this overlay stays mounted for days.
    expect(SOURCE).toContain("window.matchMedia?.('(prefers-reduced-motion: reduce)')")
    expect(SOURCE).toContain("mq.addEventListener('change', onChange)")
    expect(SOURCE).toContain("mq.removeEventListener('change', onChange)")
  })
})

// ── the desktop cast, wired into the same page ──────────────────────────────
// The same cheap oracle, for the wiring `tsc` can type-check but not place: DOM
// ORDER inside the layer, which props reach the component, and that the poll keeps
// its bail-out. pet.tsx is a page ENTRY — it calls createRoot at import — so nothing
// can render <Companion/> and assert on the result.

describe('pet.tsx cast wiring', () => {
  const SOURCE = readFileSync(
    resolve(__dirname, '../apps/crew-companion/pet.tsx'),
    'utf-8',
  )

  it('renders the cast FIRST inside cc-pet-layer, beneath everything else', () => {
    // The stacking order is DOM order and nothing else: pet.html declares no
    // z-index for these, and the context menu self-elevates to 99999. A cast moved
    // below the bubble or the companion would paint over them.
    const layer = SOURCE.indexOf('className="cc-pet-layer"')
    const cast = SOURCE.indexOf('<CrewCast', layer)
    expect(layer).toBeGreaterThan(-1)
    expect(cast).toBeGreaterThan(-1)
    for (const later of ['cc-menu-host', 'cc-bubble-host', 'className="cc-pet"']) {
      expect(SOURCE.indexOf(later, layer)).toBeGreaterThan(cast)
    }
  })

  it('holds the cast back until the companion position has loaded', () => {
    // The same gate `.cc-pet` uses for its opacity. Without it the first poll paints
    // sprites — and reports their hitboxes — in the default corner.
    expect(SOURCE).toContain('ready={posReady}')
  })

  it('passes the derived cast, its overflow, and the companion position', () => {
    expect(SOURCE).toContain('cast={crew.cast}')
    expect(SOURCE).toContain('overflow={crew.overflow}')
    expect(SOURCE).toContain('petPos={pos}')
  })

  it('opens the crew world when a sprite is chosen', () => {
    expect(SOURCE).toContain('onSelect={openCrewWorld}')
  })

  it('forwards the cast rects on the one hitbox reporting path', () => {
    // A report that omits the cast clears it, so this argument is what keeps the
    // sprites clickable at all.
    expect(SOURCE).toContain('onRects={setCastRects}')
    expect(SOURCE).toMatch(/useMouseForward\(\{[^}]*cast: castRects/)
  })

  it('bails out of the crew poll when nothing the desktop draws has changed', () => {
    // Without this the interval hands React a fresh object every tick and the
    // companion re-renders for its whole lifetime with nothing on screen changing.
    expect(SOURCE).toContain('CREW_POLL_MS')
    expect(SOURCE).toContain('sameCrewView(prev, next) ? prev : next')
  })

  it('keeps the watcher handle so the poll has a snapshot to read', () => {
    expect(SOURCE).toContain('watcherRef.current = watcher')
    expect(SOURCE).toContain('watcherRef.current?.snapshot()')
    // The teardown must still stop the socket, not just drop the ref.
    expect(SOURCE).toContain('watcher.stop()')
  })

  it('drives the companion pose from the aggregate, under its own reactions', () => {
    expect(SOURCE).toContain('restingPetState(crew.aggregate, petState)')
    expect(SOURCE).toContain('state={shownState}')
  })

  it('takes the MOTION from motionPetState, not from the held art', () => {
    // A one-shot keyframe driven by a state that persists holds its end frame; the
    // art may sit in a pose indefinitely, the keyframes may not.
    expect(SOURCE).toContain('motionPetState(crew.aggregate, petState)')
    expect(SOURCE).toMatch(/activeAnimFor\(\{\s*\n\s*state: motionState,/)
  })

  it('celebrates ARRIVING at ready through the same react() a completion uses', () => {
    expect(SOURCE).toContain("if (crew.aggregate === 'ready') react('done', CELEBRATE_MS)")
    expect(SOURCE).toContain("react('error', AGGREGATE_ERROR_MS)")
    // Never restart a reaction the companion is already playing.
    expect(SOURCE).toContain("if (petStateRef.current !== 'idle') return")
  })

  it('replays the head-cock while an agent waits on the user', () => {
    expect(SOURCE).toContain('ATTENTION_REPLAY_MS')
    expect(SOURCE).toContain('if (cockingRef.current) bumpReaction()')
    expect(SOURCE).toContain("cockingRef.current = activeAnim === 'curious' && !reducedMotion")
  })

  it('stops idle fidgets while the crew is already moving the body', () => {
    // activeAnimFor only surfaces a fidget while the motion state is idle, so without
    // this the fidget would consume its turn from the pool and play nothing.
    expect(SOURCE).toContain("motionState === 'idle'")
  })
})
