// The air round the car, for the wind tunnel. The mean flow is baked offline (scripts/bake-flow.mjs) from the
// car's voxelised shape: the potential flow round it, a wake behind every bluff body (slower air, recirculating
// right behind it, spreading downstream), the wings' bound and tip vortices, and the signed distance to the
// bodywork. Here particles are carried through that field: the mean flow, plus divergence-free turbulence that
// lives only in the wakes, so the incoming air is smooth and the air behind the tyres, the wings and the car
// tumbles. Particles near the bodywork slide along it and never pass through it. Car-rig space: nose +X, floor
// y = 0, centreline z = 0; velocities in units of the free stream.
//
// This is a geometry-aware approximation for a picture, not a validated CFD solution.

export type Field = { nx: number; ny: number; nz: number; min: [number, number, number]; h: number; vel: Float32Array; sdf: Float32Array }

export async function loadAirField(url: string): Promise<Field> {
  const res = await fetch(url)
  const buf = await new Response(res.body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  const dv = new DataView(buf)
  const nx = dv.getUint16(4, true), ny = dv.getUint16(6, true), nz = dv.getUint16(8, true)
  const min: [number, number, number] = [dv.getFloat32(12, true), dv.getFloat32(16, true), dv.getFloat32(20, true)]
  const h = dv.getFloat32(24, true)
  const N = nx * ny * nz
  const q = new Uint8Array(buf, 28, N * 4), d = new Int8Array(buf, 28 + N * 4, N)
  const vel = new Float32Array(N * 4), sdf = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    vel[i * 4] = (q[i * 4] / 255) * 4 - 2
    vel[i * 4 + 1] = (q[i * 4 + 1] / 255) * 4 - 2
    vel[i * 4 + 2] = (q[i * 4 + 2] / 255) * 4 - 2
    vel[i * 4 + 3] = q[i * 4 + 3] / 255
    sdf[i] = d[i] / 100
  }
  return { nx, ny, nz, min, h, vel, sdf }
}

/** Trilinear sample: out = [vx, vy, vz, wake, distance]. Outside the field: the free stream. */
export function sampleAir(F: Field, x: number, y: number, z: number, out: Float32Array) {
  const fx = (x - F.min[0]) / F.h, fy = (y - F.min[1]) / F.h, fz = (z - F.min[2]) / F.h
  if (fx < 0 || fy < 0 || fz < 0 || fx >= F.nx - 1 || fy >= F.ny - 1 || fz >= F.nz - 1) {
    out[0] = -1; out[1] = 0; out[2] = 0; out[3] = 0; out[4] = 1
    return
  }
  const x0 = fx | 0, y0 = fy | 0, z0 = fz | 0, tx = fx - x0, ty = fy - y0, tz = fz - z0
  const sx = 1, sy = F.nx, sz = F.nx * F.ny
  const i0 = x0 + y0 * sy + z0 * sz
  let a = 0, b = 0, c = 0, w = 0, d = 0
  for (let k = 0; k < 8; k++) {
    const dx = k & 1, dy = (k >> 1) & 1, dz = k >> 2
    const wt = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz)
    const i = i0 + dx * sx + dy * sy + dz * sz
    a += F.vel[i * 4] * wt; b += F.vel[i * 4 + 1] * wt; c += F.vel[i * 4 + 2] * wt; w += F.vel[i * 4 + 3] * wt
    d += F.sdf[i] * wt
  }
  out[0] = a; out[1] = b; out[2] = c; out[3] = w; out[4] = d
}

// ---- turbulence: the curl of a smooth periodic noise, so it stirs the air without piling it up anywhere ----
const TN = 24
function makeCurlNoise() {
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  const pot = [0, 1, 2].map(() => Float32Array.from({ length: TN * TN * TN }, rnd))
  const id = (x: number, y: number, z: number) => (((z + TN) % TN) * TN + ((y + TN) % TN)) * TN + ((x + TN) % TN)
  // smooth the potentials so the eddies are a few cells across
  for (const p of pot) for (let pass = 0; pass < 3; pass++) for (const [ax, ay, az] of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    const c = p.slice()
    for (let z = 0; z < TN; z++) for (let y = 0; y < TN; y++) for (let x = 0; x < TN; x++)
      p[id(x, y, z)] = (c[id(x - ax, y - ay, z - az)] + 2 * c[id(x, y, z)] + c[id(x + ax, y + ay, z + az)]) / 4
  }
  const out = new Float32Array(TN * TN * TN * 3)
  let rms = 0
  for (let z = 0; z < TN; z++) for (let y = 0; y < TN; y++) for (let x = 0; x < TN; x++) {
    const g = (p: Float32Array, dx: number, dy: number, dz: number) => (p[id(x + dx, y + dy, z + dz)] - p[id(x - dx, y - dy, z - dz)]) / 2
    const i = id(x, y, z) * 3
    out[i] = g(pot[2], 0, 1, 0) - g(pot[1], 0, 0, 1)
    out[i + 1] = g(pot[0], 0, 0, 1) - g(pot[2], 1, 0, 0)
    out[i + 2] = g(pot[1], 1, 0, 0) - g(pot[0], 0, 1, 0)
    rms += out[i] ** 2 + out[i + 1] ** 2 + out[i + 2] ** 2
  }
  rms = Math.sqrt(rms / (TN * TN * TN * 3))
  for (let i = 0; i < out.length; i++) out[i] /= rms
  return out
}
let CURL: Float32Array | null = null
function curl(x: number, y: number, z: number, out: Float32Array) {
  const C = (CURL ??= makeCurlNoise())
  const fx = ((x % TN) + TN) % TN, fy = ((y % TN) + TN) % TN, fz = ((z % TN) + TN) % TN
  const x0 = fx | 0, y0 = fy | 0, z0 = fz | 0, tx = fx - x0, ty = fy - y0, tz = fz - z0
  let a = 0, b = 0, c = 0
  for (let k = 0; k < 8; k++) {
    const dx = k & 1, dy = (k >> 1) & 1, dz = k >> 2
    const wt = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz)
    const i = ((((z0 + dz) % TN) * TN + ((y0 + dy) % TN)) * TN + ((x0 + dx) % TN)) * 3
    a += C[i] * wt; b += C[i + 1] * wt; c += C[i + 2] * wt
  }
  out[0] = a; out[1] = b; out[2] = c
}

// ---- the particles ----
/** the free stream, m/s in the scene */
export const U0 = 3.0
const X_IN = 4.7, X_OUT = -5.1
/** how much the wake stirs the air, as a fraction of the free stream at full wake */
const TURB = 0.42
/** eddy size: noise cells per metre */
const EDDY = 2.4
const SKIN = 0.025

export type Air = {
  n: number
  pos: Float32Array
  vel: Float32Array
  /** per particle: alpha, wake, near the bodywork (0..1), speed; alpha already says how much the car has
   *  disturbed this bit of air, so the undisturbed stream stays faint and the interaction stands out */
  data: Float32Array
  age: Float32Array
  t: number
}

export function makeAir(n: number): Air {
  return { n, pos: new Float32Array(n * 3), vel: new Float32Array(n * 3), data: new Float32Array(n * 4), age: new Float32Array(n), t: 0 }
}

let rs = 12345
const rand = () => ((rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

/** A new particle upstream (or anywhere along the tunnel, to fill it at the start), more of them where the car is. */
function spawn(A: Air, F: Field, i: number, anywhere: boolean) {
  const s = new Float32Array(5)
  for (let tries = 0; tries < 8; tries++) {
    const x = anywhere ? X_OUT + 0.3 + rand() * (X_IN - X_OUT - 0.3) : X_IN - rand() * 0.25
    // most of the air released where the car will work on it
    const y = 0.015 + 1.15 * Math.pow(rand(), 1.7)
    const z = (rand() < 0.5 ? -1 : 1) * 1.05 * Math.pow(rand(), 1.6)
    sampleAir(F, x, y, z, s)
    if (s[4] > SKIN * 2) {
      A.pos[i * 3] = x; A.pos[i * 3 + 1] = y; A.pos[i * 3 + 2] = z
      A.age[i] = anywhere ? 1 + rand() * 2 : 0
      return
    }
  }
}

export function fillAir(A: Air, F: Field) {
  for (let i = 0; i < A.n; i++) spawn(A, F, i, true)
}

const s1 = new Float32Array(5), s2 = new Float32Array(5), tb = new Float32Array(3)
/** Advance every particle by dt (s): midpoint steps through the mean flow plus the wake's turbulence. */
export function stepAir(A: Air, F: Field, dt: number) {
  A.t += dt
  const t = A.t
  // the eddies ride downstream with the air and slowly change shape
  const ox = t * U0 * 0.75 * EDDY, oy = t * 0.35, oz = -t * 0.2
  const u = (x: number, y: number, z: number, s: Float32Array, o: Float32Array) => {
    sampleAir(F, x, y, z, s)
    o[0] = s[0]; o[1] = s[1]; o[2] = s[2]
    const w = s[3]
    if (w > 0.02) {
      curl(x * EDDY + ox, y * EDDY + oy, z * EDDY + oz, tb)
      const k = TURB * w
      o[0] += tb[0] * k * 0.6; o[1] += tb[1] * k; o[2] += tb[2] * k
    }
  }
  const v1 = new Float32Array(3), v2 = new Float32Array(3)
  for (let i = 0; i < A.n; i++) {
    let x = A.pos[i * 3], y = A.pos[i * 3 + 1], z = A.pos[i * 3 + 2]
    u(x, y, z, s1, v1)
    const h = dt * U0
    u(x + v1[0] * h * 0.5, y + v1[1] * h * 0.5, z + v1[2] * h * 0.5, s2, v2)
    const wk = s2[3]
    x += v2[0] * h; y += v2[1] * h; z += v2[2] * h
    // the bodywork: a particle that reaches the skin is put back on it and slides along it
    let near = 0
    const d = s2[4]
    if (d < SKIN * 3) {
      sampleAir(F, x, y, z, s1)
      const dd = s1[4]
      near = 1 - Math.max(0, dd) / (SKIN * 3)
      if (dd < SKIN) {
        const e = 0.03
        sampleAir(F, x + e, y, z, s2); const gx = s2[4]
        sampleAir(F, x, y + e, z, s2); const gy = s2[4]
        sampleAir(F, x, y, z + e, s2); const gz = s2[4]
        let nx = gx - dd, ny = gy - dd, nz = gz - dd
        const l = Math.hypot(nx, ny, nz) || 1
        nx /= l; ny /= l; nz /= l
        const push = SKIN - dd
        x += nx * push; y += ny * push; z += nz * push
        const vn = v2[0] * nx + v2[1] * ny + v2[2] * nz
        if (vn < 0) { v2[0] -= vn * nx; v2[1] -= vn * ny; v2[2] -= vn * nz }
      }
    }
    if (y < 0.008) { y = 0.008; if (v2[1] < 0) v2[1] = 0 }
    A.pos[i * 3] = x; A.pos[i * 3 + 1] = y; A.pos[i * 3 + 2] = z
    A.vel[i * 3] = v2[0] * U0; A.vel[i * 3 + 1] = v2[1] * U0; A.vel[i * 3 + 2] = v2[2] * U0
    A.age[i] += dt
    const speed = Math.hypot(v2[0], v2[1], v2[2])
    // gone downstream, out of the tunnel, or held too long in a wake: back upstream, faded in again
    if (x < X_OUT || Math.abs(z) > 1.7 || y > 1.7 || A.age[i] > 9 || !(speed === speed)) { spawn(A, F, i, false); A.data[i * 4] = 0; continue }
    const fade = Math.min(1, A.age[i] / 0.5) * Math.min(1, (X_IN - x) / 0.6) * Math.min(1, (x - X_OUT) / 0.9) * Math.min(1, (9 - A.age[i]) / 0.6)
    // how much the car has done to this air: turned it, sped or slowed it, churned it, or held it to its skin
    const dev = Math.hypot(v2[0] + 1, v2[1], v2[2])
    const interest = Math.min(1, dev * 2.2 + wk * 0.9 + near * 0.5)
    A.data[i * 4] = Math.max(0, fade) * (0.12 + 0.88 * interest)
    A.data[i * 4 + 1] = wk
    A.data[i * 4 + 2] = near
    A.data[i * 4 + 3] = speed
  }
}
