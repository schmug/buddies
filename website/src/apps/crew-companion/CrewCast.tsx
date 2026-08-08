/**
 * CrewCast — the per-agent sprites that trail the main companion, plus the pure
 * rules that turn crew status into a desktop appearance.
 *
 * Its own file rather than more of pet.tsx, which is already past a thousand lines.
 *
 * The sprites share ONE animation driver: Framer Motion's spring on each sprite's
 * target offset. Giving each sprite its own rAF loop would be N loops for decoration.
 *
 * Every sprite reports a hitbox, because the overlay is click-through except over
 * reported rects — an unreported sprite would look clickable and do nothing. The
 * overflow badge deliberately reports none: it is a readout, not a control, and
 * every reported rect is a hole in the desktop's click-through.
 */
import { useEffect, useMemo, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

import { PetAvatar, type PetState } from './PetAvatar'
import { castSlotOffset, CAST_PX } from './castLayout'
import type { AgentState, CrewAgent, CrewStatus } from './crewStatus'
import type { HitRect } from './hitbox'
import { i18nT } from '../../i18n/t'
import { fmtNumber } from '../../i18n/format'

/** How a sprite looks for one agent state: the pack slot, and the face over it. */
export interface CastAppearance {
  state: PetState
  mood?: string
}

/**
 * What a cast member looks like.
 *
 * `PetState` has no slot for "waiting on you", so both cast states wear the busy
 * pose and the MOOD carries the difference: a turn blocked on the user's approval
 * has not stopped running, and `curious` is the face the companion already uses for
 * an approval bubble (see pet.tsx's `onApproval`) — waiting on you is a question,
 * not a failure, so it must not borrow the error shake.
 *
 * Only `running` and `needs-input` can reach the cast (`isCastEligible`); anything
 * else falls back to the resting pose rather than throwing at a caller that has
 * already decided to draw something.
 */
export function castAppearance(state: AgentState): CastAppearance {
  if (state === 'needs-input') return { state: 'loading', mood: 'curious' }
  if (state === 'running') return { state: 'loading' }
  return { state: 'idle' }
}

/** The companion's resting pose for each aggregate crew state. */
const AGGREGATE_TO_PET: Record<AgentState, PetState> = {
  'needs-input': 'loading',
  blocked: 'error',
  ready: 'done',
  running: 'loading',
  idle: 'idle',
}

/**
 * What the main companion should wear, given the crew's aggregate and whatever
 * reaction it is already showing.
 *
 * The reaction wins whenever there is one. A reaction describes a specific event
 * that just happened — a completion, a failure, a breathing phase the overlay is
 * driving — while the aggregate is the ambient condition underneath it, so an
 * aggregate that overrode a reaction would swallow the more informative signal.
 */
export function restingPetState(aggregate: AgentState, reaction: PetState): PetState {
  return reaction === 'idle' ? AGGREGATE_TO_PET[aggregate] : reaction
}

/**
 * Whether two crew snapshots would draw the same desktop.
 *
 * The overlay re-derives its status on a timer, so without this every tick would be
 * a fresh object and the companion would re-render for its whole lifetime — hours or
 * days — with nothing on screen changing. Only the fields the desktop actually draws
 * are compared: `agents` carries the whole crew for other surfaces, and an idle
 * agent's `since` ticking over is not a repaint.
 */
export function sameCrewView(a: CrewStatus, b: CrewStatus): boolean {
  if (a.aggregate !== b.aggregate || a.overflow !== b.overflow) return false
  if (a.cast.length !== b.cast.length) return false
  return a.cast.every((agent, i) => {
    const other = b.cast[i]
    return agent.id === other.id && agent.state === other.state && agent.name === other.name
  })
}

/** Badge inset from the companion's own corner, so it overlaps the body slightly. */
const OVERFLOW_DX = 10
const OVERFLOW_DY = 4
const OVERFLOW_RADIUS_PX = 10
/** Small, but above the 10px floor the typography rules set. */
const OVERFLOW_FONT_PX = 11

export interface CrewCastProps {
  cast: CrewAgent[]
  /** Cast-eligible agents that did not fit under the cap, shown as a count. */
  overflow: number
  petPos: { x: number; y: number }
  onSelect: (slotKey: string) => void
  onRects: (rects: HitRect[]) => void
}

export function CrewCast({ cast, overflow, petPos, onSelect, onRects }: CrewCastProps) {
  const reduced = useReducedMotion()

  const placed = useMemo(
    () =>
      cast.map((agent, i) => {
        const { dx, dy } = castSlotOffset(i, cast.length)
        return { agent, x: petPos.x + dx, y: petPos.y + dy }
      }),
    [cast, petPos.x, petPos.y],
  )

  // Report rects from an effect rather than during render: the parent forwards them
  // to the main process, and a setState during render would be a React violation.
  // The key guard is what keeps an unchanged frame off the IPC path.
  const lastKey = useRef<string | null>(null)
  useEffect(() => {
    const rects: HitRect[] = placed.map((p) => ({ x: p.x, y: p.y, w: CAST_PX, h: CAST_PX }))
    const key = JSON.stringify(rects)
    if (key === lastKey.current) return
    lastKey.current = key
    onRects(rects)
  }, [placed, onRects])

  return (
    <>
      {placed.map(({ agent, x, y }) => {
        const look = castAppearance(agent.state)
        return (
          <motion.button
            key={agent.id}
            type="button"
            aria-label={i18nT('apps.crewCompanion.cast.open_in_worlds', { name: agent.name })}
            onClick={() => onSelect(agent.slotKey)}
            initial={reduced ? false : { opacity: 0, scale: 0.6, x, y }}
            animate={{ opacity: 1, scale: 1, x, y }}
            exit={reduced ? undefined : { opacity: 0, scale: 0.6 }}
            transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 18 }}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: CAST_PX,
              height: CAST_PX,
              padding: 0,
              border: 'none',
              background: 'transparent',
              pointerEvents: 'auto',
              cursor: 'pointer',
            }}
          >
            <PetAvatar size={CAST_PX} state={look.state} mood={look.mood} />
          </motion.button>
        )
      })}

      {overflow > 0 ? (
        <div
          role="status"
          aria-label={i18nT('apps.crewCompanion.cast.more_agents', { count: overflow })}
          style={{
            position: 'absolute',
            left: petPos.x - OVERFLOW_DX,
            top: petPos.y - OVERFLOW_DY,
            background: 'var(--accent)',
            color: 'var(--accent-fg, var(--bg))',
            borderRadius: OVERFLOW_RADIUS_PX,
            padding: '1px 7px',
            fontSize: OVERFLOW_FONT_PX,
            fontWeight: 'bold',
            pointerEvents: 'none',
          }}
        >
          +{fmtNumber(overflow)}
        </div>
      ) : null}
    </>
  )
}
