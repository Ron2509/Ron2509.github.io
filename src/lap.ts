import { store } from './store'

// The visitor's lap: the clock starts when the name is up and the lap opens, and the time spent at each corner
// is a sector. It stops while the tab is hidden and at the chequered flag, and picks up again if they go back.

/** Sector names, one per corner after the start; the drive out of the start counts towards the first. */
export const SECTORS = ['Profile', 'Projects', 'Experience', 'Pit wall', 'Contact']
const spent = [0, 0, 0, 0, 0, 0]
let started = false
let last = 0
let cur = -1

const tick = (now: number) => {
  if (cur >= 0) spent[cur] += now - last
  last = now
}
const where = () => {
  const s = store.get()
  return started && !s.finished && document.visibilityState === 'visible' ? s.chapter : -1
}

store.subscribe(() => {
  const s = store.get()
  const now = performance.now()
  if (!started && s.entered) { started = true; last = now }
  tick(now)
  cur = where()
})
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { tick(performance.now()); cur = where() })

export type Lap = { total: number; sectors: number[] }

/** The lap so far, in ms. */
export function lapNow(): Lap {
  tick(performance.now())
  const sectors = [spent[0] + spent[1], spent[2], spent[3], spent[4], spent[5]]
  return { total: sectors.reduce((a, b) => a + b, 0), sectors }
}

/** A fresh lap from where the car is now. */
export function resetLap() {
  spent.fill(0)
  last = performance.now()
  cur = where()
}

const KEY = 'portfolio-best-lap'
/** The visitor's best lap on this browser, if there is one. */
export function bestLap(): Lap | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return v && Array.isArray(v.sectors) && v.sectors.length === SECTORS.length ? v : null
  } catch { return null }
}
/** Keeps the best total and, separately, the best of each sector. */
export function saveLap(l: Lap) {
  const b = bestLap()
  const next = b ? { total: Math.min(b.total, l.total), sectors: l.sectors.map((t, i) => Math.min(t, b.sectors[i])) } : l
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private window: nothing kept */ }
}

/** The lap as the flag came out, and the best before it: taken once, by whoever waves the flag. */
export const flag = { lap: null as Lap | null, best: null as Lap | null }
export function chequer() {
  flag.lap = lapNow()
  flag.best = bestLap()
  saveLap(flag.lap)
}

/** m:ss.mmm, the way a timing screen shows it. */
export function fmt(ms: number) {
  const m = Math.floor(ms / 60000)
  const s = (ms % 60000) / 1000
  return `${m}:${s.toFixed(3).padStart(6, '0')}`
}
