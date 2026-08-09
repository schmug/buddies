import React, { useCallback, useEffect, type RefObject } from 'react'
import type { AgentSource } from './useAgentSync'
import { useAgentPopover, type SceneAgent, type SceneTooltipTheme } from './useAgentPopover'

// The popover owns these; re-exported so scenes keep importing them from here.
export type { SceneAgent, SceneTooltipTheme }
export { agentStatusLine, messagePreview } from './useAgentPopover'

/**
 * Canvas adapter over {@link useAgentPopover}: turns mouse coordinates on a
 * pixel canvas into agent hits, and anchors the popover next to them.
 * @param canvasRef - ref to the pixel canvas element
 * @param agentsRef - ref to the scene's agent array
 * @param W - scene width in logical pixels
 * @param H - scene height in logical pixels
 * @param theme - scene-specific tooltip messages
 * @param hitRadius - hit-test radius in logical pixels (default 10)
 * @param extraLine - optional scene-specific tooltip line
 * @param sources - live AgentSource list (enables last-message tooltip line)
 */
export function useSceneInteraction(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  agentsRef: RefObject<SceneAgent[]>,
  W: number, H: number,
  theme: SceneTooltipTheme,
  hitRadius = 10,
  extraLine?: (agent: SceneAgent) => React.ReactNode,
  sources?: AgentSource[],
) {
  // Destructured rather than held as one object: the hook returns a fresh
  // literal every render, so depending on it would rebuild every handler below
  // on every animation-driven render. The callbacks themselves are stable.
  const { hover, clearHover, open, close, hoverAgent, elements, anchorRef } =
    useAgentPopover(sources, theme, extraLine)

  // A pointerdown on the canvas must not dismiss the popover; onClick below
  // owns the toggle, so re-point the anchor whenever the canvas node changes.
  useEffect(() => { anchorRef.current = canvasRef.current })

  const getAgentAt = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current
    if (!cv) return undefined
    const rect = cv.getBoundingClientRect()
    const mx = (e.clientX - rect.left) / rect.width * W
    const my = (e.clientY - rect.top) / rect.height * H
    return agentsRef.current?.find(a => Math.abs(a.x - mx) < hitRadius && Math.abs(a.y - my) < hitRadius)
  }, [canvasRef, agentsRef, W, H, hitRadius])

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const a = getAgentAt(e)
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!a || !rect) { clearHover(); return }
    hover(a, { x: e.clientX - rect.left + 12, y: e.clientY - rect.top - 50 })
  }, [getAgentAt, canvasRef, hover, clearHover])

  const onClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const a = getAgentAt(e)
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!a || !rect) { close(); return }
    // Keep the 272px-wide popover inside the canvas on both axes
    const px = Math.max(8, Math.min(e.clientX - rect.left + 12, rect.width - 280))
    const py = Math.min(Math.max(e.clientY - rect.top - 60, 8), rect.height - 200)
    open(a, { x: px, y: py })
  }, [getAgentAt, canvasRef, open, close])

  return {
    canvasProps: {
      onMouseMove, onMouseLeave: clearHover, onClick,
      // Driven by the HOVERED agent, not by whether a popover happens to be
      // open: the pointer cursor is the affordance that a slot is clickable.
      style: { cursor: hoverAgent?.kind === 'slot' ? 'pointer' : 'default' },
    },
    tooltipEl: elements,
  }
}
