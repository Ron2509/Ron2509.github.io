import { AERO } from './grid'

// Streamlines through the air round the car, traced once on the CPU from the baked field (aero.bin: distance to
// the bodywork and wake). The flow is the same model the tunnel always used, minus its turbulence: the air turns
// along the bodywork, speeds up over it and slows where it meets it head on, the rear wing and the diffuser pull
// it up, and the wing tips roll it into vortices. Without noise every line is smooth and exact, as a CFD render
// shows it. Car-rig space: nose +X, floor y = 0, centreline z = 0.

type V = [number, number, number]

/** A traced line: its points, the air speed at each (1 = free stream), and its arc length to each point. */
export type Stream = { p: Float32Array; speed: Float32Array; s: Float32Array; n: number; through: boolean }

const [NX, NY, NZ] = AERO.n
const MIN = AERO.min, MAX = AERO.max
const SIZE: V = [MAX[0] - MIN[0], MAX[1] - MIN[1], MAX[2] - MIN[2]]

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

export function makeField(data: Uint8Array) {
  // trilinear, cell-centred, like the GPU's linear 3D texture
  const at = (ch: number, p: V) => {
    const fx = ((p[0] - MIN[0]) / SIZE[0]) * NX - 0.5, fy = ((p[1] - MIN[1]) / SIZE[1]) * NY - 0.5, fz = ((p[2] - MIN[2]) / SIZE[2]) * NZ - 0.5
    const x0 = Math.max(0, Math.min(NX - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(NY - 1, Math.floor(fy))), z0 = Math.max(0, Math.min(NZ - 1, Math.floor(fz)))
    const x1 = Math.min(NX - 1, x0 + 1), y1 = Math.min(NY - 1, y0 + 1), z1 = Math.min(NZ - 1, z0 + 1)
    const tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0)), tz = Math.min(1, Math.max(0, fz - z0))
    const g = (x: number, y: number, z: number) => data[((z * NY + y) * NX + x) * 2 + ch] / 255
    const a = g(x0, y0, z0) * (1 - tx) + g(x1, y0, z0) * tx, b = g(x0, y1, z0) * (1 - tx) + g(x1, y1, z0) * tx
    const c = g(x0, y0, z1) * (1 - tx) + g(x1, y0, z1) * tx, d = g(x0, y1, z1) * (1 - tx) + g(x1, y1, z1) * tx
    return (a * (1 - ty) + b * ty) * (1 - tz) + (c * (1 - ty) + d * ty) * tz
  }
  const inBox = (p: V) => {
    const t = [(p[0] - MIN[0]) / SIZE[0], (p[1] - MIN[1]) / SIZE[1], (p[2] - MIN[2]) / SIZE[2]]
    const m = [smooth(0, 0.22, t[0]), smooth(0, 0.06, t[1]), smooth(0, 0.06, t[2])]
    return m[0] * m[1] * m[2] * (1 - smooth(0.94, 1, t[0])) * (1 - smooth(0.94, 1, t[1])) * (1 - smooth(0.94, 1, t[2]))
  }
  const dist = (p: V) => { const k = inBox(p); return k <= 0 ? AERO.DIST_MAX : AERO.DIST_MAX + (at(0, p) * AERO.DIST_MAX - AERO.DIST_MAX) * k }
  const wake = (p: V) => at(1, p) * inBox(p)
  const normal = (p: V): V => {
    const e = 0.045
    const g: V = [dist([p[0] + e, p[1], p[2]]) - dist([p[0] - e, p[1], p[2]]), dist([p[0], p[1] + e, p[2]]) - dist([p[0], p[1] - e, p[2]]), dist([p[0], p[1], p[2] + e]) - dist([p[0], p[1], p[2] - e])]
    const l = Math.hypot(g[0], g[1], g[2]) || 1
    return [g[0] / l, g[1] / l, g[2] / l]
  }
  // a tip vortex: swirl about the stream direction behind the tip, strongest at its core
  const vortex = (p: V, c: V, s: number, out: V) => {
    const ry = p[1] - c[1], rz = p[2] - c[2], rr = ry * ry + rz * rz
    const behind = smooth(c[0] + 0.05, c[0] - 0.3, p[0]) * smooth(c[0] - 4.2, c[0] - 1.2, p[0])
    const k = s * 0.07 * behind * Math.exp(-rr / 0.05) / (rr + 0.004)
    out[1] += -k * rz; out[2] += k * ry
  }
  const TIPS: [V, number][] = [
    [[-2.05, 0.82, 0.52], 1], [[-2.05, 0.82, -0.52], -1], // rear wing
    [[1.75, 0.2, 0.8], -0.8], [[1.75, 0.2, -0.8], 0.8], // front wing end plates
  ]
  const flow = (p: V): V => {
    const d = dist(p), w = wake(p)
    const n = normal(p)
    const v: V = [-1, 0, 0]
    const soft = 1 - smooth(0, 0.24, d), skin = 1 - smooth(0, 0.05, d)
    const into = -n[0]
    const press = soft * Math.max(0, -into)
    if (into < 0) { const k = into * (soft * 1.05 + skin * 0.4); v[0] -= n[0] * k; v[1] -= n[1] * k; v[2] -= n[2] * k }
    const sp = 1 + 0.55 * soft * (1 - Math.abs(into)) - 0.55 * press
    v[0] *= sp; v[1] *= sp; v[2] *= sp
    v[1] += Math.max(0, 0.08 - p[1]) * 3
    v[0] *= 1 - 0.45 * w
    // the rear wing flings the air up and over; the diffuser pulls the floor's air up behind the car
    const span = 1 - smooth(0.4, 0.58, Math.abs(p[2]))
    v[1] += 0.3 * span * smooth(-1.8, -2.1, p[0]) * (1 - smooth(-2.5, -3.2, p[0])) * smooth(0.45, 0.7, p[1]) * (1 - smooth(1.1, 1.4, p[1]))
    v[1] += 0.16 * (1 - smooth(0.45, 0.7, Math.abs(p[2]))) * smooth(-1.6, -2.0, p[0]) * (1 - smooth(-2.4, -3.0, p[0])) * (1 - smooth(0.25, 0.45, p[1]))
    for (const [c, s] of TIPS) vortex(p, c, s, v)
    return v
  }
  return { dist, flow, normal }
}

/** Trace one line from `seed` downstream in fixed steps of arc length (RK4 on the flow's direction). */
export function trace(F: ReturnType<typeof makeField>, seed: V, step = 0.02, xEnd = -4.6, max = 700): Stream {
  const pts: number[] = [], spd: number[] = [], arc: number[] = []
  let p: V = [...seed]
  let s = 0
  const dir = (q: V): [V, number] => {
    const v = F.flow(q)
    const sp = Math.hypot(v[0], v[1], v[2])
    // at the bodywork the air can only run along it: the inward part goes; where it meets the car head on (the
    // stagnation point at the nose) it is sent over the top or round the side, the way the air divides there
    const d = F.dist(q)
    if (d < 0.14) {
      const n = F.normal(q)
      const dn = v[0] * n[0] + v[1] * n[1] + v[2] * n[2]
      if (dn < 0) { v[0] -= n[0] * dn; v[1] -= n[1] * dn; v[2] -= n[2] * dn }
      if (Math.hypot(v[0], v[1], v[2]) < 0.35) {
        const e: V = q[1] > 0.32 ? [-0.2, 0.7, 0] : [-0.2, 0, 0.7 * (q[2] >= 0 ? 1 : -1)]
        const en = e[0] * n[0] + e[1] * n[1] + e[2] * n[2]
        v[0] += e[0] - n[0] * en; v[1] += e[1] - n[1] * en; v[2] += e[2] - n[2] * en
      }
    }
    const l = Math.hypot(v[0], v[1], v[2]) || 1
    return [[v[0] / l, v[1] / l, v[2] / l], sp]
  }
  for (let i = 0; i < max && p[0] > xEnd; i++) {
    const [k1, sp] = dir(p)
    pts.push(p[0], p[1], p[2]); spd.push(sp); arc.push(s)
    const [k2] = dir([p[0] + k1[0] * step / 2, p[1] + k1[1] * step / 2, p[2] + k1[2] * step / 2])
    const [k3] = dir([p[0] + k2[0] * step / 2, p[1] + k2[1] * step / 2, p[2] + k2[2] * step / 2])
    const [k4] = dir([p[0] + k3[0] * step, p[1] + k3[1] * step, p[2] + k3[2] * step])
    p = [p[0] + (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) * step / 6, p[1] + (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) * step / 6, p[2] + (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]) * step / 6]
    // never into the bodywork: a line that grazes it slides along its skin
    const d = F.dist(p)
    if (d < 0.025) { const n = F.normal(p); p = [p[0] + n[0] * (0.025 - d), p[1] + n[1] * (0.025 - d), p[2] + n[2] * (0.025 - d)] }
    if (p[1] < 0.01) p[1] = 0.01
    s += step
  }
  return { p: new Float32Array(pts), speed: new Float32Array(spd), s: new Float32Array(arc), n: spd.length, through: p[0] <= xEnd }
}

/** How near a line comes to the car, and whether it runs under the floor (it would read as a line through it). */
export function closeness(F: ReturnType<typeof makeField>, l: Stream) {
  let near = Infinity, under = false
  for (let i = 0; i < l.n; i += 3) {
    const x = l.p[i * 3], y = l.p[i * 3 + 1], z = l.p[i * 3 + 2]
    near = Math.min(near, F.dist([x, y, z]))
    if (y < 0.13 && x > -1.8 && x < 1.6 && Math.abs(z) < 0.62) under = true
  }
  return { near, under }
}

// ---------- streamline sheets ----------
// Lines that follow the car's contour the way flow over a body is drawn: a line released at height y0 in a
// vertical sheet rides at y = y0 + B(x) e^(-y0 / H), where B is the top of the car in that sheet, so lines never
// cross, crowd together (and speed up) against the bodywork and spread apart above it. Sideways sheets do the
// same round the car's flanks. B and the flank are measured from the distance field, felt a little ahead of the
// car and let go slowly behind it, the way the air anticipates the body and recovers in its wake.

const X_START = 4.4, X_END = -4.6, DX = 0.02
const H = 1.25, HZ = 0.95

function profile(raw: Float32Array, ahead = 0.3, behind = 0.75) {
  // anticipation upstream (the air starts to move before the body), then a slow recovery downstream
  const n = raw.length, a = new Float32Array(n), b = new Float32Array(n)
  let carry = 0
  for (let i = n - 1; i >= 0; i--) { carry = Math.max(raw[i], carry * Math.exp(-DX / ahead)); a[i] = carry }
  carry = 0
  for (let i = 0; i < n; i++) { carry = Math.max(a[i], carry * Math.exp(-DX / behind)); b[i] = carry }
  // a wide blur: lines follow the body's shape, not every antenna, mirror stalk and panel edge on it
  const out = new Float32Array(n), r = 18
  for (let i = 0; i < n; i++) { let s = 0, w = 0; for (let k = -r; k <= r; k++) { const j = Math.min(n - 1, Math.max(0, i + k)); const q = Math.exp(-(k * k) / 72); s += b[j] * q; w += q } out[i] = s / w }
  return out
}

/** x samples run from the start (upstream, +x) downstream. */
const xs = (() => { const a: number[] = []; for (let x = X_START; x >= X_END; x -= DX) a.push(x); return a })()

function line(pts: number[], speed: number[]): Stream {
  const n = speed.length, s = new Float32Array(n)
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2], pts[i * 3 + 2] - pts[i * 3 - 1])
  return { p: new Float32Array(pts), speed: new Float32Array(speed), s, n, through: true }
}

export function sheets(F: ReturnType<typeof makeField>, opts: { zs: number[]; ys: number[]; flankYs: number[]; flankZs: number[] }): Stream[] {
  const out: Stream[] = []
  const touching = 0.035
  // over the top: one profile per sheet
  for (const z of opts.zs) {
    const raw = new Float32Array(xs.length)
    xs.forEach((x, i) => {
      for (let y = 1.35; y > 0; y -= 0.01) {
        // solid across the sheet's width, not a lone thin part poking up through it
        if (F.dist([x, y, z]) < touching && F.dist([x, y, z + 0.06]) < touching + 0.04 && F.dist([x, y, z - 0.06]) < touching + 0.04) { raw[i] = y; break }
      }
    })
    const B = profile(raw)
    for (const y0 of opts.ys) {
      const pts: number[] = [], sp: number[] = []
      xs.forEach((x, i) => {
        const e = Math.exp(-y0 / H)
        pts.push(x, y0 + B[i] * e, z)
        // packed closer, the air is faster: the spacing between neighbouring lines, against the free stream's
        sp.push(1 / Math.max(0.35, 1 - (B[i] / H) * e))
      })
      out.push(line(pts, sp))
    }
  }
  // round the flanks: one profile per height, mirrored either side
  for (const y of opts.flankYs) {
    const raw = new Float32Array(xs.length)
    xs.forEach((x, i) => { for (let z = 1.25; z > 0; z -= 0.01) if (F.dist([x, y, z]) < touching || F.dist([x, y, -z]) < touching) { raw[i] = z; break } })
    const W = profile(raw)
    for (const z0 of opts.flankZs) for (const side of [1, -1]) {
      const pts: number[] = [], sp: number[] = []
      xs.forEach((x, i) => {
        const e = Math.exp(-z0 / HZ)
        pts.push(x, y, side * (z0 + W[i] * e))
        sp.push(1 / Math.max(0.35, 1 - (W[i] / HZ) * e))
      })
      out.push(line(pts, sp))
    }
  }
  return out
}
