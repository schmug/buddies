import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, act } from '@testing-library/react'
import { renderWithProviders, createTestStore } from './helpers'
import WorldsPopout from '../pages/WorldsPopout'

vi.mock('../hooks/useAgentSync', () => ({
  useAgentSync: () => ({
    agents: [
      { id: 'slot-1', name: 'Alpha', label: 'default', kind: 'slot', running: true, detail: '3 msgs' },
    ],
    maxAgents: 8,
  }),
}))

const { mockBroadcastScene } = vi.hoisted(() => ({
  mockBroadcastScene: vi.fn(),
}))

vi.mock('../hooks/usePopoutSync', () => ({
  usePopoutSync: () => ({ popoutActive: false, broadcastScene: mockBroadcastScene, openPopout: vi.fn() }),
}))

vi.mock('../pages/scenes/OfficeScene', () => ({ default: (p: { agents?: unknown[] }) => <div data-testid="scene-office">OfficeScene ({p.agents?.length ?? 0})</div> }))
vi.mock('../pages/scenes/NeuralConstellationScene', () => ({ default: (p: { agents: unknown[] }) => <div data-testid="scene-neural">NeuralScene ({p.agents.length})</div> }))
vi.mock('../pages/scenes/WizardTowerScene', () => ({ default: (p: { agents: unknown[] }) => <div data-testid="scene-wizard">WizardScene ({p.agents.length})</div> }))
vi.mock('../pages/scenes/UnderwaterLabScene', () => ({ default: (p: { agents: unknown[] }) => <div data-testid="scene-underwater">UnderwaterScene ({p.agents.length})</div> }))
vi.mock('../pages/scenes/mission-control/MissionControlScene', () => ({ default: (p: { agents: unknown[] }) => <div data-testid="scene-mission">MissionScene ({p.agents.length})</div> }))
vi.mock('../pages/scenes/PetCastScene', () => ({ default: (p: { agents: unknown[] }) => <div data-testid="scene-crew">CrewScene ({p.agents.length})</div> }))

// The popout now mounts the live WebSocket, which fetches the voice preference on
// open. Nothing else here touches the network.
vi.mock('../api/client', () => ({
  api: {
    chatSlots: vi.fn().mockResolvedValue([]),
    voiceConfig: vi.fn().mockResolvedValue({ autoSpeak: false }),
  },
}))

beforeEach(() => { localStorage.clear(); mockBroadcastScene.mockClear() })

describe('WorldsPopout', () => {
  it('renders all scene tab buttons', () => {
    renderWithProviders(<WorldsPopout />)
    expect(screen.getByText('Office')).toBeInTheDocument()
    expect(screen.getByText('Neural Net')).toBeInTheDocument()
    expect(screen.getByText('Wizard Tower')).toBeInTheDocument()
    expect(screen.getByText('Deep Lab')).toBeInTheDocument()
    expect(screen.getByText('Mission Control')).toBeInTheDocument()
  })

  it('shows office scene by default', () => {
    renderWithProviders(<WorldsPopout />)
    const officeWrapper = screen.getByTestId('scene-office').parentElement!
    expect(officeWrapper.style.display).not.toBe('none')
  })

  it('switches scene on tab click', () => {
    renderWithProviders(<WorldsPopout />)
    fireEvent.click(screen.getByText('Wizard Tower'))
    const wizardWrapper = screen.getByTestId('scene-wizard').parentElement!
    expect(wizardWrapper.style.display).not.toBe('none')
    const officeWrapper = screen.getByTestId('scene-office').parentElement!
    expect(officeWrapper.style.display).toBe('none')
  })

  it('keeps all scenes mounted when switching', () => {
    renderWithProviders(<WorldsPopout />)
    fireEvent.click(screen.getByText('Neural Net'))
    expect(screen.getByTestId('scene-office')).toBeInTheDocument()
    expect(screen.getByTestId('scene-neural')).toBeInTheDocument()
    expect(screen.getByTestId('scene-wizard')).toBeInTheDocument()
    expect(screen.getByTestId('scene-underwater')).toBeInTheDocument()
    expect(screen.getByTestId('scene-mission')).toBeInTheDocument()
  })

  it('persists scene selection to localStorage', () => {
    renderWithProviders(<WorldsPopout />)
    fireEvent.click(screen.getByText('Deep Lab'))
    expect(localStorage.getItem('mc-agent-scene')).toBe('underwater')
  })

  it('restores scene from localStorage', () => {
    localStorage.setItem('mc-agent-scene', 'wizard')
    renderWithProviders(<WorldsPopout />)
    const wizardWrapper = screen.getByTestId('scene-wizard').parentElement!
    expect(wizardWrapper.style.display).not.toBe('none')
  })

  it('has collapse/expand toggle', () => {
    renderWithProviders(<WorldsPopout />)
    const toggle = screen.getByTitle('Hide controls')
    expect(toggle).toHaveTextContent('▲')
    fireEvent.click(toggle)
    expect(screen.getByTitle('Show controls')).toHaveTextContent('▼')
  })

  it('passes agents to scenes', () => {
    renderWithProviders(<WorldsPopout />)
    expect(screen.getByTestId('scene-office')).toHaveTextContent('OfficeScene (1)')
  })

  it('broadcasts scene change', () => {
    renderWithProviders(<WorldsPopout />)
    fireEvent.click(screen.getByText('Wizard Tower'))
    expect(mockBroadcastScene).toHaveBeenCalledWith('wizard')
  })
})

/**
 * `/worlds-popout` is routed OUTSIDE `<App/>`, so it gets its own document and its
 * own store and inherits none of the app shell's subscriptions. Without a transport
 * of its own the popout's `failedSlots` stays empty forever and its `unreadSlots` is
 * a frozen localStorage snapshot that only decays — which would leave two of the crew
 * scene's four states unreachable on the surface "Open crew world" actually opens.
 *
 * The cost is one more socket per popout window, the same trade the popout already
 * makes by polling slots on its own.
 */
class MockWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  static instances: MockWebSocket[] = []
  readyState = MockWebSocket.CONNECTING
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  send = vi.fn()
  close = vi.fn()

  constructor() { MockWebSocket.instances.push(this) }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  simulateMessage(data: object) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }))
  }
}

describe('WorldsPopout live transport', () => {
  beforeEach(() => {
    MockWebSocket.instances.length = 0
    vi.stubGlobal('WebSocket', MockWebSocket)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('opens exactly one socket of its own', () => {
    renderWithProviders(<WorldsPopout />)
    // Exactly one, not merely at least one. No double-mount is reachable today —
    // the router renders a single route match — but "at least one" stays green if
    // `useWebSocket()` is later hoisted into a shared wrapper the popout also
    // renders, and the popout would then quietly hold two sockets per window.
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('records a slot failure from a chat_message the popout received', () => {
    const store = createTestStore()
    renderWithProviders(<WorldsPopout />, { store })
    expect(store.getState().dashboard.failedSlots).toEqual({})

    act(() => {
      MockWebSocket.instances[0].simulateOpen()
      MockWebSocket.instances[0].simulateMessage({
        type: 'chat_message',
        data: { slot: 'chat-broken', role: 'error', content: 'boom' },
      })
    })

    expect(store.getState().dashboard.failedSlots['chat-broken']).toBe(true)
  })

  it('marks a slot unread from a chat_message the popout received', () => {
    const store = createTestStore()
    renderWithProviders(<WorldsPopout />, { store })
    expect(store.getState().dashboard.unreadSlots).not.toContain('chat-busy')

    act(() => {
      MockWebSocket.instances[0].simulateOpen()
      MockWebSocket.instances[0].simulateMessage({
        type: 'chat_message',
        data: { slot: 'chat-busy', role: 'assistant', content: 'hi' },
      })
    })

    expect(store.getState().dashboard.unreadSlots).toContain('chat-busy')
  })
})
