# Desktop pet cast + crew world — design

**Date:** 2026-08-08
**Status:** approved, not yet planned
**Scope:** `website/src/apps/crew-companion/`, `website/electron/crew-companion/`,
`website/src/pages/scenes/`, `website/src/hooks/`, `website/src/store/dashboardSlice.ts`

## Problem

Kiro Crew already ships a wandering desktop pet (`crew-companion`) and an animated
agent view (`agent-worlds`), but they are unconnected — there is no reference to
either app from the other, in either direction. More importantly the two model agent
activity differently:

- The pet reacts to **discrete events**. `sessionWatch` raises a bubble when a turn
  ends or an approval lands, then discards the state. At rest the pet has no notion
  of "three agents running, one waiting on me".
- The world renders a **continuous list** of agents, but only inside the dashboard
  SPA, drawn as hand-authored pixel art unrelated to the pet's appearance packs.

The goal is the Codex-pets model adapted to this codebase: a pet whose resting
appearance reflects aggregate crew status, a cast of per-agent sprites on the
desktop, and one world scene whose characters are those same pets.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Where the work lands | Extend `crew-companion` | The overlay, cursor hit-testing, walking, bubbles, and appearance gallery already work and were non-trivial to get right |
| What the main pet represents | Aggregate across all agents, **plus** per-agent sprites | Requested; the aggregate matches Codex, the cast makes the desktop legible as a crew |
| Desktop cast membership | Chat slots in an active turn (`running` or `needs-input`), capped at 4 | Keeps the desktop readable; crons and subagents appear in the world but do not wander over your work. See [Cast membership](#cast-membership) for why an approval-blocked turn counts as active |
| The "dedicated agent world" | A ninth scene in Agent Worlds whose characters are the pets | One shared cast across both surfaces; reuses the existing scene registry and pop-out |
| Status ownership | Shared pure derivation, per-surface transport | The overlay and the SPA genuinely have different plumbing; only the rules are shared |
| Docs | Create `docs/system-specs/modules/crew-companion.md` | The app has no spec today; mochi has one |

## Status model

New module `website/src/apps/crew-companion/crewStatus.ts`. Pure — no React, no
sockets, no DOM — following the precedent of `walkMath`, `bubbleLayout`, `petAnim`,
and `completionGate`.

```ts
export type AgentState = 'needs-input' | 'blocked' | 'ready' | 'running' | 'idle'

/** What a transport must supply per agent. Unknown fields default to false. */
export interface StatusInput {
  id: string; slotKey: string; name: string
  running: boolean
  waitingForInput: boolean
  pendingApproval: boolean
  failed: boolean
  unread: boolean
  /** When the agent entered its current condition, for a stable tie-break. */
  since: number
}

export interface CrewAgent {
  id: string; slotKey: string; name: string
  state: AgentState
  /** When the agent entered `state`, for a stable tie-break within a priority. */
  since: number
}

export interface CrewStatus {
  agents: CrewAgent[]     // every agent, sorted by priority then longest-in-state
  aggregate: AgentState   // highest-priority state present; 'idle' when none
  cast: CrewAgent[]       // the capped desktop subset
  overflow: number        // cast-eligible agents beyond the cap
}
```

**Priority, highest first: `needs-input` → `blocked` → `ready` → `running` → `idle`.**
This ordering is the module's reason to exist and matches Codex's documented
behaviour.

Per-agent derivation, first match wins:

1. `pendingApproval || waitingForInput` → `needs-input`
2. `failed` → `blocked`
3. `!running && unread` → `ready`
4. `running` → `running`
5. otherwise → `idle`

### Cast membership

The desktop cap (4) is applied inside the module, so the desktop and the world can
never disagree about who is on stage.

Cast membership is **chat slots in an active turn**, which is `state === 'running'`
**or** `state === 'needs-input'`. The second half is not a widening of the agreed
"running slots only" rule so much as a correction to it: a turn blocked on your
approval has not stopped running, and `needs-input` is the highest-priority state
there is — a rule that let the one agent actually waiting on you be the one absent
from your desktop would defeat the feature.

`ready`, `blocked`, and `idle` agents are therefore not cast members. They still
appear in `agents`, so the world scene shows them and the aggregate reflects them;
they simply do not wander over your work. Crons and subagents are never cast members
regardless of state.

`cast` is filled from `agents` in priority order, so when more than four agents are
eligible, `needs-input` always makes the cut before `running`. `overflow` counts the
eligible agents that did not fit.

### Degradation

On transport disconnect the model degrades toward `idle` and empties `cast`. It must
never freeze on `running`: a pet that keeps reporting work after the gateway went
away is worse than one that goes quiet. This mirrors the three-state rule already
documented in `website/electron/crew-companion/index.js` — unknown is not disabled,
but a *known* disconnect is not "still running" either.

## Transports

### Overlay (`pet.html`)

Its own WebSocket, no Redux store. `sessionWatch.ts` grows from an event emitter into
a state keeper: it already tracks `startedAt`, `titles`, `failedSlots`, and
`stoppedSlots` internally, and already handles every frame required — `slots`,
`chat_status`, `chat_done`, `approval`, `approval_resolved`, and error-role
`chat_message`. Today that state is discarded after a callback fires; it will
additionally be exposed as `StatusInput[]`.

The existing `onDone` / `onApproval` / `onApprovalResolved` callbacks keep their
current semantics, so bubbles and the completion gate are unaffected. The change is
purely additive.

### Dashboard SPA

Redux + SSE. `useAgentSync` already supplies `running`, `waitingForInput`, and
`pendingApproval`. `unread` comes from `dashboard.unreadSlots`, which already exists
and is already persisted.

**The `failed` asymmetry.** `ChatSlot` carries `running`, `stopping`,
`pending_approval`, `waiting_for_input`, and `stop_state`, but no failure field. A
failed turn is observable only as a `chat_message` with `role: 'error'` — which is
exactly why `sessionWatch` tracks it that way.

The SPA does receive those frames: `useSSE.ts` listens for `chat_message` and
dispatches `sseChatMessage`, but that action lives in `chatSlice` and appends to the
active transcript, keeping no per-slot failure record.

Resolution, requiring no change to `useSSE.ts`: `dashboardSlice` adds a `failedSlots`
record via `extraReducers` on the same `sseChatMessage` action — set on
`role === 'error'`, cleared on that slot's next turn start.

**Verify before building:** that the SSE `chat_message` stream carries frames for
non-active slots. The WebSocket equivalent does. If SSE turns out to be scoped to the
active slot, the fallback is for the world scene to use `sessionWatch` directly — it
is deliberately not a hook and opens its own same-origin socket, so it works
unmodified in the SPA at the cost of a second connection.

## Pack vocabulary

`PetState` is currently `idle | loading | done | error` plus breathing phases. Mapping:

| AgentState | Pack slot |
|---|---|
| `running` | `loading` |
| `ready` | `done` |
| `blocked` | `error` |
| `needs-input` | **new slot** |
| `idle` | `idle` |

Adding a slot is safe: `REQUIRED_STATES` is only `['idle']` and every other slot falls
back through the animation resolver. Existing custom packs keep working and show idle
art while waiting on the user; the bubble still carries the message.

## Desktop cast

New `CrewCast.tsx`, a sibling layer to the pet inside the same overlay. `pet.tsx` is
already 1,230 lines, so the cast does not go there.

**Motion.** Cast sprites do not each get a `useWalking` instance; N rAF loops for
decorative followers is waste. Each sprite holds a stable offset in a loose trail
behind the main pet and lerps toward it in one shared frame loop, with per-sprite
stagger. A sprite walks out from the main pet when its slot joins the cast and walks
back into it when the slot leaves.

**Click-through.** The overlay covers whole displays and is click-through except over
reported hitboxes; this rule is load-bearing, because a window that swallowed clicks
would make the machine unusable. The current IPC contract is
`crew-companion:update-hitbox(pet, bubble)`, merged into `{pet, bubble, menu}` in
`petOverlay.js`. It extends to carry `cast: Rect[]`, tested by `cursorHitsWindow`
alongside the existing three. `pointInRect`, `cursorHitsWindow`, and
`refreshOverlayInput` are already exported for tests.

Interactions: clicking a cast sprite focuses that slot; clicking the main pet opens
the crew world.

**Overflow** renders as a count on the main pet, never as more sprites.

**Reduced motion** (`prefers-reduced-motion`) pins every sprite to a still frame and
suppresses wandering, matching Codex's documented behaviour.

**Multi-display: one pet per monitor, by design.** The build does not avoid showing a
pet per display — it intends to. Three independent statements in the code agree:

- `useMouseForward`'s header describes "this build's single-display-per-overlay model",
  where "each overlay renders the companion independently and the main process never
  transfers a pet between displays".
- `petBridge`'s cross-display drag hooks are deliberately left undefined because "each
  display has its own overlay, so a drag is handled entirely within the one the pointer
  is in".
- `openPetWindow` iterates `screen.getAllDisplays()` and loads the same `pet.html` into
  an overlay on each.

So `CrewCast` renders in **every** overlay, each instance following its own display's
pet. No leader election, no coordination, no per-display gating.

One inherited consequence to be aware of rather than fix: position persists globally as
a single `petX` / `petY` pair, so every display's pet sits at the same coordinates and
dragging one moves them all. The cast is positioned relative to `pos`, so it inherits
that behaviour consistently.

## World scene

`PetCastScene.tsx`, registered in `scenes/config.tsx` and `scenes/components.ts`. The
`SCENE_COMPONENTS` contract is `ComponentType<{agents, visible}>`, so the registry
does not change.

It is **DOM, not canvas** — the first such scene. Forced by the art: `PetAvatar`
resolves svg / lottie / sprite packs with colour maps applied, and Lottie cannot be
drawn into a 2D canvas context. It is also correct: reusing `PetAvatar` is what makes
the desktop cast and the world cast the same characters rather than two art pipelines
that drift.

Consequence: there is no `useSceneLoop`, so the `visible` prop must still gate
animation. A hidden scene pauses its Lottie players and its follow loop, or eight
scenes' worth of idle animation runs permanently.

### Required refactor

`useSceneInteraction` is 475 lines doing two jobs: canvas hit-testing, and the whole
popover stack (tooltip, mini thread with 2s refresh, composer with steer-vs-send,
approve / deny, "New session"). A DOM scene needs the second and none of the first.

Extract `useAgentPopover(sources)` holding all popover state and elements, driven by
`hover(agent, at)` / `open(agent, at)`. `useSceneInteraction` becomes a thin canvas
adapter that does coordinate math and delegates. The eight canvas scenes see no
behavioural change; the DOM scene calls the popover from real DOM events with no
coordinate math.

The alternative is a second popover implementation, which the jscpd `pretest`
duplication check would fail before any test ran.

## Linking the surfaces

The main pet's context menu gains "Open crew world": write `mc-agent-scene = 'crew'`
to localStorage, then open `/worlds-popout`. Both mechanisms exist — the pop-out route
is registered outside the app shell in `main.tsx` and reads that key on mount, and
`usePopoutSync` broadcasts scene changes on the existing `BroadcastChannel`.

Two guards:

- The world scene must work with the desktop app closed. It does: the SPA path derives
  status from `useAgentSync` regardless of Electron.
- Both apps are `defaultEnabled: false` and toggle independently. When Agent Worlds is
  disabled the menu item needs a defined state, rather than opening a route that
  redirects to chat.

## Testing

- **vitest** — `crewStatus` carries the heaviest coverage, since it holds every rule:
  priority ordering, cast membership (including an approval-blocked turn counting as
  active, and a `needs-input` agent displacing a `running` one at the cap), cap and
  overflow, tie-breaks, unknown-field defaults, and disconnect degradation. Then
  `useAgentPopover` (behaviour preserved across the
  extraction), `PetCastScene` rendering per state, and `sessionWatch`'s snapshot
  alongside its existing callbacks.
- **electron node:test** — extend `test/petHitbox.test.js`, which already drives the
  toggle directly rather than through the live cursor poll, to cover cast rects.
- **playwright** — add the scene to `builtin-apps.spec.ts`.
- **Gates** — `npx tsc -b` (**not** `npm run typecheck`: the root tsconfig has
  `"files": []`, so it checks zero files and always passes), then `npm run build` and
  `npm run test`. jscpd runs as `pretest`.

## File inventory

**New**

- `website/src/apps/crew-companion/crewStatus.ts` (+ test)
- `website/src/apps/crew-companion/CrewCast.tsx` (+ test)
- `website/src/pages/scenes/PetCastScene.tsx` (+ test)
- `website/src/hooks/useAgentPopover.tsx` (+ test)
- `docs/system-specs/modules/crew-companion.md`, added to that directory's README index
  (`scripts/docs-lint.sh` enforces the index)

**Modified**

- `website/src/apps/crew-companion/sessionWatch.ts` — additive status snapshot
- `website/src/apps/crew-companion/pet.tsx` — cast layer, aggregate-driven state, menu item
- `website/src/apps/crew-companion/PetAvatar.tsx`, `appearanceTypes.ts` — `needs-input` slot
- `website/src/hooks/useSceneInteraction.tsx` — becomes a canvas adapter
- `website/src/pages/scenes/config.tsx`, `components.ts` — register the scene
- `website/electron/crew-companion/petOverlay.js`, `pet-preload.js` — cast hitboxes
- `website/src/store/dashboardSlice.ts` — `failedSlots`
- `website/src/hooks/useAgentSync.ts` — `failed`, `unread`
- `src/kiro_crew/apps/builtins/crew_companion/app.json` — description and highlights;
  the app's current copy promises breaks and reminders, which is no longer its main job
- `website/src/i18n/locales/*.json` — scene label and description, menu item, tooltips,
  overflow count, across 11 locales (CI-gated, lands with the code)

## Out of scope

- Any change to `mochi`, which has its own pet overlays and its own spec.
- A `hatch`-equivalent generator for pet art. The companion already has an appearance
  gallery and sprite importer; generating packs from a prompt is a separate feature.
- Backend ownership of crew status. Reconsider only if a third consumer (for example
  Slack) needs the same aggregate.
- Restoring the `agent-worlds` manifest claim that the app "never changes what your
  agents do" — that claim is already false today, since `useSceneInteraction` sends
  messages, resolves approvals, and creates slots. Worth a separate copy fix.
