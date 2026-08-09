# Desktop Pet Cast + Crew World Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `crew-companion` an aggregate crew-status model that drives the desktop pet's resting appearance, add a capped cast of per-agent sprites beside it, and add an Agent Worlds scene whose characters are those same pets.

**Architecture:** One pure derivation module (`crewStatus.ts`) owns every rule — state priority, cast membership, cap, overflow. Two transports feed it independently: the overlay via its existing WebSocket watcher, the dashboard SPA via Redux + SSE. Neither transport knows the rules; the module knows no transport.

**Tech Stack:** TypeScript, React 18, Redux Toolkit, Framer Motion, Vite, vitest, Electron (`node:test`), Playwright.

## Global Constraints

Copied from `AGENTS.md`, `website/AGENTS.md`, and the design spec. **Every task's requirements implicitly include this section.**

- **Type-check with `npx tsc -b`, never `npm run typecheck`.** The root `tsconfig.json` has `"files": []`, so `typecheck` checks zero files and always passes.
- **`npm test` runs `jscpd` as `pretest`.** Copy-pasted code fails the run before a single test executes.
- **Icons: `lucide-react` only**, with `className="lucide-inline"`. Never an emoji, never a hand-rolled SVG, never `size={N}` in new code.
- **Never hardcode a user-facing English string.** Add a catalog key. CI-gated by `npm run lint:i18n`.
- **Never format a date, number, or sort order without naming a locale.** Route through `src/i18n/format.ts`.
- **Styling uses design tokens** (`var(--bg)`, `var(--text)`, …), never a literal colour, in DOM code.
- **Animation is Framer Motion** in new DOM code. Do not add new CSS `@keyframes`.
- **Typography:** no `text-xs`, no text below 10px.
- **Accessibility:** `<Clickable>` over `<div onClick>`; `aria-label` on every icon-only button; `<Btn>` / `<SendBtn>` over raw `<button>`.
- **Product name is "Kiro Crew"** — two words, capital K. Verify with `BRAND_BASE_REF=origin/main python3 scripts/check_brand_name.py`.
- **Comments explain the why** — invariants, edge cases, units. No PR numbers, no "previously/used to", no restating what the code plainly does.
- **Commits:** conventional prefix (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`), summary max 72 chars, imperative, lowercase, no period. One logical change per commit.
- **Do not push and do not open a PR** unless the user explicitly asks.
- **Line length 100 chars.**

**Full-gate command** (run before the final commit of any task that touches `website/`):

```bash
cd website && npx tsc -b && npm run lint && npm run test
```

---

### Task 1: Resolve the two open questions before writing cast code

The spec records three verify-before-building items. One is already resolved: `chatSlice.ts` contains `applyNonActiveFrame`, documented as "apply a WS chat frame for a NON-active slot", which proves the SSE `chat_message` stream carries frames for every slot, not just the active one. Task 4 depends on that and may proceed.

The other two are open, and Task 7 cannot start until they are answered.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-08-desktop-pet-crew-world-design.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a written answer to "does the current build show one main pet per monitor?" that Task 7 reads.

- [ ] **Step 1: Determine whether each display renders its own main pet**

`openPetWindow` in `website/electron/crew-companion/petOverlay.js:99` creates one `BrowserWindow` per display, each loading `pet.html`. Position persists globally via `petBridge.savePosition` as `petX` / `petY`.

Read these, in order, looking for any per-display gating:

```bash
cd /Users/cory/KiroCrew/.claude/worktrees/agent-worlds-overview-d3c573
grep -n "screen\|display\|getAllDisplays\|primary" website/electron/crew-companion/petOverlay.js
grep -n "petX\|petY\|savePosition\|loadPosition" website/src/apps/crew-companion/petBridge.ts
grep -n "innerWidth\|innerHeight\|pos\b" website/src/apps/crew-companion/pet.tsx | head -40
```

- [ ] **Step 2: Confirm empirically on a multi-display machine, if one is available**

Enable Crew Companion in the dashboard App Store with a second monitor attached. Count the main pets on screen.

If no second display is available, say so explicitly in Step 4 rather than guessing. A single-display machine cannot answer this question.

- [ ] **Step 3: Check `PetAvatar` at cast size**

The cast renders at roughly 56px against the main pet's `PET_PX = 128`. `PetAvatar` takes a `size` prop and resolves svg / lottie / sprite packs.

```bash
grep -n "size" website/src/apps/crew-companion/PetAvatar.tsx | head -20
```

Render the built-in `kiro-ghost` pack at 56px in a scratch vitest or Storybook-style harness and confirm the eye overlay and accessory layers still land correctly — `PetAvatar` positions those relative to the body, so a small size is where they would visibly drift.

- [ ] **Step 4: Record the answers in the spec**

Replace the "Multi-display — resolve first" paragraph under `## Desktop cast` with the finding, in one of these two shapes:

*If one pet per display:* state that each overlay renders independently, and that `CrewCast` therefore renders in every overlay too — the cast follows its own display's pet, and Task 7's follow logic is per-overlay with no coordination needed.

*If a single pet across displays:* state which mechanism elects the owning overlay, and that `CrewCast` must render only in that same overlay.

Also record the cast-size finding, including any minimum size below which the built-in pack's eyes misalign.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-08-08-desktop-pet-crew-world-design.md
git commit -m "docs: record multi-display and cast-size findings"
```

---

### Task 2: The pure status model

**Files:**
- Create: `website/src/apps/crew-companion/crewStatus.ts`
- Test: `website/src/apps/crew-companion/crewStatus.test.ts`

**Interfaces:**
- Consumes: nothing. No React, no sockets, no DOM.
- Produces: `AgentState`, `StatusInput`, `CrewAgent`, `CrewStatus`, `DESKTOP_CAST_CAP`, `deriveCrewStatus(inputs: StatusInput[]): CrewStatus`. Every later task imports from here.

- [ ] **Step 1: Write the failing test**

Create `website/src/apps/crew-companion/crewStatus.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { deriveCrewStatus, DESKTOP_CAST_CAP, type StatusInput } from './crewStatus'

/** A slot with nothing happening. Spread and override one field per test. */
const base: StatusInput = {
  id: 'slot-a', slotKey: 'a', name: 'A',
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
    const waiting = { ...base, id: 'waiting', slotKey: 'w', running: true, pendingApproval: true, since: 99 }
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

describe('deriveCrewStatus — degradation', () => {
  it('returns an idle, empty crew when the transport has nothing', () => {
    const s = deriveCrewStatus([])
    expect(s).toEqual({ agents: [], aggregate: 'idle', cast: [], overflow: 0 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd website && npx vitest run src/apps/crew-companion/crewStatus.test.ts
```

Expected: FAIL — `Failed to resolve import "./crewStatus"`.

- [ ] **Step 3: Write the implementation**

Create `website/src/apps/crew-companion/crewStatus.ts`:

```ts
/**
 * crewStatus — what the crew is doing, as one pure decision.
 *
 * Every rule about agent state lives here: which state an agent is in, which state
 * the pet should wear when several disagree, who earns a sprite on the desktop, and
 * how many is too many. Nothing here knows about sockets, React, or the DOM, so both
 * surfaces — the overlay (its own WebSocket, no store) and the dashboard SPA (Redux +
 * SSE) — can feed it from the transport they already have and still agree.
 *
 * The same split as walkMath / bubbleLayout / petAnim / completionGate, for the same
 * reason: the rules are the part worth testing, and they should not need a browser.
 */

/**
 * An agent's state, in PRIORITY ORDER — highest first.
 *
 * The order is the behaviour, not a detail. When several agents are active the pet
 * wears the most demanding of their states, because a pet that reported "running"
 * while something waited on the user would be hiding the one thing worth surfacing.
 */
export type AgentState = 'needs-input' | 'blocked' | 'ready' | 'running' | 'idle'

const PRIORITY: readonly AgentState[] = ['needs-input', 'blocked', 'ready', 'running', 'idle']

/** Rank of a state, lower is more urgent. Used for both aggregate and sort. */
function rank(state: AgentState): number {
  return PRIORITY.indexOf(state)
}

/**
 * What a transport must supply per agent.
 *
 * `failed` is the one field neither transport gets for free: a slot record carries no
 * failure flag, so a broken turn is observable only as an error-role chat message.
 * Both transports track it themselves and pass it in here.
 */
export interface StatusInput {
  id: string
  slotKey: string
  name: string
  running: boolean
  waitingForInput: boolean
  pendingApproval: boolean
  failed: boolean
  unread: boolean
  /** When the agent entered its current condition, for a stable tie-break. */
  since: number
}

export interface CrewAgent {
  id: string
  slotKey: string
  name: string
  state: AgentState
  since: number
}

export interface CrewStatus {
  /** Every agent, most urgent first, ties broken by longest in state. */
  agents: CrewAgent[]
  /** The highest-priority state present, or 'idle' for an empty crew. */
  aggregate: AgentState
  /** The capped desktop subset, in the same order. */
  cast: CrewAgent[]
  /** Cast-eligible agents that did not fit under the cap. */
  overflow: number
}

/**
 * How many sprites may wander the desktop at once.
 *
 * Four rather than the world's eight: the world is a place you look at deliberately,
 * the desktop is where you are trying to work, and the whole point of a cap is that
 * the crew stays readable at a glance.
 */
export const DESKTOP_CAST_CAP = 4

/**
 * Cast membership: chat slots in an ACTIVE TURN.
 *
 * `needs-input` counts as active because a turn blocked on the user's approval has
 * not stopped running — and it is the highest-priority state there is, so a rule that
 * kept it off the desktop would hide exactly the agent that needs attention.
 *
 * `ready`, `blocked` and `idle` agents stay in `agents` (so the world shows them and
 * the aggregate reflects them) but do not wander over the user's work.
 */
function isCastEligible(state: AgentState): boolean {
  return state === 'running' || state === 'needs-input'
}

/** One agent's state. First match wins; the order mirrors PRIORITY. */
function stateFor(input: StatusInput): AgentState {
  if (input.pendingApproval || input.waitingForInput) return 'needs-input'
  if (input.failed) return 'blocked'
  if (!input.running && input.unread) return 'ready'
  if (input.running) return 'running'
  return 'idle'
}

/**
 * Derive the whole crew's status.
 *
 * An empty input is a complete, valid answer — an idle aggregate and an empty cast —
 * which is also what a disconnected transport supplies. That matters: a pet that
 * froze on its last known state would keep reporting work after the gateway went
 * away, which is worse than going quiet.
 */
export function deriveCrewStatus(inputs: StatusInput[]): CrewStatus {
  const agents: CrewAgent[] = inputs.map((input) => ({
    id: input.id,
    slotKey: input.slotKey,
    name: input.name,
    state: stateFor(input),
    since: input.since,
  }))

  agents.sort((a, b) => rank(a.state) - rank(b.state) || a.since - b.since)

  const eligible = agents.filter((a) => isCastEligible(a.state))

  return {
    agents,
    aggregate: agents.length ? agents[0].state : 'idle',
    cast: eligible.slice(0, DESKTOP_CAST_CAP),
    overflow: Math.max(0, eligible.length - DESKTOP_CAST_CAP),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd website && npx vitest run src/apps/crew-companion/crewStatus.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 5: Type-check and commit**

```bash
cd website && npx tsc -b
git add website/src/apps/crew-companion/crewStatus.ts website/src/apps/crew-companion/crewStatus.test.ts
git commit -m "feat: add pure crew status derivation for the companion"
```

---

### Task 3: Expose a status snapshot from the overlay's session watcher

**Files:**
- Modify: `website/src/apps/crew-companion/sessionWatch.ts`
- Test: `website/src/apps/crew-companion/sessionWatch.test.ts` (extend if present, create if not)

**Interfaces:**
- Consumes: `StatusInput` from Task 2.
- Produces: `watchSessions` returns `{ stop(): void; snapshot(): StatusInput[] }` instead of a bare stop function. Its `onDone` / `onApproval` / `onApprovalResolved` callbacks keep their exact current semantics. Task 7 calls `snapshot()`.

- [ ] **Step 1: Write the failing test**

Add to `website/src/apps/crew-companion/sessionWatch.test.ts`. If the file does not exist, create it with this content plus the imports it needs.

```ts
import { describe, it, expect, vi } from 'vitest'
import { watchSessions } from './sessionWatch'

/** A fake socket the test drives frame by frame. */
function fakeSocket() {
  const ws = { onopen: null, onmessage: null, onclose: null, onerror: null, close: vi.fn() } as unknown as WebSocket
  return ws
}

function send(ws: WebSocket, type: string, data: unknown) {
  ws.onmessage?.({ data: JSON.stringify({ type, data }) } as MessageEvent)
}

describe('watchSessions snapshot', () => {
  it('starts empty', () => {
    const ws = fakeSocket()
    const w = watchSessions({ onDone: vi.fn(), isSilent: () => false, connect: () => ws })
    expect(w.snapshot()).toEqual([])
    w.stop()
  })

  it('reports a running slot with its title', () => {
    const ws = fakeSocket()
    const w = watchSessions({ onDone: vi.fn(), isSilent: () => false, connect: () => ws })
    send(ws, 'slots', [{ key: 'a', running: true, title: 'Fix the parser' }])
    const snap = w.snapshot()
    expect(snap).toHaveLength(1)
    expect(snap[0]).toMatchObject({ slotKey: 'a', name: 'Fix the parser', running: true })
    w.stop()
  })

  it('marks a slot pending approval', () => {
    const ws = fakeSocket()
    const w = watchSessions({ onDone: vi.fn(), isSilent: () => false, connect: () => ws })
    send(ws, 'slots', [{ key: 'a', running: true, title: 'A' }])
    send(ws, 'approval', { slot: 'a' })
    expect(w.snapshot()[0].pendingApproval).toBe(true)
    w.stop()
  })

  it('clears pending approval when it resolves', () => {
    const ws = fakeSocket()
    const w = watchSessions({ onDone: vi.fn(), isSilent: () => false, connect: () => ws })
    send(ws, 'slots', [{ key: 'a', running: true, title: 'A' }])
    send(ws, 'approval', { slot: 'a' })
    send(ws, 'approval_resolved', { id: 'x' })
    expect(w.snapshot()[0].pendingApproval).toBe(false)
    w.stop()
  })

  it('marks a slot failed on an error-role message', () => {
    const ws = fakeSocket()
    const w = watchSessions({ onDone: vi.fn(), isSilent: () => false, connect: () => ws })
    send(ws, 'slots', [{ key: 'a', running: true, title: 'A' }])
    send(ws, 'chat_message', { slot: 'a', role: 'error', content: 'boom' })
    expect(w.snapshot()[0].failed).toBe(true)
    w.stop()
  })

  it('empties the snapshot when the socket closes, rather than freezing it', () => {
    const ws = fakeSocket()
    const w = watchSessions({ onDone: vi.fn(), isSilent: () => false, connect: () => ws })
    send(ws, 'slots', [{ key: 'a', running: true, title: 'A' }])
    ws.onclose?.({} as CloseEvent)
    expect(w.snapshot()).toEqual([])
    w.stop()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd website && npx vitest run src/apps/crew-companion/sessionWatch.test.ts
```

Expected: FAIL — `w.snapshot is not a function`.

- [ ] **Step 3: Implement the snapshot**

In `sessionWatch.ts`, keep every existing map and callback exactly as they are and add alongside them:

```ts
/** Slots with a tool blocked on the user right now. */
const pendingApproval = new Set<string>()
/** Slots that finished with activity the user has not seen. */
const unread = new Set<string>()
/** slot -> when its current condition began, for the status tie-break. */
const stateSince = new Map<string, number>()
```

Maintain them inside the existing `handle` switch, adding only these lines to cases that already exist:

- `slots`: for each entry, `if (!stateSince.has(s.key)) stateSince.set(s.key, now())`; when a slot stops being `running`, leave `stateSince` alone — the condition changed, so `stateSince.set(s.key, now())` on any change of `running`.
- `approval`: `pendingApproval.add(data.slot); stateSince.set(data.slot, now())`.
- `approval_resolved`: `pendingApproval.clear()` — the frame carries only an id, not a slot, which is the same limitation the existing `onApprovalResolved` comment already documents.
- `chat_done`: `unread.add(slot)` before `finish(slot)` runs.
- `chat_status`: `unread.delete(slot); failedSlots.delete(slot); stateSince.set(slot, now())` — a new turn clears the previous turn's outcome.

Add the snapshot builder and change the return:

```ts
  /**
   * The crew's current condition as `crewStatus` wants it.
   *
   * Built on demand rather than pushed, so a caller that renders at 60fps reads
   * whatever is true at that frame without this module owning a subscription.
   *
   * Returns EMPTY while the socket is down. A stale snapshot would leave the pet
   * reporting work that no longer has anywhere to run.
   */
  const snapshot = (): StatusInput[] => {
    if (!socket) return []
    const keys = new Set<string>([...titles.keys(), ...startedAt.keys()])
    return [...keys].map((slot) => ({
      id: `slot-${slot}`,
      slotKey: slot,
      name: titles.get(slot) ?? '',
      running: startedAt.has(slot),
      waitingForInput: false,
      pendingApproval: pendingApproval.has(slot),
      failed: failedSlots.has(slot),
      unread: unread.has(slot),
      since: stateSince.get(slot) ?? now(),
    }))
  }

  return {
    stop: () => { /* the existing teardown body, unchanged */ },
    snapshot,
  }
```

`waitingForInput` is `false` here because the WebSocket `slots` frame does not carry it; the overlay learns about work waiting on the user through `approval` instead. Record that as the comment on the field.

Update `pet.tsx`'s existing call site, which currently assigns the return value straight to a stop function:

```ts
const watcher = watchSessions({ /* existing options, unchanged */ })
// existing cleanup becomes:
return () => watcher.stop()
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd website && npx vitest run src/apps/crew-companion/sessionWatch.test.ts
```

Expected: PASS. If a pre-existing test asserted the old bare-function return, update it to `watcher.stop()` — that is the intended contract change, not a regression.

- [ ] **Step 5: Type-check and commit**

```bash
cd website && npx tsc -b
git add website/src/apps/crew-companion/sessionWatch.ts website/src/apps/crew-companion/sessionWatch.test.ts website/src/apps/crew-companion/pet.tsx
git commit -m "feat: expose a crew status snapshot from the session watcher"
```

---

### Task 4: Give the SPA the two fields it is missing

**Files:**
- Modify: `website/src/store/dashboardSlice.ts`
- Modify: `website/src/hooks/useAgentSync.ts`
- Test: `website/src/store/dashboardSlice.test.ts` (extend if present, create if not)

**Interfaces:**
- Consumes: `sseChatMessage` from `chatSlice`, `unreadSlots` from `dashboardSlice`.
- Produces: `dashboard.failedSlots: Record<string, boolean>`; `AgentSource` gains `failed: boolean` and `unread: boolean`. Task 9 reads both.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { store } from '../store'
import { sseChatMessage } from './chatSlice'
import { sseSlots } from './dashboardSlice'

describe('dashboard failedSlots', () => {
  it('records a slot whose turn emitted an error', () => {
    store.dispatch(sseChatMessage({ slot: 'a', role: 'error', content: 'boom' }))
    expect(store.getState().dashboard.failedSlots.a).toBe(true)
  })

  it('ignores non-error roles', () => {
    store.dispatch(sseChatMessage({ slot: 'b', role: 'assistant', content: 'fine' }))
    expect(store.getState().dashboard.failedSlots.b).toBeUndefined()
  })

  it('clears the flag when that slot starts running again', () => {
    store.dispatch(sseChatMessage({ slot: 'c', role: 'error', content: 'boom' }))
    store.dispatch(sseSlots([{ key: 'c', messages: 1, running: true }]))
    expect(store.getState().dashboard.failedSlots.c).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd website && npx vitest run src/store/dashboardSlice.test.ts
```

Expected: FAIL — `failedSlots` is undefined.

- [ ] **Step 3: Implement**

In `dashboardSlice.ts`, add to `DashboardState` and `initialState`:

```ts
  /**
   * Slots whose current turn emitted an error.
   *
   * ChatSlot carries no failure field, so a broken turn is observable only as a
   * chat_message with role 'error'. Recorded here rather than derived, because by
   * the time the turn ends the message has already scrolled past.
   */
  failedSlots: Record<string, boolean>
```

```ts
  failedSlots: {},
```

Clear the flag in the existing `sseSlots` reducer, which already replaces the slot list:

```ts
    sseSlots(state, action: PayloadAction<ChatSlot[]>) {
      state.slots = action.payload
      state.slotsLoaded = true
      // A slot that is running again has started a NEW turn, so the previous
      // turn's failure no longer describes it.
      for (const s of action.payload) {
        if (s.running && state.failedSlots[s.key]) delete state.failedSlots[s.key]
      }
    },
```

Add `extraReducers` to the slice, listening to `chatSlice`'s action so `useSSE.ts` needs no change:

```ts
  extraReducers: (builder) => {
    // ... any existing cases stay ...
    builder.addCase(sseChatMessage, (state, action) => {
      const { slot, role } = action.payload
      if (role !== 'error' || !slot || isUnsafeKey(slot)) return
      state.failedSlots[slot] = true
    })
  },
```

Import `sseChatMessage` from `./chatSlice`. `isUnsafeKey` is already imported in this file.

In `useAgentSync.ts`, add the two fields to `AgentSource`:

```ts
  /** The slot's current turn emitted an error. */
  failed?: boolean
  /** The slot finished with activity the user has not opened. */
  unread?: boolean
```

Read them in the `slotAgents` memo, adding two selectors beside the existing `slots` one:

```ts
  const failedSlots = useSelector((s: RootState) => s.dashboard.failedSlots)
  const unreadSlots = useSelector((s: RootState) => s.dashboard.unreadSlots)
```

and two fields in the mapped object:

```ts
    failed: !!failedSlots[sl.key],
    unread: unreadSlots.includes(sl.key),
```

Add `failedSlots` and `unreadSlots` to the memo's dependency array.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd website && npx vitest run src/store/dashboardSlice.test.ts src/hooks
```

Expected: PASS.

- [ ] **Step 5: Type-check and commit**

```bash
cd website && npx tsc -b
git add website/src/store/dashboardSlice.ts website/src/store/dashboardSlice.test.ts website/src/hooks/useAgentSync.ts
git commit -m "feat: track per-slot failure and unread state for crew status"
```

---

### Task 5: Add the `needs-input` pack slot

**Files:**
- Modify: `website/src/apps/crew-companion/appearanceTypes.ts`
- Modify: `website/src/apps/crew-companion/PetAvatar.tsx`
- Test: `website/src/apps/crew-companion/PetAvatar.test.tsx` (extend if present, create if not)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `PetState` gains `'needs-input'`; `STATE_TO_SLOT` maps it to a `needsInput` pack slot that falls back to idle art. Tasks 7 and 9 pass `'needs-input'` to `PetAvatar`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PetAvatar } from './PetAvatar'

describe('PetAvatar needs-input', () => {
  it('renders without throwing for the needs-input state', () => {
    const { container } = render(<PetAvatar state="needs-input" size={64} />)
    expect(container.firstChild).toBeTruthy()
  })

  it('falls back to idle art for a pack that ships no needs-input frame', () => {
    const { container } = render(<PetAvatar state="needs-input" size={64} />)
    // The built-in pack has no needsInput frame; the resolver must still resolve
    // something rather than render an empty box.
    expect(container.querySelector('img, svg, canvas')).toBeTruthy()
  })
})
```

Match the existing test file's render helpers if it already has them — `PetAvatar` reads appearance through `petBridge`, so an existing suite will already have that mocked. Reuse that mock rather than writing a second one; a duplicate would risk the jscpd gate.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd website && npx vitest run src/apps/crew-companion/PetAvatar.test.tsx
```

Expected: FAIL — TypeScript rejects `state="needs-input"`.

- [ ] **Step 3: Implement**

In `PetAvatar.tsx`, extend the union and the slot map:

```ts
export type PetState =
  | 'idle' | 'loading' | 'done' | 'error' | 'needs-input'
  | 'inhale' | 'hold' | 'exhale'

type PackSlot = 'idle' | 'loading' | 'done' | 'needsInput' | 'inhale' | 'hold' | 'exhale'
```

Add the entry to `STATE_TO_SLOT`:

```ts
  'needs-input': 'needsInput',
```

In `appearanceTypes.ts`, add `needsInput` to `STATUS_STATES`:

```ts
/**
 * `needsInput` is the pet's fourth status signal: work is blocked on the user.
 * Optional like every other slot — a pack that omits it falls back through the
 * resolver to idle, so existing custom packs keep working and simply hold still
 * while the bubble carries the message.
 */
export const STATUS_STATES = ['done', 'error', 'needsInput'] as const
```

No resolver change is needed: `REQUIRED_STATES` is `['idle']` and every other slot already falls back through `animationResolver`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd website && npx vitest run src/apps/crew-companion
```

Expected: PASS, including the existing appearance and gallery suites — the editor reads `STATUS_STATES` to decide which slots it offers, so it now offers one more.

- [ ] **Step 5: Type-check and commit**

```bash
cd website && npx tsc -b
git add website/src/apps/crew-companion/PetAvatar.tsx website/src/apps/crew-companion/appearanceTypes.ts website/src/apps/crew-companion/PetAvatar.test.tsx
git commit -m "feat: add a needs-input appearance slot to the companion"
```

---

### Task 6: Carry cast rects through the hitbox contract

The overlay covers whole displays and is click-through except over reported rects. This task extends that contract only — no sprites exist yet, so nothing changes on screen.

**Files:**
- Modify: `website/src/apps/crew-companion/hitbox.ts`
- Modify: `website/electron/crew-companion/pet-preload.js`
- Modify: `website/electron/crew-companion/petOverlay.js`
- Test: `website/src/apps/crew-companion/hitbox.test.ts` (extend)
- Test: `website/electron/crew-companion/test/petHitbox.test.js` (extend)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `HitRect`, `ReportedHitboxes` gains `cast: HitRect[]`; `hitsAny` tests it; `crewCompanion.updateHitbox(pet, bubble, cast)` accepts a third argument. Task 7 supplies the rects.

- [ ] **Step 1: Write the failing tests**

Add to `website/src/apps/crew-companion/hitbox.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { hitsAny, reportedHitboxes } from './hitbox'

describe('cast hitboxes', () => {
  const pet = { x: 0, y: 0, w: 10, h: 10 }

  it('reports an empty cast by default', () => {
    const boxes = reportedHitboxes({ pos: { x: 0, y: 0 }, bubbleRect: null, menuRect: null })
    expect(boxes.cast).toEqual([])
  })

  it('treats a point inside a cast rect as a hit', () => {
    expect(hitsAny({ pet, cast: [{ x: 100, y: 100, w: 20, h: 20 }] }, 110, 110)).toBe(true)
  })

  it('treats a point outside every cast rect as a miss', () => {
    expect(hitsAny({ pet, cast: [{ x: 100, y: 100, w: 20, h: 20 }] }, 300, 300)).toBe(false)
  })

  it('tolerates an absent cast', () => {
    expect(hitsAny({ pet }, 5, 5)).toBe(true)
  })
})
```

Add to `website/electron/crew-companion/test/petHitbox.test.js`, matching that file's existing `node:test` style:

```js
test("cursorHitsWindow matches a cast rect", () => {
  const boxes = { pet: null, bubble: null, menu: null, cast: [{ x: 50, y: 50, w: 30, h: 30 }] };
  assert.equal(cursorHitsWindow(boxes, 60, 60), true);
  assert.equal(cursorHitsWindow(boxes, 10, 10), false);
});

test("setWindowHitbox preserves cast rects when the bubble changes", () => {
  const win = {};
  setWindowHitbox(win, { x: 0, y: 0, w: 1, h: 1 }, null, [{ x: 5, y: 5, w: 5, h: 5 }]);
  setWindowHitbox(win, { x: 0, y: 0, w: 1, h: 1 }, { x: 2, y: 2, w: 2, h: 2 });
  assert.equal(cursorHitsWindow(hitboxesFor(win), 7, 7), true);
});
```

If `petHitbox.test.js` has no accessor for a window's stored boxes, add one to `petOverlay.js`'s test exports in Step 3 and name it `hitboxesFor`.

- [ ] **Step 2: Run both suites to verify they fail**

```bash
cd website && npx vitest run src/apps/crew-companion/hitbox.test.ts
cd website/electron && npm test
```

Expected: both FAIL — `cast` is not part of either contract.

- [ ] **Step 3: Implement**

In `hitbox.ts`:

```ts
export interface ReportedHitboxes {
  pet: HitRect
  bubble: HitRect | null
  menu: HitRect | null
  /**
   * One rect per cast sprite. A list rather than a merged bounding box: the cast
   * spreads out behind the pet, and a box enclosing all of them would make the empty
   * space between sprites swallow clicks meant for the window underneath.
   */
  cast: HitRect[]
}

export function reportedHitboxes(input: {
  pos: { x: number; y: number }
  bubbleRect: Rect | null
  menuRect: HitRect | null
  cast?: HitRect[]
}): ReportedHitboxes {
  return {
    pet: petHitbox(input.pos),
    bubble: bubbleHitbox(input.bubbleRect),
    menu: input.menuRect ?? null,
    cast: input.cast ?? [],
  }
}

export function hitsAny(
  boxes: { pet?: HitRect | null; bubble?: HitRect | null; menu?: HitRect | null; cast?: HitRect[] },
  x: number,
  y: number,
): boolean {
  return (
    pointInRect(boxes.pet, x, y) ||
    pointInRect(boxes.bubble, x, y) ||
    pointInRect(boxes.menu, x, y) ||
    (boxes.cast ?? []).some((r) => pointInRect(r, x, y))
  )
}
```

In `pet-preload.js`, add the third parameter, keeping the existing doc comment and adding a line for it:

```js
  updateHitbox(pet, bubble, cast) {
    ipcRenderer.send(
      "crew-companion:update-hitbox",
      pet || null,
      bubble || null,
      Array.isArray(cast) ? cast : [],
    );
  },
```

In `petOverlay.js`, carry it through the three places that model the rects:

```js
function setWindowHitbox(win, pet, bubble, cast) {
  if (!win) return;
  const cur = hitboxes.get(win) || { pet: null, bubble: null, menu: null, cast: [] };
  hitboxes.set(win, {
    pet: pet || null,
    bubble: bubble || null,
    menu: cur.menu || null,
    // Undefined means "this report did not mention the cast", which must not be
    // read as "the cast is empty" — a bubble update would otherwise silently make
    // every sprite click-through.
    cast: cast === undefined ? cur.cast || [] : cast || [],
  });
}
```

```js
function cursorHitsWindow(boxes, localX, localY) {
  if (!boxes) return false;
  return (
    pointInRect(boxes.pet, localX, localY) ||
    pointInRect(boxes.bubble, localX, localY) ||
    pointInRect(boxes.menu, localX, localY) ||
    (boxes.cast || []).some((r) => pointInRect(r, localX, localY))
  );
}
```

```js
  ipcMain.on("crew-companion:update-hitbox", (event, pet, bubble, cast) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && isPetWindow(win)) setWindowHitbox(win, pet, bubble, cast);
  });
```

Update `setWindowMenuHitbox` to preserve `cast` the same way it already preserves `pet` and `bubble`, and export `hitboxesFor = (win) => hitboxes.get(win)` alongside the other test exports.

- [ ] **Step 4: Run both suites to verify they pass**

```bash
cd website && npx vitest run src/apps/crew-companion/hitbox.test.ts
cd website/electron && npm test
```

Expected: both PASS.

- [ ] **Step 5: Type-check and commit**

```bash
cd website && npx tsc -b
git add website/src/apps/crew-companion/hitbox.ts website/src/apps/crew-companion/hitbox.test.ts website/electron/crew-companion/pet-preload.js website/electron/crew-companion/petOverlay.js website/electron/crew-companion/test/petHitbox.test.js
git commit -m "feat: carry cast sprite rects through the hitbox contract"
```

---

### Task 7: The desktop cast

**Blocked by Task 1.** Read the multi-display finding recorded there before starting.

**Files:**
- Create: `website/src/apps/crew-companion/CrewCast.tsx`
- Create: `website/src/apps/crew-companion/castLayout.ts`
- Test: `website/src/apps/crew-companion/castLayout.test.ts`
- Test: `website/src/apps/crew-companion/CrewCast.test.tsx`
- Modify: `website/src/apps/crew-companion/pet.tsx`
- Modify: `website/src/apps/crew-companion/useMouseForward.ts`

**Interfaces:**
- Consumes: `CrewAgent`, `deriveCrewStatus`, `DESKTOP_CAST_CAP` (Task 2); `snapshot()` (Task 3); `PetState` including `'needs-input'` (Task 5); `HitRect`, `reportedHitboxes` (Task 6).
- Produces: `<CrewCast cast={CrewAgent[]} petPos={{x,y}} onSelect={(slotKey: string) => void} onRects={(rects: HitRect[]) => void} />`, `castSlotOffset(index: number, total: number): {dx: number; dy: number}`, and `CAST_PX`.

**Click behaviour is defined here, and deliberately narrow.** `petBridge` has no
slot-focus method and the overlay cannot focus the dashboard's chat: it is a separate
Electron window, so `window.open('/chat')` opens *another* window rather than moving
the existing one. So clicking a cast sprite opens the crew world pop-out — the surface
that already has the popover, composer, and approve/deny controls for acting on that
agent. Wiring a true dashboard-focus IPC is a follow-up, not part of this plan.

- [ ] **Step 1: Write the failing layout test**

`castLayout.ts` is split out from the component for the same reason `walkMath` is: the geometry is the part worth testing, and it needs no DOM.

```ts
import { describe, it, expect } from 'vitest'
import { castSlotOffset, CAST_PX } from './castLayout'

describe('castSlotOffset', () => {
  it('places a single sprite behind and beside the pet', () => {
    const { dx, dy } = castSlotOffset(0, 1)
    expect(dx).not.toBe(0)
    expect(Math.abs(dx)).toBeGreaterThanOrEqual(CAST_PX)
  })

  it('spreads sprites without overlapping', () => {
    const offsets = [0, 1, 2, 3].map(i => castSlotOffset(i, 4))
    for (let a = 0; a < offsets.length; a++) {
      for (let b = a + 1; b < offsets.length; b++) {
        const far = Math.abs(offsets[a].dx - offsets[b].dx) >= CAST_PX
          || Math.abs(offsets[a].dy - offsets[b].dy) >= CAST_PX
        expect(far).toBe(true)
      }
    }
  })

  it('is stable for a given index and total', () => {
    expect(castSlotOffset(2, 4)).toEqual(castSlotOffset(2, 4))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd website && npx vitest run src/apps/crew-companion/castLayout.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the layout**

```ts
/**
 * castLayout — where each cast sprite sits relative to the main pet.
 *
 * A trail, not a ring: the sprites read as following the pet rather than orbiting
 * it, and a trail stays legible when the pet is docked against a screen edge, where
 * half a ring would be off-screen.
 *
 * Pure, so the spacing guarantee can be tested without a DOM.
 */

/** Cast sprites are smaller than the main pet's PET_PX so the hierarchy is legible. */
export const CAST_PX = 56

/** Gap between adjacent sprites, measured centre to centre. */
const STRIDE = CAST_PX + 8

/** Vertical stagger, so a long trail is not a flat line. */
const RISE = 14

/**
 * Offset of one cast slot from the pet's origin.
 *
 * Sprites trail to the LEFT because the pet's default resting position is the
 * bottom-right of the display (see pet.tsx's initial position), so trailing left
 * keeps the cast on screen without any edge special-casing.
 */
export function castSlotOffset(index: number, total: number): { dx: number; dy: number } {
  const dx = -STRIDE * (index + 1)
  const dy = (index % 2 === 0 ? -RISE : RISE) - (total > 2 ? 6 : 0)
  return { dx, dy }
}
```

- [ ] **Step 4: Run the layout test to verify it passes**

```bash
cd website && npx vitest run src/apps/crew-companion/castLayout.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write the failing component test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CrewCast } from './CrewCast'
import type { CrewAgent } from './crewStatus'

const agent = (id: string, state: CrewAgent['state'] = 'running'): CrewAgent =>
  ({ id, slotKey: id, name: `Session ${id}`, state, since: 0 })

describe('CrewCast', () => {
  it('renders one sprite per cast member', () => {
    render(<CrewCast cast={[agent('a'), agent('b')]} petPos={{ x: 100, y: 100 }}
      onSelect={vi.fn()} onRects={vi.fn()} />)
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('names each sprite for screen readers', () => {
    render(<CrewCast cast={[agent('a')]} petPos={{ x: 0, y: 0 }} onSelect={vi.fn()} onRects={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Session a/ })).toBeTruthy()
  })

  it('reports one rect per sprite', () => {
    const onRects = vi.fn()
    render(<CrewCast cast={[agent('a'), agent('b')]} petPos={{ x: 0, y: 0 }}
      onSelect={vi.fn()} onRects={onRects} />)
    expect(onRects.mock.calls.at(-1)?.[0]).toHaveLength(2)
  })

  it('reports an empty rect list for an empty cast', () => {
    const onRects = vi.fn()
    render(<CrewCast cast={[]} petPos={{ x: 0, y: 0 }} onSelect={vi.fn()} onRects={onRects} />)
    expect(onRects.mock.calls.at(-1)?.[0]).toEqual([])
  })

  it('calls onSelect with the slot key when a sprite is clicked', async () => {
    const onSelect = vi.fn()
    render(<CrewCast cast={[agent('a')]} petPos={{ x: 0, y: 0 }} onSelect={onSelect} onRects={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /Session a/ }))
    expect(onSelect).toHaveBeenCalledWith('a')
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

```bash
cd website && npx vitest run src/apps/crew-companion/CrewCast.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 7: Implement the component**

```tsx
/**
 * CrewCast — the per-agent sprites that trail the main pet.
 *
 * Its own file rather than more of pet.tsx, which is already past a thousand lines.
 *
 * The sprites share ONE animation driver: Framer Motion's spring on each sprite's
 * target offset. Giving each sprite its own rAF loop would be N loops for decoration.
 *
 * Every sprite reports a hitbox, because the overlay is click-through except over
 * reported rects — an unreported sprite would look clickable and do nothing.
 */
import { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { PetAvatar, type PetState } from './PetAvatar'
import { castSlotOffset, CAST_PX } from './castLayout'
import type { CrewAgent } from './crewStatus'
import type { HitRect } from './hitbox'
import { i18nT } from '../../i18n/t'

/** The cast shows only active work, so only these two states can reach it. */
const STATE_TO_PET: Record<'running' | 'needs-input', PetState> = {
  running: 'loading',
  'needs-input': 'needs-input',
}

export interface CrewCastProps {
  cast: CrewAgent[]
  petPos: { x: number; y: number }
  onSelect: (slotKey: string) => void
  onRects: (rects: HitRect[]) => void
}

export function CrewCast({ cast, petPos, onSelect, onRects }: CrewCastProps) {
  const reduced = useReducedMotion()
  // Report rects from an effect rather than during render: the parent forwards them
  // to the main process, and a setState during render would be a React violation.
  const lastKey = useRef('')

  const placed = cast.map((agent, i) => {
    const { dx, dy } = castSlotOffset(i, cast.length)
    return { agent, x: petPos.x + dx, y: petPos.y + dy }
  })

  useEffect(() => {
    const rects: HitRect[] = placed.map((p) => ({ x: p.x, y: p.y, w: CAST_PX, h: CAST_PX }))
    const key = JSON.stringify(rects)
    if (key === lastKey.current) return
    lastKey.current = key
    onRects(rects)
  }, [placed, onRects])

  return (
    <>
      {placed.map(({ agent, x, y }) => (
        <motion.button
          key={agent.id}
          type="button"
          aria-label={i18nT('apps.crewCompanion.cast.focus_session', { name: agent.name })}
          onClick={() => onSelect(agent.slotKey)}
          initial={reduced ? false : { opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1, x, y }}
          exit={reduced ? undefined : { opacity: 0, scale: 0.6 }}
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 18 }}
          style={{
            position: 'absolute', top: 0, left: 0,
            width: CAST_PX, height: CAST_PX,
            padding: 0, border: 'none', background: 'transparent',
            pointerEvents: 'auto', cursor: 'pointer',
          }}
        >
          <PetAvatar
            state={STATE_TO_PET[agent.state as 'running' | 'needs-input'] ?? 'idle'}
            size={CAST_PX}
          />
        </motion.button>
      ))}
    </>
  )
}
```

- [ ] **Step 8: Run it to verify it passes**

```bash
cd website && npx vitest run src/apps/crew-companion/CrewCast.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Wire the cast into the overlay**

In `pet.tsx`, inside the component:

```ts
  // The crew's condition, rebuilt from the watcher each time the poll ticks. The
  // watcher owns the socket; this owns nothing but the derived view of it.
  const [crew, setCrew] = useState(() => deriveCrewStatus([]))
  useEffect(() => {
    const id = window.setInterval(() => {
      setCrew(deriveCrewStatus(watcherRef.current?.snapshot() ?? []))
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  const [castRects, setCastRects] = useState<HitRect[]>([])
```

Hold the watcher in a ref where it is currently created, so the interval can read it.

Drive the main pet's resting state from the aggregate. Find where `petState` is computed and give the aggregate priority over idle but not over an active bubble — a bubble is a specific event and outranks an ambient status:

```ts
  const AGGREGATE_TO_PET: Record<AgentState, PetState> = {
    'needs-input': 'needs-input', blocked: 'error', ready: 'done',
    running: 'loading', idle: 'idle',
  }
  // A bubble describes one specific event and keeps precedence; the aggregate is the
  // resting condition underneath it.
  const restingState = AGGREGATE_TO_PET[crew.aggregate]
```

Render the cast inside the existing `cc-pet-layer` div, before the pet's own element:

```tsx
      <CrewCast
        cast={crew.cast}
        petPos={pos}
        onSelect={openCrewWorld}
        onRects={setCastRects}
      />
```

`openCrewWorld` is the same function Task 10 adds to the context menu. Extract it now
into `website/src/apps/crew-companion/openCrewWorld.ts` so both call sites share one
copy — two copies of a `localStorage.setItem` plus `window.open` pair is exactly the
shape jscpd flags:

```ts
import { SCENE_STORAGE_KEY } from '../../pages/scenes/config'

/**
 * Open the Worlds pop-out on the crew scene.
 *
 * The scene key is written BEFORE the window opens because the pop-out reads it on
 * mount; broadcasting afterwards would race the new window's first render.
 */
export function openCrewWorld(): void {
  try { localStorage.setItem(SCENE_STORAGE_KEY, 'crew') } catch { /* private mode */ }
  const w = Math.min(960, screen.availWidth * 0.6)
  const h = Math.round(w / 1.5) + 80
  window.open('/worlds-popout', 'kirocrew-worlds', `width=${w},height=${h},resizable=yes`)
}
```

`CrewCast`'s `onSelect` receives a slot key it does not currently use. Keep the
parameter — the follow-up that adds true slot focus needs it, and dropping it now
would mean changing the component's contract again later.

Pass the rects through to `useMouseForward`:

```ts
  useMouseForward({ pos, bubbleRect: placement?.rect ?? null, dragging, cast: castRects })
```

In `useMouseForward.ts`, add `cast: HitRect[]` to `UseMouseForwardParams`, include it in the change-detection key, and pass it as the third argument to `petBridge.updateHitbox`.

If `petBridge` has no `focusSlot`, add one that navigates the dashboard to that slot using the same mechanism the panel already uses to open a destination; read `petBridge.ts` for the existing pattern rather than inventing a new IPC channel.

- [ ] **Step 10: Show the overflow count on the main pet**

The cap means a busy crew has members with no sprite. They must still be visible as a
number, or the desktop silently under-reports how much is running — the exact failure
the cap is supposed to avoid.

Write the failing test first, in `CrewCast.test.tsx`:

```tsx
  it('renders an overflow badge when agents did not fit', () => {
    render(<CrewCast cast={[agent('a')]} overflow={3} petPos={{ x: 0, y: 0 }}
      onSelect={vi.fn()} onRects={vi.fn()} />)
    expect(screen.getByText('+3')).toBeTruthy()
  })

  it('renders no badge when nothing overflowed', () => {
    render(<CrewCast cast={[agent('a')]} overflow={0} petPos={{ x: 0, y: 0 }}
      onSelect={vi.fn()} onRects={vi.fn()} />)
    expect(screen.queryByText(/^\+/)).toBeNull()
  })
```

Run it, confirm it fails, then add `overflow: number` to `CrewCastProps` and render the
badge anchored to the pet's own corner:

```tsx
      {overflow > 0 ? (
        <div
          aria-label={i18nT('apps.crewCompanion.cast.more_agents', { count: overflow })}
          style={{
            position: 'absolute',
            left: petPos.x - 10, top: petPos.y - 4,
            background: 'var(--accent)', color: 'var(--bg)',
            borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 'bold',
            pointerEvents: 'none',
          }}
        >
          +{fmtNumber(overflow)}
        </div>
      ) : null}
```

`fmtNumber` comes from `src/i18n/format.ts` — `import { fmtNumber } from '../../i18n/format'`.
Interpolating the raw number instead is exactly what the number-formatting gate exists
to catch.

The badge is `pointerEvents: 'none'` and reports no hitbox: it is a readout, not a
control, and every reported rect is a hole in the desktop's click-through.

Pass `overflow={crew.overflow}` from `pet.tsx`.

- [ ] **Step 11: Honour reduced motion on the main pet's wander**

`CrewCast` already checks `useReducedMotion`. The main pet does not — it wanders via
`useWalking` regardless. Add the same check where `pet.tsx` schedules a wander and
skip scheduling entirely when the user has asked for reduced motion.

Verify by hand: set System Settings → Accessibility → Display → Reduce motion, restart
the desktop app, and confirm the pet holds still while the cast still appears and
disappears as sessions start and stop.

- [ ] **Step 12: Add the i18n keys**

Read `website/docs/i18n-catalog.md` first — it is the authoring guide and CI enforces its conventions. Add to `website/src/i18n/locales/en.json` and each of the other ten locale files:

| Key | English |
|---|---|
| `apps.crewCompanion.cast.focus_session` | `Focus {name}` |
| `apps.crewCompanion.cast.more_agents` | `{count} more agents running` |

`more_agents` is plural-sensitive, so it also needs an entry in
`website/src/i18n/pluralKeys.json`.

```bash
cd website && npm run lint:i18n && npm run i18n:check
```

- [ ] **Step 13: Run the full gate and commit**

```bash
cd website && npx tsc -b && npm run lint && npm run test
git add website/src/apps/crew-companion website/src/i18n/locales
git commit -m "feat: add a per-agent sprite cast beside the desktop pet"
```

---

### Task 8: Extract the agent popover from the canvas hook

Pure refactor. The eight canvas scenes must behave identically afterwards.

**Files:**
- Create: `website/src/hooks/useAgentPopover.tsx`
- Modify: `website/src/hooks/useSceneInteraction.tsx`
- Test: `website/src/test/useAgentPopover.test.tsx`

**Interfaces:**
- Consumes: `AgentSource` from `useAgentSync`.
- Produces: `useAgentPopover(sources?: AgentSource[], theme?: SceneTooltipTheme, extraLine?: (agent: SceneAgent) => React.ReactNode)` returning `{ hover(agent: SceneAgent, at: {x,y}): void; clearHover(): void; open(agent: SceneAgent, at: {x,y}): void; close(): void; openAgentId: string | null; elements: React.ReactNode }`. All three parameters are optional so the hook can be called with none (tests), two (Task 9), or three (the canvas adapter). Task 9 calls it directly.

- [ ] **Step 1: Write the characterization test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAgentPopover } from '../hooks/useAgentPopover'
import type { SceneAgent } from '../hooks/useSceneInteraction'

const agent: SceneAgent = {
  id: 'slot-a', name: 'A', x: 0, y: 0, running: true, detail: '3 msgs', kind: 'slot',
}

describe('useAgentPopover', () => {
  it('starts with nothing open', () => {
    const { result } = renderHook(() => useAgentPopover([]))
    expect(result.current.openAgentId).toBeNull()
  })

  it('opens for a chat slot', () => {
    const { result } = renderHook(() => useAgentPopover([]))
    act(() => result.current.open(agent, { x: 10, y: 10 }))
    expect(result.current.openAgentId).toBe('slot-a')
  })

  it('toggles closed when the same agent is opened twice', () => {
    const { result } = renderHook(() => useAgentPopover([]))
    act(() => result.current.open(agent, { x: 10, y: 10 }))
    act(() => result.current.open(agent, { x: 10, y: 10 }))
    expect(result.current.openAgentId).toBeNull()
  })

  it('ignores a non-slot agent', () => {
    const { result } = renderHook(() => useAgentPopover([]))
    act(() => result.current.open({ ...agent, id: 'cron-x', kind: 'cron' }, { x: 0, y: 0 }))
    expect(result.current.openAgentId).toBeNull()
  })
})
```

Wrap `renderHook` in whatever Redux/Router providers the existing `Scenes.test.tsx` uses — the hook dispatches `switchSlot` and calls `useNavigate`. Reuse that file's provider helper rather than writing a second one.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd website && npx vitest run src/test/useAgentPopover.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Move the popover out of `useSceneInteraction`**

Create `useAgentPopover.tsx` and move into it, unchanged in behaviour:

- `TooltipState`, `ThreadViewState`, `ThreadMessage`, `THREAD_VIEW_MESSAGES`, `THREAD_SKIP_ROLES`, `cleanThread`, `agentStatusLine`, `messagePreview`, `MiniGhost`
- every `useState` for tooltip, thread view, draft, send state, approval state, drag position, creating
- the outside-click and Escape effect, the 2s refresh effect, the scroll-into-view effect, the composer reset effect
- `openChat`, `sendToAgent`, `resolvePendingApproval`, `createSession`, `onHeaderPointerDown`
- the `tooltipEl`, `threadViewEl`, and `spawnEl` JSX

Replace the mouse-event entry points with plain calls:

```tsx
  const hover = useCallback((agent: SceneAgent, at: { x: number; y: number }) => {
    setTooltip({ x: at.x, y: at.y, agent })
  }, [])

  const clearHover = useCallback(() => setTooltip(null), [])

  const open = useCallback((agent: SceneAgent, at: { x: number; y: number }) => {
    if (agent.kind !== 'slot') { setThreadView(null); return }
    if (threadView && threadView.agent.id === agent.id) { setThreadView(null); return }
    setTooltip(null)
    setThreadView({ x: at.x, y: at.y, agent, loading: true, messages: [], error: false })
    // the existing api.chatSlotDetail call, unchanged
  }, [threadView])
```

Return:

```tsx
  return {
    hover, clearHover, open, close: () => setThreadView(null),
    openAgentId: threadView?.agent.id ?? null,
    elements: <>{tooltipEl}{threadViewEl}{spawnEl}</>,
  }
```

Re-export `SceneAgent`, `SceneTooltipTheme`, `agentStatusLine`, and `messagePreview` from `useSceneInteraction.tsx` so existing importers do not break.

- [ ] **Step 4: Reduce `useSceneInteraction` to a canvas adapter**

```tsx
export function useSceneInteraction(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  agentsRef: RefObject<SceneAgent[]>,
  W: number, H: number,
  theme: SceneTooltipTheme,
  hitRadius = 10,
  extraLine?: (agent: SceneAgent) => React.ReactNode,
  sources?: AgentSource[],
) {
  const popover = useAgentPopover(sources, theme, extraLine)

  const getAgentAt = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // unchanged body
  }, [canvasRef, agentsRef, W, H, hitRadius])

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const a = getAgentAt(e)
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!a || !rect) { popover.clearHover(); return }
    popover.hover(a, { x: e.clientX - rect.left + 12, y: e.clientY - rect.top - 50 })
  }, [getAgentAt, canvasRef, popover])

  const onClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const a = getAgentAt(e)
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!a || !rect) { popover.close(); return }
    const px = Math.max(8, Math.min(e.clientX - rect.left + 12, rect.width - 280))
    const py = Math.min(Math.max(e.clientY - rect.top - 60, 8), rect.height - 200)
    popover.open(a, { x: px, y: py })
  }, [getAgentAt, canvasRef, popover])

  return {
    canvasProps: {
      onMouseMove, onMouseLeave: popover.clearHover, onClick,
      style: { cursor: popover.openAgentId ? 'pointer' : 'default' },
    },
    tooltipEl: popover.elements,
  }
}
```

The `theme` and `extraLine` arguments move into `useAgentPopover`'s signature since the tooltip JSX uses them.

- [ ] **Step 5: Verify no canvas scene changed behaviour**

```bash
cd website && npx vitest run src/test/Scenes.test.tsx src/test/WorldsPage.test.tsx src/test/WorldsPopout.test.tsx src/test/useAgentPopover.test.tsx
```

Expected: PASS, with no edits to `Scenes.test.tsx`. If that suite needs changing, the refactor changed behaviour — revert and redo it.

- [ ] **Step 6: Confirm the duplication gate is satisfied**

```bash
cd website && npm run jscpd
```

Expected: no new duplication between the two hooks.

- [ ] **Step 7: Type-check and commit**

```bash
cd website && npx tsc -b && npm run lint
git add website/src/hooks/useAgentPopover.tsx website/src/hooks/useSceneInteraction.tsx website/src/test/useAgentPopover.test.tsx
git commit -m "refactor: split the agent popover out of the canvas scene hook"
```

---

### Task 9: The pet-cast world scene

**Files:**
- Create: `website/src/pages/scenes/PetCastScene.tsx`
- Test: `website/src/test/PetCastScene.test.tsx`
- Modify: `website/src/pages/scenes/config.tsx`
- Modify: `website/src/pages/scenes/components.ts`
- Modify: `website/src/i18n/locales/*.json`

**Interfaces:**
- Consumes: `deriveCrewStatus`, `CrewAgent` (Task 2); `AgentSource` with `failed` / `unread` (Task 4); `PetAvatar` with `'needs-input'` (Task 5); `useAgentPopover` (Task 8).
- Produces: `SceneKey` gains `'crew'`; `SCENE_COMPONENTS.crew`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import PetCastScene from '../pages/scenes/PetCastScene'
import type { AgentSource } from '../hooks/useAgentSync'

const src = (id: string, over: Partial<AgentSource> = {}): AgentSource => ({
  id, name: `Session ${id}`, label: 'default', kind: 'slot',
  running: false, detail: '', ...over,
})

describe('PetCastScene', () => {
  it('renders one character per agent', () => {
    render(<PetCastScene agents={[src('slot-a'), src('slot-b')]} visible />)
    expect(screen.getAllByRole('button', { name: /Session/ })).toHaveLength(2)
  })

  it('labels a character that is waiting on the user', () => {
    render(<PetCastScene agents={[src('slot-a', { waitingForInput: true })]} visible />)
    expect(screen.getByRole('button', { name: /Session slot-a/ })).toBeTruthy()
  })

  it('renders an empty-crew message when there are no agents', () => {
    render(<PetCastScene agents={[]} visible />)
    expect(screen.getByText(/no agents/i)).toBeTruthy()
  })

  it('renders nothing animated while hidden', () => {
    const { container } = render(<PetCastScene agents={[src('slot-a')]} visible={false} />)
    expect(container.querySelector('[data-scene-paused="true"]')).toBeTruthy()
  })
})
```

Wrap in the same providers `Scenes.test.tsx` uses.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd website && npx vitest run src/test/PetCastScene.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the scene**

```tsx
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
import { useMemo } from 'react'
import type { AgentSource } from '../../hooks/useAgentSync'
import { deriveCrewStatus, type AgentState } from '../../apps/crew-companion/crewStatus'
import { PetAvatar, type PetState } from '../../apps/crew-companion/PetAvatar'
import { useAgentPopover } from '../../hooks/useAgentPopover'
import { i18nT } from '../../i18n/t'

const CHARACTER_PX = 96

const STATE_TO_PET: Record<AgentState, PetState> = {
  'needs-input': 'needs-input', blocked: 'error', ready: 'done',
  running: 'loading', idle: 'idle',
}

const STATE_LABEL: Record<AgentState, string> = {
  'needs-input': 'pages.scenes.petCast.needs_you',
  blocked: 'pages.scenes.petCast.blocked',
  ready: 'pages.scenes.petCast.ready',
  running: 'pages.scenes.petCast.working',
  idle: 'pages.scenes.petCast.idle',
}

export default function PetCastScene(
  { agents, visible = true }: { agents: AgentSource[]; visible?: boolean },
) {
  const crew = useMemo(() => deriveCrewStatus(agents.map((a) => ({
    id: a.id, slotKey: a.id.replace(/^slot-/, ''), name: a.name,
    running: a.running,
    waitingForInput: !!a.waitingForInput,
    pendingApproval: !!a.pendingApproval,
    failed: !!a.failed,
    unread: !!a.unread,
    since: 0,
  }))), [agents])

  const popover = useAgentPopover(agents, {
    active: i18nT('pages.scenes.petCast.working'),
    idle: i18nT('pages.scenes.petCast.idle'),
  })

  return (
    <div
      data-scene-paused={!visible}
      style={{
        position: 'absolute', inset: 0, borderRadius: 8, overflow: 'hidden',
        background: 'var(--bg-elevated)',
        display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start',
        gap: 16, padding: 20,
      }}
    >
      {crew.agents.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, margin: 'auto' }}>
          {i18nT('pages.scenes.petCast.no_agents')}
        </div>
      ) : null}

      {crew.agents.map((agent) => (
        <button
          key={agent.id}
          type="button"
          aria-label={i18nT('pages.scenes.petCast.open_session', { name: agent.name })}
          onMouseEnter={(e) => popover.hover(
            { id: agent.id, name: agent.name, x: 0, y: 0, running: agent.state === 'running', detail: '', kind: 'slot' },
            { x: e.currentTarget.offsetLeft + 12, y: e.currentTarget.offsetTop - 50 },
          )}
          onMouseLeave={popover.clearHover}
          onClick={(e) => popover.open(
            { id: agent.id, name: agent.name, x: 0, y: 0, running: agent.state === 'running', detail: '', kind: 'slot' },
            { x: e.currentTarget.offsetLeft + 12, y: e.currentTarget.offsetTop - 20 },
          )}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            background: 'transparent', border: 'none', cursor: 'pointer', padding: 4,
            width: CHARACTER_PX + 24,
          }}
        >
          {/* A hidden scene must not animate: nine scenes stay mounted at once. */}
          <PetAvatar state={visible ? STATE_TO_PET[agent.state] : 'idle'} size={CHARACTER_PX} />
          <span style={{ color: 'var(--text)', fontSize: 12, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {agent.name}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
            {i18nT(STATE_LABEL[agent.state])}
          </span>
        </button>
      ))}

      {popover.elements}
    </div>
  )
}
```

- [ ] **Step 4: Register the scene**

In `config.tsx`, add `'crew'` to `SceneKey` and this entry as the **first** element of `SCENES`, so the crew scene is what a new user meets:

```tsx
  { key: 'crew', label: 'Crew', icon: <Users className="lucide-inline" />, desc: 'Your agents as their own characters' },
```

Import `Users` from `lucide-react`.

In `components.ts`, import `PetCastScene` and add `crew: PetCastScene` to `SCENE_COMPONENTS`.

- [ ] **Step 5: Add the i18n keys**

Read `website/docs/i18n-catalog.md` first. Add to `en.json` and each of the ten other locale files:

| Key | English |
|---|---|
| `pages.scenes.petCast.needs_you` | `Needs you` |
| `pages.scenes.petCast.blocked` | `Blocked` |
| `pages.scenes.petCast.ready` | `Ready` |
| `pages.scenes.petCast.working` | `Working` |
| `pages.scenes.petCast.idle` | `Idle` |
| `pages.scenes.petCast.no_agents` | `No agents right now` |
| `pages.scenes.petCast.open_session` | `Open {name}` |

The scene's `label` and `desc` in `config.tsx` are user-facing too; follow whatever convention the existing eight entries use — if they are bare English strings today, match them and note the gap rather than converting all nine in this task.

```bash
cd website && npm run lint:i18n && npm run i18n:check
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd website && npx vitest run src/test/PetCastScene.test.tsx src/test/WorldsPage.test.tsx src/test/Scenes.test.tsx
```

Expected: PASS. `WorldsPage.test.tsx` may assert a scene count — update that number, since adding a scene is the intent.

- [ ] **Step 7: Add the Playwright case**

In `website/playwright/builtin-apps.spec.ts`, follow the existing per-app pattern to visit `/worlds`, select the Crew tab, and assert the scene container renders.

- [ ] **Step 8: Run the full gate and commit**

```bash
cd website && npx tsc -b && npm run lint && npm run test
git add website/src/pages/scenes website/src/test/PetCastScene.test.tsx website/src/i18n/locales website/playwright/builtin-apps.spec.ts
git commit -m "feat: add a crew scene rendering agents as companion characters"
```

---

### Task 10: Link the pet to the world

**Files:**
- Modify: `website/src/apps/crew-companion/PetContextMenu.tsx`
- Modify: `website/electron/crew-companion/pet-preload.js`
- Modify: `website/electron/crew-companion/index.js`
- Test: `website/src/apps/crew-companion/PetContextMenu.test.tsx` (extend if present, create if not)

**Interfaces:**
- Consumes: the `'crew'` scene key (Task 9).
- Produces: a context-menu item that opens the Worlds pop-out on the crew scene.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PetContextMenu } from './PetContextMenu'

describe('PetContextMenu crew world', () => {
  it('offers an item that opens the crew world', async () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    render(<PetContextMenu x={0} y={0} isHidden={false} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('menuitem', { name: /crew world/i }))
    expect(localStorage.getItem('mc-agent-scene')).toBe('crew')
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('/worlds-popout'),
      expect.anything(),
      expect.anything(),
    )
  })
})
```

Match the file's existing render helper and menu-item role if one is already established.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd website && npx vitest run src/apps/crew-companion/PetContextMenu.test.tsx
```

Expected: FAIL — no such menu item.

- [ ] **Step 3: Implement**

Add the item to `PetContextMenu.tsx`, following the file's existing item structure:

```tsx
  const openCrewWorld = () => {
    // The pop-out reads this key on mount, so writing it first is what makes the
    // window land on the crew scene rather than whichever scene was last chosen.
    try { localStorage.setItem(SCENE_STORAGE_KEY, 'crew') } catch { /* private mode */ }
    const w = Math.min(960, screen.availWidth * 0.6)
    const h = Math.round(w / 1.5) + 80
    window.open('/worlds-popout', 'kirocrew-worlds', `width=${w},height=${h},resizable=yes`)
    onClose()
  }
```

Import `SCENE_STORAGE_KEY` from `../../pages/scenes/config`.

Label the item with a new key `apps.crewCompanion.menu.open_crew_world` → `"Open crew world"`, added across all eleven locale files.

- [ ] **Step 4: Handle Agent Worlds being disabled**

`agent-worlds` is `defaultEnabled: false` and toggles independently of the companion. Read the enabled-app list the dashboard already keeps (`dashboard.enabledAppIds` in `dashboardSlice`) — but the overlay has no store, so query the same endpoint the companion's own reconcile loop uses:

```
GET /api/apps  →  find the row named "agent-worlds", read `enabled`
```

When it is absent or disabled, render the item disabled with a title explaining that Agent Worlds must be enabled in the App Store. Do **not** hide it — a missing item reads as a bug, and the explanation is what tells the user how to get the feature.

Add a key `apps.crewCompanion.menu.crew_world_needs_app` → `"Enable Agent Worlds in the App Store to use this"`.

- [ ] **Step 5: Run the tests and the i18n gates**

```bash
cd website && npx vitest run src/apps/crew-companion/PetContextMenu.test.tsx
cd website && npm run lint:i18n && npm run i18n:check
```

Expected: PASS.

- [ ] **Step 6: Run the full gate and commit**

```bash
cd website && npx tsc -b && npm run lint && npm run test
git add website/src/apps/crew-companion website/src/i18n/locales website/electron/crew-companion
git commit -m "feat: open the crew world from the pet context menu"
```

---

### Task 11: Documentation and manifest copy

**Files:**
- Create: `docs/system-specs/modules/crew-companion.md`
- Modify: `docs/system-specs/modules/README.md`
- Modify: `src/kiro_crew/apps/builtins/crew_companion/app.json`

**Interfaces:**
- Consumes: everything built in Tasks 2–10.
- Produces: nothing code-facing.

- [ ] **Step 1: Write the module spec**

`crew-companion` has no spec today, which is why this task exists. Cover, in this order: what the app is; the overlay window model (one per display, click-through by default, hitbox reporting and the ~60fps cursor poll, and the finding from Task 1 about multi-display pets); the three-state reconcile rule from `index.js` (enabled / disabled / **unknown**, and why unknown must change nothing); the crew status model with its priority order and cast-membership rule; the appearance-pack slots including `needsInput`; and the link to the Agent Worlds crew scene.

Follow the structure of `docs/system-specs/modules/mochi.md`, which is the closest existing analogue.

State current behaviour in the present tense. No "previously", no PR numbers, no dates.

- [ ] **Step 2: Index it**

Add a row for `crew-companion.md` to `docs/system-specs/modules/README.md`, matching the surrounding rows' format.

- [ ] **Step 3: Verify the docs gate**

```bash
bash scripts/docs-lint.sh
```

Expected: `All documentation checks passed`.

- [ ] **Step 4: Update the manifest copy**

The app's `description` and `highlights` currently promise breaks, reminders, and breathing, which is no longer its main job. Rewrite both so agent status leads and the wellbeing features follow. Keep the existing tags and add `agent-status`.

Keep every highlight a plain statement of what the app does. Do not claim it is "purely a visualization" — it is not, and the `agent-worlds` manifest already carries that inaccurate claim.

- [ ] **Step 5: Verify the brand gate**

```bash
BRAND_BASE_REF=origin/main python3 scripts/check_brand_name.py
```

Expected: the gate passes.

- [ ] **Step 6: Run the backend manifest tests**

`test/test_builtin_app_assets.py` and `test/test_app_manager.py` read every builtin manifest.

```bash
python -m pytest test/test_builtin_app_assets.py test/test_app_manager.py
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add docs/system-specs/modules/crew-companion.md docs/system-specs/modules/README.md src/kiro_crew/apps/builtins/crew_companion/app.json
git commit -m "docs: add the crew companion module spec"
```

---

## Final verification

- [ ] **Run every gate from a clean state**

```bash
cd website && npx tsc -b && npm run lint && npm run test
cd .. && python -m pytest
bash scripts/docs-lint.sh
BRAND_BASE_REF=origin/main python3 scripts/check_brand_name.py
```

- [ ] **Verify in the running app**

Enable both Crew Companion and Agent Worlds in the App Store. Start two chat sessions and confirm: two sprites trail the pet; approving a tool changes the main pet's state and moves that agent to the front of the cast; the crew scene shows the same characters; "Open crew world" opens the pop-out on the crew scene; and the pet goes quiet rather than freezing when the gateway restarts.

Report actual output, not a summary. A gate that was not run is not a gate that passed.
