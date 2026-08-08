import type { ReactNode } from 'react'
import { Building2, Brain, Wand2, Waves, Rocket, Sparkles, TreePine, Ghost, Users } from 'lucide-react'

export type SceneKey = 'crew' | 'office' | 'panda' | 'neural' | 'wizard' | 'underwater' | 'mission' | 'serengeti' | 'ghost'

export interface SceneMeta {
  key: SceneKey
  label: string
  icon: ReactNode
  desc: string
}

/**
 * `label` and `desc` are user-facing English and are NOT localised.
 *
 * They sit at module scope, which is exactly where a catalog lookup cannot go: a
 * value resolved once at module evaluation freezes the boot language and never
 * re-reads it. Localising them means moving the whole list behind a getter that
 * every consumer calls per render — all nine entries plus both pages that map
 * over them.
 */
export const SCENES: SceneMeta[] = [
  { key: 'crew', label: 'Crew', icon: <Users className="lucide-inline" />, desc: 'Your agents as their own characters' },
  { key: 'office', label: 'Office', icon: <Building2 className="lucide-inline" />, desc: 'Classic pixel office' },
  { key: 'panda', label: 'Panda Den', icon: <Sparkles className="lucide-inline" />, desc: 'Bamboo forest workspace, all pandas' },
  { key: 'neural', label: 'Neural Net', icon: <Brain className="lucide-inline" />, desc: 'Constellation map' },
  { key: 'wizard', label: 'Wizard Tower', icon: <Wand2 className="lucide-inline" />, desc: 'Alchemy lab' },
  { key: 'underwater', label: 'Deep Lab', icon: <Waves className="lucide-inline" />, desc: 'Underwater station' },
  { key: 'mission', label: 'Mission Control', icon: <Rocket className="lucide-inline" />, desc: 'NASA ops center' },
  { key: 'serengeti', label: 'Watering Hole', icon: <TreePine className="lucide-inline" />, desc: 'Serengeti savanna with giraffes, warthogs, and elephants' },
  { key: 'ghost', label: 'Kiro Haunt', icon: <Ghost className="lucide-inline" />, desc: 'Kiro ghosts in hats, glasses, and capes' },
]

export const SCENE_STORAGE_KEY = 'mc-agent-scene'

/** CSS layout multiplier — keeps containers the same size as the original S=3 era */
export const SCENE_LAYOUT_SCALE = 3

/** Canvas pixel-buffer multiplier — sharp on HiDPI screens */
export const SCENE_SCALE = SCENE_LAYOUT_SCALE * Math.min(Math.ceil(window.devicePixelRatio ?? 1), 2)

export const POPOUT_CHANNEL = 'kirocrew-worlds-popout'
