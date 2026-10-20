import * as THREE from 'three'

// The last two corners: the car turns to dust and comes back. A ragged front runs down the car nose to tail; the
// bodywork glows white-hot along it and comes apart into grains as fine as salt, which lift off the surface the
// moment the front passes them, blown back and up, a share of them straight at the lens. They hang, glittering,
// then sweep back round the car in a slow vortex and settle onto it from the tail forward, the car forming behind a bright
// seam as they land.
//
// The grains are sampled off the real surface of the car (area-weighted, so they lie on it evenly), in idle time
// after load. Every grain's flight is worked out in its vertex shader from its resting place and the clock, so
// there is no simulation to run. The car's own materials are patched to fall away (and come back) along the
// same front, so grains and bodywork always agree.

/** Seconds: the front crossing the car, the hang, the front coming back. */
const DISSOLVE = 1.35
const REBUILD_AT = DISSOLVE + 0.25
const REBUILD = 2.0
// the car keeps turning a moment after the last grain lands, then sets down
const END = REBUILD_AT + REBUILD + 0.9
/** fronts run a little past both ends of the car so its very first and last grains go too */
const PAD = 0.08
const front = (t: number, len: number) => -PAD + (1 + 2 * PAD) * Math.min(1, Math.max(0, t / len))

/** How long a full run takes, seconds (the finish card's burnout waits on it). */
export const DUST_LENGTH = END

/** Shared by the grains and every patched car material. */
export const dustUniforms = {
  uDOn: { value: 0 },
  /** the dissolve front (things before it are gone) and the rebuild front (things after it are not back yet) */
  uDA: { value: -1 },
  uDB: { value: 2 },
  uDT: { value: 0 },
  uDMin: { value: new THREE.Vector3() },
  uDSize: { value: new THREE.Vector3(1, 1, 1) },
  /** world to car-rig space (the same matrix the livery uses) */
  uDInv: { value: new THREE.Matrix4() },
}

// where along the run a point of the car sits, 0 at the nose to 1 at the tail, broken up so the front is ragged
// and grainy rather than a clean slice
const sweepGlsl = /* glsl */ `
  uniform float uDOn;
  uniform float uDA;
  uniform float uDB;
  uniform float uDT;
  uniform vec3 uDMin;
  uniform vec3 uDSize;
  float dHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float dNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(dHash(i), dHash(i + vec3(1, 0, 0)), f.x), mix(dHash(i + vec3(0, 1, 0)), dHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(dHash(i + vec3(0, 0, 1)), dHash(i + vec3(1, 0, 1)), f.x), mix(dHash(i + vec3(0, 1, 1)), dHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float dSweep(vec3 p) {
    float x = 1.0 - (p.x - uDMin.x) / uDSize.x;
    return x * 0.8 + dNoise(p * 2.7) * 0.13 + dNoise(p * 31.0) * 0.07;
  }
`

/** Teach every material on the car to fall away and come back along the front. Call once the livery has been
 *  applied (it chains onto whatever onBeforeCompile is already there). */
export function patchDissolve(root: THREE.Object3D) {
  const seen = new Set<THREE.Material>()
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      // patched already, and still is (the livery may have been put back on since, in development double runs)
      if (seen.has(mat) || (mat.userData.dust && mat.onBeforeCompile === mat.userData.dust)) continue
      seen.add(mat)
      const prev = mat.onBeforeCompile.bind(mat)
      // taken now: the default key is the onBeforeCompile source, which is about to become this wrapper's
      const prevKey = mat.customProgramCacheKey()
      mat.onBeforeCompile = (shader, renderer) => {
        prev(shader, renderer)
        Object.assign(shader.uniforms, dustUniforms)
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform mat4 uDInv;\nvarying vec3 vDP;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvDP = (uDInv * (modelMatrix * vec4(transformed, 1.0))).xyz;')
        const lit = shader.fragmentShader.includes('#include <emissivemap_fragment>')
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vDP;\n' + sweepGlsl)
          .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          float dEdge = 0.0;
          if (uDOn > 0.5) {
            float ds = dSweep(vDP);
            if (ds < uDA || ds > uDB) discard;
            // white-hot just ahead of the dissolve, and just behind the rebuild as the surface forms
            dEdge = max(1.0 - smoothstep(0.0, 0.025, ds - uDA), 1.0 - smoothstep(0.0, 0.035, uDB - ds));
          }`)
        if (lit) {
          shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
            '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.78, 0.86, 1.0) * dEdge * dEdge * 2.4;')
        }
      }
      mat.userData.dust = mat.onBeforeCompile
      // its own program, not one shared with an unpatched material of the same kind
      mat.customProgramCacheKey = () => 'dust|' + prevKey
      mat.needsUpdate = true
    }
  })
}

const grainVert = /* glsl */ `
  attribute vec3 aN;
  attribute vec4 aCol;
  attribute float aSeed;
  uniform vec3 uPaint;
  uniform vec3 uCam;
  uniform vec3 uCentre;
  uniform float uScale;
  uniform float uRb;
  varying vec3 vCol;
  varying float vA;
  ${sweepGlsl}
  void main() {
    float s = dSweep(position);
    // released when the dissolve front passes; it has been flying for this long
    float tr = (s + ${PAD.toFixed(3)}) / ${(1 + 2 * PAD).toFixed(3)} * ${DISSOLVE.toFixed(3)};
    float age = uDT - tr;
    vec3 r3 = vec3(fract(aSeed * 91.7), fract(aSeed * 53.3), fract(aSeed * 27.1)) - 0.5;
    float far = 1.0 - exp(-max(age, 0.0) * 1.7);
    // off the surface, blown back and up, a few of them straight at the lens
    vec3 toCam = uCam - position;
    float camDist = length(toCam);
    toCam /= camDist;
    vec3 dir = normalize(aN * 0.55 + vec3(-0.95, 0.22, 0.0) + r3 * 1.35);
    float lens = step(0.86, fract(aSeed * 13.7));
    vec3 p = position + dir * (0.4 + fract(aSeed * 7.3) * 1.9) * far + vec3(-0.38, 0.04, 0.0) * max(age, 0.0);
    p += toCam * lens * camDist * (0.22 + 0.3 * fract(aSeed * 3.1)) * far;
    // and stirred, like dust in a draught
    float a = max(age, 0.0);
    p += 0.16 * far * vec3(sin(a * 1.7 + aSeed * 40.0 + position.z * 3.0), sin(a * 1.3 + aSeed * 25.0 + position.x * 2.0), cos(a * 1.5 + aSeed * 33.0 + position.y * 4.0));
    // coming home: a slow vortex round the car that tightens onto the surface as the rebuild front reaches it
    // the rebuild front runs back up the car from the tail, so it reaches the last grains to leave first: the
    // same dust turns round and builds the car again, back to front
    float k = uRb > 0.5 ? 1.0 - smoothstep(s - 0.01, s + 0.13, uDA) : 0.0;
    float kk = k * k * (3.0 - 2.0 * k);
    float ang = sin(3.14159 * kk) * (1.1 + fract(aSeed * 5.1) * 0.9) * uRb;
    vec3 q = p - uCentre;
    float c = cos(ang), sn = sin(ang);
    q = vec3(c * q.x - sn * q.z, q.y, sn * q.x + c * q.z);
    p = mix(uCentre + q, position, kk);
    bool shown = uDOn > 0.5 && age > 0.0 && k < 0.995;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = shown ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
    float px = 0.0055 * uScale / max(0.2, -mv.z) * (0.55 + fract(aSeed * 5.7) * 0.9);
    gl_PointSize = clamp(px, 1.0, 9.0);
    // salt: its own colour, lifted, lit from above; it glitters as it tumbles, flashes as it lets go and as it lands
    vec3 base = aCol.a > 0.5 ? uPaint : aCol.rgb;
    base = mix(base, vec3(0.8, 0.82, 0.86), 0.26);
    float light = 0.22 + 0.6 * max(0.0, dot(normalize(aN + r3 * 0.6), normalize(vec3(0.2, 1.0, 0.3))));
    float glint = pow(max(0.0, sin(uDT * (5.0 + fract(aSeed * 17.0) * 11.0) + aSeed * 61.0)), 28.0);
    float hot = exp(-max(age, 0.0) * 4.5);
    float land = smoothstep(0.7, 0.97, k) * (1.0 - smoothstep(0.97, 0.995, k));
    vCol = base * light + vec3(1.0) * glint * 1.9 + vec3(0.85, 0.92, 1.15) * (hot * 1.0 + land * 1.6);
    vA = (px < 1.0 ? max(0.35, px) : 1.0) * 0.85;
  }
`
const grainFrag = /* glsl */ `
  varying vec3 vCol;
  varying float vA;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    if (dot(c, c) > 0.25) discard;
    gl_FragColor = vec4(vCol, vA);
  }
`

export type Dust = {
  points: THREE.Points
  mat: THREE.ShaderMaterial
  ready: boolean
  /** seconds into the run, or -1 */
  t: number
  queued: boolean
  hurry: boolean
  /** 0..1, how much of the car is gone (the contact shadow and the car's own shadows follow it) */
  k: number
  stop: () => void
}

/** Sample the car's surface into grains, in idle time; the returned Dust is ready once `ready` is true. */
export function buildDust(model: THREE.Object3D, rigInv: THREE.Matrix4, paint: THREE.Material, count: number): Dust {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...dustUniforms,
      uPaint: { value: new THREE.Color() },
      uCam: { value: new THREE.Vector3() },
      uCentre: { value: new THREE.Vector3() },
      uScale: { value: 800 },
      uRb: { value: 0 },
    },
    vertexShader: grainVert, fragmentShader: grainFrag,
    transparent: true, depthWrite: false, toneMapped: false,
  })
  const geo = new THREE.BufferGeometry()
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  points.visible = false
  points.renderOrder = 7
  const dust: Dust = { points, mat, ready: false, t: -1, queued: false, hurry: false, k: 0, stop: () => {} }

  // every mesh, its triangles, in rig space
  model.updateWorldMatrix(true, true)
  // the model is quantised and interleaved (meshopt): read its typed arrays straight, which is many times quicker
  // than going through the attribute accessors for two and a half million triangles
  type Src = { arr: ArrayLike<number>; stride: number; off: number; k: number }
  const src = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined): Src | null => {
    if (!attr) return null
    const il = (attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute
    const arr = il ? (attr as THREE.InterleavedBufferAttribute).data.array : attr.array
    const stride = il ? (attr as THREE.InterleavedBufferAttribute).data.stride : attr.itemSize
    const off = il ? (attr as THREE.InterleavedBufferAttribute).offset : 0
    const k = !attr.normalized ? 1 : arr instanceof Int8Array ? 1 / 127 : arr instanceof Uint8Array ? 1 / 255 : arr instanceof Int16Array ? 1 / 32767 : arr instanceof Uint16Array ? 1 / 65535 : 1
    return { arr, stride, off, k }
  }
  type M = { p: Src; nrm: Src | null; idx: ArrayLike<number> | null; tris: number; m: THREE.Matrix4; nm: THREE.Matrix3; scale2: number; col: THREE.Color; paint: boolean; area: number }
  const meshes: M[] = []
  model.traverse((o) => {
    const mesh = o as THREE.Mesh
    const pa = mesh.isMesh ? src(mesh.geometry.getAttribute('position') as THREE.BufferAttribute) : null
    if (!pa) return
    const m = new THREE.Matrix4().multiplyMatrices(rigInv, mesh.matrixWorld)
    const mm = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    const c = (mm as THREE.MeshStandardMaterial).color
    const g = mesh.geometry
    meshes.push({
      p: pa, nrm: src(g.getAttribute('normal') as THREE.BufferAttribute), idx: g.index ? g.index.array : null,
      tris: (g.index ? g.index.count : g.getAttribute('position').count) / 3,
      m, nm: new THREE.Matrix3().getNormalMatrix(m), scale2: Math.pow(Math.abs(m.determinant()), 2 / 3),
      col: c ? c.clone() : new THREE.Color(0.2, 0.2, 0.2), paint: mm === paint, area: 0,
    })
  })
  const V = new Float32Array(9)
  const corners = (M: M, f: number) => {
    const { arr, stride, off, k } = M.p
    for (let j = 0; j < 3; j++) {
      const v = M.idx ? M.idx[f * 3 + j] : f * 3 + j
      const o = v * stride + off
      V[j * 3] = arr[o] * k; V[j * 3 + 1] = arr[o + 1] * k; V[j * 3 + 2] = arr[o + 2] * k
    }
  }
  const triArea = () => {
    const bx = V[3] - V[0], by = V[4] - V[1], bz = V[5] - V[2], cx = V[6] - V[0], cy = V[7] - V[1], cz = V[8] - V[2]
    return 0.5 * Math.hypot(by * cz - bz * cy, bz * cx - bx * cz, bx * cy - by * cx)
  }
  // each mesh's area, estimated from a sample of its triangles: enough to share the grains out fairly
  let totalArea = 0
  for (const M of meshes) {
    const step = Math.max(1, Math.floor(M.tris / 1500))
    let sum = 0, cnt = 0
    for (let f = 0; f < M.tris; f += step) { corners(M, f); sum += triArea(); cnt++ }
    M.area = (sum / Math.max(1, cnt)) * M.tris * M.scale2
    totalArea += M.area
  }
  const density = count / Math.max(1e-6, totalArea)
  const cap = Math.ceil(count * 1.2)
  const pos = new Float32Array(cap * 3), nor = new Int8Array(cap * 3), col = new Uint8Array(cap * 4), seed = new Float32Array(cap)
  let n = 0
  const pa = new THREE.Vector3(), pn = new THREE.Vector3()
  const N = new Float32Array(9)
  const emit = (M: M, f: number, want: number) => {
    if (M.nrm) {
      const { arr, stride, off, k } = M.nrm
      for (let j = 0; j < 3; j++) {
        const v = M.idx ? M.idx[f * 3 + j] : f * 3 + j
        const o = v * stride + off
        N[j * 3] = arr[o] * k; N[j * 3 + 1] = arr[o + 1] * k; N[j * 3 + 2] = arr[o + 2] * k
      }
    }
    for (let j = 0; j < want && n < cap; j++) {
      let u = Math.random(), v = Math.random()
      if (u + v > 1) { u = 1 - u; v = 1 - v }
      const w = 1 - u - v
      pa.set(V[0] * w + V[3] * u + V[6] * v, V[1] * w + V[4] * u + V[7] * v, V[2] * w + V[5] * u + V[8] * v).applyMatrix4(M.m)
      if (M.nrm) pn.set(N[0] * w + N[3] * u + N[6] * v, N[1] * w + N[4] * u + N[7] * v, N[2] * w + N[5] * u + N[8] * v).applyMatrix3(M.nm).normalize()
      else pn.set(0, 1, 0)
      const i3 = n * 3, i4 = n * 4
      pos[i3] = pa.x; pos[i3 + 1] = pa.y; pos[i3 + 2] = pa.z
      nor[i3] = Math.round(pn.x * 127); nor[i3 + 1] = Math.round(pn.y * 127); nor[i3 + 2] = Math.round(pn.z * 127)
      col[i4] = Math.round(M.col.r * 255); col[i4 + 1] = Math.round(M.col.g * 255); col[i4 + 2] = Math.round(M.col.b * 255); col[i4 + 3] = M.paint ? 255 : 0
      seed[n] = Math.random()
      n++
    }
  }
  // one pass over every triangle, in slices that leave the frames alone
  let alive = true
  let mi = 0, f = 0
  const work = () => {
    if (!alive) return
    const until = performance.now() + 9
    while (performance.now() < until) {
      if (mi >= meshes.length) { finish(); return }
      const M = meshes[mi]
      const stop = Math.min(M.tris, f + 6000)
      for (; f < stop; f++) {
        corners(M, f)
        const want = triArea() * M.scale2 * density
        const k = Math.floor(want) + (Math.random() < want - Math.floor(want) ? 1 : 0)
        if (k) emit(M, f, k)
      }
      if (f >= M.tris) { mi++; f = 0 }
    }
    schedule()
  }
  const ch = new MessageChannel()
  ch.port1.onmessage = work
  const schedule = () => ch.port2.postMessage(0)
  const finish = () => {
    ch.port1.onmessage = null
    geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, n * 3), 3))
    geo.setAttribute('aN', new THREE.BufferAttribute(nor.subarray(0, n * 3), 3, true))
    geo.setAttribute('aCol', new THREE.BufferAttribute(col.subarray(0, n * 4), 4, true))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed.subarray(0, n), 1))
    geo.setDrawRange(0, n)
    dust.ready = true
  }
  schedule()
  dust.stop = () => { alive = false }
  return dust
}

const tumbleEuler = new THREE.Euler()
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
/** The car's turn in the air while it re-forms, in its own space: a full barrel roll along its length (top,
 *  flank, underside, the other flank) with a sway either way that shows the nose and the tail, never standing
 *  on end, ending exactly where it began. */
export function dustTumble(d: Dust, q: THREE.Quaternion) {
  if (d.t < REBUILD_AT) return q.identity()
  const e = easeInOut(Math.min(1, (d.t - REBUILD_AT) / (END - REBUILD_AT)))
  return q.setFromEuler(tumbleEuler.set(Math.PI * 2 * e, 0.5 * Math.sin(Math.PI * 2 * e), 0.18 * Math.sin(Math.PI * 4 * e), 'YXZ'))
}

/** Turn the car to dust now (the grains must be ready; a run already going queues this one). */
export function playDust(d: Dust) {
  if (!d.ready) return
  if (d.t >= 0) { d.queued = true; return }
  d.t = 0
  d.hurry = false
}

/** Cut it short: the car comes straight back. */
export function hurryDust(d: Dust) {
  if (d.t < 0 || d.hurry) return
  d.hurry = true
  d.queued = false
}

/** One frame. `cam` is the camera in rig space, `scale` the pixels per unit at one metre. */
export function driveDust(d: Dust, dt: number, cam: THREE.Vector3, scale: number, paint: THREE.Color, centre: THREE.Vector3) {
  const U = dustUniforms
  const off = () => { U.uDOn.value = 0; U.uDA.value = -1; U.uDB.value = 2; d.points.visible = false }
  if (d.t < 0) { d.k = Math.max(0, d.k - dt * 2.5); off(); return }
  // cut short before the rebuild has started: jump to it, quickly
  if (d.hurry && d.t < REBUILD_AT) d.t = REBUILD_AT
  d.t += d.hurry ? dt * 2.2 : dt
  const t = d.t
  U.uDOn.value = 1
  U.uDT.value = t
  // one front: down the car taking it apart, then back up it from the tail putting it together (what is on the
  // nose side of it is gone)
  U.uDA.value = t < REBUILD_AT ? front(t, DISSOLVE) : 1.16 - (1.16 + PAD) * Math.min(1, (t - REBUILD_AT) / REBUILD)
  U.uDB.value = 2
  const u = d.mat.uniforms
  u.uRb.value = t >= REBUILD_AT ? 1 : 0
  u.uCam.value.copy(cam)
  u.uScale.value = scale
  u.uPaint.value.copy(paint)
  u.uCentre.value.copy(centre)
  d.points.visible = true
  const gone = t < REBUILD_AT ? Math.min(1, t / DISSOLVE) : 1 - Math.min(1, (t - REBUILD_AT) / REBUILD)
  d.k += (gone - d.k) * Math.min(1, dt * 6)
  if (t >= END) { d.t = -1; off() }
}
