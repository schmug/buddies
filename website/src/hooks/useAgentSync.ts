import { useEffect, useMemo, useState } from 'react'
import { useSelector } from 'react-redux'
import { api } from '../api/client'
import type { RootState } from '../store'
import type { CronJob, SubagentInfo } from '../types'

export interface AgentSource {
  id: string
  name: string
  label: string
  kind: 'slot' | 'cron' | 'spawn'
  running: boolean
  detail: string
  /** Real latest message preview for chat slots (empty for crons/spawns) */
  lastMessage?: string
  /** True when the session is waiting for user input */
  waitingForInput?: boolean
  /** Pending tool approval blocking the session, if any */
  pendingApproval?: { tool: string; requestId: string } | null
  /** The slot's current turn emitted an error. */
  failed?: boolean
  /**
   * The slot has message activity the user has not viewed. Set for ANY
   * chat_message on a non-active slot, so it turns true mid-turn: this is not a
   * "finished" signal, and a still-running slot can be unread.
   */
  unread?: boolean
}

const MAX_AGENTS = 8
const CRON_POLL_MS = 5000
const SPAWN_POLL_MS = 3000

/**
 * Own-property lookup into a slot-keyed flag map.
 *
 * Slot keys derive from user-supplied titles and channel names, so a key like
 * `constructor` or `toString` is reachable. A bare `map[key]` resolves those
 * through `Object.prototype` and would paint a healthy, never-errored slot as
 * failed — permanently, because the write path guards those keys and so never
 * created an own property for any clear path to delete.
 */
function hasFlag(map: Record<string, boolean>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key) && map[key]
}

function shortName(s: string, max = 45): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

export function useAgentSync() {
  const slots = useSelector((s: RootState) => s.dashboard.slots)
  const failedSlots = useSelector((s: RootState) => s.dashboard.failedSlots)
  const unreadSlots = useSelector((s: RootState) => s.dashboard.unreadSlots)
  const [extras, setExtras] = useState<AgentSource[]>([])

  const slotAgents = useMemo<AgentSource[]>(() => slots.map(sl => ({
    id: 'slot-' + sl.key, name: shortName(sl.title || sl.key),
    label: sl.agent || 'default', kind: 'slot' as const,
    running: sl.running, detail: sl.messages + ' msgs',
    lastMessage: sl.last_message || '',
    waitingForInput: !!sl.waiting_for_input,
    pendingApproval: sl.pending_approval_info
      ? { tool: sl.pending_approval_info.tool, requestId: sl.pending_approval_info.request_id }
      : null,
    failed: hasFlag(failedSlots, sl.key),
    // `includes` searches unreadSlots BY VALUE, so unlike the failedSlots map
    // above it is already safe for a prototype-named key.
    unread: unreadSlots.includes(sl.key),
  })), [slots, failedSlots, unreadSlots])

  useEffect(() => {
    let cancelled = false
    let cronTimer: ReturnType<typeof setTimeout> | undefined
    let spawnTimer: ReturnType<typeof setTimeout> | undefined
    let cronResult: AgentSource[] = []
    let spawnResult: AgentSource[] = []
    const update = () => { if (!cancelled) setExtras([...cronResult, ...spawnResult]) }

    const pollCron = async () => {
      try {
        const cronData = await api.crons() as CronJob[]
        cronResult = cronData.filter(c => c.enabled).slice(0, 3).map(cr => ({
          id: 'cron-' + cr.id, name: shortName(cr.name || cr.id),
          label: 'cron', kind: 'cron' as const,
          running: cr.last_status === 'running', detail: cr.schedule,
        }))
      } catch { /* ignore */ }
      update()
      if (!cancelled) cronTimer = setTimeout(pollCron, CRON_POLL_MS)
    }

    const pollSpawn = async () => {
      try {
        const spawnData = await api.spawnList() as SubagentInfo[]
        spawnResult = spawnData.filter(s => !s.done).slice(0, 3).map(sp => ({
          id: 'spawn-' + sp.id, name: shortName(sp.task, 45),
          label: 'spawn', kind: 'spawn' as const,
          running: !sp.done, detail: sp.done ? 'done' : 'running',
        }))
      } catch { /* ignore */ }
      update()
      if (!cancelled) spawnTimer = setTimeout(pollSpawn, SPAWN_POLL_MS)
    }

    pollCron(); pollSpawn()
    return () => { cancelled = true; clearTimeout(cronTimer); clearTimeout(spawnTimer) }
  }, [])

  const agents = useMemo(() => [...slotAgents, ...extras].slice(0, MAX_AGENTS), [slotAgents, extras])
  return { agents, maxAgents: MAX_AGENTS }
}
