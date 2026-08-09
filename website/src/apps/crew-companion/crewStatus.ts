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
