/**
 * The `needs-input` slot is REACHABLE, and optional.
 *
 * Two halves, because this app's recurring failure class is art that is imported,
 * stored and listed — and that nothing ever renders. A slot that exists in the type
 * but never reaches the resolver is the same bug wearing a type annotation, so the
 * reachability assertion is the point of the first test, not a nicety.
 *
 * The second half is the promise that makes the slot safe to add at all: every pack
 * ever authored ships without `needsInput` art, so a missing frame MUST degrade to
 * the pack's idle body rather than an empty box. Both the built-in ghost (no pack
 * animations at all) and a custom pack that omits the frame are pinned, because they
 * travel completely different code paths inside PetAvatar.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { STATUS_STATES } from './appearanceTypes'
import { slotLabel } from './slotLabel'

// Distinct shapes so a resolved data URI says WHICH frame was chosen.
const IDLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="9" height="9"/></svg>'
const NEEDS_INPUT_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><polygon points="0,0 9,0 4,9"/></svg>'
const LOADING_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><ellipse rx="4" ry="2"/></svg>'
// `circle`, not `line` or `path`: those two occur in the built-in ghost asset
// (`stroke-linejoin`, `<path>`), so the wait below would match the pre-resolve
// default frame and every assertion would run against the wrong image again.
const THINKING_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>'

const BUILT_IN = 'kiro-ghost'

const config = { activeAppearance: BUILT_IN as string }
const detail: { animations: Record<string, string>; sprite: Record<string, number> } = {
  animations: { idle: IDLE_SVG },
  sprite: {},
}

vi.mock('./petBridge', () => ({
  petBridge: {
    getCrewCompanionConfig: () => Promise.resolve(config),
    presetsGetColorMap: () => Promise.resolve(null),
    galleryGetPackDetail: () => Promise.resolve(detail),
    onGalleryActiveChanged: () => () => {},
    onColorMapChanged: () => () => {},
  },
}))

// Imported AFTER the mock is registered.
const { PetAvatar } = await import('./PetAvatar')

/**
 * The resolved body frame, decoded so the assertion can name the shape it wants.
 *
 * The wait is on a FIXTURE shape rather than on `src^="data:"`: the bundler inlines
 * the built-in ghost as a data URI too, so the cheaper selector matches the
 * pre-resolve default frame on the very first tick and every pack assertion would
 * run against the wrong image.
 */
async function bodyArt(container: HTMLElement): Promise<string> {
  let src = ''
  await waitFor(() => {
    const img = container.querySelector('img') as HTMLImageElement | null
    expect(img).not.toBeNull()
    src = decodeURIComponent(img!.getAttribute('src') || '')
    expect(src).toMatch(/rect|polygon|ellipse|circle/)
  })
  return src
}

/** The `src` the built-in ghost settles on for a given state. */
async function builtInArt(state: 'idle' | 'needs-input'): Promise<string> {
  const { container, unmount } = render(<PetAvatar size={64} state={state} />)
  const src = await waitFor(() => {
    const img = container.querySelector('img') as HTMLImageElement | null
    expect(img).not.toBeNull()
    const value = img!.getAttribute('src') || ''
    expect(value.length).toBeGreaterThan(0)
    return value
  })
  unmount()
  return src
}

afterEach(cleanup)

describe('PetAvatar needs-input', () => {
  beforeEach(() => {
    config.activeAppearance = BUILT_IN
    detail.animations = { idle: IDLE_SVG }
  })

  it('renders the needs-input state without throwing', () => {
    const { container } = render(<PetAvatar size={64} state="needs-input" />)
    expect(container.firstChild).toBeTruthy()
    expect(container.querySelector('img, svg, canvas')).toBeTruthy()
  })

  it('plays a custom pack needsInput frame when the pack ships one', async () => {
    config.activeAppearance = 'custom-pack'
    detail.animations = { idle: IDLE_SVG, needsInput: NEEDS_INPUT_SVG }
    const { container } = render(<PetAvatar size={64} state="needs-input" />)
    // `polygon` is the needsInput frame; `rect` would mean the slot never reached
    // the resolver and the state silently rendered as idle.
    expect(await bodyArt(container)).toContain('polygon')
  })

  it('falls back to idle art for a custom pack that ships no needsInput frame', async () => {
    config.activeAppearance = 'custom-pack'
    const { container } = render(<PetAvatar size={64} state="needs-input" />)
    expect(await bodyArt(container)).toContain('rect')
  })

  it('falls back to the built-in idle body, which ships no needsInput art at all', async () => {
    // The built-in ghost resolves nothing through the pack path — it is the bundled
    // SVG plus the eye overlay — so "no needsInput frame" here means the box must
    // hold the SAME body idle draws, not come up empty. Comparing the two states'
    // resolved `src` is the fallback claim stated as an equality rather than as a
    // "something rendered" that an empty string would also satisfy.
    const needsInput = await builtInArt('needs-input')
    const idle = await builtInArt('idle')
    expect(needsInput).toBe(idle)
  })

  it('refuses the busy aliases, so imported thinking art cannot read as "still working"', async () => {
    /*
     * The whole point of the signal. `done` may take the busy aliases because it is
     * transient — a wrong frame shows for the length of a hop. `needs-input` holds
     * until a human acts, so a wrong frame shows for minutes, and the wrong frame
     * here is the WORST one available: PetDex-style imports routinely carry
     * `thinking` art (which is why it is in LEGACY_STATES), so the ordinary chain
     * would render a busy body at exactly the moment the user must be told the agent
     * has stopped. They glance over, read "still working", never approve, and the
     * agent stalls. Idle-vs-busy is a real visual distinction; busy-vs-busy is none.
     */
    config.activeAppearance = 'custom-pack'
    detail.animations = { idle: IDLE_SVG, loading: LOADING_SVG, thinking: THINKING_SVG }
    const { container } = render(<PetAvatar size={64} state="needs-input" />)
    expect(await bodyArt(container)).toContain('rect')
  })
})

/**
 * A slot the editor OFFERS must have a name the editor can say.
 *
 * This lives beside the render tests rather than in a suite of its own because it
 * pins the other half of the same one-slot addition: `STATUS_STATES` is what
 * `PackEditor` maps over to build its Status grid, and `slotLabel` is what names each
 * cell. Adding a slot without a catalog row therefore ships a camelCase identifier
 * into a translated grid, unconditionally, in all 11 locales — and nothing else
 * catches it. `check-i18n-keys` verifies that referenced keys exist and `deadKeys`
 * finds keys nothing references; a slot with NO key is invisible to both, because
 * `slotLabel`'s raw-id fallback is deliberate (a pack may declare a slot this build
 * never enters). The gate has to be the offered set.
 */
describe('every offered status slot is named', () => {
  it('resolves through the catalog rather than rendering its raw identifier', () => {
    for (const slot of STATUS_STATES) {
      const label = slotLabel(slot)
      // Not the slot id: that is the fallback for an unmapped slot.
      expect(label, `${slot} has no STATE_LABEL_KEY row`).not.toBe(slot)
      // Not a dotted path either: that is i18next echoing a key with no catalog entry.
      expect(label, `${slot} is mapped to a key with no catalog entry`).not.toContain('.')
    }
  })
})
