import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { carRig } from '../Car'
import { view } from '../Scene'
import { PROJECTS } from '../content'
import { store, useStore } from '../store'
import { dims } from './CadLook'

// The pulled-apart car, annotated. The project on show tells how it works one step per assembly (content.ts,
// brief); as each assembly comes out, its numbered step appears in a card clear of the car, on a leader to its
// part. Dimension figures sit on the floor's dimension lines.

const MAX = 8
const CARD_W = 214

export function CadLabels() {
  const svg = useRef<SVGSVGElement>(null)
  const leads = useRef<(SVGPolylineElement | null)[]>([])
  const dots = useRef<(SVGCircleElement | null)[]>([])
  const cards = useRef<(HTMLDivElement | null)[]>([])
  const dimEls = useRef<SVGTextElement[]>([])
  // each card's width and measured height: measuring forces a layout of the page, so it happens only when a
  // card's width or its text changes, not every frame
  const sized = useRef<{ w: number; h: number; key: string }[]>([])
  const chapter = useStore((s) => s.chapter)
  const step = useStore((s) => s.step)
  const project = chapter === 2 ? PROJECTS[Math.min(step, PROJECTS.length - 1)] : null

  useEffect(() => {
    const v = new THREE.Vector3()
    const c = new THREE.Vector3()
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const cam = view.camera
      const root = carRig.root
      const k = carRig.explode
      const el = svg.current!
      const hideCards = () => cards.current.forEach((d) => { if (d) d.style.opacity = '0' })
      if (!cam || !root || k < 0.02) { el.style.opacity = '0'; hideCards(); return }
      el.style.opacity = '1'
      const W = innerWidth, H = innerHeight
      const toScreen = (p: THREE.Vector3) => {
        v.copy(p).applyMatrix4(root.matrixWorld).project(cam)
        return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, behind: v.z > 1 }
      }
      // cards never sit under the content on the left
      const panel = document.querySelector('.panels .panel-left')?.getBoundingClientRect()
      const minX = panel && panel.width > 0 && panel.right < W * 0.7 ? panel.right + 14 : 16
      const st = store.get()
      const pr = st.chapter === 2 ? PROJECTS[Math.min(st.step, PROJECTS.length - 1)] : null
      const steps = pr ? pr.brief : []
      // where each step's part is now, and how far its card is in
      const live: { i: number; x: number; y: number; show: number }[] = []
      for (let i = 0; i < MAX; i++) {
        const st2 = steps[i]
        const a = st2 && carRig.assemblies.find((x) => x.id === st2.on)
        // a step shows once its part has come out
        const show = a ? Math.max(0, Math.min(1, (a.e - 0.8) / 0.2)) : 0
        if (!a || show <= 0) {
          const card = cards.current[i]
          if (card) card.style.opacity = '0'
          leads.current[i]?.setAttribute('points', '')
          const dot = dots.current[i]
          if (dot) dot.style.opacity = '0'
          continue
        }
        const p = toScreen(c.copy(a.top).add(a.off).addScaledVector(a.off, a.e - 1))
        if (p.behind) continue
        live.push({ i, x: p.x, y: p.y, show })
      }
      // the cards stand clear of the car: odd steps in a row above it, even steps in a row below, each row in the
      // order of its parts across the screen, so no leader crosses another
      const rows = [live.filter((l) => l.i % 2 === 0), live.filter((l) => l.i % 2 === 1)]
      rows.forEach((full, r) => {
        full.sort((u, w) => u.x - w.x)
        const y0 = r === 0 ? Math.max(172, Math.min(...full.map((l) => l.y)) - 150) : Math.min(H - 118, Math.max(...full.map((l) => l.y)) + 56)
        // bottom right is the circuit map's, when the row comes down that far
        const right = W - (r === 1 && y0 + 62 > H - 232 ? 190 : 16)
        const avail = right - minX
        // cards shrink to fit the room beside the content; too narrow to read and the row splits in two lines
        const fit = (n: number) => Math.min(CARD_W, (avail - 10 * (n - 1)) / n)
        const lines = fit(full.length) >= 158 || full.length < 2 ? [full] : [full.filter((_, j) => j % 2 === 0), full.filter((_, j) => j % 2 === 1)]
        // a second line stacks on the real height of the first, so a three-line card never runs into the next
        let edge = y0
        lines.forEach((row, ln) => {
          const w = Math.max(140, fit(row.length))
          const heightOf = (i: number) => {
            const card = cards.current[i]
            if (!card) return 50
            const key = pr ? pr.name : ''
            const c = (sized.current[i] ??= { w: -1, h: 50, key: '' })
            if (c.w !== w || c.key !== key) { card.style.width = `${w}px`; c.w = w; c.key = key; c.h = card.offsetHeight }
            return c.h
          }
          const h = Math.max(...row.map((l) => heightOf(l.i)))
          const y = ln === 0 ? y0 : r === 0 ? edge - h - 8 : edge + 8
          edge = ln === 0 ? (r === 0 ? y0 : y0 + h) : (r === 0 ? y : y + h)
          let next = minX
          const xs = row.map((l) => { const x = Math.max(next, Math.min(right - w, l.x - w / 2)); next = x + w + 10; return x })
          // pushed past the end: slide the line back, keeping the gaps
          for (let j = xs.length - 1, lim = right - w; j >= 0; j--) { xs[j] = Math.min(xs[j], lim); lim = xs[j] - w - 10 }
          row.forEach((l, j) => {
            const card = cards.current[l.i], lead = leads.current[l.i], dot = dots.current[l.i]
            const cx = xs[j], cy = y
            const ch = heightOf(l.i)
            if (card) { card.style.transform = `translate3d(${cx}px, ${cy}px, 0)`; card.style.opacity = String(l.show) }
            // the leader leaves the card from its edge facing the car, straight down or up, then angles to the part
            const ex = Math.min(cx + w - 14, Math.max(cx + 14, l.x))
            const ey = r === 0 ? cy + ch : cy
            const ky = r === 0 ? ey + 14 : ey - 14
            lead?.setAttribute('points', `${ex},${ey} ${ex},${ky} ${l.x},${l.y}`)
            if (lead) lead.style.opacity = String(l.show)
            if (dot) { dot.setAttribute('cx', String(l.x)); dot.setAttribute('cy', String(l.y)); dot.style.opacity = String(l.show) }
          })
        })
      })
      dims.forEach((d, i) => {
        const t = dimEls.current[i]
        if (!t) return
        const q = toScreen(d.mid)
        t.textContent = d.text
        t.setAttribute('x', String(q.x)); t.setAttribute('y', String(q.y + 14))
        t.style.opacity = q.behind ? '0' : String(Math.max(0, (k - 0.6) / 0.4) * 0.7)
      })
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <>
      <svg className="cad-labels" ref={svg} aria-hidden="true">
        {Array.from({ length: MAX }, (_, i) => (
          <g key={i} className="cad-step">
            <polyline className="lead" ref={(l) => { leads.current[i] = l }} points="" />
            <circle className="dot" r="3" ref={(d) => { dots.current[i] = d }} />
          </g>
        ))}
        {[0, 1].map((i) => <text key={'d' + i} className="cad-dim" ref={(t) => { if (t) dimEls.current[i] = t }} />)}
      </svg>
      {Array.from({ length: MAX }, (_, i) => {
        const s = project?.brief[i]
        return (
          <div key={i} className="cad-card" ref={(d) => { cards.current[i] = d }} style={{ opacity: 0 }} aria-hidden={!s}>
            {s && <><i>{String(i + 1).padStart(2, '0')}</i><b>{s.title}</b><span>{s.line}</span></>}
          </div>
        )
      })}
    </>
  )
}
