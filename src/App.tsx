import { useEffect, useRef, useState } from 'react'
import Lenis from 'lenis'
import { useProgress } from '@react-three/drei'
import { Scene } from './Scene'
import { CircuitNav, TRACK } from './CircuitNav'
import { Cursor } from './Cursor'
import { Panels } from './Panels'
import { Callouts } from './Callouts'
import { PitBoard } from './PitBoard'
import { EXPERIENCE, PROJECTS } from './content'
import { CHAPTERS } from './config'
import { pace } from './stepper'
import { Modes } from './Modes'
import { CadLabels } from './cad/CadLabels'
import { CaseStudy } from './CaseStudy'
import { Finish } from './Finish'
import { chequer, resetLap } from './lap'
import { DWELL } from './Panels'
import { scroll, store, useStore } from './store'

// Space revs the engine, so it only counts as a scroll attempt when it isn't aimed at the controls
const engineHasFocus = () => !!document.activeElement?.closest('.engine')

/** the one-stop-per-gesture controller, shared with the nav, the circuit and the timing tower */
const stepper = { go: (_dir: number) => {}, settle: () => {}, restart: () => {} }

const smooth01 = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x) }

/** Items stepped through while each chapter's camera holds: one project or season per stretch of scroll. */
const STEPS = [1, 3, PROJECTS.length, EXPERIENCE.length, 1, 1]

/**
 * The way in: a graphite studio in the dark, the circuit drawing itself as the car loads, the lap counter
 * ticking. When the car is ready the overlay lifts and the studio lights come up on it.
 */
function Loader() {
  const { progress, active } = useProgress()
  const loaded = useStore((s) => s.loaded)
  const compiled = useStore((s) => s.compiled)
  const done = loaded && compiled && !active
  const track = useRef<SVGPathElement>(null)
  const dot = useRef<SVGCircleElement>(null)
  useEffect(() => {
    const p = track.current
    if (!p) return
    const len = p.getTotalLength()
    p.style.strokeDasharray = String(len)
    p.style.strokeDashoffset = String(len * (1 - progress / 100))
    const pt = p.getPointAtLength((len * progress) / 100)
    dot.current?.setAttribute('transform', `translate(${pt.x} ${pt.y})`)
  }, [progress])
  useEffect(() => { if (done) { performance.mark('loader:done'); document.body.classList.add('lit') } }, [done])
  return (
    <div className={'loader' + (done ? ' done' : '')} aria-hidden={done}>
      <div className="loader-in">
        <svg viewBox="0 0 120 200" className="loader-track" aria-hidden="true">
          <path d={TRACK} className="lt-base" />
          <path ref={track} d={TRACK} className="lt-lap" />
          <circle ref={dot} r="2.6" className="lt-car" />
        </svg>
        <div className="loader-read mono">
          <span>Opening the garage</span>
          <b>{String(Math.round(progress)).padStart(3, '0')}</b>
        </div>
        <span className="loader-sub mono">Raunak Saoji · Portfolio 2026</span>
      </div>
    </div>
  )
}

export default function App() {
  const lenisRef = useRef<Lenis | null>(null)
  const [time, setTime] = useState('')
  const chapter = useStore((s) => s.chapter)

  useEffect(() => {
    const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9 })
    lenisRef.current = lenis
    const sections = () => [...document.querySelectorAll<HTMLElement>('main > .chapter')]
    // The page is a lap. Each chapter's section is a stretch where the camera holds its shot and the chapter's
    // blocks are on screen (stepping through its items); the one-screen gap between sections is the camera
    // flying to the next corner, with the blocks cleared away.
    const sync = (y: number) => {
      const els = sections()
      const n = els.length
      if (n < 2) return
      const ih = innerHeight
      const holds = els.map((el) => [el.offsetTop, Math.max(el.offsetTop, el.offsetTop + el.offsetHeight - ih)])
      let p = 1, chapter = n - 1, hold = true, local = 1
      for (let i = 0; i < n; i++) {
        const [a, b] = holds[i]
        if (y <= b) {
          if (y >= a || i === 0) { p = i / (n - 1); chapter = i; local = (y - a) / Math.max(1, b - a) }
          else {
            const prevEnd = holds[i - 1][1]
            const t = smooth01((y - prevEnd) / Math.max(1, a - prevEnd))
            p = (i - 1 + t) / (n - 1)
            chapter = t < 0.5 ? i - 1 : i
            hold = false
            local = t < 0.5 ? 1 : 0
          }
          break
        }
      }
      scroll.progress = p
      const steps = STEPS[chapter] ?? 1
      const step = Math.min(steps - 1, Math.max(0, Math.floor(local * steps)))
      const s = store.get()
      if (s.chapter !== chapter || s.hold !== hold || s.step !== step) store.set({ chapter, hold, step })
    }
    lenis.on('scroll', (l: Lenis) => { scroll.velocity = l.velocity; sync(l.scroll) })

    // ---- one stop per gesture ----
    // Every place the lap can rest: each item of each chapter (mid-way through its stretch), and the start of
    // single-item chapters. A wheel flick, a swipe or a key moves exactly one stop, animated; a fast scroll
    // can't skip anything. Trackpad momentum is ignored until it dies down, so one flick is one stop.
    const stops = () => {
      const ih = innerHeight
      return sections().flatMap((el, ch) => {
        const a = el.offsetTop
        const span = Math.max(0, el.offsetHeight - ih)
        const n = STEPS[ch] ?? 1
        return n === 1 ? [{ y: a, ch }] : Array.from({ length: n }, (_, k) => ({ y: a + (span * (k + 0.5)) / n, ch }))
      })
    }
    const nearest = (list: { y: number }[], y: number) => list.reduce((b, s, i) => (Math.abs(s.y - y) < Math.abs(list[b].y - y) ? i : b), 0)
    let busy = false
    // One gesture, one stop. A gesture made while the lap is moving belongs to that move and is dropped (keeping it
    // would carry the lap on past the next stop); one made in the short settle after landing is kept and runs the
    // moment the stop lets it, so the first scroll on a new page is never lost.
    let pending = 0
    let pendingAt = 0
    const request = (dir: number) => {
      if (busy) return
      if (performance.now() >= pace.holdUntil) { pending = 0; go(dir) } else { pending = dir; pendingAt = performance.now() }
    }
    const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
    const go = (dir: number) => {
      // a stop that just arrived holds until its blocks are on screen; a new item at the same stop holds a beat
      if (busy || performance.now() < pace.holdUntil) return
      // past the flag the lap is over: back up and the flag goes in, the car still at the last corner
      if (store.get().finished) {
        if (dir < 0) { store.set({ finished: false }); pace.holdUntil = performance.now() + 900 }
        return
      }
      const list = stops()
      const i = nearest(list, lenis.targetScroll)
      const j = Math.max(0, Math.min(list.length - 1, i + dir))
      if (j === i) {
        // on past the last corner: the chequered flag
        if (dir > 0 && list[i].ch === sections().length - 1 && store.get().hold) {
          chequer()
          store.set({ finished: true })
          pace.holdUntil = performance.now() + 2600
        }
        return
      }
      const corner = list[j].ch !== list[i].ch
      busy = true
      pending = 0
      const duration = corner ? (Math.max(list[i].ch, list[j].ch) <= 2 ? 3.8 : 2.4) : 0.95
      lenis.scrollTo(list[j].y, {
        // a drive to the next corner takes its time; the next item at the same corner is quick
        // the first two drives (start to profile, profile to projects) are given longer to breathe
        duration,
        easing: corner ? easeInOut : easeOut,
        lock: true,
        force: true,
        onComplete: () => {
          busy = false
          // a new item holds a beat; a new corner holds until its blocks mount and set the real hold
          pace.holdUntil = Math.max(pace.holdUntil, performance.now() + (corner ? 700 : 150 + DWELL * 1000))
        },
      })
    }
    stepper.go = go
    stepper.settle = () => { busy = false }
    // a fresh lap: the flag goes in and the car drives the whole way back round to the start
    stepper.restart = () => {
      busy = true
      store.set({ finished: false })
      lenis.scrollTo(0, {
        duration: 4.2, easing: easeInOut, lock: true, force: true,
        onComplete: () => { busy = false; resetLap(); pace.holdUntil = performance.now() + 1200 },
      })
    }

    // The first page is a gate: nobody scrolls past it until the name has come up out of the smoke.
    // Trying to scroll before then nudges the engine controls instead.
    lenis.stop()
    const nudge = () => {
      document.body.classList.remove('nudge')
      void document.body.offsetWidth
      document.body.classList.add('nudge')
    }
    let touchY = 0
    let swiped = false
    // Wheels and trackpads: a gesture starts only after a real pause in the events, or on a change of direction.
    // A trackpad swipe speeding up, its momentum dying away, or a fast spin of the wheel all stay one gesture.
    let wheelAt = 0
    let wheelDir = 0
    let wheelAbs = 0
    let armed = true
    let probe = false
    let base = 0
    lenis.options.virtualScroll = ({ deltaX, deltaY, event }) => {
      // let a scrollable panel (phones) scroll inside itself
      const t = event.target as HTMLElement | null
      const inner = t?.closest?.('.panel-left') as HTMLElement | null
      if (inner && inner.scrollHeight > inner.clientHeight + 2 && event.type.includes('touch')) return false
      // an open case study scrolls itself (it is marked data-lenis-prevent); nothing behind it moves
      if (store.get().study !== null) return false
      if (event.cancelable && event.type !== 'touchstart') event.preventDefault()
      if (!store.get().entered) { if (Math.abs(deltaY) > 2) nudge(); return false }
      const now = performance.now()
      if (event.type === 'touchstart') { touchY = 0; swiped = false; return false }
      if (event.type.includes('touch')) {
        // a swipe: mostly-vertical travel past a threshold (sideways drags turn the car instead), once per swipe
        if (swiped || Math.abs(deltaY) < Math.abs(deltaX)) return false
        touchY += deltaY
        if (Math.abs(touchY) > 46) { swiped = true; request(Math.sign(touchY)) }
        return false
      }
      const abs = Math.abs(deltaY)
      if (abs < 1) return false
      const dir = Math.sign(deltaY)
      // when the input happened, not when the page got to it: a stalled frame must not look like a pause
      const at = event.timeStamp || now
      const gap = at - wheelAt
      // a turn or a long pause starts a new gesture; after a short pause it is only new if it pushes harder than
      // the tail it follows (momentum only ever dies away, a fresh swipe speeds up)
      if (dir !== wheelDir && abs >= 8) { armed = true; probe = false; wheelDir = dir }
      else if (gap > 450) { armed = true; probe = false; wheelDir = dir }
      else if (gap > 200) { probe = true; base = wheelAbs }
      if (probe && abs > Math.max(6, base * 1.4)) { armed = true; probe = false; wheelDir = dir }
      wheelAt = at
      wheelAbs = abs
      // it fires once, on its first real push (swipes start with a few tiny events, which must not use it up)
      if (armed && abs >= 4) { armed = false; probe = false; request(dir) }
      return false
    }
    const keys = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea')) return
      // an open case study reads with the keys (arrows and space scroll it), the lap waits
      if (store.get().study !== null) return
      const down = ['ArrowDown', 'PageDown'].includes(e.key) || (e.key === ' ' && !engineHasFocus() && !e.shiftKey)
      const up = ['ArrowUp', 'PageUp'].includes(e.key) || (e.key === ' ' && e.shiftKey && !engineHasFocus())
      if (!down && !up) return
      e.preventDefault()
      if (!store.get().entered) { if (down) nudge(); return }
      if (!e.repeat) request(down ? 1 : -1)
    }
    addEventListener('keydown', keys)
    const unsub = store.subscribe(() => { if (store.get().entered && lenis.isStopped) lenis.start() })
    const onResize = () => sync(lenis.scroll)
    addEventListener('resize', onResize)
    sync(0)
    let raf = 0
    const loop = (t: number) => {
      lenis.raf(t)
      // a kept gesture goes as soon as the stop it is waiting on lets it (and is dropped if it has gone stale)
      if (pending && !busy && performance.now() >= pace.holdUntil) {
        const d = pending
        pending = 0
        if (performance.now() - pendingAt < 2500) go(d)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    const clock = () =>
      setTime(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date()))
    clock()
    const iv = setInterval(clock, 30000)
    return () => {
      cancelAnimationFrame(raf); lenis.destroy(); clearInterval(iv); removeEventListener('resize', onResize)
      removeEventListener('keydown', keys); unsub()
    }
  }, [])

  const sectionAt = (i: number) => [...document.querySelectorAll<HTMLElement>('main > .chapter')][i]
  // jump to a chapter (p is its lap position, 0..1), landing at the start of its hold
  const jump = (p: number) => {
    if (!store.get().entered) { document.body.classList.remove('nudge'); void document.body.offsetWidth; document.body.classList.add('nudge'); return }
    const el = sectionAt(Math.round(p * (CHAPTERS.length - 1)))
    if (lenisRef.current && el) lenisRef.current.scrollTo(el.offsetTop, { duration: 2.2 })
  }
  // jump to item k of the chapter on screen, mid-way through that item's stretch
  const toStep = (k: number) => {
    const s = store.get()
    const el = sectionAt(s.chapter)
    if (!lenisRef.current || !el) return
    const span = Math.max(1, el.offsetHeight - innerHeight)
    lenisRef.current.scrollTo(el.offsetTop + (span * (k + 0.5)) / (STEPS[s.chapter] ?? 1), { duration: 1.2 })
  }

  const nav = CHAPTERS.slice(1).map((c) => [c.label, c.at] as const)

  return (
    <>
      <Scene />
      <Loader />
      <Cursor />

      <header className="top mono">
        <nav aria-label="Sections">
          {nav.map(([label, p], k) => (
            <a key={label} href={'#' + label.toLowerCase().replace(' ', '')} aria-current={chapter === k + 1}
              onClick={(e) => { e.preventDefault(); jump(p) }}>{label}</a>
          ))}
        </nav>
        <span className="status"><i aria-hidden="true" />Available · Bangalore · IST {time}</span>
      </header>

      <Modes />
      <h1 className="sr-only">Raunak Saoji, software developer</h1>
      <CircuitNav onJump={jump} />
      <Panels onStep={toStep} />
      <Callouts />
      <CadLabels />
      <PitBoard />
      <Finish onRestart={() => stepper.restart()} />
      <CaseStudy />

      {/* the scroll track: one stretch per chapter; the content itself is in the fixed panels above */}
      <main aria-hidden="true">
        <section className="chapter" id="intro" style={{ height: '150vh' }} />
        <section className="chapter" id="profile" style={{ height: '310vh' }} />
        <section className="chapter" id="projects" style={{ height: `${100 + PROJECTS.length * 70}vh` }} />
        <section className="chapter" id="experience" style={{ height: `${100 + EXPERIENCE.length * 70}vh` }} />
        <section className="chapter" id="pitwall" style={{ height: '150vh' }} />
        <section className="chapter" id="contact" style={{ height: '140vh' }} />
      </main>
    </>
  )
}
