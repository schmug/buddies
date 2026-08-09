/**
 * Pet overlay context menu — uses the shared ContextMenu component.
 * Provides pet-specific menu items with i18n.
 */
import { useCallback, useMemo } from 'react'
import { ContextMenu, type ContextMenuEntry } from './ContextMenu'
import { i18nT } from '../../i18n/t'
import { openCrewWorld } from './openCrewWorld'
import { petBridge } from './petBridge'

// Same method names as the desktop app's IPC bridge, re-implemented over
// Kiro Crew's gateway — so everything below is unchanged.
const api = petBridge

/**
 * The one action this menu performs itself rather than handing to the bridge.
 *
 * Named rather than inlined because the item and the dispatch below must agree; a
 * typo in either would fall through to `contextMenuAction`, which has no branch for
 * it, and the preload's catch-all would swallow it as a menu item that does nothing.
 */
const CREW_WORLD_ACTION = 'crew-world'

interface Props {
  x: number
  y: number
  isHidden: boolean
  onClose: () => void
}

export function PetContextMenu({ x, y, onClose }: Props) {

  const items: ContextMenuEntry[] = useMemo(() => {
    return [
      // The companion's link into the crew scene, and the only way to reach it from
      // the overlay: the pet has no chat surface of its own.
      //
      // Always offered, never conditioned on whether the Agent Worlds app is enabled.
      // `/worlds-popout` is routed in `main.tsx` OUTSIDE `<App/>` and its scenes are
      // dashboard code, not app-supplied, so the pop-out renders the crew scene
      // either way — there is no broken destination to guard against. Asking would
      // also mean a second `/api/apps` poll from this window: the main process's poll
      // reaches only itself, and this overlay mounts with no store.
      { label: i18nT('apps.crewCompanion.menu.open_crew_world'), action: CREW_WORLD_ACTION },
      // The gallery is its own window, so this is its entry point. It is NOT in
      // Settings: importing and authoring packs are creation flows that don't
      // belong in a preferences column.
      { label: i18nT('apps.crewCompanion.menu.change_avatar'), action: 'gallery' },
      { separator: true },
      // Quit names the APP, not the pet: "Quit Kiro" read as dismissing the
      // character rather than closing Crew Companion.
      { label: i18nT('apps.crewCompanion.menu.quit'), action: 'quit', danger: true },
    ]
    // Removed deliberately:
    //  • the 🎬 motion list and the 🔔 "Test notify" items — developer ingress that
    //    let anyone fire a reaction or a fake notification, so a celebration or an
    //    approval bubble no longer always meant something had happened;
  }, [])

  const handleAction = useCallback((action: string) => {
    // Handled here rather than in `petBridge`, because opening the pop-out is a
    // renderer act: `window.open` from this page is what gives the new window this
    // origin and this `localStorage`, which is where the scene key was just written.
    // `ContextMenu` has already called `onClose` by the time this runs.
    if (action === CREW_WORLD_ACTION) {
      openCrewWorld()
      return
    }
    api?.contextMenuAction?.(action)
  }, [])

  return (
    <ContextMenu
      x={x} y={y}
      items={items}
      reportHitbox
      onAction={handleAction}
      onClose={onClose}
    />
  )
}
