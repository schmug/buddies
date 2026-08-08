import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderHookWithProviders, renderWithProviders } from './helpers'
import { useAgentPopover } from '../hooks/useAgentPopover'
import type { SceneAgent } from '../hooks/useSceneInteraction'

// The popover fetches the mini thread as soon as it opens; keep it off the network.
vi.mock('../api/client', () => ({
  api: {
    chatSlotDetail: vi.fn().mockResolvedValue({ messages: [] }),
    steerChat: vi.fn().mockResolvedValue(undefined),
    sendChat: vi.fn().mockResolvedValue({ body: null }),
    resolveApproval: vi.fn().mockResolvedValue(undefined),
    createChatSlot: vi.fn().mockResolvedValue(undefined),
  },
}))

const agent: SceneAgent = {
  id: 'slot-a', name: 'A', x: 0, y: 0, running: true, detail: '3 msgs', kind: 'slot',
}

describe('useAgentPopover', () => {
  it('starts with nothing open', () => {
    const { result } = renderHookWithProviders(() => useAgentPopover([]))
    expect(result.current.openAgentId).toBeNull()
  })

  it('opens for a chat slot', () => {
    const { result } = renderHookWithProviders(() => useAgentPopover([]))
    act(() => result.current.open(agent, { x: 10, y: 10 }))
    expect(result.current.openAgentId).toBe('slot-a')
  })

  it('toggles closed when the same agent is opened twice', () => {
    const { result } = renderHookWithProviders(() => useAgentPopover([]))
    act(() => result.current.open(agent, { x: 10, y: 10 }))
    act(() => result.current.open(agent, { x: 10, y: 10 }))
    expect(result.current.openAgentId).toBeNull()
  })

  it('ignores a non-slot agent', () => {
    const { result } = renderHookWithProviders(() => useAgentPopover([]))
    act(() => result.current.open({ ...agent, id: 'cron-x', kind: 'cron' }, { x: 0, y: 0 }))
    expect(result.current.openAgentId).toBeNull()
  })

  it('closes an open popover', () => {
    const { result } = renderHookWithProviders(() => useAgentPopover([]))
    act(() => result.current.open(agent, { x: 10, y: 10 }))
    act(() => result.current.close())
    expect(result.current.openAgentId).toBeNull()
  })

  it('tracks the hovered agent and clears it', () => {
    const { result } = renderHookWithProviders(() => useAgentPopover([]))
    act(() => result.current.hover(agent, { x: 4, y: 8 }))
    expect(result.current.hoverAgent?.id).toBe('slot-a')
    act(() => result.current.clearHover())
    expect(result.current.hoverAgent).toBeNull()
  })

  it('is callable with no arguments at all', () => {
    const { result } = renderHookWithProviders(() => useAgentPopover())
    expect(result.current.openAgentId).toBeNull()
    expect(result.current.elements).toBeTruthy()
  })
})

/**
 * The dismissal guard only runs once `elements` is mounted, because it reads the
 * popover's own DOM node to decide what counts as "outside". A renderHook that
 * never renders `elements` leaves that node null, short-circuits the guard, and
 * passes no matter what the guard says — so this block mounts for real.
 */
describe('useAgentPopover outside dismissal', () => {
  let latest: ReturnType<typeof useAgentPopover>

  function Harness() {
    const popover = useAgentPopover([])
    latest = popover
    return (
      <div style={{ position: 'relative' }}>
        <div data-testid="anchor" ref={el => { popover.anchorRef.current = el }} />
        <div data-testid="outside" />
        {popover.elements}
      </div>
    )
  }

  function mountOpen() {
    renderWithProviders(<Harness />)
    act(() => latest.open(agent, { x: 10, y: 10 }))
    // Guards this whole block against passing vacuously: without a mounted
    // popover node the dismissal branch is unreachable and proves nothing.
    expect(screen.getByRole('dialog')).toBeTruthy()
  }

  it('keeps the popover open when the anchor itself receives a pointerdown', () => {
    mountOpen()
    fireEvent.pointerDown(screen.getByTestId('anchor'))
    // The anchor's owner runs its own click handler, which owns the toggle;
    // dismissing here would turn a second click on the same agent into a reopen.
    expect(latest.openAgentId).toBe('slot-a')
    expect(screen.queryByRole('dialog')).toBeTruthy()
  })

  it('keeps the popover open when the pointerdown lands inside the popover', () => {
    mountOpen()
    fireEvent.pointerDown(screen.getByRole('dialog'))
    expect(latest.openAgentId).toBe('slot-a')
  })

  it('closes when a pointerdown lands anywhere else', () => {
    mountOpen()
    fireEvent.pointerDown(screen.getByTestId('outside'))
    expect(latest.openAgentId).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape', () => {
    mountOpen()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(latest.openAgentId).toBeNull()
  })
})
