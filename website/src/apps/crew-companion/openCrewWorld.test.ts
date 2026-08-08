/**
 * Opening the crew world from the overlay.
 *
 * The ordering assertion is the one that matters: the pop-out reads the scene key
 * on mount, so writing it after `window.open` would race the new window's first
 * render and land the user on whichever scene they last used.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { openCrewWorld, CREW_SCENE_KEY } from './openCrewWorld'
import { SCENE_STORAGE_KEY } from '../../pages/scenes/config'

describe('openCrewWorld', () => {
  let open: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    localStorage.clear()
    open = vi.spyOn(window, 'open').mockImplementation(() => null)
  })
  afterEach(() => {
    open.mockRestore()
  })

  it('selects the crew scene before the window opens', () => {
    const order: string[] = []
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => { order.push('store') })
    open.mockImplementation(() => { order.push('open'); return null })
    openCrewWorld()
    expect(order).toEqual(['store', 'open'])
    setItem.mockRestore()
  })

  it('stores the crew scene under the key the pop-out reads', () => {
    openCrewWorld()
    expect(localStorage.getItem(SCENE_STORAGE_KEY)).toBe(CREW_SCENE_KEY)
  })

  it('opens the worlds pop-out under one reusable window name', () => {
    openCrewWorld()
    openCrewWorld()
    expect(open).toHaveBeenCalledTimes(2)
    const [url, name] = open.mock.calls[0]
    expect(url).toBe('/worlds-popout')
    expect(open.mock.calls[1][1]).toBe(name)
  })

  it('sizes the window from the display', () => {
    openCrewWorld()
    const features = String(open.mock.calls[0][2])
    expect(Number(/width=(\d+)/.exec(features)?.[1])).toBe(
      Math.round(screen.availWidth * 0.6),
    )
  })

  it('asks for a usable size even when the screen reports no width', () => {
    const availWidth = vi.spyOn(screen, 'availWidth', 'get').mockReturnValue(0)
    openCrewWorld()
    const features = String(open.mock.calls[0][2])
    expect(Number(/width=(\d+)/.exec(features)?.[1])).toBeGreaterThan(0)
    expect(Number(/height=(\d+)/.exec(features)?.[1])).toBeGreaterThan(0)
    availWidth.mockRestore()
  })

  it('still opens when storage refuses the write', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('private mode')
    })
    expect(() => openCrewWorld()).not.toThrow()
    expect(open).toHaveBeenCalled()
    setItem.mockRestore()
  })
})
