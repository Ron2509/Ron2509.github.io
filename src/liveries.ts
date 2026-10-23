import type { Sponsor, SponsorSet } from './sponsors'

// Two-tone liveries: one body colour and black, nothing else. Lettering is black on the colour and turns to
// the body colour where it lands on a black panel. No team marks or real sponsors: every partner mark on the
// bodywork is the portfolio itself (see sponsors.ts), repainted at each corner of the lap.
//
// Each livery is painted as 2D artwork in three views, then projected onto the bodywork:
//   u: 0 = tail, 1 = nose      v (side): 0 = ground, 1 = top of car      v (top): across the car, mirrored left/right

export const NAME = 'SAOJI'
export const FULL_NAME = 'RAUNAK SAOJI'
export const NUMBER = '07'

export type View = {
  g: CanvasRenderingContext2D
  x0: number
  y0: number
  w: number
  h: number
  /** mirrored layout for the car's right flank, so lettering reads correctly from both sides */
  flip: boolean
  /** horizontal squash that keeps lettering undistorted (canvas px per metre differ per axis) */
  k: number
}

export type LiveryDef = {
  id: string
  name: string
  era: string
  /** the body colour; every livery is this one colour plus black, nothing else */
  a: string
  /** UI accent that follows the car */
  accent: string
  /** wheel rim colour */
  rim: string
  metalness: number
  roughness: number
  clearcoat: number
  /** clear coat roughness; matte by default */
  coatRough?: number
  /** metallic flake in the paint, 0 for none */
  flake?: number
  iridescence: number
  side: (v: View) => void
  top: (v: View) => void
}

// ---------- drawing helpers (all coordinates in u/v) ----------
// positions are the same on both flanks; only glyphs are mirrored on the right flank (see text/decal)
const P = (c: View, u: number, v: number): [number, number] => [c.x0 + u * c.w, c.y0 + (1 - v) * c.h]

function fillAll(c: View, color: string | CanvasGradient) {
  c.g.fillStyle = color
  c.g.fillRect(c.x0, c.y0, c.w, c.h)
}

function gradU(c: View, stops: [number, string][]) {
  const [xa] = P(c, 0, 0)
  const [xb] = P(c, 1, 0)
  const gr = c.g.createLinearGradient(xa, 0, xb, 0)
  stops.forEach(([o, col]) => gr.addColorStop(o, col))
  return gr
}

function shape(c: View, pts: [number, number][], fill: string | CanvasGradient, smooth = true) {
  const g = c.g
  g.beginPath()
  const p = pts.map(([u, v]) => P(c, u, v))
  g.moveTo(...p[0])
  if (smooth && p.length > 2) {
    for (let i = 1; i < p.length - 1; i++) {
      const mx = (p[i][0] + p[i + 1][0]) / 2
      const my = (p[i][1] + p[i + 1][1]) / 2
      g.quadraticCurveTo(p[i][0], p[i][1], mx, my)
    }
    g.lineTo(...p[p.length - 1])
  } else p.slice(1).forEach((q) => g.lineTo(...q))
  g.closePath()
  g.fillStyle = fill
  g.fill()
}

type G = CanvasRenderingContext2D & { letterSpacing?: string }
const SANS = "'Archivo', 'Helvetica Neue', Arial, sans-serif"
const MONO = "'JetBrains Mono', ui-monospace, monospace"

type TextOpts = { weight?: number; fill?: string; spacing?: number; stretch?: string }

// ---------- sponsor decals ----------
const BLACK = '#0b0b0c'
/** every letter on the car: Pantone 13-0002 White Sand */
const WHITE = '#e7e3dd'


/** White lettering on the dark paint, black on any light one; inside a boxed mark the paint shows through. */
function inkAt(c: View, _l: LiveryDef, x: number, y: number) {
  // read off the small copy of the paint underneath (see paintAtlas): a read-back of the full atlas costs a GPU
  // round trip per mark, and was nearly all of a repaint's time
  const i = ground ? (Math.min(PROBE_H - 1, Math.max(0, (y / PROBE) | 0)) * PROBE_W + Math.min(PROBE_W - 1, Math.max(0, (x / PROBE) | 0))) * 4 : -1
  const d = ground ? ground.subarray(i, i + 4) : c.g.getImageData(Math.round(x), Math.round(y), 1, 1).data
  const lum = (0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]) / 255
  return { ink: lum > 0.45 ? '#121214' : WHITE, knock: `rgb(${d[0]},${d[1]},${d[2]})` }
}

/** A partner mark drawn like a real sponsor lockup, centred on (u, v), fitted inside maxU of the car's length. */
function decal(c: View, m: Sponsor, u: number, v: number, size: number, maxU: number, l: LiveryDef) {
  if (!m.text) return
  const g = c.g as G
  const [x, y] = P(c, u, v)
  const { ink, knock } = inkAt(c, l, x, y)
  const plate = false
  const px = size * c.h
  const font = (w: number, opts: { mono?: boolean; stretch?: string; italic?: boolean; scale?: number } = {}) =>
    `${opts.italic ? 'italic ' : ''}${opts.mono ? '' : (opts.stretch ?? 'expanded') + ' '}${w} ${Math.round(px * (opts.scale ?? 1))}px ${opts.mono ? MONO : SANS}`
  g.save()
  let width = 0
  let draw: () => void = () => {}
  switch (m.style) {
    case 'bold': {
      g.font = font(800, { italic: true }); g.letterSpacing = `${px * 0.02}px`
      width = g.measureText(m.text).width
      draw = () => { g.fillStyle = ink; g.fillText(m.text, 0, 0) }
      break
    }
    case 'box': {
      g.font = font(700); g.letterSpacing = `${px * 0.08}px`
      width = g.measureText(m.text).width + px * 0.9
      draw = () => {
        g.fillStyle = ink
        g.fillRect(-width / 2, -px * 0.72, width, px * 1.44)
        g.fillStyle = knock
        g.fillText(m.text, px * 0.04, px * 0.04)
      }
      break
    }
    case 'emblem': {
      g.font = font(600, { stretch: 'normal' }); g.letterSpacing = `${px * 0.16}px`
      const e = px * 0.95
      const iw = g.measureText(m.text).width + e * 1.6
      width = iw
      draw = () => {
        g.save()
        g.translate(-iw / 2 + e * 0.5, 0)
        g.rotate(Math.PI / 4)
        g.strokeStyle = ink; g.lineWidth = px * 0.12
        g.strokeRect(-e * 0.35, -e * 0.35, e * 0.7, e * 0.7)
        g.fillStyle = ink
        g.fillRect(-e * 0.14, -e * 0.14, e * 0.28, e * 0.28)
        g.restore()
        g.fillStyle = ink; g.textAlign = 'left'
        g.fillText(m.text, -iw / 2 + e * 1.3, 0)
        g.textAlign = 'center'
      }
      break
    }
    case 'stack': {
      const [a, ...rest] = m.text.split(' ')
      const b = rest.join(' ')
      const top = () => { g.font = font(800); g.letterSpacing = `${px * 0.04}px` }
      const bottom = () => { g.font = font(500, { stretch: 'normal', scale: 0.4 }); g.letterSpacing = `${px * 0.24}px` }
      top(); const wa = g.measureText(a).width
      bottom(); const wb = g.measureText(b).width
      width = Math.max(wa, wb)
      draw = () => {
        top(); g.fillStyle = ink; g.fillText(a, 0, -px * 0.22)
        g.fillRect(-width / 2, px * 0.34, width, px * 0.05)
        bottom(); g.fillText(b, 0, px * 0.66)
      }
      break
    }
    case 'outline': {
      g.font = font(900); g.letterSpacing = `${px * 0.04}px`
      width = g.measureText(m.text).width
      draw = () => { g.lineJoin = 'round'; g.strokeStyle = ink; g.lineWidth = Math.max(2, px * 0.05); g.strokeText(m.text, 0, 0) }
      break
    }
    case 'num': {
      g.font = font(600, { stretch: 'normal' }); g.letterSpacing = `${px * 0.02}px`
      width = g.measureText(m.text).width
      draw = () => { g.fillStyle = ink; g.fillText(m.text, 0, px * 0.04) }
      break
    }
    case 'mono': {
      g.font = font(600, { mono: true, scale: 0.8 }); g.letterSpacing = `${px * 0.2}px`
      width = g.measureText(m.text).width
      draw = () => { g.fillStyle = ink; g.fillText(m.text, 0, 0) }
      break
    }
    case 'script': {
      g.font = font(400, { stretch: 'normal', italic: true }); g.letterSpacing = `${px * 0.01}px`
      width = g.measureText(m.text).width
      draw = () => {
        g.fillStyle = ink; g.fillText(m.text, 0, -px * 0.05)
        g.strokeStyle = ink; g.lineWidth = px * 0.05; g.lineCap = 'round'
        g.beginPath(); g.moveTo(-width * 0.5, px * 0.5); g.quadraticCurveTo(0, px * 0.72, width * 0.55, px * 0.38); g.stroke()
      }
      break
    }
  }
  if (plate) {
    const inner = draw
    const pad = px * 0.5
    const h = m.style === 'mono' ? px * 1.25 : px * 1.4
    width += pad * 2
    draw = () => { g.fillStyle = BLACK; g.fillRect(-width / 2, -h / 2, width, h); inner() }
  }
  // shrink to fit the slot (the k squash shortens lettering on screen, so budget in unsquashed units)
  const fit = Math.min(1, (maxU * c.w) / c.k / Math.max(1, width))
  g.translate(x, y)
  g.scale((c.flip ? -1 : 1) * c.k * fit, fit)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  draw()
  g.restore()
}

// Placement is measured off the model with a debug grid (?liverydebug): every mark sits wholly inside either a
// side-facing panel or an up-facing panel, so none is cut by the side/top blend or shows twice.
//   side-facing: sidepod flank u .25-.62 v .2-.5 · engine-cover shoulder u .36-.46 v .72-.84 · coke-bottle u .2-.28
//   v .45-.55 · cockpit flank u .53-.6 v .58-.64 · nose flank u .66-.92 v .36-.48 · rear-wing endplate u 0-.1
//   up-facing: sidepod tops u .22-.48 v .31-.41 / .59-.69 · engine-cover spine u .14-.42 · nose top u .6-.95
// [u, v, size, max length] per partner mark index; one mark per surface, mirrored on both flanks.
const SIDE_SLOTS: [number, number, number, number][] = [
  [0.46, 0.355, 0.075, 0.27], //  0 sidepod: title partner
  [0.405, 0.78, 0.055, 0.07], // 1 engine-cover shoulder
  [0.46, 0.19, 0.042, 0.16], // 2 lower sidepod, on the black
  [0.78, 0.42, 0.055, 0.14], // 3 nose flank
  [0.24, 0.5, 0.08, 0.06], //  4 coke-bottle
]
// carried on every livery, every corner: what he does and what he loves
const CORE: Record<number, Sponsor> = {
  0: { text: 'SOFTWARE DEVELOPER', style: 'bold' },
  3: { text: 'FOOTBALL', style: 'emblem' },
  4: { text: 'F1', style: 'outline' },
}
type TopMark = { mark: Sponsor | number; u: number; v: number; size: number; maxU: number }
const TOP_MARKS: TopMark[] = [
  { mark: 7, u: 0.7, v: 0.5, size: 0.05, maxU: 0.11 },
]

/** Lettering that reads along v (up an endplate, across a wing): rotated, with the same undistorted scale. */
function textRot(c: View, s: string, u: number, v: number, size: number, maxV: number, o: TextOpts & { mono?: boolean } = {}) {
  const g = c.g as G
  const [x, y] = P(c, u, v)
  g.save()
  g.translate(x, y)
  g.scale((c.flip ? -1 : 1) * c.k, 1)
  g.rotate(-Math.PI / 2)
  const px = Math.round(size * c.h)
  g.font = o.mono ? `600 ${px}px ${MONO}` : `${o.stretch ?? 'expanded'} ${o.weight ?? 800} ${px}px ${SANS}`
  g.letterSpacing = `${(o.spacing ?? 0) * px}px`
  const w = g.measureText(s).width
  const fit = Math.min(1, (maxV * c.h) / Math.max(1, w))
  g.scale(fit, fit)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = o.fill ?? '#ffffff'
  g.fillText(s, 0, 0)
  g.restore()
}

/** Driver name on the cockpit flank, under the halo. */
function driverTag(c: View, l: LiveryDef, u: number, v: number) {
  decal(c, { text: 'RAUNAK', style: 'mono' }, u, v, 0.032, 0.06, l)
}

// rear wing: black, the endplates carry the name in white, the mainplane the full name
const REAR = { u0: 0, u1: 0.1, v0: 0.34, v1: 0.84 }
function rearWingSide(c: View) {
  shape(c, [[REAR.u0, REAR.v0], [REAR.u1, REAR.v0], [REAR.u1, REAR.v1], [REAR.u0, REAR.v1]], BLACK, false)
  textRot(c, NAME, 0.045, 0.59, 0.2, 0.32, { fill: WHITE, weight: 800 })
  textRot(c, '#' + NUMBER + '  ·  ON TRACK · NO REGRETS', 0.085, 0.59, 0.035, 0.32, { fill: WHITE, mono: true, spacing: 0.2 })
}
function rearWingTop(c: View) {
  shape(c, [[REAR.u0, 0], [REAR.u1, 0], [REAR.u1, 1], [REAR.u0, 1]], BLACK, false)
  textRot(c, FULL_NAME, 0.05, 0.5, 0.1, 0.5, { fill: WHITE, weight: 800, spacing: 0.04 })
}

function decalsSide(c: View, l: LiveryDef, set: SponsorSet) {
  rearWingSide(c)
  SIDE_SLOTS.forEach(([u, v, s, mu], i) => { const m = CORE[i] ?? set.marks[i]; if (m) decal(c, m, u, v, s, mu, l) })
  driverTag(c, l, 0.565, 0.61)
  // the pit wall's motto, along the black of the lower body
  decal(c, { text: 'ON TRACK · NO REGRETS', style: 'mono' }, 0.27, 0.235, 0.03, 0.15, l)
  decal(c, { text: NUMBER, style: 'num' }, 0.905, 0.42, 0.07, 0.05, l)
}
function decalsTop(c: View, l: LiveryDef, set: SponsorSet) {
  rearWingTop(c)
  TOP_MARKS.forEach(({ mark, u, v, size, maxU }) => {
    const m = typeof mark === 'number' ? set.marks[mark] : mark
    if (m) decal(c, m, u, v, size, maxU, l)
  })
  decal(c, { text: NUMBER, style: 'num' }, 0.84, 0.5, 0.1, 0.05, l)
}

// ---------- the liveries ----------
// The owner's palette: Pantone 19-1650 Rouge Noir taken a step darker than the swatch, a gunmetal grey and a
// deep petrol worn super matte, and a satin gunmetal with a fine metal flake that catches the studio
// lights, all with black panels (gloss, like bare carbon). Lettering is White Sand on the dark cars and black
// on any light one.
const ROUGE = '#3d0710'
const PETROL = '#134a66'
const GREY = '#545c63'
const MATTE = { metalness: 0.02, roughness: 0.66, clearcoat: 0.04, iridescence: 0 }
const SATIN = { metalness: 0.62, roughness: 0.34, clearcoat: 0.45, coatRough: 0.26, flake: 0.2, iridescence: 0 }

// black lower body that rises toward the tail, shared by all three
const lowerBlack = (c: View) => shape(c, [[0, 0.44], [0.22, 0.33], [0.36, 0.265], [0.5, 0.245], [0.72, 0.245], [1, 0.22], [1, 0], [0, 0]], BLACK)

export const LIVERIES: LiveryDef[] = [
  {
    id: 'rouge', name: 'Rouge Noir', era: 'Pantone 19-1650 · black · white',
    a: ROUGE, accent: '#b0283c', rim: '#0b0b0c', ...MATTE,
    side(c) {
      fillAll(c, gradU(c, [[0, '#2f050c'], [0.55, ROUGE], [1, '#4a0a14']]))
      // black engine-cover tail and fin, the cut raked forward
      shape(c, [[0, 1], [0.24, 1], [0.31, 0.62], [0, 0.6]], BLACK, false)
      // and black all along underneath: red over black, the line rising from the nose to the tail
      shape(c, [[0, 0.6], [0.18, 0.52], [0.34, 0.44], [0.5, 0.405], [0.66, 0.385], [0.82, 0.35], [1, 0.31], [1, 0], [0, 0]], BLACK)
    },
    top(c) {
      fillAll(c, gradU(c, [[0, '#2f050c'], [0.55, ROUGE], [1, '#4a0a14']]))
      shape(c, [[0, 0], [0.2, 0], [0.24, 0.5], [0.2, 1], [0, 1]], BLACK, false)
    },
  },
  {
    id: 'petrol', name: 'Deep Petrol', era: 'deep petrol · black · white',
    a: PETROL, accent: '#3f8fa6', rim: '#0b0b0c', ...MATTE,
    side(c) {
      fillAll(c, gradU(c, [[0, '#0e3549'], [0.55, PETROL], [1, '#265872']]))
      // one black band raked through the cockpit, the rest petrol
      shape(c, [[0.5, 1], [0.6, 1], [0.66, 0.26], [0.56, 0.27]], BLACK, false)
      lowerBlack(c)
    },
    top(c) {
      fillAll(c, gradU(c, [[0, '#0e3549'], [0.55, PETROL], [1, '#265872']]))
      shape(c, [[0.5, 0], [0.6, 0], [0.6, 1], [0.5, 1]], BLACK, false)
      shape(c, [[0, 0], [0.12, 0], [0.12, 1], [0, 1]], BLACK, false)
    },
  },
  {
    id: 'grey', name: 'Gunmetal', era: 'satin gunmetal · black · white',
    a: GREY, accent: '#a9b4bc', rim: '#0b0b0c', ...SATIN,
    side(c) {
      fillAll(c, gradU(c, [[0, '#40474d'], [0.55, GREY], [1, '#646d75']]))
      shape(c, [[0, 1], [0.2, 1], [0.27, 0.62], [0, 0.6]], BLACK, false)
      shape(c, [[0.93, 1], [1, 1], [1, 0], [0.95, 0]], BLACK, false)
      lowerBlack(c)
    },
    top(c) {
      fillAll(c, gradU(c, [[0, '#40474d'], [0.55, GREY], [1, '#646d75']]))
      shape(c, [[0, 0], [0.18, 0], [0.2, 0.5], [0.18, 1], [0, 1]], BLACK, false)
      shape(c, [[0.93, 0], [1, 0], [1, 1], [0.93, 1]], BLACK, false)
    },
  },
]

/** Dev only: the Deep Petrol design (its black band and panels) in any body colour, to compare shades. */
export function petrolIn(hex: string): LiveryDef {
  const base = LIVERIES.find((l) => l.id === 'petrol')!
  const mixc = (to: number, k: number) => {
    const n = parseInt(hex.slice(1), 16)
    const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (to - v) * k))
    return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('')
  }
  const lo = mixc(0, 0.28), hi = mixc(255, 0.08)
  return {
    ...base, id: 'petrol-' + hex, a: hex,
    side(c) {
      fillAll(c, gradU(c, [[0, lo], [0.55, hex], [1, hi]]))
      shape(c, [[0.5, 1], [0.6, 1], [0.66, 0.26], [0.56, 0.27]], BLACK, false)
      lowerBlack(c)
    },
    top(c) {
      fillAll(c, gradU(c, [[0, lo], [0.55, hex], [1, hi]]))
      shape(c, [[0.5, 0], [0.6, 0], [0.6, 1], [0.5, 1]], BLACK, false)
      shape(c, [[0, 0], [0.12, 0], [0.12, 1], [0, 1]], BLACK, false)
    },
  }
}

/** Dev only: the Cognac layout in any colour, to compare candidate liveries on the real car. */
export function trialLivery(hex: string): LiveryDef {
  const mixc = (to: number, k: number) => {
    const n = parseInt(hex.slice(1), 16)
    const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (to - v) * k))
    return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('')
  }
  const lo = mixc(0, 0.18), hi = mixc(255, 0.06)
  return {
    id: 'trial-' + hex, name: hex, era: 'trial', a: hex, accent: hex, rim: '#0b0b0c', ...MATTE,
    side(c) {
      fillAll(c, gradU(c, [[0, lo], [0.55, hex], [1, hi]]))
      shape(c, [[0, 1], [0.2, 1], [0.27, 0.62], [0, 0.6]], BLACK, false)
      shape(c, [[0.93, 1], [1, 1], [1, 0], [0.95, 0]], BLACK, false)
      lowerBlack(c)
    },
    top(c) {
      fillAll(c, gradU(c, [[0, lo], [0.55, hex], [1, hi]]))
      shape(c, [[0, 0], [0.18, 0], [0.2, 0.5], [0.18, 1], [0, 1]], BLACK, false)
      shape(c, [[0.93, 0], [1, 0], [1, 1], [0.93, 1]], BLACK, false)
    },
  }
}

/** What the paint lens shows over each livery: red and petrol reveal each other, the grey reveals red. */
export const LENS_OF: Record<string, string> = { rouge: 'petrol', petrol: 'rouge', grey: 'rouge' }

// ---------- atlas ----------
export const ATLAS_W = 4096
export const ATLAS_H = 2048
// canvas rows: left flank (z+) 0..768, right flank (z-) 768..1536, top 1536..2048
// the paint under the lettering, at an eighth of the atlas, on a CPU canvas that is cheap to read
const PROBE = 8
const PROBE_W = ATLAS_W / PROBE, PROBE_H = ATLAS_H / PROBE
let probe: CanvasRenderingContext2D | null = null
let ground: Uint8ClampedArray | null = null

export function paintAtlas(ctx: CanvasRenderingContext2D, l: LiveryDef, set: SponsorSet, size: { x: number; y: number; z: number }) {
  ctx.clearRect(0, 0, ATLAS_W, ATLAS_H)
  const sideH = 768
  const kSide = ATLAS_W / size.x / (sideH / size.y)
  const kTop = ATLAS_W / size.x / (512 / size.z)
  const side = (v: View) => { l.side(v); decalsSide(v, l, set) }
  const top = (v: View) => { l.top(v); decalsTop(v, l, set) }
  const rows: [number, number, boolean, number, (v: View) => void][] = [
    [0, sideH, false, kSide, side],
    [sideH, sideH, true, kSide, side],
    [sideH * 2, 512, false, kTop, top],
  ]
  // first the bare paint and the black wing, small, so each mark can pick its ink without reading the atlas back
  if (!probe) {
    // a page canvas, or an offscreen one when this runs in the atlas worker
    const pc = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(PROBE_W, PROBE_H)
    pc.width = PROBE_W; pc.height = PROBE_H
    probe = pc.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null
  }
  if (probe) {
    probe.setTransform(1, 0, 0, 1, 0, 0)
    probe.clearRect(0, 0, PROBE_W, PROBE_H)
    rows.forEach(([y0, h, flip, k], r) => {
      probe!.save()
      probe!.setTransform(1 / PROBE, 0, 0, 1 / PROBE, 0, 0)
      probe!.beginPath(); probe!.rect(0, y0, ATLAS_W, h); probe!.clip()
      const v = { g: probe!, x0: 0, y0, w: ATLAS_W, h, flip, k }
      if (r < 2) { l.side(v); rearWingSide(v) } else { l.top(v); rearWingTop(v) }
      probe!.restore()
    })
    ground = probe.getImageData(0, 0, PROBE_W, PROBE_H).data
  }
  for (const [y0, h, flip, k, draw] of rows) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, y0, ATLAS_W, h)
    ctx.clip()
    draw({ g: ctx, x0: 0, y0, w: ATLAS_W, h, flip, k })
    ctx.restore()
  }
  ground = null
}
