import { useRef } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from './helpers'
import { useSceneInteraction, type SceneAgent, type SceneTooltipTheme } from '../hooks/useSceneInteraction'

// Opening the popover fetches the mini thread; keep the adapter off the network.
vi.mock('../api/client', () => ({
  api: {
    chatSlotDetail: vi.fn().mockResolvedValue({ messages: [] }),
    steerChat: vi.fn().mockResolvedValue(undefined),
    sendChat: vi.fn().mockResolvedValue({ body: null }),
    resolveApproval: vi.fn().mockResolvedValue(undefined),
    createChatSlot: vi.fn().mockResolvedValue(undefined),
  },
}))

const W = 100
const H = 100
const THEME: SceneTooltipTheme = { active: 'Working', idle: 'Idle' }

/** One slot at (50,50) and one cron at (10,10), inside the default hit radius. */
const AGENTS: SceneAgent[] = [
  { id: 'slot-a', name: 'Alpha', x: 50, y: 50, running: false, detail: '', kind: 'slot' },
  { id: 'cron-b', name: 'Beta', x: 10, y: 10, running: false, detail: '', kind: 'cron' },
]

let canvasProps: ReturnType<typeof useSceneInteraction>['canvasProps']

function Harness() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const agentsRef = useRef<SceneAgent[]>(AGENTS)
  const scene = useSceneInteraction(canvasRef, agentsRef, W, H, THEME)
  canvasProps = scene.canvasProps
  return (
    <div style={{ position: 'relative' }}>
      <canvas ref={canvasRef} width={W} height={H} data-testid="cv" {...scene.canvasProps} />
      {scene.tooltipEl}
    </div>
  )
}

/** jsdom reports a 0x0 rect, which would make the hit test divide by zero. */
function mountScene() {
  const { rerender } = renderWithProviders(<Harness />)
  const cv = screen.getByTestId('cv') as HTMLCanvasElement
  cv.getBoundingClientRect = () => ({
    left: 0, top: 0, right: W, bottom: H, width: W, height: H, x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect
  return { cv, rerender }
}

describe('useSceneInteraction cursor', () => {
  it('defaults to no affordance before any hover', () => {
    mountScene()
    expect(canvasProps.style.cursor).toBe('default')
  })

  it('shows a pointer while hovering a chat slot', () => {
    const { cv } = mountScene()
    fireEvent.mouseMove(cv, { clientX: 50, clientY: 50 })
    expect(canvasProps.style.cursor).toBe('pointer')
  })

  it('stays default over a non-slot agent, which has no thread to open', () => {
    const { cv } = mountScene()
    fireEvent.mouseMove(cv, { clientX: 10, clientY: 10 })
    expect(canvasProps.style.cursor).toBe('default')
  })

  it('drops back to default when the pointer moves off every agent', () => {
    const { cv } = mountScene()
    fireEvent.mouseMove(cv, { clientX: 50, clientY: 50 })
    expect(canvasProps.style.cursor).toBe('pointer')
    fireEvent.mouseMove(cv, { clientX: 95, clientY: 95 })
    expect(canvasProps.style.cursor).toBe('default')
  })

  it('drops back to default on mouse leave', () => {
    const { cv } = mountScene()
    fireEvent.mouseMove(cv, { clientX: 50, clientY: 50 })
    expect(canvasProps.style.cursor).toBe('pointer')
    fireEvent.mouseLeave(cv)
    expect(canvasProps.style.cursor).toBe('default')
  })

  it('is driven by the hovered agent, not by an open popover', () => {
    const { cv } = mountScene()
    fireEvent.click(cv, { clientX: 50, clientY: 50 })
    // The popover is open, so an openAgentId-driven cursor would read 'pointer'
    // here even though the pointer is over empty scene.
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.mouseMove(cv, { clientX: 95, clientY: 95 })
    expect(canvasProps.style.cursor).toBe('default')
  })
})

describe('useSceneInteraction memoization', () => {
  it('keeps onMouseMove stable across renders', () => {
    // Scenes re-render on every animation frame, and a fresh handler each frame
    // would defeat the useCallback entirely.
    const { rerender } = mountScene()
    const first = canvasProps.onMouseMove
    rerender(<Harness />)
    expect(canvasProps.onMouseMove).toBe(first)
  })
})
