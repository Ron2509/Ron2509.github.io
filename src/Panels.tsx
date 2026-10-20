import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { AnimatePresence, animate, motion, type Variants } from 'motion/react'
import { createPortal } from 'react-dom'
import { EngineControls } from './EngineControls'
import { engine, setRev } from './engine'
import { ANCHOR_LABEL, EXPERIENCE, LINKS, PIT_LANE, PROFILE, PROJECTS } from './content'
import { useStore } from './store'
import { pace } from './stepper'
import { ago, loadWire, setPitZoom, wire, wireMeshes, type Story } from './PitWall'
import { view } from './Scene'
import * as THREE from 'three'

// Every chapter's content arrives the way a race starts: a start-light gantry, then on lights out the blocks
// arrive. Each corner has its own entrance, in the language of an F1 broadcast, so no two feel the same:
//   grid    off the grid from the left: motion blur, a lean, a speed streak, a spring onto its marks
//   right   the same launch from the right (the driver card on the Profile corner)
//   rise    a lower-third rising up from the bottom of the frame (Experience)
//   emerge  out of a point in the studio: the car part a project is about, or the pit-wall screen (Pit wall)
//   radio   a team-radio caption tuning in (Contact)
// Variant labels flow down from the chapter root, so one `animate` drives every block, line and number in it.

const OUT = [0.16, 1, 0.3, 1] as const
const AWAY = [0.55, 0, 0.8, 0.2] as const
/** how long before the first block moves: lights out on arrival, almost nothing when only the item changes */
const Start = createContext(0.1)
export type Entrance = 'grid' | 'right' | 'rise' | 'emerge' | 'radio'
/** the corner's entrance, and for 'emerge' where on screen the blocks come out of */
const Kind = createContext<{ kind: Entrance; from?: () => { x: number; y: number } | null }>({ kind: 'grid' })
type C = { i: number; d: number; k: Entrance }

const spring = { type: 'spring', stiffness: 240, damping: 24, mass: 0.9 } as const
const blockV: Variants = {
  hidden: ({ k }: C) => (
    k === 'right' ? { opacity: 0, x: 120, skewX: 14, filter: 'blur(14px)' }
    : k === 'rise' ? { opacity: 0, y: 90, clipPath: 'inset(100% 0% 0% 0%)', filter: 'blur(10px)' }
    : k === 'emerge' ? { opacity: 0, scale: 0.04, filter: 'blur(10px)' }
    : k === 'radio' ? { opacity: 0, scaleY: 0.02, filter: 'brightness(3)' }
    : { opacity: 0, x: -120, skewX: -14, filter: 'blur(14px)' }),
  show: ({ i, d, k }: C) => {
    // per-value transitions don't inherit the shared delay, so each carries its own
    const delay = d + i * (k === 'rise' ? 0.11 : 0.075)
    if (k === 'rise') return {
      opacity: 1, y: 0, clipPath: 'inset(0% 0% 0% 0%)', filter: 'blur(0px)',
      transition: { y: { ...spring, delay }, clipPath: { duration: 0.6, ease: OUT, delay }, filter: { duration: 0.5, delay }, opacity: { duration: 0.2, delay } },
    }
    if (k === 'emerge') return {
      opacity: 1, scale: 1, filter: 'blur(0px)',
      transition: { scale: { type: 'spring', stiffness: 170, damping: 22, delay }, filter: { duration: 0.55, delay }, opacity: { duration: 0.25, delay } },
    }
    if (k === 'radio') return {
      opacity: [0, 1, 0.35, 1, 0.7, 1], scaleY: 1, filter: 'brightness(1)',
      transition: { scaleY: { duration: 0.45, ease: OUT, delay }, opacity: { duration: 0.6, delay, times: [0, 0.2, 0.35, 0.5, 0.7, 1] }, filter: { duration: 0.6, delay } },
    }
    return {
      opacity: 1, x: 0, skewX: 0, filter: 'blur(0px)',
      transition: { x: { ...spring, delay }, skewX: { duration: 0.55, ease: OUT, delay }, filter: { duration: 0.45, ease: OUT, delay }, opacity: { duration: 0.18, delay } },
    }
  },
  exit: ({ i, k }: C) => (
    k === 'rise' ? { opacity: 0, y: 60, filter: 'blur(8px)', transition: { duration: 0.4, ease: AWAY, delay: i * 0.035 } }
    : k === 'emerge' || k === 'radio' ? { opacity: 0, scale: 0.92, filter: 'blur(8px)', transition: { duration: 0.35, ease: AWAY, delay: i * 0.03 } }
    : { opacity: 0, x: k === 'right' ? -160 : 160, skewX: k === 'right' ? -12 : 12, filter: 'blur(12px)', transition: { duration: 0.42, ease: AWAY, delay: i * 0.035 } }),
}
// the speed streak: light trails behind a launching block, gone once it has landed (launches only)
const streakV: Variants = {
  hidden: { opacity: 0, scaleX: 0.2 },
  show: ({ i, d, k }: C) => (k === 'grid' || k === 'right'
    ? { opacity: [0, 0.9, 0], scaleX: [0.3, 1.2, 0.1], transition: { duration: 0.75, ease: 'easeOut', delay: d + i * 0.075, times: [0, 0.3, 1] } }
    : { opacity: 0 }),
  exit: { opacity: 0, transition: { duration: 0.1 } },
}
// the timing line along the top edge, drawn once the block is on its marks
const lineV: Variants = {
  hidden: { scaleX: 0 },
  show: ({ i, d }: C) => ({ scaleX: 1, transition: { duration: 0.7, ease: OUT, delay: d + i * 0.075 + 0.25 } }),
  exit: { scaleX: 0, transition: { duration: 0.2 } },
}
const innerV: Variants = {
  hidden: { opacity: 0 },
  show: ({ i, d }: C) => ({ opacity: 1, transition: { duration: 0.5, ease: OUT, delay: d + i * 0.075 + 0.18 } }),
  exit: { opacity: 0, transition: { duration: 0.2 } },
}
const riseV: Variants = {
  hidden: { y: '110%' },
  show: ({ i, d }: C) => ({ y: '0%', transition: { duration: 0.9, ease: OUT, delay: d + i * 0.07 + 0.28 } }),
  exit: { y: '-110%', transition: { duration: 0.3, ease: AWAY } },
}

type BlockProps = { i?: number; className?: string; children: ReactNode; callout?: string; label?: string; kind?: Entrance; from?: () => { x: number; y: number } | null }
function Block({ i = 0, className = '', children, callout, label, kind, from }: BlockProps) {
  const d = useContext(Start)
  const ctx = useContext(Kind)
  const k = kind ?? ctx.kind
  const src = from ?? ctx.from
  const c = { i, d, k }
  const ref = useRef<HTMLDivElement>(null)
  // 'emerge': grow out of the given point on screen. The card is mounted scaled down about its centre, so its
  // centre on screen is where it will sit; the origin is that point's offset in the card's own units.
  useLayoutEffect(() => {
    const el = ref.current
    if (k !== 'emerge' || !el || !src) return
    const p = src()
    if (!p) return
    const r = el.getBoundingClientRect()
    const fit = r.width / Math.max(1, el.offsetWidth * 0.04)
    const ox = el.offsetWidth / 2 + (p.x - (r.left + r.width / 2)) / fit
    const oy = el.offsetHeight / 2 + (p.y - (r.top + r.height / 2)) / fit
    el.style.transformOrigin = `${ox}px ${oy}px`
  }, [k, src])
  return (
    <motion.div ref={ref} className={'card ' + className + ' enter-' + k} custom={c} variants={blockV} data-callout={callout} aria-label={label}>
      <motion.span className="card-streak" custom={c} variants={streakV} aria-hidden="true" />
      <motion.span className="card-line" custom={c} variants={lineV} aria-hidden="true" />
      <motion.div className="card-in" custom={c} variants={innerV}>{children}</motion.div>
      <i className="tick tl" aria-hidden="true" />
      <i className="tick br" aria-hidden="true" />
    </motion.div>
  )
}

/** A headline whose lines rise out of a mask once the block is on its marks. */
function Rise({ i = 0, as: Tag = 'h2', children, className }: { i?: number; as?: 'h2' | 'h3' | 'p'; children: ReactNode; className?: string }) {
  const d = useContext(Start)
  return (
    <Tag className={'rise ' + (className ?? '')}>
      <motion.span className="rise-in" custom={{ i, d }} variants={riseV}>{children}</motion.span>
    </Tag>
  )
}

function Head({ t, label, i = 0, count }: { t: string; label: string; i?: number; count?: string }) {
  const d = useContext(Start)
  return (
    <div className="card-head mono">
      <span><b>{t}</b> {label}</span>
      {count && <motion.span custom={{ i, d }} variants={innerV}>{count}</motion.span>}
    </div>
  )
}

/**
 * The start gantry, as big as the moment deserves: it drops in over the studio, the five columns light one by
 * one at a real start's cadence (with a blip of the V8 each, if the engine is running), holds for a random beat
 * so nobody can anticipate it, then all five go out together with a full rev, and the blocks launch.
 */
type Plan = { on: number[]; out: number }
/** seconds every item stays on screen, once its blocks have landed, before a scroll moves on (a scroll made sooner
 *  waits, it is not lost) */
export const DWELL = 0.3
/** the start lights have run (once per visit) */
let lightsDone = false
const makePlan = (): Plan => {
  const on = Array.from({ length: 5 }, (_, k) => 0.25 + k * 0.24)
  return { on, out: on[4] + 0.3 + Math.random() * 0.3 }
}
function Gantry({ plan, hero }: { plan: Plan; hero?: boolean }) {
  useEffect(() => {
    const blip = (ms: number) => { if (!engine.running) return; setRev(true); setTimeout(() => setRev(false), ms) }
    const timers = plan.on.map((t) => setTimeout(() => blip(150), t * 1000))
    timers.push(setTimeout(() => blip(380), plan.out * 1000))
    return () => timers.forEach(clearTimeout)
  }, [plan])
  const T = plan.out + 0.9
  const f = (t: number) => t / T
  return createPortal(
    <motion.div className={'gantry mono' + (hero ? ' hero' : '')} aria-hidden="true"
      initial={{ opacity: 0, y: -40 }}
      animate={{ opacity: [0, 1, 1, 0], y: [-40, 0, 0, -30] }}
      transition={{ duration: T, times: [0, f(0.3), f(plan.out + 0.35), 1], ease: 'easeOut' }}>
      <span className="beam" />
      <span className="pods">
        {plan.on.map((t, k) => (
          <span className="pod" key={k}>
            {[0, 1].map((r) => (
              <span className="lamp" key={r}>
                <motion.i initial={{ opacity: 0 }} animate={{ opacity: [0, 0, 1, 1, 0] }}
                  transition={{ duration: T, times: [0, f(t) - 0.001, f(t), f(plan.out) - 0.001, f(plan.out)], ease: 'linear' }} />
              </span>
            ))}
          </span>
        ))}
      </span>
      <motion.b initial={{ opacity: 0, letterSpacing: '0.1em' }}
        animate={{ opacity: [0, 0, 1, 1, 0], letterSpacing: ['0.1em', '0.1em', '0.42em', '0.42em', '0.5em'] }}
        transition={{ duration: T, times: [0, f(plan.out) - 0.001, f(plan.out + 0.12), f(plan.out + 0.6), 1] }}>
        Lights out
      </motion.b>
    </motion.div>,
    document.body,
  )
}

/**
 * One corner's blocks. Arriving, it waits for lights out; when only the item on show changes later, the new
 * blocks go straight away.
 */
function Corner({ sref, className, label, children, hero, kind = 'grid', from }: {
  sref?: RefObject<HTMLElement | null>; className: string; label: string; children: ReactNode; hero?: boolean
  kind?: Entrance; from?: () => { x: number; y: number } | null
}) {
  const [at] = useState(() => performance.now())
  // the start lights run once, on the first arrival; every corner after that goes straight to its blocks
  const [plan] = useState(() => { const first = !lightsDone; lightsDone = true; return first ? makePlan() : null })
  const lead = plan ? plan.out + 0.05 : 0.25
  const start = Math.max(0.1, lead - (performance.now() - at) / 1000)
  // the lap waits here until the blocks have landed and been on screen a moment
  useState(() => { pace.holdUntil = Math.max(pace.holdUntil, at + (lead + 0.65 + DWELL) * 1000) })
  return (
    <Start.Provider value={start}>
      <Kind.Provider value={{ kind, from }}>
        {plan && <Gantry plan={plan} hero={hero} />}
        <motion.section ref={sref} className={className} {...root} aria-label={label}>
          {children}
        </motion.section>
      </Kind.Provider>
    </Start.Provider>
  )
}

/** A number that counts up once its block has landed. */
function Count({ to, sign = '', unit = '' }: { to: number; sign?: string; unit?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const d = useContext(Start)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.textContent = sign + '0' + unit
    const c = animate(0, to, { duration: 1.4, ease: OUT, delay: d + 0.45, onUpdate: (v) => { el.textContent = sign + Math.round(v) + unit } })
    return () => c.stop()
  }, [to, sign, unit, d])
  return <span ref={ref}>{sign + to + unit}</span>
}

const root = { initial: 'hidden', animate: 'show', exit: 'exit' } as const
const detailV = root

/**
 * Keeps a chapter's blocks inside the screen at any height: centred between the header and the bottom edge,
 * scaled down only when the content is taller than that band.
 */
function useFit(): RefObject<HTMLElement | null> {
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      if (matchMedia('(max-width: 820px)').matches) { el.style.transform = ''; return }
      const band = innerHeight - 84 - 28
      const k = Math.min(1, band / Math.max(1, el.offsetHeight))
      el.style.transform = `translate3d(0, -50%, 0) scale(${k.toFixed(4)})`
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    addEventListener('resize', fit)
    return () => { ro.disconnect(); removeEventListener('resize', fit) }
  }, [])
  return ref
}

// ---------- T1 · start ----------
function Hero() {
  return (
    <Corner className="panel panel-hero" label="Introduction" hero>
      <Block i={0} className="hero-card">
        <Head t="T1" label="Portfolio · 2026" />
        <p className="lede"><strong>Software developer.</strong> {PROFILE.lede}</p>
        <dl className="kv mono">
          <div><dt>Based in</dt><dd>{PROFILE.based}</dd></div>
          <div><dt>Now</dt><dd>MTS, Soket AI Labs</dd></div>
          <div><dt>Shipping</dt><dd>Loop · open source</dd></div>
        </dl>
      </Block>
      <Block i={1} className="engine-card"><EngineControls /></Block>
    </Corner>
  )
}

// ---------- T2 · profile ----------
// three stretches of scroll: who I am, the setup sheet, life off track
function Profile({ step }: { step: number }) {
  const ref = useFit()
  return (
    <Corner sref={ref} className="panel panel-right" label="Profile" kind="right">
      <AnimatePresence mode="wait">
        {step === 0 && (
          <motion.div key="who" className="step-wrap" {...detailV}>
            <Block i={0} className="span2">
              <Head t="T2" label="Profile · who I am" count="01 / 03" />
              <Rise i={0}>Backend and AI,</Rise>
              <Rise i={1}>built to hold.</Rise>
              <p className="body">{PROFILE.about}</p>
            </Block>
            <Block i={1} className="span2 strip"><span className="mono">Now</span><span>{PROFILE.now}</span></Block>
            <Block i={2} className="span2 strip"><span className="mono">Based in</span><span>{PROFILE.based}</span></Block>
          </motion.div>
        )}
        {step === 1 && (
          <motion.div key="skills" className="step-wrap" {...detailV}>
            <Block i={0} className="span2">
              <Head t="T2" label="Profile · setup sheet" count="02 / 03" />
              <Rise i={0}>The toolbox.</Rise>
              <dl className="skills">
                {PROFILE.skills.map((g) => (
                  <div key={g.k}>
                    <dt className="mono">{g.k}</dt>
                    <dd><ul>{g.v.map((x) => <li key={x}>{x}</li>)}</ul></dd>
                  </div>
                ))}
              </dl>
            </Block>
          </motion.div>
        )}
        {step >= 2 && (
          <motion.div key="off" className="step-wrap" {...detailV}>
            <Block i={0} className="span2">
              <Head t="T2" label="Profile · off track" count="03 / 03" />
              <Rise i={0}>Off the clock.</Rise>
              <ul className="hobbies four">
                {PROFILE.offTrack.map((h, k) => <li key={h}><span className="mono">{String(k + 1).padStart(2, '0')}</span>{h}</li>)}
              </ul>
            </Block>
            <Block i={1} className="span2 strip"><span className="mono">Education</span><span>{PROFILE.education}</span></Block>
          </motion.div>
        )}
      </AnimatePresence>
    </Corner>
  )
}

// ---------- shared: a timing tower ----------
type TowerRow = { key: string; pos: string; name: string; meta: string }
function Tower({ rows, step, onPick, i }: { rows: TowerRow[]; step: number; onPick: (k: number) => void; i: number }) {
  return (
    <Block i={i} className="tower-card">
      <ol className="tower">
        {rows.map((r, k) => (
          <li key={r.key}>
            <button className={k === step ? 'on' : ''} onClick={() => onPick(k)} aria-current={k === step}>
              {k === step && <motion.span layoutId="tower-hl" className="tower-hl" transition={{ type: 'spring', stiffness: 420, damping: 38 }} />}
              <span className="pos mono">{r.pos}</span>
              <span className="nm">{r.name}</span>
              <span className="meta mono">{r.meta}</span>
            </button>
          </li>
        ))}
      </ol>
    </Block>
  )
}

// ---------- T3 · projects ----------
// the project on show in a card; the car beside it, pulled apart, tells how it works step by step (cad/CadLabels)
function Projects({ step, onStep }: { step: number; onStep: (k: number) => void }) {
  const p = PROJECTS[Math.min(step, PROJECTS.length - 1)]
  const ref = useFit()
  return (
    <Corner sref={ref} className="panel panel-left split" label="Projects">
      <Block i={0} className="span2 title-card">
        <Head t="T3" label="Projects · what I've built" count={`${String(step + 1).padStart(2, '0')} / ${String(PROJECTS.length).padStart(2, '0')}`} />
        <Rise i={0}>Race results.</Rise>
      </Block>
      <Tower i={1} step={step} onPick={onStep}
        rows={PROJECTS.map((x, k) => ({ key: x.name, pos: 'P' + (k + 1), name: x.short, meta: x.badge ? 'IEEE' : x.year }))} />
      <AnimatePresence mode="wait">
        <motion.div key={p.name} className="detail-wrap" {...detailV}>
          <Block i={0} className="detail" label={p.name}>
            <Head t={'P' + (step + 1)} label="How it works · on the car →" />
            <Rise i={0} as="h3">{p.name}</Rise>
            {p.badge && <em className="badge mono">{p.badge}</em>}
            <p className="kind mono">{p.kind}</p>
            {/* the numbers first, read at a glance; the one line of why after */}
            <div className="stats">{p.stats.map((x) => <div key={x.k}><b>{x.v}</b><span className="mono">{x.k}</span></div>)}</div>
            {p.note && <p className="body">{p.note}</p>}
            <ul className="tags mono">{p.tags.map((t) => <li key={t}>{t}</li>)}</ul>
            <div className="links mono">
              {p.live && <a className="go" href={p.live} target="_blank" rel="noreferrer">Live demo <span aria-hidden="true">↗</span></a>}
              <a className="go" href={p.href ?? LINKS.githubRepos} target="_blank" rel="noreferrer">
                {p.href ? 'Repository' : 'GitHub profile'} <span aria-hidden="true">↗</span>
              </a>
            </div>
          </Block>
        </motion.div>
      </AnimatePresence>
      <Block i={3} className="span2 strip pit">
        <span className="mono">Pit lane · second-year basics, built in free time</span>
        <span className="pl">
          {PIT_LANE.map((x) => <a key={x.name} href={x.href} target="_blank" rel="noreferrer">{x.name}</a>)}
          <a className="all" href={LINKS.githubRepos} target="_blank" rel="noreferrer">All repos ↗</a>
        </span>
      </Block>
    </Corner>
  )
}

// ---------- T4 · experience ----------
// a broadcast lower-third: the seasons and the one on show rise up along the bottom, the car framed above
function Experience({ step, onStep }: { step: number; onStep: (k: number) => void }) {
  const r = EXPERIENCE[Math.min(step, EXPERIENCE.length - 1)]
  return (
    <Corner className="panel panel-bottom" label="Experience" kind="rise">
      <Block i={0} className="seasons-card">
        <Head t="T4" label="Experience" count={`${String(step + 1).padStart(2, '0')} / ${String(EXPERIENCE.length).padStart(2, '0')}`} />
        <Rise i={0}>Seasons.</Rise>
        <ol className="tower compact">
          {EXPERIENCE.map((x, k) => (
            <li key={x.company}>
              <button className={k === step ? 'on' : ''} onClick={() => onStep(k)} aria-current={k === step}>
                {k === step && <motion.span layoutId="season-hl" className="tower-hl" transition={{ type: 'spring', stiffness: 420, damping: 38 }} />}
                <span className="pos mono">{x.now ? 'NOW' : x.when.slice(-4)}</span>
                <span className="nm">{x.company}</span>
              </button>
            </li>
          ))}
        </ol>
      </Block>
      <AnimatePresence mode="wait">
        <motion.div key={r.company} className="detail-wrap" {...detailV}>
          <Block i={1} className="detail wide" callout={r.anchor} label={r.company}>
            <div className="wide-a">
              <Head t={r.now ? 'NOW' : r.when.slice(-4)} label={ANCHOR_LABEL[r.anchor]} />
              <Rise i={0} as="h3">{r.company}</Rise>
              <p className="kind mono">{r.role} · {r.where} · {r.when}</p>
              <div className="metric">
                <b>{r.metric ? <Count to={r.metric.v} sign={r.metric.sign} unit={r.metric.unit} /> : r.headline?.v}</b>
                <span className="mono">{r.metric?.k ?? r.headline?.k}</span>
              </div>
            </div>
            <div className="wide-b">
              <ul className="pts">{r.points.map((x) => <li key={x}>{x}</li>)}</ul>
              {r.links && (
                <div className="links mono">
                  {r.links.map((l) => <a key={l.href} className="go" href={l.href} target="_blank" rel="noreferrer">{l.label} <span aria-hidden="true">↗</span></a>)}
                </div>
              )}
            </div>
          </Block>
        </motion.div>
      </AnimatePresence>
    </Corner>
  )
}

// ---------- T5 · pit wall ----------
// the day's AI & tech wire, the same feed as the screens behind, readable and linked to each source
function useWire() {
  const [items, setItems] = useState<Story[]>(wire.items)
  const [updated, setUpdated] = useState(wire.updated)
  useEffect(() => {
    let alive = true
    loadWire().then(() => { if (alive) { setItems(wire.items); setUpdated(wire.updated) } })
    return () => { alive = false }
  }, [])
  return { items, updated }
}

function PitWallWire() {
  const ref = useFit()
  const { items, updated } = useWire()
  const when = updated
    ? new Date(updated).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }).toUpperCase() + ' IST'
    : ''
  const sources = [...new Set(items.map((x) => x.source))]
  return (
    <Corner sref={ref} className="panel panel-left" label="Pit wall: today's AI and tech news" kind="emerge" from={wirePoint}>
      <Block i={0} className="span2">
        <Head t="T5" label="Pit wall · the AI wire" count={when ? 'Updated ' + when : undefined} />
        <Rise i={0}>What's moving</Rise>
        <Rise i={1}>in AI today.</Rise>
        <p className="body">Headlines from established publications and the AI labs' own newsrooms, refreshed every morning. Open any to read it at the source.</p>
      </Block>
      <Block i={1} className="span2 wire-card">
        {items.length ? (
          <ol className="wire">
            {items.slice(0, 7).map((x) => (
              <li key={x.url}>
                <a href={x.url} target="_blank" rel="noreferrer">
                  <span className="src mono">{x.source}<i>{ago(x.time)}</i></span>
                  <span className="ttl">{x.title}</span>
                  <span className="arw" aria-hidden="true">↗</span>
                </a>
              </li>
            ))}
          </ol>
        ) : <p className="body">The wire is offline. The screens show the last headlines.</p>}
      </Block>
      {sources.length > 0 && (
        <Block i={2} className="span2 strip">
          <span className="mono">Sources</span>
          <span className="srcs">{sources.join(' · ')}</span>
        </Block>
      )}
    </Corner>
  )
}

// ---------- T6 · contact ----------
// team radio: a centred caption tunes in under the car, the waveform still talking
function Contact() {
  return (
    <Corner className="panel panel-center" label="Contact" kind="radio">
      <Block i={0} className="span2 radio-card">
        <div className="radio-head mono">
          <span><b>T6</b> Team radio · box box</span>
          <span className="wave" aria-hidden="true">{Array.from({ length: 28 }, (_, k) => <i key={k} style={{ animationDelay: `${(k * 73) % 900}ms` }} />)}</span>
        </div>
        <Rise i={0}>Let&apos;s build something fast.</Rise>
        <a className="mail" href={'mailto:' + LINKS.email}>{LINKS.email}</a>
      </Block>
      <Block i={1} className="link-card">
        <a href={LINKS.github} target="_blank" rel="noreferrer">
          <span className="mono">GitHub</span><b>Ron2509</b><i aria-hidden="true">↗</i>
        </a>
      </Block>
      <Block i={2} className="link-card">
        <a href={LINKS.linkedin} target="_blank" rel="noreferrer">
          <span className="mono">LinkedIn</span><b>raunak-saoji</b><i aria-hidden="true">↗</i>
        </a>
      </Block>
      <Block i={3} className="span2 strip">
        <span className="mono">Car model</span>
        <span className="credit">Peter Kiss (@peterkissdesign), CC BY-NC-SA</span>
      </Block>
    </Corner>
  )
}

/** On the Pit wall: a hint to click a screen, and the way back out once one is zoomed. */
function PitZoomChip() {
  const zoomed = useStore((st) => st.pitZoomed)
  return (
    <motion.div className="pit-chip mono" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { delay: 2.4 } }} exit={{ opacity: 0 }}>
      {zoomed ? (
        <button onClick={() => setPitZoom(null)}><span aria-hidden="true">←</span> Back to the wall <kbd>Esc</kbd></button>
      ) : (
        <span>Click any screen to zoom in · drag to turn the stand</span>
      )}
    </motion.div>
  )
}

/** Where the pit wall's news screen is on screen, for the wire that comes out of it. */
const wirePoint = () => {
  const m = [...wireMeshes][0]
  const cam = view.camera
  if (!m || !cam) return null
  const v = m.getWorldPosition(new THREE.Vector3()).project(cam)
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }
}

export function Panels({ onStep }: { onStep: (k: number) => void }) {
  const chapter = useStore((s) => s.chapter)
  const hold = useStore((s) => s.hold)
  const step = useStore((s) => s.step)
  const loaded = useStore((s) => s.loaded)
  const finished = useStore((s) => s.finished)
  const show = loaded && hold && !finished
  return (
    <div className="panels">
      <AnimatePresence mode="wait">
        {show && chapter === 0 && <Hero key="hero" />}
        {show && chapter === 1 && <Profile key="profile" step={step} />}
        {show && chapter === 2 && <Projects key="projects" step={step} onStep={onStep} />}
        {show && chapter === 3 && <Experience key="experience" step={step} onStep={onStep} />}
        {show && chapter === 4 && <PitWallWire key="pitwall" />}
        {show && chapter === 5 && <Contact key="contact" />}
      </AnimatePresence>
      {/* its own presence: the panels above swap one at a time ("wait"), and the chip rides alongside the wire */}
      <AnimatePresence>{show && chapter === 4 && <PitZoomChip key="pitzoom" />}</AnimatePresence>
    </div>
  )
}
