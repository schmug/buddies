/**
 * The cast half of the hitbox contract.
 *
 * The overlay is click-through everywhere except the rects it reports, so the
 * cast sprites are only clickable if their rects travel through `reportedHitboxes`
 * and `hitsAny`. These pin that they do, that the cast is a LIST (a merged
 * bounding box would make the gaps between sprites swallow clicks meant for the
 * window behind), and that a caller that never mentions the cast still works.
 */
import { describe, it, expect } from 'vitest'
import { hitsAny, reportedHitboxes } from './hitbox'

describe('cast hitboxes', () => {
  const pet = { x: 0, y: 0, w: 10, h: 10 }

  it('reports an empty cast by default', () => {
    const boxes = reportedHitboxes({ pos: { x: 0, y: 0 }, bubbleRect: null, menuRect: null })
    expect(boxes.cast).toEqual([])
  })

  it('treats a point inside a cast rect as a hit', () => {
    expect(hitsAny({ pet, cast: [{ x: 100, y: 100, w: 20, h: 20 }] }, 110, 110)).toBe(true)
  })

  it('treats a point outside every cast rect as a miss', () => {
    expect(hitsAny({ pet, cast: [{ x: 100, y: 100, w: 20, h: 20 }] }, 300, 300)).toBe(false)
  })

  it('tolerates an absent cast', () => {
    expect(hitsAny({ pet }, 5, 5)).toBe(true)
  })

  it('keeps the gap between two sprites click-through', () => {
    const cast = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 200, y: 0, w: 10, h: 10 },
    ]
    // Between the two sprites: a merged bounding box would report this as a hit.
    expect(hitsAny({ cast }, 100, 5)).toBe(false)
    expect(hitsAny({ cast }, 205, 5)).toBe(true)
  })
})
