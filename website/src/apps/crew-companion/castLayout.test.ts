/**
 * Cast geometry — where each sprite sits relative to the main companion.
 *
 * Pure maths, so the spacing guarantee is provable without a DOM: the whole point
 * of splitting this out of the component is that "no two sprites overlap" is a
 * property, not a screenshot.
 */
import { describe, it, expect } from 'vitest'

import { castSlotOffset, CAST_PX } from './castLayout'

describe('castSlotOffset', () => {
  it('places a single sprite behind and beside the companion', () => {
    const { dx } = castSlotOffset(0, 1)
    expect(dx).not.toBe(0)
    expect(Math.abs(dx)).toBeGreaterThanOrEqual(CAST_PX)
  })

  it('spreads sprites without overlapping', () => {
    const offsets = [0, 1, 2, 3].map((i) => castSlotOffset(i, 4))
    for (let a = 0; a < offsets.length; a++) {
      for (let b = a + 1; b < offsets.length; b++) {
        const far =
          Math.abs(offsets[a].dx - offsets[b].dx) >= CAST_PX ||
          Math.abs(offsets[a].dy - offsets[b].dy) >= CAST_PX
        expect(far).toBe(true)
      }
    }
  })

  it('is stable for a given index and total', () => {
    expect(castSlotOffset(2, 4)).toEqual(castSlotOffset(2, 4))
  })

  it('trails to the left, so a companion resting bottom-right keeps its cast on screen', () => {
    for (const i of [0, 1, 2, 3]) expect(castSlotOffset(i, 4).dx).toBeLessThan(0)
  })

  it('orders the trail so a later index is further from the companion', () => {
    const dxs = [0, 1, 2, 3].map((i) => castSlotOffset(i, 4).dx)
    for (let i = 1; i < dxs.length; i++) expect(dxs[i]).toBeLessThan(dxs[i - 1])
  })
})
