import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { carRig } from './Car'
import { engine, setRev } from './engine'
import { Shutter, SHUTTER_AT, SHUTTER_FALL } from './Shutter'
import { flag, fmt, SECTORS, type Lap } from './lap'
import { store, useStore } from './store'

// The chequered flag. Scrolling on past the last corner ends the lap: the car does a slow victory burnout, the
// garage shutter comes down over it (Shutter.tsx), and on the closed door a timing graphic gives the visitor
// their lap and its sectors, coloured the way the timing screens do it (purple: your best, yellow: slower than
// your best on this browser).

/** A cloth flag, pinned on its left edge, waving: drawn as shaded strips so the folds catch the light. */
function Flag() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current!
    const g = c.getContext('2d')!
    const COLS = 9, ROWS = 6, SUB = 5
    let raf = 0
    const t0 = performance.now()
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const dpr = Math.min(2, devicePixelRatio || 1)
      const W = c.clientWidth, H = c.clientHeight
      if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr) }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, W, H)
      const t = (now - t0) / 1000
      const fw = W * 0.9, fh = fw / 1.5
      const x0 = W * 0.04, y0 = (H - fh) / 2
      const A = fh * 0.075
      // the cloth's height off its rest position, and how much the fold faces the light, at (u, v)
      const phase = (u: number, v: number) => Math.PI * 2 * (1.25 * u - 0.55 * t) + v * 0.9
      const at = (u: number, v: number): [number, number] => {
        const k = Math.pow(u, 0.85)
        const p = phase(u, v)
        return [x0 + u * fw - A * 0.35 * k * (1 - Math.cos(p)), y0 + v * fh + A * k * Math.sin(p) + A * 0.25 * k * Math.sin(p * 0.5 + v * 2)]
      }
      for (let r = 0; r < ROWS; r++) {
        const va = r / ROWS, vb = (r + 1) / ROWS
        for (let q = 0; q < COLS * SUB; q++) {
          const ua = q / (COLS * SUB), ub = (q + 1) / (COLS * SUB)
          const white = (Math.floor(q / SUB) + r) % 2 === 0
          const um = (ua + ub) / 2, vm = (va + vb) / 2
          const light = 0.8 + 0.3 * Math.cos(phase(um, vm)) * Math.pow(um, 0.6)
          const base = white ? [214, 210, 204] : [17, 18, 20]
          const lift = white ? 0 : Math.max(0, light - 0.95) * 90
          g.fillStyle = `rgb(${base.map((b) => Math.round(Math.min(255, b * light + lift))).join(',')})`
          const a = at(ua, va), b = at(ub, va), d = at(ub, vb), e = at(ua, vb)
          g.beginPath()
          g.moveTo(a[0], a[1]); g.lineTo(b[0] + 0.4, b[1]); g.lineTo(d[0] + 0.4, d[1] + 0.4); g.lineTo(e[0], e[1] + 0.4)
          g.closePath()
          g.fill()
        }
      }
      // the pole it hangs from
      g.fillStyle = '#2a2c30'
      g.fillRect(x0 - 3, y0 - fh * 0.08, 3, fh * 1.25)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={ref} className="flag" aria-hidden="true" />
}

const sectorTime = (ms: number) => (ms < 60000 ? (ms / 1000).toFixed(3) : fmt(ms))

function Timing({ onRestart, onContact }: { onRestart: () => void; onContact: () => void }) {
  // the lap as it was read when the flag came out, against the best kept before it
  const lap: Lap = flag.lap ?? { total: 0, sectors: SECTORS.map(() => 0) }
  const best = flag.best
  const pb = !best || lap.total <= best.total
  const delta = best ? lap.total - best.total : 0
  const total = Math.max(1, lap.total)
  return (
    <motion.div className="finish card" role="dialog" aria-label="Lap complete"
      initial={{ opacity: 0, y: 28, filter: 'blur(8px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: SHUTTER_AT + SHUTTER_FALL + 0.4 } }}
      exit={{ opacity: 0, y: 18, filter: 'blur(6px)', transition: { duration: 0.4 } }}>
      <div className="finish-top">
        <Flag />
        <div className="finish-head">
          <span className="mono finish-k">Chequered flag · lap complete</span>
          <h2>Thanks for the lap.</h2>
          <div className="finish-lap">
            <span className="mono">Lap time</span>
            <b className={pb ? 'pb' : ''}>{fmt(lap.total)}</b>
            <span className="mono finish-delta">
              {!best ? 'First lap · personal best' : pb ? `New best · −${fmt(-delta)}` : `+${fmt(delta)} to your best`}
            </span>
          </div>
        </div>
      </div>
      {/* where the lap went: the sectors in proportion, then each one's time */}
      <div className="finish-bar" aria-hidden="true">
        {lap.sectors.map((t, i) => (
          <i key={i} className={!best || t <= best.sectors[i] ? 'pb' : 'slow'} style={{ flexGrow: Math.max(0.02, t / total) }} />
        ))}
      </div>
      <ol className="finish-sectors">
        {lap.sectors.map((t, i) => (
          <li key={i} className={!best || t <= best.sectors[i] ? 'pb' : 'slow'}>
            <span className="mono">S{i + 1} · {SECTORS[i]}</span>
            <b className="mono">{sectorTime(t)}</b>
          </li>
        ))}
      </ol>
      <div className="finish-actions">
        <button className="finish-btn" onClick={onRestart}><span aria-hidden="true">↺</span> Restart lap</button>
        <button className="finish-btn solid" onClick={onContact}>Let’s start the warm-up lap · Drop a line <span aria-hidden="true">→</span></button>
      </div>
    </motion.div>
  )
}

export function Finish({ onRestart }: { onRestart: () => void }) {
  const finished = useStore((s) => s.finished)
  const atContact = useStore((s) => s.chapter === 5 && s.hold && s.loaded)
  // the victory burnout, held long enough to smoke, let go slowly as the shutter comes down
  useEffect(() => {
    if (!finished) return
    // (a car still rebuilding from the Contact corner's dust finishes that first)
    const du = carRig.dust
    const after = (du && du.t >= 0 ? 2600 : 0) + 350
    const ids = [
      setTimeout(() => { if (engine.running) setRev(true) }, after),
      setTimeout(() => setRev(false), after + 3500),
    ]
    return () => { ids.forEach(clearTimeout); setRev(false) }
  }, [finished])
  return (
    <AnimatePresence>
      {/* "Drop a line" puts the flag away: back to the radio card, with the mail, GitHub and LinkedIn */}
      {finished && <Shutter key="shutter" />}
      {finished && <Timing key="finish" onRestart={onRestart} onContact={() => store.set({ finished: false })} />}
      {!finished && atContact && (
        <motion.div key="hint" className="finish-hint mono" aria-hidden="true"
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { delay: 3.2, duration: 0.8 } }} exit={{ opacity: 0, transition: { duration: 0.3 } }}>
          Scroll on to take the flag <span>↓</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
