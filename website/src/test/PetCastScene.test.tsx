import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderWithProviders } from './helpers'
import PetCastScene, { characterAnchor, toStatusInputs } from '../pages/scenes/PetCastScene'
import { ATTENTION_REPLAY_MS } from '../apps/crew-companion/petAnim'
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

  /**
   * The label is the half you read; this is the half you glance at.
   *
   * The scene hands PetAvatar a state and no explicit `anim`, so STATE_TO_PET picks
   * the MOTION as well as the art. Routing `needs-input` at any other pose therefore
   * swaps the motion silently and the type checker stays content: `done` hops, which
   * reads as finished, and `loading` ponders on a loop, which reads as still working —
   * the two readings this state exists to rule out.
   */
  it('gives a character waiting on the user the head-cock, not the completion hop', () => {
    const { container } = renderWithProviders(
      <PetCastScene agents={[src('slot-a', { waitingForInput: true })]} visible />,
    )
    expect(container.querySelector('.kg-anim-curious')).toBeTruthy()
    expect(container.querySelector('.kg-anim-celebrate')).toBeNull()
    expect(container.querySelector('.kg-anim-ponder-loop')).toBeNull()
  })

  /**
   * ...and it must keep cocking it. `kg-curious` is a 2000ms one-shot ending back at
   * neutral, so a character that HOLDS `needs-input` settles still while every
   * `running` character beside it bobs forever on an infinite loop. Scanning a full
   * cast, the one that cannot move without you would be the one that moves least.
   *
   * Asserted on node identity, because the class name never changes — the remount is
   * what replays the keyframes.
   */
  it('keeps replaying the waiting head-cock rather than settling still', () => {
    vi.useFakeTimers()
    try {
      const { container } = renderWithProviders(
        <PetCastScene agents={[src('slot-a', { waitingForInput: true })]} visible />,
      )
      const first = container.querySelector('.kg-anim-curious')
      expect(first).toBeTruthy()
      act(() => { vi.advanceTimersByTime(ATTENTION_REPLAY_MS) })
      const second = container.querySelector('.kg-anim-curious')
      expect(second).toBeTruthy()
      expect(second).not.toBe(first)
    } finally {
      vi.useRealTimers()
    }
  })

  it('runs no replay timer while the scene is hidden', () => {
    // Nine scenes stay mounted at once and a hidden one draws no avatar, so a timer
    // bumping an epoch nothing reads would be pure waste.
    vi.useFakeTimers()
    try {
      renderWithProviders(
        <PetCastScene agents={[src('slot-a', { waitingForInput: true })]} visible={false} />,
      )
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
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
 * Anchoring the popover at the character's own origin paints it OVER that character,
 * and the second click — the gesture that closes it — then lands on the popover and
 * does nothing. Anchoring below without clamping is the mirror failure: the scene is
 * `overflow: hidden`, so a second-row character's popover has its bottom cut off,
 * taking the approve/deny row and the composer with it.
 *
 * Both were reproduced with a real cursor. A synthetic `element.click()` sees
 * neither, because dispatching straight at a node never consults what is painted on
 * top of it or whether the node is clipped.
 */
describe('characterAnchor', () => {
  // The popover's real size, measured from its own parts: 272 wide (declared in
  // useAgentPopover), and 35 header + 192 list-at-max + 35 approve/deny + 40 composer
  // tall.
  const POPOVER = { w: 272, h: 302 }
  // Measured geometry, not invented: a pop-out world whose scene box is 773x514,
  // holding 8 agents across two rows of 148px characters.
  const SCENE = { width: 773, height: 514 }
  const CHAR = { offsetWidth: 120, offsetHeight: 148 }
  const ROW_1 = { offsetLeft: 20, offsetTop: 20, ...CHAR }
  const ROW_2 = { offsetLeft: 20, offsetTop: 184, ...CHAR }
  const RIGHTMOST = { offsetLeft: 564, offsetTop: 20, ...CHAR }
  // Enough room below a first-row character for the whole popover.
  const TALL_SCENE = { width: 773, height: 900 }

  const overlaps = (
    a: { x: number; y: number },
    box: { offsetLeft: number; offsetTop: number; offsetWidth: number; offsetHeight: number },
  ) => a.x < box.offsetLeft + box.offsetWidth && a.x + POPOVER.w > box.offsetLeft
    && a.y < box.offsetTop + box.offsetHeight && a.y + POPOVER.h > box.offsetTop

  it('places the popover below the character when there is room', () => {
    expect(characterAnchor(ROW_1, TALL_SCENE).y)
      .toBeGreaterThan(ROW_1.offsetTop + ROW_1.offsetHeight)
  })

  it('keeps the popover left-aligned with its character when it goes below', () => {
    expect(characterAnchor(ROW_1, TALL_SCENE).x).toBe(ROW_1.offsetLeft)
  })

  it('never anchors above the scene, which would put it off-screen', () => {
    expect(characterAnchor(ROW_1, SCENE).y).toBeGreaterThanOrEqual(0)
  })

  /**
   * The scene is `overflow: hidden`, so a popover running past the bottom loses its
   * approve/deny row and composer — the agent below the first row then cannot be
   * approved, denied or messaged from the world at all.
   */
  it('keeps the whole popover inside the scene for a second-row character', () => {
    const a = characterAnchor(ROW_2, SCENE)
    expect(a.y + POPOVER.h).toBeLessThanOrEqual(SCENE.height)
    expect(a.x + POPOVER.w).toBeLessThanOrEqual(SCENE.width)
  })

  it('keeps the whole popover inside the scene for the rightmost character', () => {
    const a = characterAnchor(RIGHTMOST, TALL_SCENE)
    expect(a.x + POPOVER.w).toBeLessThanOrEqual(TALL_SCENE.width)
  })

  /**
   * The pair that a vertical-clamp-only fix cannot satisfy at once. Clamping a
   * second-row popover up into the scene puts it back over the character that owns
   * the toggle — measured in a real browser as `elementFromPoint` at the character's
   * centre resolving to the popover instead of the character.
   */
  it('never covers the character it belongs to, in either placement', () => {
    expect(overlaps(characterAnchor(ROW_1, TALL_SCENE), ROW_1)).toBe(false)
    expect(overlaps(characterAnchor(ROW_2, SCENE), ROW_2)).toBe(false)
    expect(overlaps(characterAnchor(RIGHTMOST, SCENE), RIGHTMOST)).toBe(false)
  })

  it('goes beside the character when it cannot fit below', () => {
    const a = characterAnchor(ROW_2, SCENE)
    expect(a.x).toBeGreaterThanOrEqual(ROW_2.offsetLeft + ROW_2.offsetWidth)
  })

  it('clamps rather than inverting when the scene is smaller than the popover', () => {
    // A collapsed or very short container must still yield a usable in-bounds origin,
    // not a negative one that pushes the popover off the top or the left.
    const tiny = characterAnchor(ROW_1, { width: 120, height: 100 })
    expect(tiny.x).toBeGreaterThanOrEqual(0)
    expect(tiny.y).toBeGreaterThanOrEqual(0)
  })

  it('leaves an unmeasured container with an in-bounds origin', () => {
    // jsdom, and the very first paint, both report 0x0.
    const unmeasured = characterAnchor(ROW_1, { width: 0, height: 0 })
    expect(unmeasured.x).toBeGreaterThanOrEqual(0)
    expect(unmeasured.y).toBeGreaterThanOrEqual(0)
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
