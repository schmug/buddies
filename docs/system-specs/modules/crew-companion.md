# Crew Companion (builtin app)

A desktop companion that reports what the crew is doing. An always-on-top character
sits on the desktop, one sprite per chat session in an active turn trails behind it,
and a bubble goes up when a turn finishes, fails, or blocks on the user. Around that
status core it carries a wellbeing surface — break nudges, reminders written in plain
language, and a guided breathing exercise — plus an avatar gallery and a pack editor.
The overlay, panel and gallery windows render only in the Kiro Crew desktop (Electron)
shell; the dashboard page at `/crew-companion` is the browser-visible surface.

`defaultEnabled: false` and `platform.requiresDesktopApp: true` — it appears in the App
Store, is opt-in, and its window surfaces need the Electron shell. `permissions`: `api`,
`storage`, `network`, `events` (`crew-companion:fire`); `cron` is false.

The backend runs IN-PROCESS under the gateway at `/api/apps/crew-companion/`. There is
no second process, no loopback URL and no proxy hop, and `tests/test_manifest.py`
asserts the absence of each so none can creep back. It also asserts that `setup.onEnable`
and `openCommand` stay absent: the gateway rolls a failed enable BACK, so an enable that
runs a command is an enable that can be impossible to complete. The windows follow the
enabled state instead, which leaves nothing to fail and nothing to roll back.

## Layout

| Path | What it is |
|---|---|
| `src/kiro_crew/apps/builtins/crew_companion/app.json` | manifest (`backend.routes`, `backend.hooks`, `ui.pages`, permissions, `platform.requiresDesktopApp`) |
| `.../hooks.py` | `on_startup` / `on_shutdown`, both idempotent; owns the process-wide `CompanionStore` and `AppearanceStore` |
| `.../store.py` | persistence plus the tick that fires reminders and break nudges |
| `.../reminders.py` | the pure reminder model and its scheduling rules |
| `.../appearances.py`, `.../pack_transfer.py` | the pack library; export/import and the PetDex fetch |
| `.../backend/routes.py` | the HTTP surface, every handler wrapped in `_require_enabled` (403 disabled, 503 not yet started) |
| `website/electron/crew-companion/index.js` | the reconcile loop that makes the windows follow the app's enabled state |
| `.../petOverlay.js` | the per-display overlay windows and the cursor-hitbox authority |
| `.../pet-preload.js` | the overlay's whole main-process bridge |
| `.../panelWindow.js`, `.../panelPlacement.js`, `.../galleryWindow.js`, `.../pageUrl.js` | the panel and gallery windows, panel placement, window URLs |
| `website/src/apps/crew-companion/` | the renderer: `pet.tsx`, `CrewCast`, the panel and gallery, `crewStatus`, `sessionWatch`, `hitbox`, `petBridge` |
| `website/src/pages/scenes/PetCastScene.tsx` | the same characters inside Agent Worlds |

## The overlay window model

One `BrowserWindow` per display, each covering that display's full bounds:
transparent, frameless, `alwaysOnTop`, `skipTaskbar`, non-focusable, visible on all
workspaces and over full-screen apps, and created with `backgroundThrottling: false`
(the companion animates continuously in a window that never holds focus, so Chromium
would otherwise throttle it to a stall for the window's whole lifetime). Full-bounds
rather than a small window because the companion moves around the screen, and a small
window would need constant repositioning.

**One companion per monitor is the design, not a defect.** Each overlay renders its own
companion independently and the main process never transfers one between displays,
which is why `useMouseForward` carries none of the source hook's active-display gating:
its header names this "this build's single-display-per-overlay model".

Cursor hit-testing runs in the MAIN process. `petOverlay.js` polls
`screen.getCursorScreenPoint()` every `HITBOX_POLL_MS` (16ms, ~60fps), converts the
point to overlay-local pixels using the window's OWN `getBounds()` rather than
`display.bounds` (which drifts with the macOS menu bar and with a display
rearrangement), tests it against the rects the renderer reported, and toggles
`setIgnoreMouseEvents` only when the answer changes. Doing the hit-test here rather
than over a pointer-enter/leave IPC round-trip is what stops a click on the companion
body falling through to the window behind it; `forward: true` on the ignore state is
what keeps move events flowing while the window is click-through.

The renderer reports four kinds of rect: the companion, its bubble, the context menu,
and one per cast sprite. The cast is a LIST, never a merged bounding box — the sprites
trail out behind the companion, and one box enclosing them all would swallow the
clicks that land in the gaps.

Focus is granted only while the panel is open. The overlay is non-focusable so it never
takes focus from the user's real work, but a non-focusable window receives no keystrokes
at all and the panel has a text input. `index.js` narrows the grant to the panel's
lifetime and calls `win.focus()` explicitly, because `setFocusable` alone does not move
focus — without it the panel opens focusable but unfocused and the first keystroke goes
to the previous app.

## The click-through invariant (do NOT weaken)

The overlay covers whole displays, so every region it declares interactive is a hole
punched in the user's desktop. All four layers therefore read an ABSENT cast as an
EMPTY cast, deliberately and identically:

| Layer | Where |
|---|---|
| `hitbox.ts` | `reportedHitboxes` (`input.cast ?? []`) and `hitsAny` |
| `petBridge.ts` | `updateHitbox`'s third parameter is required, not optional — the type forces every report to carry the set |
| `pet-preload.js` | `Array.isArray(cast) ? cast : []` before the IPC send |
| `petOverlay.js` | `setWindowHitbox` normalizes the same way on receipt |

Carrying the previous rects forward is the unsafe direction: stale rects pin regions of
the desktop unclickable, which is worse than a sprite that does not answer a click.

**The consequence is a rule.** There is exactly ONE path that reports the
companion/bubble/cast triple — `useMouseForward` — and every send on it carries the
whole set, including both re-assert paths (the 2s re-send while a bubble is up, and the
post-`mouseup` re-send that makes the companion clickable again after a drag). A second
reporter that sent only the companion and the bubble would silently make every cast
sprite click-through.

The context menu is the one thing outside that path, and it is a MERGE rather than a
replace: `ContextMenu.tsx` sends its rect on the separate `crew-companion:menu-hitbox`
channel and `setWindowMenuHitbox` copies the pet/bubble/cast rects forward untouched —
otherwise opening the menu would make the companion and every sprite click-through for
as long as it stayed open. Note what that rect is: the WHOLE viewport
(`{x: 0, y: 0, w: innerWidth, h: innerHeight}`), for the menu's lifetime only. A menu is
a modal moment, and a rect covering only the menu's own box means a click just outside
it is forwarded to the desktop, never reaches the page, and the close-on-outside
listener never fires — leaving a menu that cannot be dismissed. The effect's cleanup
sends `null` the instant the menu closes, so no full-screen hitbox outlives it.

## Reconcile has three states, not two

`index.js` runs one job: ask the gateway whether the app is enabled, and make the
windows match. Nothing is launched, so nothing can fail and be rolled back — clicking
Enable in the dashboard is sufficient.

`probeEnabled` answers `enabled`, `disabled`, or **`unknown`**, and unknown must leave
every window exactly as it is. Everything short of a clear answer maps to unknown: a
non-200, unparseable JSON, a timeout, a transport error, no local token, and — the case
worth stating — an app row ABSENT from `/api/apps`. Absent is not disabled: an older
gateway that does not ship this builtin, or a response shape that was not expected, must
not read as an instruction to tear the windows down. Treating a failed probe as
`disabled` is what makes the companion appear to crash and reappear every few seconds
across an ordinary gateway restart.

`reconcileOnce` is re-entrancy guarded, runs on a `TICK_MS` (5s) interval, and that
timer is `unref`'d — as is the hitbox poll. A background poll must never be the reason
the process cannot exit, and an un-`unref`'d one turns any early return that skips
shutdown into a hang instead of an exit.

## Crew status

`crewStatus.ts` holds every rule about agent state as one pure decision, with no
knowledge of sockets, React or the DOM, so both surfaces feed it from the transport they
already have and still agree.

`AgentState` is declared in PRIORITY ORDER, most urgent first:

```
needs-input → blocked → ready → running → idle
```

The order is the behaviour, not a detail. `aggregate` is the highest-priority state
present, or `idle` for an empty crew, because a companion reporting "running" while
something waited on the user would hide the one thing worth surfacing. Agents sort by
that rank with ties broken by `since`, so the longest-waiting agent stays stably first.

One agent's state, first match wins: `pendingApproval || waitingForInput` →
`needs-input`; `failed` → `blocked`; `!running && unread` → `ready`; `running` →
`running`; otherwise `idle`.

**Cast membership is chat slots in an active turn.** `isCastEligible` requires
`kind === 'slot'` AND a state of `running` or `needs-input`. Both halves are enforced
here rather than trusted to a transport, which is why `AgentKind` (`slot` | `cron` |
`spawn`) is a required input field: a cron runs on a schedule with nobody watching, and
a subagent belongs to the session that spawned it — which already has a sprite — so
neither earns one of its own at any state. `needs-input` counts as active because a turn
blocked on the user's approval has not stopped running, and it is the highest-priority
state there is. `ready`, `blocked` and `idle` agents stay in `agents`, so the world shows
them and the aggregate reflects them, but they do not wander over the user's work.

`DESKTOP_CAST_CAP` is 4, against the world's eight: the world is a place you look at
deliberately, the desktop is where you are trying to work. Eligible agents past the cap
become `overflow`, which `CrewCast` draws as a badge that deliberately reports NO
hitbox — it is a readout, not a control, and every reported rect is a hole in the
desktop's click-through.

An empty input is a complete, valid answer — idle aggregate, empty cast — which is also
what a disconnected transport supplies.

## Two transports, one status model

**The overlay** owns its own WebSocket to the gateway's `/api/ws` (`sessionWatch.ts`),
the same broadcast every dashboard client receives; an app-window page is such a client,
same origin and authenticated by the same session cookie. `snapshot()` is a PULL —
`pet.tsx` polls it every `CREW_POLL_MS` (1s), feeds `deriveCrewStatus`, and keeps the
previous object when nothing the desktop draws has changed so React can bail out.

The frame names matter, because the obvious guess is wrong: `chat_status` means a turn
STARTED, `chat_done` means that turn FINISHED, `slots` is the full list, and
`subagent_done` is a different thing that is ignored. The `slots` frame is the
authority — every other frame is a delta and a delta can be missed — so `known`,
`liveRunning`, `waitingForInput`, `pendingApproval`, `unread` and `failedTurn` are all
reconciled against it and pruned to the slots it lists. `snapshot()` returns EMPTY while
the socket is down, keyed on the handshake having COMPLETED rather than on a socket
object existing, because a stale snapshot would leave the companion reporting work that
no longer has anywhere to run. Every row it emits is `kind: 'slot'`, which is what keeps
crons and subagents off the desktop cast.

Two facts the gateway never states outright are tracked here. A failure arrives only as
a `chat_message` with `role: 'error'` followed by an ordinary `chat_done`, so without
recording it a broken turn is indistinguishable from a clean one. A user Stop is visible
only as `stopping: true` on a `slots` frame while the cancel is in flight; a stopped turn
is neither success nor failure, so it produces no bubble, no hop and no error shake.

**The dashboard SPA** feeds the same model from Redux. `useAgentSync` maps
`dashboard.slots` together with `dashboard.failedSlots` and `dashboard.unreadSlots`, and
adds crons and spawns from their own polls. `PetCastScene.toStatusInputs` adapts an
`AgentSource` into a `StatusInput`: `slotKey` is emptied for any kind that is not a slot,
so a cron id can never be mis-addressed as a session key, and `since` is 0 for every
agent because the SPA has no per-agent entry timestamp — the sort falls back to state
rank alone, which is the ordering that scene wants.

That Redux state is fed by the dashboard's single multiplexed WebSocket
(`hooks/useWebSocket.ts`), not by SSE. The reducers keep `sse`-prefixed names
(`sseSlots`, `sseStatus`, …) for the transport they stand in for; the wire is a
WebSocket. `/worlds-popout` is routed outside `<App/>`, in its own window with its own
store, so it opens that socket itself — slot polling alone carries no message stream, and
`blocked` (an error-role message) and `ready` (an unread one) would both be unreachable
there without it.

`failed` and `unread` are NOT symmetric in durability. `unreadSlots` is persisted to
`localStorage` under `mc-unread-slots`; `failedSlots` is an in-memory
`Record<string, boolean>` with no persistence at all. A reload therefore keeps every
`unread` and drops every `failed`.

## Appearance packs

`idle` is the only slot `REQUIRED_STATES` demands — one image is a complete, valid
avatar, and everything else falls back through the resolver. `STATUS_STATES` is the
optional status trio (`done`, `error`, `needsInput`), `BREATHING_STATES` the three
guided-breathing phases, `RANDOM_STATES` the spontaneous clips. A turn RUNNING is
deliberately not a slot: `loading` and its `thinking` / `working` aliases sit in
`LEGACY_STATES` so packs authored before the status/random split keep working, and the
editor does not offer them.

`needsInput` resolves differently from the rest. `IDLE_ONLY_FALLBACK_SLOTS` in
`PetAvatar.tsx` routes it — with the three breathing phases — to the pack's IDLE art when
the pack ships no `needsInput` frame, instead of down the ordinary chain that ends in the
busy aliases. The reason is exposure. `done` is TRANSIENT, so a wrong frame shows for the
length of a hop; blocked-on-you is held until a human acts. Imported packs routinely
carry `thinking` art, so the busy chain would render a working body at exactly the moment
the user has to be told that nothing is progressing: they read "still working", never
approve, and the agent stalls — the failure this signal exists to prevent. Idle-vs-busy
is a real visual distinction; busy-vs-busy is none.

Motion travels with the art. `needs-input` plays `curious`, the head-cock, rather than
the ponder loop, because blocked-on-you is a request for attention and the loop would
read as "still working" — the one thing it is not.

## The crew scene in Agent Worlds

`PetCastScene` is the `crew` scene, and the only DOM scene: every other scene draws pixel
art into a canvas, and a Lottie pack cannot be drawn into a 2D context. It renders the
SAME appearance packs through `PetAvatar`, so the creature trailing the companion on the
desktop and the creature in the scene are one character rather than two drawings that
drift apart. Each crew state picks its pet appearance and its own design-token colour, so
the cast is readable before any label is.

`openCrewWorld.ts` is the single place that pairs "select the crew scene" with "open the
pop-out", shared by the cast sprites and the companion's context menu. It writes
`SCENE_STORAGE_KEY` BEFORE `window.open`, because the pop-out reads the key on mount and
broadcasting afterwards would race its first render, and it uses one stable window name
so a second click reuses the pop-out instead of stacking another over it.

Clicking a sprite lands there rather than focusing the session's chat because `petBridge`
has no slot-focus channel: the overlay is a separate Electron window, so
`window.open('/chat')` would open ANOTHER window instead of moving the one the user
already has. The pop-out is the surface that already carries the popover, composer and
approve/deny controls for acting on an agent.
