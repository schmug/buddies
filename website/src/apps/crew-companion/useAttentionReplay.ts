/**
 * useAttentionReplay — keep a HELD one-shot motion visible by re-triggering it.
 *
 * `.kg-anim-curious` is `2000ms … both` and its 100% keyframe is its 0% keyframe, so a
 * surface that holds `needs-input` cocks its head once and then sits at neutral. That
 * is worse than merely subtle: the `running` agents beside it loop on `ponder-loop`
 * forever, so the one agent that cannot progress without a human would be the only
 * thing on screen not moving — the priority the state exists to express, inverted.
 * (`curious` is in `POSED_ANIMS`, so the eyes keep an offset. An expression is not
 * motion, and motion is what catches an eye crossing the screen.)
 *
 * The returned epoch is what `PetAvatar` keys its animated span on, so each bump
 * remounts the node and the keyframes re-fire. `pet.tsx` drives the main companion the
 * same way, through the reaction epoch it already shares with every other repeated
 * motion; this hook is that pattern for the surfaces that have no reaction state of
 * their own.
 *
 * Callers must pass `animEpoch` ONLY to the avatars actually wearing the held motion.
 * Remounting a looping motion restarts it from 0% at an arbitrary point in its cycle,
 * which reads as a stutter.
 */
import { useEffect, useState } from 'react'

import { ATTENTION_REPLAY_MS } from './petAnim'

/**
 * @param active Whether anything on this surface is currently holding the motion.
 *   No timer runs while this is false, so an idle crew costs nothing.
 * @returns An epoch that advances once per `ATTENTION_REPLAY_MS`.
 */
export function useAttentionReplay(active: boolean): number {
  const [epoch, setEpoch] = useState(0)

  /*
   * SUBSCRIBED rather than read once, matching pet.tsx: the preference can change
   * while the companion is up, and a surface that sampled it at mount would keep
   * replaying for the rest of the session after the user asked it to stop.
   */
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    // Under reduced motion the stylesheet sets `.kg-anim-curious { animation: none }`,
    // so a replay would remount the node to play nothing.
    if (!active || reduced) return
    const id = window.setInterval(() => setEpoch((n) => n + 1), ATTENTION_REPLAY_MS)
    return () => window.clearInterval(id)
  }, [active, reduced])

  return epoch
}
