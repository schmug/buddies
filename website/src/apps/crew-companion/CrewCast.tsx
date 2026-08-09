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
import { useAttentionReplay } from './useAttentionReplay'
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
 * A turn blocked on the user wears the `needs-input` pose, and keeps the `curious`
 * mood alongside it: `curious` is the face the companion already uses for an approval
 * bubble (see pet.tsx's `onApproval`), and it selects the SAME head-cock that
 * `PetAvatar.STATE_TO_ANIM` gives `needs-input`, so the mood and the state cannot
 * fight over one body. Waiting on you is a question, not a failure, so it must not
 * borrow the error shake.
 *
 * Only `running` and `needs-input` can reach the cast (`isCastEligible`); anything
 * else falls back to the resting pose rather than throwing at a caller that has
 * already decided to draw something.
 */
export function castAppearance(state: AgentState): CastAppearance {
  if (state === 'needs-input') return { state: 'needs-input', mood: 'curious' }
  if (state === 'running') return { state: 'loading' }
  return { state: 'idle' }
}

/** The companion's resting pose for each aggregate crew state. */
const AGGREGATE_TO_PET: Record<AgentState, PetState> = {
  'needs-input': 'needs-input',
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
 * Aggregate states whose motion the companion may follow for as long as it is in
 * them, rather than being flattened to `idle`.
 *
 * Only `running` sustains itself: `kg-ponder` is `infinite`, so being in the state is
 * the whole mechanism. `needs-input` does NOT — `kg-curious` is a 2000ms one-shot, so
 * every surface holding it must replay the keyframes on `ATTENTION_REPLAY_MS`
 * (`useAttentionReplay`, and pet.tsx's own reaction epoch) or it settles to neutral.
 * `idle`'s membership is inert: `AGGREGATE_TO_PET['idle']` is `idle`, so both branches
 * below return the same value and its motion is whatever fidget `IDLE_FIDGET_ANIMS`
 * offered — a pool of bounded one-shots, not a loop, and chosen by the caller rather
 * than by this set. It is listed so the set reads as a full enumeration of the states
 * that are not flattened.
 *
 * Everything else resolves to a one-shot keyframe — `kg-celebrate` (900ms) and
 * `kg-error` (800ms). Both end back at neutral and neither is in `POSED_ANIMS`, so
 * holding one past its run costs nothing visually: the companion sits at its resting
 * transform with cursor tracking live, exactly as if no animation were set.
 *
 * The cost is that `activeAnimFor` still returns non-null, and its ambient branch
 * surfaces an idle fidget only while the state is `idle`. So an aggregate that
 * persists starves the fidget: one finished-but-unread session would leave the
 * companion inert for as long as it stayed unread, because `ready` outranks `running`
 * in `crewStatus`'s priority order and nothing would clear it but the user.
 */
const SUSTAINED_MOTION: ReadonlySet<AgentState> = new Set<AgentState>([
  'running',
  'needs-input',
  'idle',
])

/**
 * What the companion's MOTION is computed from — the same inputs as
 * `restingPetState`, answering a different question.
 *
 * `restingPetState` chooses the ART, which may sit in a pose indefinitely.
 * This chooses the KEYFRAMES, which may not: a celebration is a reaction to ARRIVING
 * at `ready`, not a property of BEING there. The arrival is carried by the reaction —
 * `pet.tsx` raises one through the same `react()` path a completion bubble uses — so
 * once that reaction expires the motion settles to nothing while the art keeps
 * showing what the crew's condition is.
 */
export function motionPetState(aggregate: AgentState, reaction: PetState): PetState {
  if (reaction !== 'idle') return reaction
  return SUSTAINED_MOTION.has(aggregate) ? AGGREGATE_TO_PET[aggregate] : 'idle'
}

/**
 * Whether two crew snapshots would draw the same desktop.
 *
 * The overlay re-derives its status on a timer, so without this every tick would be
 * a fresh object and the companion would re-render for its whole lifetime — hours or
 * days — with nothing on screen changing. Only the fields the desktop actually draws
 * are compared: `agents` carries the whole crew for other surfaces, and an idle
 * agent's `since` ticking over is not a repaint.
 *
 * `slotKey` is NOT compared, and that rests on a transport invariant this module
 * cannot enforce: `sessionWatch.snapshot()` derives both `id` and `slotKey` from the
 * same slot string, so equal ids imply equal slot keys. A transport that ever
 * decoupled the two would have to be compared here as well — `slotKey` is what
 * `onSelect` carries, so a change it missed would leave a sprite pointing at the
 * wrong session.
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
  /**
   * Whether `petPos` is the companion's REAL position yet.
   *
   * `useDrag` loads the saved position behind a timer plus an async bridge call, so
   * until it lands `petPos` is the default bottom-right corner. Drawing there would
   * put sprites beside an invisible companion (`.cc-pet` holds itself at opacity 0
   * for the same window) and — worse — report their hitboxes at those coordinates,
   * so a region of the user's desktop would swallow clicks with nothing drawn in it.
   */
  ready: boolean
  petPos: { x: number; y: number }
  onSelect: (slotKey: string) => void
  onRects: (rects: HitRect[]) => void
}

export function CrewCast({
  cast, overflow, ready, petPos, onSelect, onRects,
}: CrewCastProps) {
  const reduced = useReducedMotion()

  // Empty rather than an early return, so the rect-reporting effect below still runs
  // and clears the cast rather than leaving a stale set behind.
  const placed = useMemo(
    () =>
      (ready ? cast : []).map((agent, i) => {
        const { dx, dy } = castSlotOffset(i, cast.length)
        return { agent, x: petPos.x + dx, y: petPos.y + dy }
      }),
    [ready, cast, petPos.x, petPos.y],
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

  /*
   * A sprite wearing the head-cock is HOLDING a 2000ms one-shot, so without this it
   * settles to neutral and is the stillest thing on the desktop — beside `running`
   * sprites that bob forever. The main companion is replayed the same way from
   * pet.tsx; this is the cast's half of that.
   */
  const attentionEpoch = useAttentionReplay(
    placed.some(({ agent }) => agent.state === 'needs-input'),
  )

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
            /*
             * Entry only, and no `exit`. An exit variant needs an <AnimatePresence>
             * to keep the node mounted while it plays, and that node would outlive
             * its reported rect — a visible sprite over click-through desktop, which
             * is the one failure mode the rect reporting exists to prevent. A
             * departure animation belongs with the change that reports rects from the
             * PAINTED position rather than the spring's target.
             */
            initial={reduced ? false : { opacity: 0, scale: 0.6, x, y }}
            animate={{ opacity: 1, scale: 1, x, y }}
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
            {/*
              The epoch goes ONLY to the sprite holding the one-shot. `ponder-loop` is
              `infinite`, so remounting a busy sprite would restart its bob part-way
              through a cycle and read as a stutter.
            */}
            <PetAvatar
              size={CAST_PX}
              state={look.state}
              mood={look.mood}
              animEpoch={look.state === 'needs-input' ? attentionEpoch : 0}
            />
          </motion.button>
        )
      })}

      {/* The badge is anchored to petPos too, so it waits for the same gate. */}
      {ready && overflow > 0 ? (
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
