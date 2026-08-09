/**
 * castLayout — where each cast sprite sits relative to the main companion.
 *
 * A trail, not a ring: the sprites read as following the companion rather than
 * orbiting it, and a trail stays legible when the companion is docked against a
 * screen edge, where half a ring would be off-screen.
 *
 * Pure, so the spacing guarantee can be tested without a DOM — the same split as
 * walkMath / bubbleLayout / petAnim, for the same reason.
 */

/** Cast sprites are smaller than the main companion's PET_PX so the hierarchy reads. */
export const CAST_PX = 56

/** Gap between adjacent sprites, measured origin to origin. Exceeds CAST_PX, so no two overlap. */
const STRIDE = CAST_PX + 8

/** Vertical stagger, so a long trail is not a flat line. */
const RISE = 14

/** Extra lift once the trail is long enough to read as a group rather than a pair. */
const CROWD_LIFT = 6

/** Above this many sprites the whole trail lifts clear of the companion's own box. */
const CROWD_FROM = 2

/**
 * Offset of one cast slot from the companion's origin, in overlay-local pixels.
 *
 * Sprites trail to the LEFT because the companion's resting position is the
 * bottom-right of the display, so trailing left keeps the cast on screen without
 * any edge special-casing. `index` grows away from the companion, which is what
 * makes the cap's cut fall on the sprites furthest from it.
 */
export function castSlotOffset(index: number, total: number): { dx: number; dy: number } {
  const dx = -STRIDE * (index + 1)
  const dy = (index % 2 === 0 ? -RISE : RISE) - (total > CROWD_FROM ? CROWD_LIFT : 0)
  return { dx, dy }
}
