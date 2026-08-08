/**
 * Open the Worlds pop-out on the crew scene.
 *
 * Shared by the cast sprites and the companion's context menu so there is one copy
 * of the "select the scene, then open the window" pair — two copies of a
 * `localStorage.setItem` plus `window.open` is exactly the shape jscpd flags, and
 * the ordering below is a correctness rule that must not be duplicated and drift.
 *
 * Clicking a sprite lands here rather than focusing the session's chat because
 * `petBridge` has no slot-focus channel: the overlay is a separate Electron window,
 * so `window.open('/chat')` would open ANOTHER window instead of moving the one the
 * user already has. The pop-out is the surface that already carries the popover,
 * composer and approve/deny controls for acting on an agent.
 */
import { SCENE_STORAGE_KEY } from '../../pages/scenes/config'

/** The scene the pop-out selects on mount. Matches the crew scene's registered id. */
export const CREW_SCENE_KEY = 'crew'

/** Widest the pop-out asks for, in px. Beyond this the scene just gains margin. */
const MAX_W = 960
/**
 * Narrowest the pop-out asks for.
 *
 * A floor rather than a bare `Math.min`: `screen.availWidth` is 0 in a headless or
 * embedded context, and `width=0` opens a window the user cannot see or close.
 */
const MIN_W = 480
/** Share of the display the pop-out takes when the screen is wider than MAX_W. */
const SCREEN_SHARE = 0.6
/** Scene aspect ratio, plus room for the pop-out's own chrome. */
const ASPECT = 1.5
const CHROME_H = 80

/** The route the Worlds pop-out is registered at, outside `<App/>`. */
const POPOUT_PATH = '/worlds-popout'
/**
 * The window TARGET, following the dashboard's other pop-outs (`mc-popout-*`).
 * A stable name is what makes a second click reuse the window rather than stack a
 * new one over it.
 */
const POPOUT_WINDOW_NAME = 'mc-popout-worlds'

/** The pop-out is resizable; the computed width and height are a starting size. */
const RESIZABLE = 'yes'

export function openCrewWorld(): void {
  // Written BEFORE the window opens because the pop-out reads it on mount;
  // broadcasting afterwards would race the new window's first render.
  try {
    localStorage.setItem(SCENE_STORAGE_KEY, CREW_SCENE_KEY)
  } catch {
    // Private mode refuses the write; the pop-out then opens on its last scene,
    // which is worse than landing on the crew but better than not opening.
  }
  const w = Math.round(Math.max(MIN_W, Math.min(MAX_W, screen.availWidth * SCREEN_SHARE)))
  const h = Math.round(w / ASPECT) + CHROME_H
  // A browser API contract rather than copy, so it is assembled from name/value
  // pairs: no part of it may ever read as a translatable sentence.
  const features = [['width', w], ['height', h], ['resizable', RESIZABLE]]
    .map((pair) => pair.join('=')).join(',')
  // One window NAME, so a second click reuses the pop-out instead of stacking a
  // new one over it.
  window.open(POPOUT_PATH, POPOUT_WINDOW_NAME, features)
}
