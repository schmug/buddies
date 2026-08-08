/**
 * PetCastScene — the crew as its own characters.
 *
 * The only DOM scene. Every other scene draws pixel art into a canvas, but this one
 * renders the SAME appearance packs the desktop pet uses, and a Lottie pack cannot be
 * drawn into a 2D context. Sharing PetAvatar is the point: the creature trailing your
 * pet on the desktop and the creature in this scene are one character, not two
 * drawings that drift apart.
 *
 * `visible` still gates animation. Every scene stays mounted and is hidden with CSS,
 * so a scene that animated while hidden would burn frames for all nine at once.
 */
import { useEffect, useMemo, useRef } from 'react'
import type { AgentSource } from '../../hooks/useAgentSync'
import {
  deriveCrewStatus,
  type AgentKind,
  type AgentState,
  type StatusInput,
} from '../../apps/crew-companion/crewStatus'
import { PetAvatar, type PetState } from '../../apps/crew-companion/PetAvatar'
import { useAgentPopover } from '../../hooks/useAgentPopover'
import { i18nT } from '../../i18n/t'

const CHARACTER_PX = 96

/** Horizontal room for the name and state lines either side of the art. */
const CHARACTER_GUTTER_PX = 24

/**
 * Which pet appearance each crew state wears.
 *
 * `needs-input` and `blocked` are the two that carry urgency, and the pack format
 * offers `done` (one hop) and `error` (one shake) for them. `needs-input` hops
 * because it is a question, not a failure — the shake belongs to the state that
 * really did break. `ready` shares the hop: both mean "your turn", and the state
 * line underneath is what separates them in words.
 */
const STATE_TO_PET: Record<AgentState, PetState> = {
  'needs-input': 'done',
  blocked: 'error',
  ready: 'done',
  running: 'loading',
  idle: 'idle',
}

const STATE_LABEL: Record<AgentState, string> = {
  'needs-input': 'pages.scenes.petCastScene.needs_you',
  blocked: 'pages.scenes.petCastScene.blocked',
  ready: 'pages.scenes.petCastScene.ready',
  running: 'pages.scenes.petCastScene.working',
  idle: 'pages.scenes.petCastScene.idle',
}

/**
 * Colour per state, so the cast is readable before any label is.
 *
 * Design tokens only — a literal here would survive a theme switch and be the one
 * wrong colour on screen.
 */
const STATE_COLOR: Record<AgentState, string> = {
  'needs-input': 'var(--warn)',
  blocked: 'var(--danger)',
  ready: 'var(--ok)',
  running: 'var(--accent)',
  idle: 'var(--muted)',
}

/**
 * Adapt the SPA's agent list to what `crewStatus` derives from.
 *
 * `slotKey` addresses a chat session, so only a chat slot has one. Stripping
 * `^slot-` off every id leaves `cron-abc` as `cron-abc` — a cron id wearing a slot
 * key's name, which any consumer that resolves it would silently mis-address. A kind
 * with no session gets an empty key instead, which is unusable by construction.
 *
 * `failed` and `unread` are optional on `AgentSource` and are coerced here, once,
 * rather than at each read. They are also NOT symmetric in durability: `unreadSlots`
 * is persisted to localStorage while `failedSlots` lives only in memory, so a reload
 * drops every `failed` and keeps every `unread`.
 */
export function toStatusInputs(agents: AgentSource[]): StatusInput[] {
  return agents.map((a) => ({
    id: a.id,
    slotKey: a.kind === 'slot' ? a.id.replace(/^slot-/, '') : '',
    name: a.name,
    kind: a.kind,
    running: a.running,
    waitingForInput: !!a.waitingForInput,
    pendingApproval: !!a.pendingApproval,
    failed: !!a.failed,
    unread: !!a.unread,
    // The SPA has no per-agent entry timestamp, so every agent ties and the sort
    // falls back to state rank alone — which is the ordering this scene wants.
    since: 0,
  }))
}

/** Gap between a character and the popover anchored under it. */
const ANCHOR_GAP_PX = 6

/**
 * Where the tooltip and thread popover attach, relative to the scene container.
 *
 * BELOW the character, never over it. The popover is 272px wide and ~250px tall, so
 * anchoring at the character's own origin paints it across the character — and the
 * second click, which is the gesture that closes the popover, then hit-tests onto the
 * popover instead and the character can never be clicked again. Only a real cursor
 * observes this: `element.click()` dispatches straight at the node and never consults
 * what is painted on top of it.
 */
export function characterAnchor(
  box: { offsetLeft: number; offsetTop: number; offsetHeight: number },
): { x: number; y: number } {
  return { x: box.offsetLeft, y: box.offsetTop + box.offsetHeight + ANCHOR_GAP_PX }
}

export default function PetCastScene(
  { agents, visible = true }: { agents: AgentSource[]; visible?: boolean },
) {
  const crew = useMemo(() => deriveCrewStatus(toStatusInputs(agents)), [agents])

  const popover = useAgentPopover(agents, {
    active: i18nT('pages.scenes.petCastScene.working'),
    idle: i18nT('pages.scenes.petCastScene.idle'),
  })

  /**
   * The popover dismisses on any capture-phase `pointerdown` outside its anchor, and
   * every character is a button wrapping an avatar and two spans — so the pointerdown
   * always lands on a DESCENDANT. Anchoring the whole scene (the canvas adapter's
   * shape, since a `<canvas>` is likewise one element covering every agent) is what
   * lets a second click toggle the popover shut instead of dismissing then reopening.
   */
  const containerRef = useRef<HTMLDivElement>(null)
  const { anchorRef } = popover
  useEffect(() => { anchorRef.current = containerRef.current }, [anchorRef])

  const sceneAgentFor = (agent: { id: string; name: string; state: AgentState; kind: AgentKind }) => ({
    id: agent.id, name: agent.name, x: 0, y: 0,
    running: agent.state === 'running', detail: '', kind: agent.kind,
  })

  return (
    <div
      ref={containerRef}
      data-testid="crew-scene"
      data-scene-paused={!visible}
      style={{
        position: 'absolute', inset: 0, borderRadius: 8, overflow: 'hidden',
        background: 'var(--bg-elevated)',
        border: '1.5px solid var(--border)',
        display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start',
        gap: 16, padding: 20,
      }}
    >
      {crew.agents.length === 0 ? (
        // Positioned rather than an auto-margin flex item: `alignContent: flex-start`
        // leaves a wrapped line no free vertical space to absorb, so `margin: auto`
        // centres horizontally and pins the text to the top.
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: 'var(--muted)', fontSize: 13,
          }}
        >
          {i18nT('pages.scenes.petCastScene.no_agents_right_now')}
        </div>
      ) : null}

      {crew.agents.map((agent) => (
        <button
          key={agent.id}
          type="button"
          aria-label={i18nT('pages.scenes.petCastScene.open_session', { name: agent.name })}
          onMouseEnter={(e) => popover.hover(sceneAgentFor(agent), characterAnchor(e.currentTarget))}
          onMouseLeave={popover.clearHover}
          onClick={(e) => popover.open(sceneAgentFor(agent), characterAnchor(e.currentTarget))}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            background: 'transparent', border: 'none', cursor: 'pointer', padding: 4,
            width: CHARACTER_PX + CHARACTER_GUTTER_PX,
            fontFamily: 'var(--font-body, inherit)',
          }}
        >
          {/*
            A hidden scene must not animate: nine scenes stay mounted at once, and a
            Lottie pack autoplays the moment its player mounts. There is no pause on
            the player, so the only honest way to stop it is not to mount it — the
            placeholder holds the character's footprint so the layout does not jump
            when the scene comes back.
          */}
          <span style={{ width: CHARACTER_PX, height: CHARACTER_PX, display: 'block' }}>
            {visible ? <PetAvatar state={STATE_TO_PET[agent.state]} size={CHARACTER_PX} /> : null}
          </span>
          <span
            style={{
              color: 'var(--text)', fontSize: 12, maxWidth: '100%',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {agent.name}
          </span>
          <span style={{ color: STATE_COLOR[agent.state], fontSize: 11 }}>
            {i18nT(STATE_LABEL[agent.state])}
          </span>
        </button>
      ))}

      {popover.elements}
    </div>
  )
}
