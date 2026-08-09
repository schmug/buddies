import type { ReactNode } from 'react'
import { Building2, Brain, Wand2, Waves, Rocket, Sparkles, TreePine, Ghost, Users } from 'lucide-react'

export type SceneKey = 'crew' | 'office' | 'panda' | 'neural' | 'wizard' | 'underwater' | 'mission' | 'serengeti' | 'ghost'

export interface SceneMeta {
  key: SceneKey
  icon: ReactNode
}

/**
 * Catalog keys for each scene's picker name and one-line description.
 *
 * Keys, not copy: this table is module-level, so an `i18nT()` call here would
 * resolve once at boot and never follow a language switch — the lookup happens
 * where each label renders. Shaped as flat `Record`s of full literal keys and
 * indexed inline at the `i18nT()` call, because that is the form
 * `scripts/check-i18n-keys.mjs` can resolve statically; a key it cannot resolve is
 * a key it cannot verify exists. Same shape as `FILTER_LABEL_KEY` in `ChatSidebar`.
 */
export const SCENE_LABEL_KEY: Record<SceneKey, string> = {
  crew: 'pages.scenes.config.crew_label',
  office: 'pages.scenes.config.office_label',
  panda: 'pages.scenes.config.panda_label',
  neural: 'pages.scenes.config.neural_label',
  wizard: 'pages.scenes.config.wizard_label',
  underwater: 'pages.scenes.config.underwater_label',
  mission: 'pages.scenes.config.mission_label',
  serengeti: 'pages.scenes.config.serengeti_label',
  ghost: 'pages.scenes.config.ghost_label',
}

export const SCENE_DESC_KEY: Record<SceneKey, string> = {
  crew: 'pages.scenes.config.crew_desc',
  office: 'pages.scenes.config.office_desc',
  panda: 'pages.scenes.config.panda_desc',
  neural: 'pages.scenes.config.neural_desc',
  wizard: 'pages.scenes.config.wizard_desc',
  underwater: 'pages.scenes.config.underwater_desc',
  mission: 'pages.scenes.config.mission_desc',
  serengeti: 'pages.scenes.config.serengeti_desc',
  ghost: 'pages.scenes.config.ghost_desc',
}

export const SCENES: SceneMeta[] = [
  { key: 'crew', icon: <Users className="lucide-inline" /> },
  { key: 'office', icon: <Building2 className="lucide-inline" /> },
  { key: 'panda', icon: <Sparkles className="lucide-inline" /> },
  { key: 'neural', icon: <Brain className="lucide-inline" /> },
  { key: 'wizard', icon: <Wand2 className="lucide-inline" /> },
  { key: 'underwater', icon: <Waves className="lucide-inline" /> },
  { key: 'mission', icon: <Rocket className="lucide-inline" /> },
  { key: 'serengeti', icon: <TreePine className="lucide-inline" /> },
  { key: 'ghost', icon: <Ghost className="lucide-inline" /> },
]

export const SCENE_STORAGE_KEY = 'mc-agent-scene'

/** CSS layout multiplier — keeps containers the same size as the original S=3 era */
export const SCENE_LAYOUT_SCALE = 3

/** Canvas pixel-buffer multiplier — sharp on HiDPI screens */
export const SCENE_SCALE = SCENE_LAYOUT_SCALE * Math.min(Math.ceil(window.devicePixelRatio ?? 1), 2)

export const POPOUT_CHANNEL = 'kirocrew-worlds-popout'
