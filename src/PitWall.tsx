import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { drive } from './fx'
import { engine } from './engine'
import { scroll, store } from './store'
import { PROJECTS } from './content'
import { TRACK } from './CircuitNav'

// A pit-wall monitor stand at the edge of the studio: an aluminium rack of six 27" screens over a desk, the
// screens live. They show the day's AI and tech wire (public/news.json, refreshed every morning; click the wire
// screen to open the story), the car's telemetry, live timing, agent logs, the track map and the session.
// Everything is drawn in a dark broadcast style and lit only by itself, so it sits in the room like real kit.

export type Story = { title: string; url: string; source: string; time: string | null; kind?: 'press' | 'lab' }
export const wire = { items: [] as Story[], updated: '', featured: 0 }
let wireLoad: Promise<void> | null = null
export function loadWire() {
  wireLoad ??= fetch(`${import.meta.env.BASE_URL}news.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((j: { items: Story[]; updated: string }) => { wire.items = j.items ?? []; wire.updated = j.updated ?? '' })
    .catch(() => {})
  return wireLoad
}

const W = 768
const H = 432
const MONO = "'JetBrains Mono', ui-monospace, monospace"
const SANS = "'Archivo', 'Helvetica Neue', Arial, sans-serif"
const INK = '#e9e7e2'
const DIM = '#7d7b76'
const FAINT = '#3a3a3d'
type G = CanvasRenderingContext2D & { letterSpacing?: string }

export const ago = (iso: string | null) => {
  if (!iso) return ''
  const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000))
  return m < 60 ? `${m}m ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`
}
const ist = (d = new Date(), withSec = false) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: withSec ? '2-digit' : undefined, timeZone: 'Asia/Kolkata' }).format(d)

function frame(g: G, title: string, right: string, accent: string) {
  g.fillStyle = '#060708'
  g.fillRect(0, 0, W, H)
  // faint panel grid, the way broadcast graphics sit on a dark field
  g.strokeStyle = '#0d0f12'
  g.lineWidth = 1
  for (let x = 0; x < W; x += 32) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke() }
  for (let y = 0; y < H; y += 32) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke() }
  g.fillStyle = '#0b0c0f'
  g.fillRect(0, 0, W, 44)
  g.fillStyle = accent
  g.fillRect(0, 43, 120, 2)
  g.font = `600 15px ${MONO}`
  g.letterSpacing = '2.5px'
  g.textBaseline = 'middle'
  g.textAlign = 'left'
  g.fillStyle = INK
  g.fillText(title, 18, 23)
  g.textAlign = 'right'
  g.fillStyle = DIM
  g.fillText(right, W - 18, 23)
  g.letterSpacing = '0px'
  g.textAlign = 'left'
}

function wrap(g: G, text: string, x: number, y: number, maxW: number, lh: number, maxLines: number) {
  const words = text.split(' ')
  let line = ''
  let n = 0
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i]
    if (g.measureText(test).width > maxW && line) {
      if (n === maxLines - 1) { g.fillText(line.replace(/[,.;:]?$/, '…'), x, y + n * lh); return n + 1 }
      g.fillText(line, x, y + n * lh); n++; line = words[i]
    } else line = test
  }
  if (line) { g.fillText(line, x, y + n * lh); n++ }
  return n
}

// ---------- the six screens ----------
function drawWire(g: G, t: number, accent: string) {
  const items = wire.items
  const upd = wire.updated ? new Date(wire.updated) : null
  frame(g, 'WIRE · AI & TECH', upd ? `${upd.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' }).toUpperCase()} · ${ist(upd)} IST` : 'CONNECTING', accent)
  if (!items.length) {
    g.font = `500 18px ${MONO}`; g.fillStyle = DIM; g.fillText('Wire offline. Last headlines will show here.', 18, 120)
    return
  }
  const f = Math.floor(t / 7) % items.length
  wire.featured = f
  const s = items[f]
  const fade = Math.min(1, (t % 7) * 2.2)
  g.globalAlpha = fade
  g.font = `600 13px ${MONO}`; g.letterSpacing = '2px'
  g.fillStyle = accent; g.fillText(s.source.toUpperCase(), 18, 74)
  g.fillStyle = DIM; g.fillText(ago(s.time).toUpperCase(), 18 + g.measureText(s.source.toUpperCase()).width + 16, 74)
  g.letterSpacing = '0px'
  g.font = `600 31px ${SANS}`
  g.fillStyle = INK
  g.textBaseline = 'alphabetic'
  const lines = wrap(g, s.title, 18, 118, W - 36, 38, 3)
  g.globalAlpha = 1
  // what's next on the wire
  let y = 118 + lines * 38 + 26
  g.fillStyle = FAINT; g.fillRect(18, y - 20, W - 36, 1)
  g.font = `500 15px ${SANS}`
  for (let k = 1; k <= 4 && y < H - 30; k++) {
    const n = items[(f + k) % items.length]
    g.fillStyle = DIM; g.font = `500 11px ${MONO}`; g.fillText(n.source.toUpperCase().slice(0, 12), 18, y + 2)
    g.fillStyle = '#b9b7b1'; g.font = `500 16px ${SANS}`
    let title = n.title
    while (g.measureText(title).width > W - 170 && title.length > 8) title = title.slice(0, -2)
    g.fillText(title === n.title ? title : title.trimEnd() + '…', 140, y + 2)
    y += 30
  }
  g.font = `600 11px ${MONO}`; g.letterSpacing = '2px'; g.fillStyle = DIM; g.textAlign = 'right'
  g.fillText('CLICK TO READ ↗', W - 18, H - 14)
  g.textAlign = 'left'; g.letterSpacing = '0px'; g.textBaseline = 'middle'
  // progress bar for the featured story
  g.fillStyle = FAINT; g.fillRect(0, H - 3, W, 3)
  g.fillStyle = accent; g.fillRect(0, H - 3, W * ((t % 7) / 7), 3)
}

const N = 220
const tele = { speed: new Float32Array(N), thr: new Float32Array(N), brk: new Float32Array(N), rpm: new Float32Array(N), head: 0, acc: 0 }
function sampleTelemetry(dt: number, t: number) {
  tele.acc += dt
  while (tele.acc > 1 / 30) {
    tele.acc -= 1 / 30
    // a simulated lap underneath, the real car's drive and engine on top
    const lap = Math.sin(t * 0.9) * 0.5 + Math.sin(t * 2.3 + 1) * 0.25
    const thr = THREE.MathUtils.clamp(0.55 + lap + drive.speed * 0.5, 0, 1)
    const brk = THREE.MathUtils.clamp(-lap * 1.6 - 0.35 + Math.max(0, -drive.accel), 0, 1)
    const i = tele.head = (tele.head + 1) % N
    tele.thr[i] = thr
    tele.brk[i] = brk
    tele.speed[i] = THREE.MathUtils.lerp(tele.speed[(i + N - 1) % N] || 180, 95 + thr * 230 - brk * 120, 0.08)
    tele.rpm[i] = engine.running ? Math.min(1, engine.rpm / 15000) : 0.35 + thr * 0.55
  }
}
function trace(g: G, arr: Float32Array, y0: number, h: number, max: number, color: string, label: string, value: string) {
  g.fillStyle = FAINT; g.fillRect(18, y0 + h, W - 36, 1)
  g.font = `600 11px ${MONO}`; g.letterSpacing = '2px'; g.fillStyle = DIM; g.fillText(label, 18, y0 + 6)
  g.textAlign = 'right'; g.fillStyle = INK; g.font = `500 15px ${MONO}`; g.fillText(value, W - 18, y0 + 6); g.textAlign = 'left'; g.letterSpacing = '0px'
  g.beginPath()
  for (let k = 0; k < N; k++) {
    const v = arr[(tele.head + 1 + k) % N] / max
    const x = 18 + (k / (N - 1)) * (W - 36)
    const y = y0 + h - v * (h - 16)
    if (k) g.lineTo(x, y); else g.moveTo(x, y)
  }
  g.strokeStyle = color; g.lineWidth = 2; g.stroke()
}
function drawTelemetry(g: G, accent: string) {
  frame(g, 'CAR 07 · TELEMETRY', engine.running ? 'ENGINE ON' : 'LIVE', accent)
  const i = tele.head
  trace(g, tele.speed, 56, 82, 330, INK, 'SPEED KM/H', String(Math.round(tele.speed[i])))
  trace(g, tele.thr, 148, 62, 1, accent, 'THROTTLE', Math.round(tele.thr[i] * 100) + '%')
  trace(g, tele.brk, 220, 62, 1, '#8a8882', 'BRAKE', Math.round(tele.brk[i] * 100) + '%')
  trace(g, tele.rpm, 292, 82, 1, '#c9c6bf', 'RPM', String(Math.round(tele.rpm[i] * 12000)).padStart(5, '0'))
  const gear = Math.min(8, Math.max(1, Math.round(tele.speed[i] / 42)))
  g.font = `600 13px ${MONO}`; g.fillStyle = DIM; g.fillText('GEAR', 18, 400); g.fillStyle = INK; g.font = `600 22px ${MONO}`; g.fillText(String(gear), 74, 400)
  g.font = `600 13px ${MONO}`; g.fillStyle = DIM; g.fillText('DRS', 120, 400); g.fillStyle = tele.thr[i] > 0.9 ? accent : FAINT; g.fillRect(162, 392, 34, 16)
}

const laps = PROJECTS.map((p, k) => ({ name: p.short.toUpperCase(), base: 84.2 + k * 0.37 }))
function drawTiming(g: G, t: number, accent: string) {
  frame(g, 'PORTFOLIO GP · LIVE TIMING', 'LAP ' + String(Math.round(scroll.progress * 100)).padStart(3, '0'), accent)
  g.font = `600 11px ${MONO}`; g.letterSpacing = '2px'; g.fillStyle = DIM
  ;['POS', 'PROJECT', 'LAST LAP', 'GAP', 'S1', 'S2', 'S3'].forEach((h, k) => g.fillText(h, [18, 76, 330, 470, 572, 638, 704][k], 66))
  g.letterSpacing = '0px'
  laps.forEach((l, k) => {
    const y = 108 + k * 64
    const lap = l.base + Math.sin(t * 0.3 + k * 1.7) * 0.18
    g.fillStyle = k === 0 ? '#101114' : '#0a0b0d'; g.fillRect(12, y - 24, W - 24, 52)
    if (k === 0) { g.fillStyle = accent; g.fillRect(12, y - 24, 3, 52) }
    g.font = `600 20px ${MONO}`; g.fillStyle = INK; g.fillText(String(k + 1), 26, y)
    g.font = `600 19px ${SANS}`; g.fillText(l.name, 76, y)
    g.font = `500 18px ${MONO}`; g.fillStyle = INK
    const m = Math.floor(lap / 60), s = (lap % 60).toFixed(3).padStart(6, '0')
    g.fillText(`${m}:${s}`, 330, y)
    g.fillStyle = DIM; g.fillText(k === 0 ? 'LEADER' : '+' + (lap - laps[0].base).toFixed(3), 470, y)
    for (let sct = 0; sct < 3; sct++) {
      const best = (Math.floor(t * 0.5 + k + sct * 2) % 5) === 0
      g.fillStyle = best ? accent : k === 0 ? '#8a8882' : '#4a4a4d'
      g.fillRect([572, 638, 704][sct], y - 7, 46, 14)
    }
  })
}

const LOGS = [
  'agent.step  tool=web.fetch       ok   312ms',
  'agent.step  tool=code.run        ok  1.24s',
  'eval.judge  relevance=0.91  grounding=0.88',
  'harness     checkpoint saved     run-7f3a',
  'router      model=eka-preview    p50 182ms',
  'agent.step  tool=fs.read         ok    41ms',
  'guardrail   policy=pii           pass',
  'harness     long-run resumed     t+04:12:09',
  'serve       tokens/s=1840        gpu util 87%',
  'agent.plan  subtasks=6           depth=2',
  'eval.judge  factual=0.93         n=128',
  'ci          deploy main          ✓ green',
]
function drawLogs(g: G, t: number, accent: string) {
  frame(g, 'LOOP · AGENT LOGS', 'DEV PREVIEW', accent)
  g.font = `500 15px ${MONO}`
  const step = Math.floor(t * 1.6)
  const rows = 11
  for (let r = 0; r < rows; r++) {
    const k = step - rows + 1 + r
    const line = LOGS[((k % LOGS.length) + LOGS.length) % LOGS.length]
    const d = new Date(Date.now() - (rows - 1 - r) * 640)
    const y = 72 + r * 32
    g.fillStyle = FAINT; g.fillText(ist(d, true), 18, y)
    g.fillStyle = r === rows - 1 ? INK : '#9c9a94'
    g.fillText(line, 120, y)
    if (line.includes('✓') || line.includes('pass')) { g.fillStyle = accent; g.fillRect(108, y - 6, 4, 12) }
  }
  if (Math.floor(t * 2) % 2) { g.fillStyle = INK; g.fillRect(120, 72 + rows * 32 - 8, 10, 18) }
}

let trackPath: Path2D | null = null
function drawMap(g: G, accent: string) {
  frame(g, 'CIRCUIT · TRACK MAP', 'SECTOR ' + (Math.min(3, Math.floor(scroll.progress * 3)) + 1), accent)
  trackPath ??= new Path2D(TRACK)
  g.save()
  g.translate(W / 2 - 120 * 1.6 / 2, 56)
  g.scale(1.6, 1.6)
  g.lineJoin = 'round'
  g.strokeStyle = '#1d1e22'; g.lineWidth = 9; g.stroke(trackPath)
  g.strokeStyle = '#5a5a5e'; g.lineWidth = 1.4; g.stroke(trackPath)
  g.restore()
  // the car's dot rides the lap, same as the circuit rail on the page
  const svg = document.querySelector<SVGPathElement>('.circuit .track')
  if (svg) {
    const len = svg.getTotalLength()
    const p = svg.getPointAtLength(scroll.progress * len)
    const x = W / 2 - 96 + p.x * 1.6, y = 56 + p.y * 1.6
    g.fillStyle = accent; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.globalAlpha = 0.35; g.fill(); g.globalAlpha = 1
    g.fillStyle = INK; g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill()
  }
}

// The session screen's lower rows: the pit wall's running jokes, F1 and engineering, two at a time
const BANTER: [string, string][] = [
  ['PENALTY', '+5S · MISSING SEMICOLON'],
  ['DRS', 'OPEN · TOKENS FLOWING'],
  ['WEATHER', '10% CHANCE OF BUGS*'],
  ['CONTEXT', '200K · TYRES HOLDING UP'],
  ['LATENCY', '1.5S · WAS 3.5S'],
  ['TEAM RADIO', 'COPY. PUSHING TO PROD'],
]
const FLAP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789·%+'
/** the value, mid-flip: letters still settling show random characters, left to right, like a split-flap board */
const flap = (text: string, p: number, seed: number) =>
  text.split('').map((ch, i) => (ch === ' ' || p >= (i + 1) / text.length ? ch : FLAP[(i * 7 + seed) % FLAP.length])).join('')

function drawSession(g: G, t: number, accent: string) {
  const s = store.get()
  frame(g, 'SESSION', 'BANGALORE · IST', accent)
  g.font = `300 104px ${MONO}`; g.fillStyle = INK; g.textBaseline = 'alphabetic'
  g.fillText(ist(new Date(), true), 18, 168)
  g.textBaseline = 'middle'
  const period = 4
  const pairs = BANTER.length / 2
  const n = Math.floor(t / period) % pairs
  const p = Math.min(1, (t % period) / 0.6)
  const seed = Math.floor(t * 18)
  const rows: [string, string, boolean][] = [
    ['DRIVER', 'RAUNAK', false],
    ['LIVERY', s.active.name.toUpperCase(), false],
    [BANTER[n * 2][0], flap(BANTER[n * 2][1], p, seed), true],
    [BANTER[n * 2 + 1][0], flap(BANTER[n * 2 + 1][1], p, seed + 5), true],
  ]
  rows.forEach(([k, v, joke], i) => {
    const y = 222 + i * 48
    g.fillStyle = FAINT; g.fillRect(18, y - 24, W - 36, 1)
    g.font = `600 13px ${MONO}`; g.letterSpacing = '2px'; g.fillStyle = DIM; g.fillText(k, 18, y)
    g.letterSpacing = '0px'; g.font = `600 20px ${MONO}`; g.fillStyle = joke && i === 2 ? accent : INK; g.fillText(v, 220, y)
  })
}

// ---------- the stand ----------
const SW = 0.62 // 27" panel, 16:9
const SH = 0.35
type Screen = { canvas: HTMLCanvasElement; g: G; tex: THREE.CanvasTexture; draw: (g: G, t: number, accent: string) => void }

// one set of live screens, shared by every stand in the studio (each stand shows them in its own order)
let shared: Screen[] | null = null
function useScreens() {
  const gl = useThree((s) => s.gl)
  return useMemo(() => {
    if (shared) return shared
    const make = (draw: Screen['draw']): Screen => {
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      // redrawn all the time: no mipmap chain to rebuild on every upload
      tex.generateMipmaps = false
      tex.minFilter = THREE.LinearFilter
      // uploaded as the canvas holds it (no flip, alpha as is), which Chrome copies GPU to GPU; flipping on upload
      // takes a slow path through the CPU. The picture is turned the right way up by the texture transform instead.
      tex.flipY = false
      tex.premultiplyAlpha = true
      tex.repeat.set(1, -1)
      tex.offset.set(0, 1)
      tex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
      return { canvas, g: canvas.getContext('2d') as G, tex, draw }
    }
    const list = [
      make((g, t, a) => drawTiming(g, t, a)),
      make((g, t, a) => drawWire(g, t, a)),
      make((g, t, a) => drawSession(g, t, a)),
      make((g, _t, a) => drawMap(g, a)),
      make((g, _t, a) => drawTelemetry(g, a)),
      make((g, t, a) => drawLogs(g, t, a)),
    ]
    shared = list
    return list
  }, [gl])
}

const metal = new THREE.MeshStandardMaterial({ color: '#2b2c30', metalness: 0.85, roughness: 0.38 })
const housing = new THREE.MeshStandardMaterial({ color: '#0c0c0e', metalness: 0.2, roughness: 0.55 })
const deskTop = new THREE.MeshStandardMaterial({ color: '#141416', metalness: 0.1, roughness: 0.62 })
const keyMat = new THREE.MeshStandardMaterial({ color: '#0e0e10', metalness: 0.3, roughness: 0.5 })
const spill = (() => {
  const c = document.createElement('canvas')
  c.width = 256; c.height = 128
  const g = c.getContext('2d')!
  const gr = g.createRadialGradient(128, 0, 0, 128, 0, 180)
  gr.addColorStop(0, 'rgba(200,210,225,0.22)')
  gr.addColorStop(1, 'rgba(200,210,225,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, 256, 128)
  const t = new THREE.CanvasTexture(c)
  return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
})()

function Monitor({ screen, position, yaw, onRef }: { screen: Screen; position: [number, number, number]; yaw: number; onRef?: (m: THREE.Mesh | null) => void }) {
  // the panel: emissive picture under glossy glass that picks up the studio lights
  const mat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#000000', emissive: '#ffffff', emissiveMap: screen.tex, emissiveIntensity: 1.25, roughness: 0.14, metalness: 0,
  }), [screen])
  return (
    <group position={position} rotation-y={yaw}>
      <RoundedBox args={[SW + 0.018, SH + 0.018, 0.032]} radius={0.006} smoothness={3} material={housing} position={[0, 0, -0.016]} />
      <mesh ref={onRef} material={mat} position={[0, 0, 0.0005]}>
        <planeGeometry args={[SW, SH]} />
      </mesh>
      {/* VESA arm back to the upright */}
      <mesh material={metal} position={[0, 0, -0.06]}>
        <boxGeometry args={[0.08, 0.08, 0.05]} />
      </mesh>
    </group>
  )
}

/**
 * On the Pit wall corner the stand turns like the car does: drag sideways (Car.tsx routes the drag here) or
 * just move the cursor, and it swivels to bring the far screens round.
 */
export const pitSwivel = { target: 0, value: 0 }
export const wireMeshes = new Set<THREE.Mesh>()
/** the swivelling stand's six screens, and the one zoomed in on (if any) */
const zoomables = new Set<THREE.Mesh>()
export const pitZoom = { mesh: null as THREE.Mesh | null }
export function setPitZoom(m: THREE.Mesh | null) {
  pitZoom.mesh = m
  if (store.get().pitZoomed !== !!m) store.set({ pitZoomed: !!m })
}
if (import.meta.env.DEV) (window as unknown as { __wire: typeof wireMeshes }).__wire = wireMeshes
let drawnAt = -1
let clickBound = false

export function PitWall({ position, yaw, order = [0, 1, 2, 3, 4, 5], children, swivel }: {
  position: [number, number, number]; yaw: number; order?: number[]; children?: React.ReactNode; swivel?: boolean
}) {
  const stand = useRef<THREE.Group>(null)
  const screens = useScreens()
  const { camera, size } = useThree()
  const acc = useRef(0)
  const next = useRef(0)
  const accent = useRef('#a3242e')

  useEffect(() => { loadWire() }, [])

  // click the wire screen to read the featured story at its source (one listener for every stand)
  useEffect(() => {
    if (clickBound) return
    clickBound = true
    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let down: { x: number; y: number } | null = null
    const pd = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY } }
    const pu = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return
      if ((e.target as HTMLElement).closest('a, button, .card, .top, .circuit')) return
      ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      const open = () => { if (wire.items.length) window.open(wire.items[wire.featured].url, '_blank', 'noopener') }
      // on the Pit wall corner a click zooms into a screen; a click on the zoomed news screen opens the story;
      // a click anywhere else steps back out
      const s = store.get()
      if (s.chapter === 4 && s.hold && zoomables.size) {
        const hit = ray.intersectObjects([...zoomables], false)[0]
        const m = hit?.object as THREE.Mesh | undefined
        if (m) { if (pitZoom.mesh === m && wireMeshes.has(m)) open(); else setPitZoom(m); return }
        if (pitZoom.mesh) { setPitZoom(null); return }
      }
      if (wireMeshes.size && ray.intersectObjects([...wireMeshes], false).length) open()
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && pitZoom.mesh) setPitZoom(null) }
    addEventListener('pointerdown', pd)
    addEventListener('pointerup', pu)
    addEventListener('keydown', esc)
    return () => { clickBound = false; removeEventListener('pointerdown', pd); removeEventListener('pointerup', pu); removeEventListener('keydown', esc) }
  }, [camera, size])

  useFrame((state, dt) => {
    if (swivel && stand.current) {
      const s = store.get()
      const here = s.chapter === 4 && s.hold
      if (!here) pitSwivel.target = THREE.MathUtils.damp(pitSwivel.target, 0, 2, dt)
      if (!here && pitZoom.mesh) setPitZoom(null)
      // the cursor leans it a little; a drag turns it properly; held still while a screen is zoomed
      const lean = here && !pitZoom.mesh && !document.body.classList.contains('grabbing') ? state.pointer.x * 0.22 : 0
      pitSwivel.value = THREE.MathUtils.damp(pitSwivel.value, pitSwivel.target + lean, 5, dt)
      stand.current.rotation.y = yaw + pitSwivel.value
    }
  })
  useFrame((state, dt) => {
    // the shared screens are drawn once per frame, however many stands show them
    if (drawnAt === state.clock.elapsedTime) return
    drawnAt = state.clock.elapsedTime
    const t = state.clock.elapsedTime
    sampleTelemetry(dt, t)
    // each screen refreshes at 8 fps at the pit wall, like a real feed, and once a second from across the studio
    // where it is out of focus; one screen at a time, so the work never lands in a single frame. While the car is
    // driving the screens hold their last picture: they are streaking past, and the frames go to the drive
    const st = store.get()
    if (drive.speed > 0.02) return
    const fps = st.chapter === 4 ? 8 : 1
    acc.current += dt
    if (acc.current < 1 / (fps * screens.length)) return
    acc.current = 0
    accent.current = st.active.accent
    const sc = screens[next.current++ % screens.length]
    sc.draw(sc.g, t, accent.current)
    sc.tex.needsUpdate = true
  })

  // two rows of three, the outer columns toed in toward the engineer's seat
  const cols = [-1, 0, 1]
  const toe = 0.2
  const place = (c: number, row: number): [[number, number, number], number] => {
    const x = c * (SW + 0.03) * Math.cos(toe * Math.abs(c))
    const z = Math.abs(c) * (SW + 0.03) * Math.sin(toe) * 1.0
    return [[x, row === 0 ? 1.06 : 1.45, 0.02 + z], -c * toe]
  }
  const postX = 1.5 * (SW + 0.03) + 0.04
  return (
    <group ref={stand} position={position} rotation-y={yaw}>
      {/* desk */}
      <mesh material={deskTop} position={[0, 0.74, 0.32]} castShadow receiveShadow>
        <boxGeometry args={[2.2, 0.035, 0.66]} />
      </mesh>
      {[-1.02, 1.02].map((x) => (
        <mesh key={x} material={metal} position={[x, 0.37, 0.32]} castShadow>
          <boxGeometry args={[0.05, 0.74, 0.6]} />
        </mesh>
      ))}
      {/* keyboard and its faint backlight */}
      <mesh material={keyMat} position={[-0.15, 0.766, 0.42]} rotation-x={-0.06}>
        <boxGeometry args={[0.44, 0.018, 0.14]} />
      </mesh>
      <mesh position={[0.25, 0.761, 0.44]} material={keyMat}>
        <boxGeometry args={[0.07, 0.012, 0.11]} />
      </mesh>
      {/* uprights and rails */}
      {[-postX, postX].map((x) => (
        <group key={x}>
          <mesh material={metal} position={[x, 0.98, 0]} castShadow>
            <boxGeometry args={[0.045, 1.96, 0.045]} />
          </mesh>
          <mesh material={metal} position={[x, 0.012, 0.12]}>
            <boxGeometry args={[0.09, 0.024, 0.5]} />
          </mesh>
        </group>
      ))}
      {[1.06, 1.45, 1.86].map((y) => (
        <mesh key={y} material={metal} position={[0, y, -0.09]}>
          <boxGeometry args={[postX * 2, 0.03, 0.03]} />
        </mesh>
      ))}
      {/* the screens */}
      {cols.flatMap((c) => [0, 1].map((row) => {
        const slot = row * 3 + (c + 1)
        const idx = order[slot]
        const [p, yaw2] = place(c, row)
        return <Monitor key={slot} screen={screens[idx]} position={p} yaw={yaw2}
          onRef={(m) => { if (!m) return; if (idx === 1) wireMeshes.add(m); if (swivel) zoomables.add(m) }} />
      }))}
      {/* the spill the screens throw onto the desk: a soft glow on the surface, not a lamp (a lamp would flare in the glass) */}
      <mesh position={[0, 0.759, 0.3]} rotation-x={-Math.PI / 2} material={spill}>
        <planeGeometry args={[2.1, 0.62]} />
      </mesh>
      {children}
    </group>
  )
}
