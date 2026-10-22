// CFD streamlines for the wind tunnel, solved offline.
//   node scripts/bake-flow.mjs <solid.json> [out]
// <solid.json> is the car's voxelised skin from the dev bake (?bakesolid, src/aero/bakeSolid.ts), as a base64
// JSON string. The air is flooded in from the tunnel's edges (whatever it can't reach is solid car), the
// potential flow round the car is solved on the grid (Laplace's equation for the velocity potential: free stream
// in at the nose end, no flow through the bodywork or the floor), the wing-tip vortices are added as Lamb-Oseen
// vortices, and streamlines are traced from a rake upstream. On top of the potential flow (which has no wakes) a
// wake model is added: behind every bluff body the air loses speed, recirculates right behind it and spreads, and
// both wings carry a bound vortex (the upwash behind an inverted wing) and tip vortices. The mean field, its wake
// intensity and the signed distance to the bodywork go to public/models/field.bin (gzip; see src/aero/airflow.ts),
// for the particles the page advects through it, and the streamlines traced through the same field go to
// public/models/flow.bin:
//   Uint32 lineCount, Uint32 pointCount, Uint16 count[lineCount] (padded to 4 bytes),
//   Int16 [x, y, z, speed] per point (x, y, z in metres * 4000, speed as a fraction of the free stream * 10000)
import { readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const [, , solidPath, outPath = 'public/models/flow.bin'] = process.argv
const H = 0.04, MIN = [-5.6, 0, -1.6], N = [281, 41, 81]
const [NX, NY, NZ] = N
const idx = (x, y, z) => (z * NY + y) * NX + x
const t0 = Date.now()
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', ...a)

// 1. solid: the skin, and everything inside it the air can't reach
const shell = Buffer.from(JSON.parse(readFileSync(solidPath, 'utf8')), 'base64')
const air = new Uint8Array(NX * NY * NZ)
{
  const q = new Int32Array(NX * NY * NZ)
  let head = 0, tail = 0
  const push = (i) => { if (!air[i] && !shell[i]) { air[i] = 1; q[tail++] = i } }
  for (let z = 0; z < NZ; z++) for (let y = 0; y < NY; y++) { push(idx(0, y, z)); push(idx(NX - 1, y, z)) }
  for (let x = 0; x < NX; x++) for (let y = 0; y < NY; y++) { push(idx(x, y, 0)); push(idx(x, y, NZ - 1)) }
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) push(idx(x, NY - 1, z))
  while (head < tail) {
    const i = q[head++]
    const x = i % NX, y = ((i / NX) | 0) % NY, z = (i / (NX * NY)) | 0
    if (x > 0) push(i - 1); if (x < NX - 1) push(i + 1)
    if (y > 0) push(i - NX); if (y < NY - 1) push(i + NX)
    if (z > 0) push(i - NX * NY); if (z < NZ - 1) push(i + NX * NY)
  }
}
let solidCount = 0
for (let i = 0; i < air.length; i++) if (!air[i]) solidCount++
log('solid nodes', solidCount)

// 2. potential flow: phi = -x far away (air moving to -x), d phi / dn = 0 on the car, floor, roof and walls.
//    Gauss-Seidel with over-relaxation, started from a coarser solve so it converges in a few hundred sweeps.
function solve(n, fluid, phi, iters, omega) {
  const [nx, ny, nz] = n
  const sx = 1, sy = nx, sz = nx * ny
  for (let it = 0; it < iters; it++) {
    let maxd = 0
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
      let i = (z * ny + y) * nx + 1
      for (let x = 1; x < nx - 1; x++, i++) {
        if (!fluid[i]) continue
        const c = phi[i]
        // a wall (car, floor, roof, side) mirrors the node's own value: no flow through it
        const xm = fluid[i - sx] ? phi[i - sx] : c, xp = fluid[i + sx] ? phi[i + sx] : c
        const ym = y > 0 && fluid[i - sy] ? phi[i - sy] : c, yp = y < ny - 1 && fluid[i + sy] ? phi[i + sy] : c
        const zm = z > 0 && fluid[i - sz] ? phi[i - sz] : c, zp = z < nz - 1 && fluid[i + sz] ? phi[i + sz] : c
        const v = (xm + xp + ym + yp + zm + zp) / 6
        const d = v - c
        phi[i] = c + omega * d
        if (Math.abs(d) > maxd) maxd = Math.abs(d)
      }
    }
    if (it % 200 === 199) log('  sweep', it + 1, 'max change', maxd.toExponential(2))
  }
}
// three levels: 4h, 2h, h
function level(f) {
  const n = [Math.floor((NX - 1) / f) + 1, Math.floor((NY - 1) / f) + 1, Math.floor((NZ - 1) / f) + 1]
  const fluid = new Uint8Array(n[0] * n[1] * n[2])
  for (let z = 0; z < n[2]; z++) for (let y = 0; y < n[1]; y++) for (let x = 0; x < n[0]; x++) {
    // solid if any fine node it stands for is solid
    let ok = 1
    for (let dz = 0; dz < f && ok; dz++) for (let dy = 0; dy < f && ok; dy++) for (let dx = 0; dx < f && ok; dx++) {
      const X = Math.min(NX - 1, x * f + dx - (f >> 1)), Y = Math.min(NY - 1, Math.max(0, y * f + dy - (f >> 1))), Z = Math.min(NZ - 1, Math.max(0, z * f + dz - (f >> 1)))
      if (X >= 0 && !air[idx(X, Y, Z)]) ok = 0
    }
    fluid[(z * n[1] + y) * n[0] + x] = ok
  }
  return { n, fluid, f }
}
function prolong(from, to) {
  // trilinear from the coarse level onto the finer one
  const [cx, cy, cz] = from.n, [fx, fy, fz] = to.n, r = from.f / to.f
  const out = new Float32Array(fx * fy * fz)
  for (let z = 0; z < fz; z++) for (let y = 0; y < fy; y++) for (let x = 0; x < fx; x++) {
    const gx = Math.min(cx - 1.001, x / r), gy = Math.min(cy - 1.001, y / r), gz = Math.min(cz - 1.001, z / r)
    const x0 = Math.floor(gx), y0 = Math.floor(gy), z0 = Math.floor(gz), tx = gx - x0, ty = gy - y0, tz = gz - z0
    const g = (a, b, c) => from.phi[(c * cy + b) * cx + a]
    const v = (1 - tz) * ((1 - ty) * ((1 - tx) * g(x0, y0, z0) + tx * g(x0 + 1, y0, z0)) + ty * ((1 - tx) * g(x0, y0 + 1, z0) + tx * g(x0 + 1, y0 + 1, z0)))
      + tz * ((1 - ty) * ((1 - tx) * g(x0, y0, z0 + 1) + tx * g(x0 + 1, y0, z0 + 1)) + ty * ((1 - tx) * g(x0, y0 + 1, z0 + 1) + tx * g(x0 + 1, y0 + 1, z0 + 1)))
    out[(z * fy + y) * fx + x] = v
  }
  return out
}
const freePhi = (n, f) => {
  const p = new Float32Array(n[0] * n[1] * n[2])
  for (let z = 0; z < n[2]; z++) for (let y = 0; y < n[1]; y++) for (let x = 0; x < n[0]; x++) p[(z * n[1] + y) * n[0] + x] = -(MIN[0] + x * f * H)
  return p
}
const L4 = level(4), L2 = level(2), L1 = { n: N, fluid: air, f: 1 }
L4.phi = freePhi(L4.n, 4); log('level 4h', L4.n.join('x')); solve(L4.n, L4.fluid, L4.phi, 3000, 1.9)
L2.phi = prolong(L4, L2); fixEnds(L2); log('level 2h', L2.n.join('x')); solve(L2.n, L2.fluid, L2.phi, 1200, 1.92)
L1.phi = prolong(L2, L1); fixEnds(L1); log('level h', L1.n.join('x')); solve(L1.n, L1.fluid, L1.phi, 2400, 1.95)
function fixEnds(L) {
  // the inlet and outlet keep the free stream's potential exactly
  const [nx, ny, nz] = L.n
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
    L.phi[(z * ny + y) * nx] = -MIN[0]
    L.phi[(z * ny + y) * nx + nx - 1] = -(MIN[0] + (nx - 1) * L.f * H)
  }
}
const phi = L1.phi

// 3. velocity = grad phi, one-sided against walls; nodes just inside the car take their air neighbours' mean so
//    lines skim along the skin instead of stalling on it
const vel = new Float32Array(NX * NY * NZ * 3)
for (let z = 0; z < NZ; z++) for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
  const i = idx(x, y, z)
  if (!air[i]) continue
  const d = (a, b, s) => {
    const m = a >= 0 && air[a], p = b >= 0 && air[b]
    if (m && p) return (phi[b] - phi[a]) / (2 * H)
    if (p) return (phi[b] - phi[i]) / H
    if (m) return (phi[i] - phi[a]) / H
    return 0
  }
  vel[i * 3] = d(x > 0 ? i - 1 : -1, x < NX - 1 ? i + 1 : -1)
  vel[i * 3 + 1] = d(y > 0 ? i - NX : -1, y < NY - 1 ? i + NX : -1)
  vel[i * 3 + 2] = d(z > 0 ? i - NX * NY : -1, z < NZ - 1 ? i + NX * NY : -1)
}
for (let pass = 0; pass < 2; pass++) {
  const filled = []
  for (let z = 1; z < NZ - 1; z++) for (let y = 1; y < NY - 1; y++) for (let x = 1; x < NX - 1; x++) {
    const i = idx(x, y, z)
    if (air[i] || vel[i * 3] !== 0 || vel[i * 3 + 1] !== 0 || vel[i * 3 + 2] !== 0) continue
    let c = 0, s0 = 0, s1 = 0, s2 = 0
    for (const j of [i - 1, i + 1, i - NX, i + NX, i - NX * NY, i + NX * NY]) {
      if (vel[j * 3] === 0 && vel[j * 3 + 1] === 0 && vel[j * 3 + 2] === 0) continue
      s0 += vel[j * 3]; s1 += vel[j * 3 + 1]; s2 += vel[j * 3 + 2]; c++
    }
    if (c) filled.push([i, s0 / c, s1 / c, s2 / c])
  }
  for (const [i, a, b, c] of filled) { vel[i * 3] = a; vel[i * 3 + 1] = b; vel[i * 3 + 2] = c }
}
log('velocity')

// the car's own landmarks, read off the solid: the rear wing's top outer corners and the front wing's end plates
// the outermost top corner of each wing, from the solid nodes in its region
function corner(test) {
  let zMax = 0
  const c = []
  for (let z = 0; z < NZ; z++) for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    if (air[idx(x, y, z)]) continue
    const P = { x: MIN[0] + x * H, y: y * H, z: MIN[2] + z * H }
    if (P.z > 0 && test(P)) { c.push(P); if (P.z > zMax) zMax = P.z }
  }
  const edge = c.filter((P) => P.z > zMax - 0.05)
  const yMax = Math.max(...edge.map((P) => P.y))
  const top = edge.filter((P) => P.y > yMax - 0.05)
  return { x: top.reduce((s, P) => s + P.x, 0) / top.length, y: yMax, z: zMax }
}
const rear = corner((P) => P.x < -1.95 && P.y > 0.72)
const front = corner((P) => P.x > 1.65 && P.y < 0.45)
log('rear wing tip', rear, 'front end plate', front)
// 3b. the real flow on top of the potential flow
// signed distance to the bodywork (m): positive in the air, negative inside the car (chamfer transform)
function distanceFrom(seed) {
  const d = new Float32Array(NX * NY * NZ).fill(1e9)
  for (let i = 0; i < d.length; i++) if (seed[i]) d[i] = 0
  const offs = []
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy && !dz) continue
    offs.push([dx, dy, dz, H * Math.hypot(dx, dy, dz)])
  }
  const fwd = offs.filter(([dx, dy, dz]) => dz < 0 || (dz === 0 && (dy < 0 || (dy === 0 && dx < 0))))
  const bwd = offs.filter((o) => !fwd.includes(o))
  for (let pass = 0; pass < 2; pass++) {
    const list = pass === 0 ? fwd : bwd
    const zs = pass === 0 ? [0, NZ, 1] : [NZ - 1, -1, -1], ys = pass === 0 ? [0, NY, 1] : [NY - 1, -1, -1], xs = pass === 0 ? [0, NX, 1] : [NX - 1, -1, -1]
    for (let z = zs[0]; z !== zs[1]; z += zs[2]) for (let y = ys[0]; y !== ys[1]; y += ys[2]) for (let x = xs[0]; x !== xs[1]; x += xs[2]) {
      const i = idx(x, y, z)
      let best = d[i]
      for (const [dx, dy, dz, w] of list) {
        const X = x + dx, Y = y + dy, Z = z + dz
        if (X < 0 || Y < 0 || Z < 0 || X >= NX || Y >= NY || Z >= NZ) continue
        const v = d[idx(X, Y, Z)] + w
        if (v < best) best = v
      }
      d[i] = best
    }
  }
  return d
}
const solidMask = new Uint8Array(air.length), airMask = new Uint8Array(air.length)
for (let i = 0; i < air.length; i++) { solidMask[i] = air[i] ? 0 : 1; airMask[i] = air[i] }
const dOut = distanceFrom(solidMask), dIn = distanceFrom(airMask)
const sdf = new Float32Array(air.length)
for (let i = 0; i < air.length; i++) sdf[i] = air[i] ? dOut[i] : -dIn[i]
log('signed distance')

// wake: how recently, looking upstream, the air passed a body; sharp right behind it, spreading as it goes
const since = new Float32Array(air.length).fill(99)
for (let z = 0; z < NZ; z++) for (let y = 0; y < NY; y++) {
  let last = -1
  for (let x = NX - 1; x >= 0; x--) {
    const i = idx(x, y, z)
    if (!air[i]) { last = x; continue }
    if (last >= 0) since[i] = (last - x) * H
  }
}
const blur = (src, axis, r) => {
  const out = new Float32Array(src.length), st = [1, NX, NX * NY][axis], n = [NX, NY, NZ][axis]
  for (let z = 0; z < NZ; z++) for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    const i = idx(x, y, z), c = [x, y, z][axis]
    let s = 0, k = 0
    for (let j = -r; j <= r; j++) { const q = c + j; if (q < 0 || q >= n) continue; s += src[i + j * st]; k++ }
    out[i] = s / k
  }
  return out
}
let wSharp = new Float32Array(air.length)
for (let i = 0; i < air.length; i++) wSharp[i] = air[i] && since[i] < 3 ? Math.exp(-since[i] / 1.1) : 0
let wWide = wSharp
for (let k = 0; k < 2; k++) { wSharp = blur(blur(wSharp, 1, 1), 2, 1) }
for (let k = 0; k < 3; k++) { wWide = blur(blur(blur(wWide, 1, 3), 2, 3), 0, 1) }
// the wake also spreads sideways and up the further it goes: the sharp wake right behind, the wide one later
const sinceS = blur(blur(since.map((v) => Math.min(v, 3)), 1, 2), 2, 2)
const wake = new Float32Array(air.length)
for (let i = 0; i < air.length; i++) {
  const t = Math.min(1, Math.max(0, sinceS[i] / 1.6))
  wake[i] = air[i] ? Math.min(1, wSharp[i] * (1 - t) + wWide[i] * 1.35 * t) : 0
}
log('wake')

// the wings: where each one is, from its tip
const RW = { x: rear.x + 0.1, y: rear.y - 0.14, span: rear.z, K: 0.055, rc: 0.1 }
const FW = { x: front.x + 0.12, y: 0.2, span: front.z, K: 0.03, rc: 0.08 }
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
for (let z = 0; z < NZ; z++) for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
  const i = idx(x, y, z)
  if (!air[i]) continue
  const P = [MIN[0] + x * H, y * H, MIN[2] + z * H]
  let vx = vel[i * 3], vy = vel[i * 3 + 1], vz = vel[i * 3 + 2]
  // the wake: the air behind a body has lost speed, and right behind a bluff one it turns back on itself
  const w = wake[i]
  const rec = Math.exp(-since[i] / 0.22) * Math.min(1, wSharp[i] * 1.4) * smooth(0.0, 0.05, sdf[i])
  vx = vx * (1 - 0.6 * w) + 0.95 * rec
  vy *= 1 - 0.4 * w; vz *= 1 - 0.4 * w
  // each wing's bound vortex: an inverted wing speeds the air beneath it and throws the flow up behind it
  for (const W of [RW, FW]) {
    const dx = P[0] - W.x, dy = P[1] - W.y, r2 = dx * dx + dy * dy
    const span = smooth(W.span + 0.06, W.span - 0.12, Math.abs(P[2]))
    const k = W.K * span * Math.exp(-Math.sqrt(r2) / 0.9) / (r2 + W.rc * W.rc)
    vx += k * dy; vy += -k * dx
  }
  // and its tip vortices, rolling up behind each tip, sinking and drifting inboard as they go
  for (const [T, g, rc] of [[rear, 0.05, 0.07], [front, 0.03, 0.06]]) for (const sd of [1, -1]) {
    const behind = T.x - P[0]
    if (behind <= 0) continue
    const on = Math.min(1, behind / 0.25) * Math.exp(-behind / 6)
    const cy = T.y - 0.04 * Math.min(behind, 3), cz = sd * (T.z - 0.03 * Math.min(behind, 3))
    const ry = P[1] - cy, rz = P[2] - cz, r2 = ry * ry + rz * rz + 1e-6
    const vt = (g / r2) * (1 - Math.exp(-r2 / (rc * rc))) * on * sd
    vy += -vt * rz; vz += vt * ry
  }
  vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz
}
log('flow model')

// 4. sampling and tracing
const sample = (p, out) => {
  const fx = (p[0] - MIN[0]) / H, fy = (p[1] - MIN[1]) / H, fz = (p[2] - MIN[2]) / H
  if (fx < 0 || fy < 0 || fz < 0 || fx >= NX - 1 || fy >= NY - 1 || fz >= NZ - 1) return false
  const x0 = fx | 0, y0 = fy | 0, z0 = fz | 0, tx = fx - x0, ty = fy - y0, tz = fz - z0
  out[0] = out[1] = out[2] = 0
  for (let c = 0; c < 8; c++) {
    const dx = c & 1, dy = (c >> 1) & 1, dz = c >> 2
    const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz)
    const i = idx(x0 + dx, y0 + dy, z0 + dz) * 3
    out[0] += vel[i] * w; out[1] += vel[i + 1] * w; out[2] += vel[i + 2] * w
  }
  return true
}
const solidAt = (p) => {
  const x = Math.round((p[0] - MIN[0]) / H), y = Math.round((p[1] - MIN[1]) / H), z = Math.round((p[2] - MIN[2]) / H)
  if (x < 0 || y < 0 || z < 0 || x >= NX || y >= NY || z >= NZ) return false
  return !air[idx(x, y, z)]
}
const STEP = 0.02
function trace(seed) {
  const pts = [], sp = []
  let p = seed.slice(), near = 9, under = false, wide = 0
  const v = [0, 0, 0], k = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]
  const dir = (q, o) => { if (!sample(q, v)) return -1; const m = Math.hypot(v[0], v[1], v[2]); if (m < 1e-4) return 0; o[0] = v[0] / m; o[1] = v[1] / m; o[2] = v[2] / m; return m }
  let nudges = 0
  // the air slides over the skin: a line that touches the voxelised bodywork, or stalls at the nose's stagnation
  // point, is lifted off it a little and carries on (a few times at most)
  const lift = () => { for (let t = 0; t < 6; t++) { p[1] += H * 0.5; if (!solidAt(p)) return true } return false }
  for (let n = 0; n < 1400; n++) {
    let m = dir(p, k[0])
    if (m < 0.06 && nudges < 30) { nudges++; if (!lift()) break; m = dir(p, k[0]) }
    if (m < 0.02) break
    pts.push(p[0], p[1], p[2]); sp.push(m)
    const a = [p[0] + k[0][0] * STEP / 2, p[1] + k[0][1] * STEP / 2, p[2] + k[0][2] * STEP / 2]
    if (dir(a, k[1]) <= 0) break
    const b = [p[0] + k[1][0] * STEP / 2, p[1] + k[1][1] * STEP / 2, p[2] + k[1][2] * STEP / 2]
    if (dir(b, k[2]) <= 0) break
    const c = [p[0] + k[2][0] * STEP, p[1] + k[2][1] * STEP, p[2] + k[2][2] * STEP]
    if (dir(c, k[3]) <= 0) break
    for (let j = 0; j < 3; j++) p[j] += STEP / 6 * (k[0][j] + 2 * k[1][j] + 2 * k[2][j] + k[3][j])
    if (p[1] < 0.012) p[1] = 0.012
    if (solidAt(p)) { if (nudges++ > 30 || !lift()) break }
    if (p[0] < MIN[0] + 0.1) break
    // how low and how far sideways it goes alongside the car
    if (Math.abs(p[0]) < 2.4) {
      wide = Math.max(wide, Math.abs(p[2] - seed[2]))
      // any bodywork straight above it: the line is passing under the nose, a wing or the car
      if (!under && n % 3 === 0) {
        const x = Math.round((p[0] - MIN[0]) / H), z = Math.round((p[2] - MIN[2]) / H)
        for (let y = Math.round(p[1] / H) + 1; y < NY; y++) if (!air[idx(x, y, z)]) { under = true; break }
      }
    }
    // how close it comes to the car
    if (Math.abs(p[0]) < 2.6) {
      const x = Math.round((p[0] - MIN[0]) / H), y = Math.round(p[1] / H), z = Math.round((p[2] - MIN[2]) / H)
      for (let r = 1; r <= 4 && r < near / H; r++) {
        let hit = false
        for (let dz = -r; dz <= r && !hit; dz += r) for (let dy = -r; dy <= r && !hit; dy += r) for (let dx = -r; dx <= r && !hit; dx += r) {
          const X = x + dx, Y = y + dy, Z = z + dz
          if (X >= 0 && Y >= 0 && Z >= 0 && X < NX && Y < NY && Z < NZ && !air[idx(X, Y, Z)]) hit = true
        }
        if (hit) { near = Math.min(near, r * H); break }
      }
    }
  }
  return { pts, sp, near, under, wide, end: p[0] }
}

const lines = []
const why = {}
let tried = 0
// which lines to keep (argv[4]):
//   hug:  a few sheets over the top of the car, only the lines that run right along the bodywork
//   top:  a full curtain over the top of the car, from the bodywork to well clear of it
//   full: lines all round the car, over it, down its flanks and round its wheels
const MODE = process.argv[4] || 'around'
const SEEDS = {
  hug: { y: [0.2, 0.96, 0.02], z: [-0.42, 0.42, 0.14], keep: (l) => !l.under && l.wide < 0.3 && l.near <= 0.09 },
  top: { y: [0.2, 0.96, 0.045], z: [-0.5, 0.5, 0.0833], keep: (l) => !l.under && l.wide < 0.35 && l.near <= 0.45 },
  full: { y: [0.05, 1.3, 0.085], z: [-1.1, 1.1, 0.085], keep: (l) => l.near <= 0.12 },
  around: { y: [0.06, 1.1, 0.11], z: [-0.95, 0.95, 0.13], keep: (l) => l.near <= 0.14 },
}[MODE]
for (let y = SEEDS.y[0]; y <= SEEDS.y[1] + 1e-6; y += SEEDS.y[2]) for (let z = SEEDS.z[0]; z <= SEEDS.z[1] + 1e-6; z += SEEDS.z[2]) {
  tried++
  const l = trace([MIN[0] + (NX - 1) * H - 0.15, y, z])
  // kept if it runs all the way through and is the kind of line this mode wants
  if (l.end < -2.4 && l.sp.length > 50 && SEEDS.keep(l)) lines.push(l)
  else (why[[l.end >= -4.5 && 'stopped', l.under && 'under', l.wide >= 0.35 && 'wide', 'near ' + l.near.toFixed(2)].filter(Boolean).join('+') + ' y' + y.toFixed(2)] ??= []).push(z.toFixed(2))
}
if (MODE === 'hug') {
  // in each sheet, lines released close together end up hugging the same stretch of bodywork: keep them apart
  const bySheet = new Map()
  for (const l of lines) { const k = l.pts[2].toFixed(2); if (!bySheet.has(k)) bySheet.set(k, []); bySheet.get(k).push(l) }
  lines.length = 0
  for (const sheet of bySheet.values()) {
    sheet.sort((a, b) => a.pts[1] - b.pts[1])
    let last = -9
    for (const l of sheet) if (l.pts[1] - last >= 0.035) { lines.push(l); last = l.pts[1] }
  }
}
log('traced', tried, 'kept', lines.length)
for (const k of Object.keys(why).sort()) console.log(' ', k, why[k].join(' '))

// 5. write
// every other point (4 cm apart) is plenty for a smooth line
for (const l of lines) {
  const keep = []
  for (let i = 0; i < l.sp.length; i++) if (i % 2 === 0 || i === l.sp.length - 1) keep.push(i)
  l.pts = keep.flatMap((i) => [l.pts[i * 3], l.pts[i * 3 + 1], l.pts[i * 3 + 2]])
  l.sp = keep.map((i) => l.sp[i])
}
const total = lines.reduce((s, l) => s + l.sp.length, 0)
const head = 8 + lines.length * 2, pad = (4 - (head % 4)) % 4
const buf = Buffer.alloc(head + pad + total * 8)
buf.writeUInt32LE(lines.length, 0); buf.writeUInt32LE(total, 4)
lines.forEach((l, i) => buf.writeUInt16LE(l.sp.length, 8 + i * 2))
let o = head + pad
const q = (v, s) => Math.max(-32767, Math.min(32767, Math.round(v * s)))
for (const l of lines) for (let i = 0; i < l.sp.length; i++) {
  buf.writeInt16LE(q(l.pts[i * 3], 4000), o); buf.writeInt16LE(q(l.pts[i * 3 + 1], 4000), o + 2)
  buf.writeInt16LE(q(l.pts[i * 3 + 2], 4000), o + 4); buf.writeInt16LE(q(l.sp[i], 10000), o + 6)
  o += 8
}
writeFileSync(outPath, buf)
{
  // the field for the page: velocity (RGB, -2..2 of the free stream), wake (A), signed distance (int8, cm)
  const h = 0.06, n = [Math.floor(((NX - 1) * H) / h) + 1, Math.floor(((NY - 1) * H) / h) + 1, Math.floor(((NZ - 1) * H) / h) + 1]
  const N2 = n[0] * n[1] * n[2]
  const out = Buffer.alloc(28 + N2 * 5)
  out.write('FLW1', 0, 'ascii')
  out.writeUInt16LE(n[0], 4); out.writeUInt16LE(n[1], 6); out.writeUInt16LE(n[2], 8)
  out.writeFloatLE(MIN[0], 12); out.writeFloatLE(MIN[1], 16); out.writeFloatLE(MIN[2], 20); out.writeFloatLE(h, 24)
  const tri = (arr, stride, ch, X, Y, Z) => {
    const fx = X / H, fy = Y / H, fz = Z / H
    const x0 = Math.min(NX - 2, fx | 0), y0 = Math.min(NY - 2, fy | 0), z0 = Math.min(NZ - 2, fz | 0)
    const tx = fx - x0, ty = fy - y0, tz = fz - z0
    let v = 0
    for (let c = 0; c < 8; c++) {
      const dx = c & 1, dy = (c >> 1) & 1, dz = c >> 2
      v += arr[idx(x0 + dx, y0 + dy, z0 + dz) * stride + ch] * (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz)
    }
    return v
  }
  const q8 = (v) => Math.max(0, Math.min(255, Math.round(((v + 2) / 4) * 255)))
  for (let z = 0; z < n[2]; z++) for (let y = 0; y < n[1]; y++) for (let x = 0; x < n[0]; x++) {
    const j = (z * n[1] + y) * n[0] + x, X = x * h, Y = y * h, Z = z * h
    out[28 + j * 4] = q8(tri(vel, 3, 0, X, Y, Z))
    out[28 + j * 4 + 1] = q8(tri(vel, 3, 1, X, Y, Z))
    out[28 + j * 4 + 2] = q8(tri(vel, 3, 2, X, Y, Z))
    out[28 + j * 4 + 3] = Math.round(Math.min(1, tri(wake, 1, 0, X, Y, Z)) * 255)
    out.writeInt8(Math.max(-127, Math.min(127, Math.round(tri(sdf, 1, 0, X, Y, Z) * 100))), 28 + N2 * 4 + j)
  }
  const gz = gzipSync(out, { level: 9 })
  writeFileSync(outPath.replace(/flow\.bin$/, 'field.bin'), gz)
  log('wrote field', n.join('x'), out.length, 'bytes, gzip', gz.length)
}
log('wrote', outPath, buf.length, 'bytes,', lines.length, 'lines,', total, 'points')
{
  // the speed range the lines see, to set the colour scale
  const all = lines.flatMap((l) => l.sp).sort((a, b) => a - b)
  console.log('speed p5', all[Math.floor(all.length * 0.05)].toFixed(2), 'p50', all[all.length >> 1].toFixed(2), 'p95', all[Math.floor(all.length * 0.95)].toFixed(2), 'max', all[all.length - 1].toFixed(2))
}
