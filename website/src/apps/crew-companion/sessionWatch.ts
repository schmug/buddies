/**
 * Watch the gateway for a chat session's turn ending, so the companion can say so.
 *
 * ## Why a WebSocket and not the companion's own backend
 *
 * The rest of the companion learns things by polling its own backend, which owns
 * reminders and break nudges. Session completion is different: the backend has no
 * knowledge of it. There is no `session_done` event and nothing enqueues a
 * session-shaped fire — the whole producing half was missing, so the panel's "Tell me
 * when sessions are done" switch saved a value that nothing read.
 *
 * The signal already exists, one layer up: the gateway broadcasts turn lifecycle over
 * the dashboard WebSocket to EVERY connected client, and an app-window page is such a
 * client — same origin, authenticated by the same session cookie. Mochi's panel
 * already consumes it exactly this way (`apps/mochi/panel/panelBridge.ts`), which is
 * the precedent this module follows rather than inventing a backend producer.
 *
 * ## The event names matter, because the obvious guess is wrong
 *
 *   `chat_status` → a turn STARTED (the model stream opened)
 *   `chat_done`   → that turn FINISHED. This is the session-done signal.
 *   `slots`       → the full slot list, each with `running` and `title`
 *   `subagent_done` → a spawned background agent ended. A DIFFERENT thing, ignored.
 *
 * ## The one thing the gateway does not tell us
 *
 * No payload carries a turn's start time or elapsed duration. So "was this turn long
 * enough to be worth interrupting for" can only be answered by having WATCHED the
 * start. A page that connects mid-turn cannot recover when that turn began, which is
 * exactly the `assumedStart` case the ported gate already reasons about: the desktop
 * app hit the same wall and treated an unobserved start as unknown rather than as
 * zero, because measuring from "when I first noticed" silently swallowed every
 * notification after a restart.
 *
 * ## Two outputs from one socket
 *
 * The same frames answer a second question — "what is the crew doing right now" —
 * which the desktop cast asks every frame. That is `snapshot()`, and it is a PULL:
 * the tables below are already maintained for the completion gate, so exposing a
 * read of them costs nothing, while pushing would make this module own a
 * subscription that the caller's render loop already provides.
 */
import {
  evaluateCompletion,
  confirmAssumedStart,
  type GateDecision,
} from './completionGate'
import type { StatusInput } from './crewStatus'

/** What the caller needs in order to raise a bubble. */
export interface SessionDone {
  /** Slot key of the session that finished. */
  slot: string
  /** The session's title, when the gateway has told us one. */
  title: string
  /** How long the turn ran, when we saw it start. */
  elapsedMs: number
  /**
   * True when the turn ENDED BADLY.
   *
   * The gateway has no "failed" event: a broken turn emits a `chat_message` with
   * `role: 'error'` and then terminates with an ordinary `chat_done`. So without
   * tracking that message a failure is indistinguishable from success, and the
   * companion cheerfully reports a finish that did not happen.
   */
  failed: boolean
}

export interface SessionWatchOptions {
  /** Raise the bubble. Called only for completions that pass the gate. */
  onDone: (done: SessionDone) => void
  /** Read the live preference each time, so toggling it takes effect at once. */
  isSilent: () => boolean
  /** Injectable for tests. */
  now?: () => number
  /** Injectable for tests; defaults to the real same-origin dashboard socket. */
  connect?: () => WebSocket
  /**
   * The companion's backend says a fire was just queued.
   *
   * A doorbell, not the delivery: the caller drains `/pending` itself, so the
   * cursor stays the single authority on ordering and nothing can arrive twice or
   * out of order. Without this the overlay waited out its poll interval on top of
   * the backend's own tick, and a due reminder was visibly late.
   */
  onFireQueued?: () => void
  /**
   * A tool is BLOCKED waiting for the user to approve it.
   *
   * This is the create half of the approval lifecycle, and it was the missing one:
   * the gateway broadcasts an `approval` frame the moment a tool goes pending, but
   * nothing here listened, so the sticky approval bubble the display machinery can
   * already render was never actually raised — and the panel's promise that
   * "anything waiting on you always notifies" quietly did not hold. The resolve half
   * (`onApprovalResolved`) was wired; without this the slot could be released but
   * never claimed.
   *
   * The frame carries the approval's `slot` (see state.py's broadcast_ws('approval',
   * …)) but no human title, so the words come from the same per-slot `titles` table
   * that `onDone` reads — the last `slots`/title we saw for that session, or '' when
   * we joined too late to have one.
   */
  onApproval?: (blocked: { slot: string; title: string }) => void
  /**
   * Blocked work was resolved somewhere else — approved or rejected in the
   * dashboard rather than through the companion's own bubble.
   *
   * Without this, a sticky bubble keeps holding the notification slot until the
   * user clicks it or the bounded hold expires, so everything behind it waits on a
   * question that has already been answered.
   */
  onApprovalResolved?: () => void
}

/** The gateway's socket, same origin as this page. */
function defaultConnect(): WebSocket {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return new WebSocket(`${proto}//${window.location.host}/api/ws`)
}

/** Backoff bounds for reconnection. */
const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 30_000

/** What a caller holds onto: the teardown, and a read of what the crew is doing. */
export interface SessionWatcher {
  /** Detach the socket and stop reconnecting. */
  stop: () => void
  /** The crew's current condition, as `crewStatus` wants it. Empty while down. */
  snapshot: () => StatusInput[]
}

/**
 * Start watching. Returns the watcher handle.
 *
 * Deliberately not a React hook: it owns a socket and a table of start times, and
 * both must survive re-renders of the companion. The caller holds the handle.
 */
export function watchSessions(opts: SessionWatchOptions): SessionWatcher {
  const now = opts.now ?? (() => Date.now())
  const connect = opts.connect ?? defaultConnect

  /** slot -> when we SAW it start. Absent means we never saw this turn begin. */
  const startedAt = new Map<string, number>()
  /**
   * Slots whose start we only assumed — they were already running the first time we
   * heard about them, so their real start is unknown and the duration rule cannot be
   * applied to them fairly.
   */
  const assumed = new Set<string>()
  /** slot -> last known title, for the bubble's words. */
  const titles = new Map<string, string>()
  /** Slots that emitted an error message during the current turn. */
  const failedSlots = new Set<string>()
  /**
   * Slots the USER deliberately stopped mid-turn.
   *
   * The backend broadcasts `chat_done` for a stopped turn exactly as it does for a
   * finished one — the frame is `{slot}` either way — so without this the companion
   * celebrated an interruption as a success. The stop itself never arrives as a
   * `chat_message` (the stop card is appended without a broadcast), but the `slots`
   * frames this watcher already consumes carry `stopping: true` while the cancel is
   * in flight; that is the signal recorded here. A stopped turn is neither a success
   * nor a failure — the user chose to end it — so `finish()` drops it silently:
   * no hop, no bubble, no error shake.
   */
  const stoppedSlots = new Set<string>()

  /*
   * ── Status-snapshot state ─────────────────────────────────────────────────
   *
   * Deliberately NOT shared with the completion tables above. Those are consumed
   * as the gate rules on a bubble — `finish()` empties them — while the snapshot
   * has to keep describing the session afterwards. Reading the gate's records
   * alone made a broken turn and a clean one both report `ready`, because the
   * failure was erased at the very moment the turn ended.
   *
   * Every one of these is reconciled against the `slots` frame, which is the
   * gateway's FULL list and its only authority on what exists and what each
   * session is doing. Every other frame here is a delta, and a delta can be missed.
   */

  /** Slots the gateway currently lists. The snapshot has exactly these rows. */
  const known = new Set<string>()
  /** Running per the frame — not per the gate's start table, which outlives a stop. */
  const liveRunning = new Set<string>()
  /** Turn ended and the session is waiting on the user (`waiting_for_input`). */
  const waitingForInput = new Set<string>()
  /**
   * Slots with a tool blocked on the user right now.
   *
   * Separate from the callbacks: `onApproval` fires once, at the moment the tool
   * goes pending, while the status snapshot has to keep answering "is this session
   * still waiting on me" on every frame that follows.
   */
  const pendingApproval = new Set<string>()
  /** Slots whose last turn ended with an outcome the user has not looked at yet. */
  const unread = new Set<string>()
  /**
   * A turn that ENDED badly, remembered past the gate's own bookkeeping.
   *
   * Cleared when the session next starts running, mirroring the dashboard slice's
   * `failedSlots`, so both surfaces answer "did that break" the same way.
   */
  const failedTurn = new Set<string>()
  /**
   * slot -> when its current condition began, for the status tie-break.
   *
   * Written only where a condition actually CHANGES, never on every frame: the
   * tie-break's whole job is to keep the longest-waiting agent stably first, and a
   * re-stamp on each repeated frame would reshuffle the cast on the user's desktop.
   */
  const stateSince = new Map<string, number>()

  /** Every per-slot set, so reconciliation is exhaustive by construction. */
  const slotSets: readonly Set<string>[] = [
    known, liveRunning, waitingForInput, pendingApproval, unread, failedTurn,
  ]

  /** Drop every trace of the slots the gateway no longer lists. */
  const pruneTo = (seen: Set<string>) => {
    for (const set of slotSets) {
      for (const slot of [...set]) if (!seen.has(slot)) set.delete(slot)
    }
    for (const slot of [...stateSince.keys()]) if (!seen.has(slot)) stateSince.delete(slot)
    for (const slot of [...titles.keys()]) if (!seen.has(slot)) titles.delete(slot)
  }

  /** Forget the whole crew, so a reconnect rebuilds from the next full frame. */
  const forgetAll = () => {
    for (const set of slotSets) set.clear()
    stateSince.clear()
  }

  /** Add or remove in one step, so a frame's boolean maps straight onto a set. */
  const setMember = (set: Set<string>, slot: string, member: boolean) => {
    if (member) set.add(slot)
    else set.delete(slot)
  }

  let socket: WebSocket | null = null
  /**
   * The handshake COMPLETED — not merely that a socket object exists.
   *
   * `open()` assigns the socket before the connection establishes, and `onopen`
   * need never fire, so keying the snapshot's emptiness on assignment would serve
   * pre-drop state for as long as the gateway stayed down: every retry from the
   * first onward makes the socket non-null again.
   */
  let connected = false
  let stopped = false
  let retryMs = RECONNECT_MIN_MS
  let retryTimer: number | null = null

  const markStart = (slot: string, wasAssumed: boolean) => {
    if (startedAt.has(slot)) return
    startedAt.set(slot, now())
    if (wasAssumed) assumed.add(slot)
  }

  const finish = (slot: string) => {
    const started = startedAt.get(slot)
    const wasAssumed = assumed.has(slot)
    const failed = failedSlots.has(slot)
    const userStopped = stoppedSlots.has(slot)
    startedAt.delete(slot)
    assumed.delete(slot)
    failedSlots.delete(slot)
    stoppedSlots.delete(slot)

    // The user pressed Stop: this turn ended because they ended it. Celebrating it
    // as done misreports the outcome, and shaking about it misreports it worse.
    if (userStopped) return

    let decision: GateDecision = evaluateCompletion({
      slotKey: slot,
      startedAt: started,
      now: now(),
      assumedStart: wasAssumed,
      /*
       * A FAILURE is never silenced.
       *
       * "Tell me when sessions are done" is a preference about good news. Work that
       * stopped because it broke is the case the user most needs to hear about, and
       * the app this was ported from made the same exception explicitly. The duration
       * rule still applies either way — a two-second failure is still noise.
       */
      silent: failed ? false : opts.isSilent(),
    })

    /*
     * An assumed start cannot be verified here.
     *
     * The desktop app recovered the real start from the gateway's slot history. This
     * page could fetch `/api/chat/slots/<slot>` and read the last user message's
     * timestamp, but that is the only proxy available and it is not the same fact:
     * a queued turn starts well after the message that asked for it. Rather than
     * dress an approximation up as a measurement, treat the elapsed we have as the
     * best available and let the gate rule on it — `confirmAssumedStart` applies the
     * same threshold, so a genuinely short turn is still skipped.
     */
    if (decision.action === 'verify') {
      // (realStart, now, fallbackElapsedMs). No recovered start is available here, so
      // 0 says "nothing to recover" and the measured elapsed is what gets ruled on.
      // Passing only the elapsed would leave the other two undefined, and
      // `now - undefined` is NaN — which is not less than the threshold, so the gate
      // would fall through to NOTIFY on every assumed start. Failing towards a
      // notification is the wrong direction for a rule whose whole job is silence.
      decision = confirmAssumedStart(0, now(), decision.elapsedMs)
    }
    if (decision.action !== 'notify') return

    opts.onDone({
      slot,
      title: titles.get(slot) ?? '',
      elapsedMs: decision.elapsedMs,
      failed,
    })
  }

  const handle = (raw: string) => {
    let msg: { type?: string; data?: unknown }
    try {
      msg = JSON.parse(raw) as { type?: string; data?: unknown }
    } catch {
      return // a frame we cannot read is not a reason to tear the socket down
    }
    const data = (msg.data ?? {}) as Record<string, unknown>

    switch (msg.type) {
      case 'chat_status': {
        // The earliest live start marker there is.
        if (typeof data.slot === 'string') {
          const slot = data.slot
          /*
           * Only the FIRST status frame of a turn opens a new turn.
           *
           * The gateway repeats this frame as the status line changes ("Thinking…",
           * then the next thing), so clearing the outcome on every one would wipe an
           * error recorded earlier in the SAME turn — and `onDone` would then report
           * a broken turn as a success. `startedAt` is the one record that already
           * distinguishes the two, and `markStart` is idempotent for the same reason.
           */
          const fresh = !startedAt.has(slot)
          markStart(slot, false)
          known.add(slot)
          if (!liveRunning.has(slot)) stateSince.set(slot, now())
          liveRunning.add(slot)
          // A session that is talking is not waiting on anybody. This is also what
          // heals a `pending_approval` the resolve frame could not name: the tool got
          // its answer, so the turn is moving again.
          waitingForInput.delete(slot)
          pendingApproval.delete(slot)
          if (fresh) {
            unread.delete(slot)
            failedSlots.delete(slot)
            failedTurn.delete(slot)
          }
        }
        break
      }
      case 'slots': {
        /*
         * The FULL list, and the authority on every field it carries: `running`,
         * `title`, `waiting_for_input` and `pending_approval` (all built by the
         * backend's serialize_slots). A slot found already running is an ASSUMED
         * start: we joined mid-turn. A slot MISSING from the list no longer exists,
         * which is the only way this socket ever learns that a session was deleted.
         */
        const list = Array.isArray(data) ? data : (data.slots as unknown[]) ?? []
        const seen = new Set<string>()
        for (const entry of list) {
          const s = entry as {
            key?: unknown
            running?: unknown
            title?: unknown
            stopping?: unknown
            waiting_for_input?: unknown
            pending_approval?: unknown
          }
          if (typeof s.key !== 'string') continue
          seen.add(s.key)
          if (typeof s.title === 'string') titles.set(s.key, s.title)
          const wasRunning = liveRunning.has(s.key)
          const isRunning = s.running === true
          if (isRunning) markStart(s.key, true)
          setMember(liveRunning, s.key, isRunning)
          setMember(waitingForInput, s.key, s.waiting_for_input === true)
          setMember(pendingApproval, s.key, s.pending_approval === true)
          // Running again means a NEW turn, so the last one's failure no longer
          // describes this session — the rule dashboardSlice's sseSlots applies.
          if (isRunning) failedTurn.delete(s.key)
          // First sight starts the clock; after that only a real change moves it.
          if (!known.has(s.key) || isRunning !== wasRunning) stateSince.set(s.key, now())
          known.add(s.key)
          /*
           * `stopping: true` is the only signal this socket gets that the user
           * pressed Stop — the stop card itself is appended to the transcript
           * without a `chat_message` broadcast, so it never arrives here. The flag
           * is transient (the cancel is in flight), which is exactly why it is
           * RECORDED rather than acted on: by the time `chat_done` lands the flag
           * may already be false again, and `finish()` needs to know the turn's
           * ending was chosen, not earned.
           */
          if (s.stopping === true) stoppedSlots.add(s.key)
        }
        pruneTo(seen)
        break
      }
      case 'chat_done': {
        if (typeof data.slot === 'string') {
          const slot = data.slot
          // Whatever the gate decides about the bubble, the turn produced something
          // the user has not read yet — that is a status the pet reports, not a
          // notification, so it is recorded regardless of the gate's ruling.
          unread.add(slot)
          liveRunning.delete(slot)
          stateSince.set(slot, now())
          // Take the failure BEFORE `finish()` consumes it: past this line the gate
          // has forgotten the turn broke, and the snapshot would call it merely read.
          if (failedSlots.has(slot)) failedTurn.add(slot)
          finish(slot)
        }
        break
      }
      case 'chat_message': {
        // The only signal that a turn is going wrong. Recorded rather than acted on:
        // the turn is still running, and `chat_done` is what closes it.
        if (typeof data.slot === 'string' && data.role === 'error') {
          failedSlots.add(data.slot)
        }
        break
      }
      case 'approval': {
        // A tool just went pending on the user's OK. Carries a `slot` (unlike the
        // resolve frame, which carries only an id), so this CAN say which session is
        // waiting — the title comes from the same table `onDone` reads, since the
        // frame itself has no human name.
        if (typeof data.slot === 'string') {
          known.add(data.slot)
          pendingApproval.add(data.slot)
          stateSince.set(data.slot, now())
          opts.onApproval?.({ slot: data.slot, title: titles.get(data.slot) ?? '' })
        }
        break
      }
      case 'approval_resolved': {
        // Carries the approval's id, not a slot — so this cannot say WHICH bubble to
        // clear. Treated as "the blocking question was answered", which is enough for
        // the caller to release a sticky bubble that is holding the slot.
        //
        // The STATUS half deliberately does not react at all. Clearing every slot
        // because one was answered would go quiet about a session still genuinely
        // blocked on the user, which is the failure this whole feature exists to
        // prevent — and unlike the bubble, nothing here is holding up a queue. The
        // backend pairs this broadcast with a slots push (see the dashboard's
        // approval handler), so the authoritative `pending_approval` arrives on the
        // next frame; a resumed turn's `chat_status` clears it as well.
        opts.onApprovalResolved?.()
        break
      }
      case 'app_event': {
        /*
         * App-published events all ride under ONE ws type with the real name
         * inside, because an app event called e.g. "notification" would otherwise
         * land in the dashboard's own notification feed. So the name has to be
         * unwrapped here rather than switched on above.
         */
        // The name is in `event`, NOT `type`: apps/event_bus.py builds the
        // envelope by DELETING `type` and writing the real name to `event`, so a
        // check on `inner.type` compares against undefined forever. It type-checks,
        // it throws nothing, and the doorbell simply never rings — reminders fall
        // back to the 2s poll and look merely a little slow. Mochi's panelBridge
        // carries the same note for the same reason.
        const inner = data as { event?: unknown; app?: unknown }
        if (inner.app === 'crew-companion' && inner.event === 'crew-companion:fire') {
          opts.onFireQueued?.()
        }
        break
      }
      default:
        break
    }
  }

  /**
   * The socket dropped while turns were in flight — report each as a FAILURE.
   *
   * A gateway restart or a network drop means no `chat_done` will ever arrive for
   * those slots, so without this they sat in `startedAt` forever: no notification (the
   * user is never told the work died) AND a stale start time, so the NEXT turn on that
   * slot measured its duration from the old start and could report a three-second turn
   * as a long one.
   *
   * Reported as failed, not silently dropped, because that is what it is: the work
   * stopped without finishing and the user did not ask for that. It goes through the
   * same `finish(failed)` path as an error row — which also means it is never silenced
   * by the session-notifications preference, matching the existing rule that bad news
   * always gets through.
   *
   * A deliberate Stop is excluded: `finish()` returns early for a slot in
   * `stoppedSlots`, so a stop that happens to be followed by a disconnect stays quiet.
   */
  const failInFlight = () => {
    for (const slot of [...startedAt.keys()]) {
      failedSlots.add(slot)
      finish(slot)
    }
  }

  const open = () => {
    if (stopped) return
    let ws: WebSocket
    try {
      ws = connect()
    } catch {
      schedule()
      return
    }
    socket = ws
    ws.onopen = () => { retryMs = RECONNECT_MIN_MS; connected = true }
    ws.onmessage = (ev) => handle(String(ev.data))
    // Both paths reconnect: a gateway restart closes cleanly, a network drop errors.
    // The crew is forgotten on the way down so a reconnect rebuilds from the next
    // full `slots` frame rather than serving whatever was true before the drop.
    ws.onclose = () => {
      socket = null
      connected = false
      failInFlight()
      forgetAll()
      schedule()
    }
    ws.onerror = () => {
      connected = false
      try { ws.close() } catch { /* already closing */ }
    }
  }

  function schedule() {
    if (stopped || retryTimer !== null) return
    retryTimer = window.setTimeout(() => {
      retryTimer = null
      retryMs = Math.min(retryMs * 2, RECONNECT_MAX_MS)
      open()
    }, retryMs)
  }

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
    if (!connected) return []
    return [...known].map((slot) => ({
      id: `slot-${slot}`,
      slotKey: slot,
      // Only chat slots reach this transport, so nothing here can be a cron or a
      // subagent — which is what keeps those off the desktop cast.
      kind: 'slot' as const,
      name: titles.get(slot) ?? '',
      running: liveRunning.has(slot),
      waitingForInput: waitingForInput.has(slot),
      pendingApproval: pendingApproval.has(slot),
      // Two windows, one answer: the gate's flag covers the error arriving mid-turn,
      // and the snapshot's own memory covers everything after the turn ended.
      failed: failedSlots.has(slot) || failedTurn.has(slot),
      unread: unread.has(slot),
      since: stateSince.get(slot) ?? now(),
    }))
  }

  const stop = () => {
    stopped = true
    connected = false
    if (retryTimer !== null) window.clearTimeout(retryTimer)
    retryTimer = null
    if (socket) {
      // Drop the handler first: closing fires onclose, which would otherwise
      // schedule a reconnect for a watcher the caller has already stopped.
      socket.onclose = null
      try { socket.close() } catch { /* already closing */ }
      socket = null
    }
  }

  open()

  return { stop, snapshot }
}
