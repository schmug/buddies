import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderWithProviders } from './helpers'
import PetCastScene, { characterAnchor, toStatusInputs } from '../pages/scenes/PetCastScene'
import type { AgentSource } from '../hooks/useAgentSync'

// The popover fetches the mini thread the instant it opens; keep it off the network.
vi.mock('../api/client', () => ({
  api: {
    chatSlotDetail: vi.fn().mockResolvedValue({ messages: [] }),
    steerChat: vi.fn().mockResolvedValue(undefined),
    sendChat: vi.fn().mockResolvedValue({ body: null }),
    resolveApproval: vi.fn().mockResolvedValue(undefined),
    createChatSlot: vi.fn().mockResolvedValue(undefined),
  },
}))

const src = (id: string, over: Partial<AgentSource> = {}): AgentSource => ({
  id, name: `Session ${id}`, label: 'default', kind: 'slot',
  running: false, detail: '', ...over,
})

describe('PetCastScene', () => {
  it('renders one character per agent', () => {
    renderWithProviders(<PetCastScene agents={[src('slot-a'), src('slot-b')]} visible />)
    expect(screen.getAllByRole('button', { name: /Session/ })).toHaveLength(2)
  })

  it('labels a character that is waiting on the user', () => {
    renderWithProviders(<PetCastScene agents={[src('slot-a', { waitingForInput: true })]} visible />)
    const character = screen.getByRole('button', { name: /Session slot-a/ })
    expect(within(character).getByText('Needs you')).toBeTruthy()
  })

  it('labels a failed slot as blocked', () => {
    renderWithProviders(<PetCastScene agents={[src('slot-a', { failed: true })]} visible />)
    expect(within(screen.getByRole('button', { name: /Session slot-a/ })).getByText('Blocked')).toBeTruthy()
  })

  it('labels an idle slot with unread activity as ready', () => {
    renderWithProviders(<PetCastScene agents={[src('slot-a', { unread: true })]} visible />)
    expect(within(screen.getByRole('button', { name: /Session slot-a/ })).getByText('Ready')).toBeTruthy()
  })

  it('treats absent failed / unread as false rather than as a state', () => {
    renderWithProviders(<PetCastScene agents={[src('slot-a')]} visible />)
    expect(within(screen.getByRole('button', { name: /Session slot-a/ })).getByText('Idle')).toBeTruthy()
  })

  it('renders an empty-crew message when there are no agents', () => {
    renderWithProviders(<PetCastScene agents={[]} visible />)
    expect(screen.getByText(/no agents/i)).toBeTruthy()
  })

  it('renders nothing animated while hidden', () => {
    const { container } = renderWithProviders(
      <PetCastScene agents={[src('slot-a')]} visible={false} />,
    )
    expect(container.querySelector('[data-scene-paused="true"]')).toBeTruthy()
  })

  /**
   * The avatar owns the Lottie player, and a mounted player autoplays — there is no
   * pause on it. Nine scenes stay mounted at once, so a hidden scene that still
   * rendered its avatars would run nine packs' worth of animation behind
   * `display: none`. Asserted against PetAvatar's OWN art node rather than a marker
   * this scene controls, so switching the avatar to a still frame instead of
   * unmounting it cannot satisfy the test.
   */
  it('mounts no pet avatar at all while hidden', () => {
    const { container } = renderWithProviders(
      <PetCastScene agents={[src('slot-a')]} visible={false} />,
    )
    expect(container.querySelectorAll('img')).toHaveLength(0)
    // The character itself stays in the DOM — only its animated art is withheld.
    expect(screen.getByRole('button', { name: /Session slot-a/ })).toBeTruthy()
  })

  it('mounts the pet avatar once visible', () => {
    const { container } = renderWithProviders(
      <PetCastScene agents={[src('slot-a')]} visible />,
    )
    expect(container.querySelectorAll('img')).toHaveLength(1)
  })

  /**
   * The characters must be fully opaque on the very first paint, with no entry
   * animation to finish.
   *
   * A pop-out world is a background window by design — you put it on the second
   * monitor and work in the main one — and a backgrounded document reports
   * `visibilityState: 'hidden'`, at which point `requestAnimationFrame` stops firing
   * entirely. An entry transition from `opacity: 0` therefore never advances, and the
   * whole cast stays invisible until the window is focused. Observed in a real
   * browser: zero frames in 500 ms, every character stranded at 0.13 opacity.
   */
  it('paints the cast at full opacity with no entry animation to finish', () => {
    renderWithProviders(<PetCastScene agents={[src('slot-a'), src('slot-b')]} visible />)
    for (const character of screen.getAllByRole('button', { name: /Session/ })) {
      // An unset inline opacity reads as '' here; an entry transition writes its
      // starting value, so anything but '' or '1' is a frame the cast is waiting on.
      expect(['', '1']).toContain((character as HTMLElement).style.opacity)
      expect((character as HTMLElement).style.transform).toBe('')
    }
  })
})

/**
 * The popover's dismissal listener is capture-phase on `document`, and every
 * character is a button wrapping an avatar and two spans — so a pointerdown lands
 * on a DESCENDANT, never on the element that owns the toggle. Anchoring on the
 * scene container and testing containment (not identity) is what makes a second
 * click close the popover instead of dismissing-then-reopening it.
 */
describe('PetCastScene popover toggle', () => {
  function openFirst() {
    const view = renderWithProviders(<PetCastScene agents={[src('slot-a')]} visible />)
    const character = screen.getByRole('button', { name: /Session slot-a/ })
    fireEvent.pointerDown(character.firstElementChild ?? character)
    fireEvent.click(character)
    expect(screen.getByRole('dialog')).toBeTruthy()
    return { ...view, character }
  }

  it('opens the thread popover for a character', () => {
    openFirst()
  })

  it('survives a pointerdown on a descendant of the character', () => {
    const { character } = openFirst()
    fireEvent.pointerDown(character.firstElementChild ?? character)
    expect(screen.queryByRole('dialog')).toBeTruthy()
  })

  it('toggles closed on a second click of the same character', () => {
    const { character } = openFirst()
    fireEvent.pointerDown(character.firstElementChild ?? character)
    fireEvent.click(character)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('dismisses on a pointerdown outside the scene', () => {
    openFirst()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

/**
 * The popover is ~272x250. Anchoring it at the character's own origin paints it
 * OVER that character, and the second click — the gesture that closes it — then
 * lands on the popover and does nothing. Reproduced with a real cursor; a
 * synthetic `element.click()` cannot see it, because dispatching straight at a
 * node never consults what is painted on top of it.
 */
describe('characterAnchor', () => {
  it('places the popover below the character, never over it', () => {
    const box = { offsetLeft: 20, offsetTop: 20, offsetHeight: 150 }
    expect(characterAnchor(box).y).toBeGreaterThan(box.offsetTop + box.offsetHeight)
  })

  it('never anchors above the scene, which would put it off-screen', () => {
    // The top row sits at the container's padding, so a negative offset escapes it.
    expect(characterAnchor({ offsetLeft: 20, offsetTop: 20, offsetHeight: 150 }).y)
      .toBeGreaterThanOrEqual(0)
  })

  it('keeps the popover left-aligned with its character', () => {
    expect(characterAnchor({ offsetLeft: 148, offsetTop: 20, offsetHeight: 150 }).x).toBe(148)
  })
})

/**
 * `slotKey` addresses a chat session. `id.replace(/^slot-/, '')` leaves `cron-abc`
 * as `cron-abc`, which is a cron id wearing a slot key's name — so the prefix is
 * stripped only for the kind that actually has one.
 */
describe('toStatusInputs', () => {
  it('strips the slot- prefix for chat slots', () => {
    expect(toStatusInputs([src('slot-a')])[0].slotKey).toBe('a')
  })

  it('gives a cron no slot key rather than its own id', () => {
    const [input] = toStatusInputs([src('cron-abc', { kind: 'cron' })])
    expect(input.slotKey).toBe('')
    expect(input.kind).toBe('cron')
  })

  it('gives a subagent no slot key rather than its own id', () => {
    const [input] = toStatusInputs([src('spawn-9', { kind: 'spawn' })])
    expect(input.slotKey).toBe('')
    expect(input.kind).toBe('spawn')
  })

  it('carries the agent kind through instead of hardcoding slot', () => {
    expect(toStatusInputs([src('slot-a')])[0].kind).toBe('slot')
  })

  it('defaults the optional flags to false', () => {
    const [input] = toStatusInputs([src('slot-a')])
    expect(input.failed).toBe(false)
    expect(input.unread).toBe(false)
    expect(input.waitingForInput).toBe(false)
    expect(input.pendingApproval).toBe(false)
  })
})
