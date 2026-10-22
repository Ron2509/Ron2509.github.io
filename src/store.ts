import { useSyncExternalStore } from 'react'
import { LIVERIES, type LiveryDef } from './liveries'
import { SPONSOR_SETS, type SponsorSet } from './sponsors'

type State = {
  /** livery id shown at each chapter, in chapter order */
  liveries: string[]
  /** livery currently on the car */
  active: LiveryDef
  /** partner marks currently on the car */
  partners: SponsorSet
  finish: 'gloss' | 'satin'
  loaded: boolean
  dragged: boolean
  /** the name has been revealed by a burnout */
  revealed: boolean
  /** the name is fully up and the visitor may scroll on past the first page */
  entered: boolean
  /** index of the chapter section actually in view */
  chapter: number
  /** the camera is parked on the chapter (not flying between two), so its blocks are on screen */
  hold: boolean
  /** which item of the chapter is up (one project or season at a time) */
  step: number
  /** a pit-wall screen is zoomed in on */
  pitZoomed: boolean
  /** when the last pit stop started (performance.now) and how long it took, seconds */
  pitAt: number
  pitTime: number
  /** livery id previewed in the paint lens (hovered swatch), or null for "next in line" */
  preview: string | null
  /** wind-tunnel mode: aero streamlines over the car */
  tunnel: boolean
  /** scrolled on past the last corner: the chequered flag is out */
  finished: boolean
  /** the project whose case study is open ("How it's built"), or null */
  study: number | null
}

let state: State = {
  liveries: ['rouge', 'petrol', 'grey', 'rouge', 'petrol', 'grey'],
  active: LIVERIES[0],
  partners: SPONSOR_SETS[0],
  finish: 'gloss',
  loaded: false,
  dragged: false,
  revealed: false,
  entered: false,
  chapter: 0,
  hold: true,
  step: 0,
  pitAt: 0,
  pitZoomed: false,
  pitTime: 0,
  preview: null,
  tunnel: false,
  finished: false,
  study: null,
}
const listeners = new Set<() => void>()

export const store = {
  get: () => state,
  set(patch: Partial<State>) {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  },
  subscribe(l: () => void) {
    listeners.add(l)
    return () => { listeners.delete(l) }
  },
}

export function useStore<T>(pick: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => pick(state))
}

// Scroll progress changes every frame, so the 3D scene reads it directly instead of re-rendering React.
export const scroll = { progress: 0, velocity: 0 }

if (import.meta.env.DEV) (window as unknown as { __store: typeof store }).__store = store
