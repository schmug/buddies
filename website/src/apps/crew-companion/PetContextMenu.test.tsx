/**
 * The companion's menu, and its link into the crew world.
 *
 * Two properties are pinned here for the first time, both invisible to a reader of
 * `PetContextMenu` alone:
 *
 *  * The crew-world item acts in the RENDERER (`openCrewWorld`) rather than being
 *    forwarded to the main process. `petBridge.contextMenuAction` has no branch for
 *    it, and the preload's fall-through would swallow the action silently — a menu
 *    item that does nothing at all.
 *  * `onClose` fires exactly ONCE per item. `ContextMenu` closes before it dispatches,
 *    so a handler that also closes would run the parent's teardown twice. The COUNT is
 *    what catches that; asserting the mere call passes either way.
 *
 * The hitbox case is a re-statement rather than a new property: the same rect is
 * already pinned on `ContextMenu` itself in `src/test/CrewCompanionContextMenu.test.tsx`.
 * It is repeated at THIS level because what matters when the pet's menu grows is that
 * the rect is independent of the item COUNT — the overlay is click-through outside the
 * reported region, so an item below the fold of a menu-sized rect would be unclickable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SCENE_STORAGE_KEY } from '../../pages/scenes/config'
import { CREW_SCENE_KEY } from './openCrewWorld'

const contextMenuAction = vi.fn()
const setMenuHitbox = vi.fn()

vi.mock('./petBridge', () => ({
  petBridge: {
    contextMenuAction: (action: string) => contextMenuAction(action),
    setMenuHitbox: (rect: unknown) => setMenuHitbox(rect),
  },
}))

// Imported AFTER the mock is registered.
const { PetContextMenu } = await import('./PetContextMenu')

let open: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  localStorage.clear()
  contextMenuAction.mockClear()
  setMenuHitbox.mockClear()
  open = vi.spyOn(window, 'open').mockImplementation(() => null)
})

afterEach(() => {
  cleanup()
  open.mockRestore()
})

describe('PetContextMenu', () => {
  it('offers an item that opens the crew world', async () => {
    const onClose = vi.fn()
    render(<PetContextMenu x={0} y={0} isHidden={false} onClose={onClose} />)

    await userEvent.click(screen.getByRole('menuitem', { name: 'Open crew world' }))

    expect(localStorage.getItem(SCENE_STORAGE_KEY)).toBe(CREW_SCENE_KEY)
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('/worlds-popout'),
      expect.anything(),
      expect.anything(),
    )
    // Exactly once. `ContextMenu` closes BEFORE it dispatches, so a handler that
    // closes as well would tear the parent down twice; `toHaveBeenCalled()` alone
    // cannot tell the two apart.
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not forward the crew world to the main process', async () => {
    render(<PetContextMenu x={0} y={0} isHidden={false} onClose={vi.fn()} />)

    await userEvent.click(screen.getByRole('menuitem', { name: 'Open crew world' }))

    expect(contextMenuAction).not.toHaveBeenCalled()
  })

  it('still hands the other items to the bridge', async () => {
    render(<PetContextMenu x={0} y={0} isHidden={false} onClose={vi.fn()} />)

    await userEvent.click(screen.getByRole('menuitem', { name: 'Change avatar' }))

    expect(contextMenuAction).toHaveBeenCalledWith('gallery')
    expect(open).not.toHaveBeenCalled()
  })

  it('reports the whole viewport as its hitbox, whatever it lists', () => {
    const { unmount } = render(<PetContextMenu x={0} y={0} isHidden={false} onClose={vi.fn()} />)

    expect(setMenuHitbox).toHaveBeenCalledWith({
      x: 0, y: 0, w: window.innerWidth, h: window.innerHeight,
    })

    unmount()
    expect(setMenuHitbox).toHaveBeenLastCalledWith(null)
  })
})
