import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { GPUComputationRenderer, type Variable } from 'three/examples/jsm/misc/GPUComputationRenderer.js'
import { carRig } from '../Car'
import { drive, fx } from '../fx'
import { store, useStore } from '../store'
import { fieldUniforms, flowGlsl, loadField } from './flow'

// Airflow over the car: smoke-rake streamlines of fine particles. Seeds at five heights upstream of the nose
// (front wing and floor, wheels and sidepods, bodywork, cockpit, airbox and rear wing) each emit a steady stream;
// every particle is advected on the GPU through the airflow (flow.ts). Each is drawn as a soft streak of constant
// pixel width along its velocity, bright at the head and fading to nothing at the tail, so the streams read as
// smooth filaments and never shimmer.
// It plays by itself while the car is parked on the Jobs corner, and in full (studio dimmed, rolling road
// running) whenever the wind tunnel is switched on (W).

const FINE = typeof matchMedia !== 'undefined' && matchMedia('(min-width: 900px) and (pointer: fine)').matches
const W = FINE ? 384 : 192
const H = FINE ? 224 : 128
const HEIGHTS = [0.1, 0.3, 0.5, 0.68, 0.86]
const ROWS = HEIGHTS.length
const COLS = 26
const X_SPAWN = 3.3
const X_GONE = -3.9
/** tunnel air speed, scene metres per second: slow enough to read the flow */
const SPEED = 2.6
/** steps run up front so the streams are fully formed, spread over a few frames */
const WARM = 300

// The smoke rake: wands upstream of the car, each letting out a puff every D seconds. A wand's puffs, joined in
// the order they left it, are one continuous smoke line (a streakline, which is what a real tunnel shows): it
// hugs the nose, splits over the halo, races under the floor, rolls up into spirals off the wing tips and comes
// apart in the wake. Rows at seven heights across the car, and small clusters right where the vortices are born.
const P = 72
const D = 0.05
const T = P * D
const RAKE_Y = [0.1, 0.28, 0.48, 0.66, 0.86]
const RAKE_Z = 12
const TIPS: [number, number][] = [[0.22, 0.84], [0.2, 0.24], [0.84, 0.5], [0.62, 0.78]]
const WANDS: THREE.Vector3[] = []
for (const y of RAKE_Y) for (let c = 0; c < RAKE_Z; c++) WANDS.push(new THREE.Vector3(X_SPAWN, y, -0.86 + (1.72 * (c + 0.5)) / RAKE_Z))
for (const [y, z] of TIPS) for (const side of [1, -1]) for (let k = 0; k < 3; k++) WANDS.push(new THREE.Vector3(X_SPAWN, y + (k - 1) * 0.018, side * (z + (k - 1) * 0.014)))
const S = WANDS.length

const smokeSim = /* glsl */ `
  uniform float uDt;
  uniform vec3 uWands[${S}];
  ${flowGlsl}
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 s = texture2D(tSmoke, uv);
    float j = floor(gl_FragCoord.x), w = floor(gl_FragCoord.y);
    // each puff's age on one clock, so a wand's puffs stay evenly spaced and in order along its line
    float age = mod(uTime - j * ${D.toFixed(3)}, ${T.toFixed(3)});
    vec3 p = s.xyz;
    if (age < s.w || s.w < 0.0) {
      // let out again at its wand
      p = uWands[int(w)] - vec3(${SPEED.toFixed(2)} * age, 0.0, 0.0);
    } else {
      float wk, pr;
      vec3 k1 = flow(p, wk, pr);
      vec3 k2 = flow(p + k1 * uDt * 0.5, wk, pr);
      p += k2 * uDt;
      float d = dist(p);
      if (d < 0.02) p += normalAt(p) * (0.02 - d);
    }
    gl_FragColor = vec4(p, age);
  }
`
const smokeVert = /* glsl */ `
  attribute vec2 aSeg;
  attribute vec2 corner;
  uniform sampler2D tSmoke;
  uniform float uOn;
  uniform vec2 uRes;
  uniform float uWidth;
  varying vec3 vCol;
  varying float vA;
  varying vec2 vC;
  void main() {
    vec2 px = vec2(1.0 / ${P.toFixed(1)}, 1.0 / ${S.toFixed(1)});
    vec4 a = texture2D(tSmoke, (aSeg + 0.5) * px);
    vec4 b = texture2D(tSmoke, (aSeg + vec2(1.5, 0.5)) * px);
    // puff j left one beat before j + 1: joined only if they are neighbours on the line (not across the wrap)
    float gap = a.w - b.w;
    float seg = length(a.xyz - b.xyz);
    bool ok = gap > 0.0 && gap < ${(D * 1.5).toFixed(3)} && seg < 0.7;
    mat4 mvp = projectionMatrix * modelViewMatrix;
    vec4 ca = mvp * vec4(a.xyz, 1.0);
    vec4 cb = mvp * vec4(b.xyz, 1.0);
    vec2 sa = ca.xy / ca.w * uRes, sb = cb.xy / cb.w * uRes;
    vec2 dir = sb - sa;
    dir = length(dir) > 1e-3 ? normalize(dir) : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    vec4 c = mix(ca, cb, corner.x);
    // smoke spreads as it ages: a fine thread at the wand, a soft band in the wake
    float age = mix(a.w, b.w, corner.x);
    c.xy += nrm * corner.y * uWidth * (1.0 + 1.6 * age / ${T.toFixed(2)}) / uRes * c.w;
    gl_Position = ok ? c : vec4(2.0, 2.0, 2.0, 1.0);
    vC = corner;
    // the air's speed from how far apart the puffs have drawn: dim where it is slow, bright where it races
    float sp = seg / (${SPEED.toFixed(2)} * ${D.toFixed(3)});
    vCol = mix(vec3(0.42, 0.52, 0.72), vec3(0.78, 0.9, 1.0), smoothstep(0.4, 1.0, sp));
    vCol = mix(vCol, vec3(1.05, 1.08, 1.12), smoothstep(1.05, 1.5, sp));
    float x = mix(a.x, b.x, corner.x);
    float life = smoothstep(0.0, 0.25, age) * (1.0 - smoothstep(${(T - 0.6).toFixed(2)}, ${T.toFixed(2)}, age)) * smoothstep(${X_GONE.toFixed(2)}, ${(X_GONE + 1.8).toFixed(2)}, x);
    // where the puffs have pulled apart the line has broken up: it fades into the wake instead of zigzagging
    float whole = 1.0 - smoothstep(1.2, 1.75, sp);
    vA = life * whole * smoothstep(0.6, 2.2, ca.w) * uOn * (1.0 - 0.6 * age / ${T.toFixed(2)});
  }
`
const smokeFrag = /* glsl */ `
  varying vec3 vCol;
  varying float vA;
  varying vec2 vC;
  void main() {
    float a = exp(-vC.y * vC.y * 3.2) * vA * 0.17;
    if (a < 0.002) discard;
    gl_FragColor = vec4(vCol * a, 1.0);
  }
`

const simGlsl = /* glsl */ `
  uniform float uDt;
  uniform float uHeights[${ROWS}];
  ${flowGlsl}
  float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  vec3 seed(vec2 uv, float gen) {
    // each particle belongs to one rake seed for life, so the seed's stream is one filament
    float id = floor(h12(uv * 913.7) * ${(ROWS * COLS).toFixed(1)});
    float row = floor(id / ${COLS.toFixed(1)});
    float col = id - row * ${COLS.toFixed(1)};
    // a little fixed scatter per seed, so a rake never reads as a ruler-straight row
    float y = uHeights[int(row)] + (h12(vec2(id, 1.7)) - 0.5) * 0.05;
    float z = -1.15 + 2.3 * (col + 0.5 + (h12(vec2(id, 5.3)) - 0.5) * 0.5) / ${COLS.toFixed(1)};
    vec3 j = vec3(h12(uv + gen * 1.7), h12(uv * 3.1 + gen), h12(uv * 7.3 - gen)) - 0.5;
    return vec3(${X_SPAWN.toFixed(2)} + j.x * 0.06, y + j.y * 0.0016, z + j.z * 0.0016);
  }
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 s = texture2D(tPos, uv);
    vec3 p = s.xyz;
    float age = s.w;
    float wk, pr;
    // two-step (midpoint) integration so the streams follow the curves cleanly
    vec3 k1 = flow(p, wk, pr);
    vec3 k2 = flow(p + k1 * uDt * 0.5, wk, pr);
    p += k2 * uDt;
    float d = dist(p);
    if (d < 0.024) p += normalAt(p) * (0.024 - d);
    age += uDt;
    bool gone = p.x < ${X_GONE.toFixed(2)} || abs(p.z) > 2.6 || p.y > 2.2 || p.y < -0.05 || age > 9.0;
    if (gone) { p = seed(uv, floor(uTime * 7.0 + h12(uv) * 50.0)); age = 0.0; }
    gl_FragColor = vec4(p, age);
  }
`

const streakVert = /* glsl */ `
  attribute vec2 aRef;
  attribute vec2 corner;
  uniform sampler2D tPos;
  uniform float uOn;
  uniform vec2 uRes;
  uniform float uWidth;
  varying vec3 vCol;
  varying float vA;
  varying vec2 vC;
  ${flowGlsl}
  void main() {
    vec4 s = texture2D(tPos, aRef);
    vec3 p = s.xyz;
    float wk, pr;
    vec3 v = flow(p, wk, pr);
    float sp = length(v);
    // the streak runs back along the velocity: longer where the air is fast
    vec3 tail = p - (v / max(sp, 1e-4)) * (0.04 + 0.12 * sp * sp);
    mat4 mvp = projectionMatrix * modelViewMatrix;
    vec4 ch = mvp * vec4(p, 1.0);
    vec4 ct = mvp * vec4(tail, 1.0);
    // a quad of constant pixel width, laid along the streak on screen
    vec2 sh = ch.xy / ch.w * uRes, st = ct.xy / ct.w * uRes;
    vec2 dir = st - sh;
    dir = length(dir) > 1e-3 ? normalize(dir) : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    vec4 c = mix(ch, ct, corner.x);
    c.xy += nrm * corner.y * uWidth / uRes * c.w;
    gl_Position = c;
    vC = corner;
    // one cool family: deep blue where the air is slow, cyan in the free stream, white where it races
    vec3 slow = vec3(0.10, 0.20, 0.70);
    vec3 free = vec3(0.30, 0.66, 1.0);
    vec3 fast = vec3(0.85, 0.95, 1.0);
    vCol = mix(mix(slow, free, smoothstep(0.35, 0.95, sp)), fast, smoothstep(1.05, 1.45, sp));
    // streams come out of the dark ahead of the nose and die away behind the car
    float life = smoothstep(0.0, 1.0, s.w) * smoothstep(${X_GONE.toFixed(2)}, ${(X_GONE + 1.6).toFixed(2)}, p.x);
    float near = smoothstep(0.6, 2.2, ch.w);
    // the air that touches the car carries the picture: bright close to the bodywork, faint in the far field
    float hug = 0.08 + 0.92 * (1.0 - smoothstep(0.05, 0.6, dist(p)));
    vA = life * near * hug * uOn;
    if (!(vA == vA)) vA = 0.0;
  }
`
const streakFrag = /* glsl */ `
  varying vec3 vCol;
  varying float vA;
  varying vec2 vC;
  void main() {
    // soft across, bright at the head, fading to nothing at the tail
    float a = exp(-vC.y * vC.y * 2.6) * pow(clamp(1.0 - vC.x, 0.0, 1.0), 1.6) * vA * 0.02;
    if (a < 0.0008) discard;
    gl_FragColor = vec4(vCol * a, 1.0);
  }
`

export function WindTunnel() {
  const on = useStore((s) => s.tunnel)
  const chapter = useStore((s) => s.chapter)
  const loaded = useStore((s) => s.loaded)
  const { gl, scene, size, camera } = useThree()
  const group = useRef<THREE.Group>(null)
  const sim = useRef<{ gpu: GPUComputationRenderer; pos: Variable; smoke: GPUComputationRenderer; puffs: Variable; warm: number } | null>(null)
  const tunnel = useRef(0)
  const shown = useRef(0)
  const shared = useMemo(fieldUniforms, [])

  const streaks = useMemo(() => {
    const n = W * H
    const g = new THREE.InstancedBufferGeometry()
    // one quad, head (x = 0) to tail (x = 1), across from -1 to 1
    g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([0, -1, 1, -1, 1, 1, 0, 1]), 2))
    g.setIndex([0, 1, 2, 0, 2, 3])
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3))
    const ref = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) { ref[i * 2] = ((i % W) + 0.5) / W; ref[i * 2 + 1] = (Math.floor(i / W) + 0.5) / H }
    g.setAttribute('aRef', new THREE.InstancedBufferAttribute(ref, 2))
    g.instanceCount = n
    const m = new THREE.ShaderMaterial({
      uniforms: { ...shared, tPos: { value: null }, uOn: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uWidth: { value: 1.2 } },
      vertexShader: streakVert, fragmentShader: streakFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    })
    const mesh = new THREE.Mesh(g, m)
    mesh.frustumCulled = false
    mesh.renderOrder = 6
    // seen by the camera only, not mirrored in the floor
    mesh.layers.set(1)
    return mesh
  }, [shared])

  const lines = useMemo(() => {
    const n = S * (P - 1)
    const g = new THREE.InstancedBufferGeometry()
    g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([0, -1, 1, -1, 1, 1, 0, 1]), 2))
    g.setIndex([0, 1, 2, 0, 2, 3])
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3))
    const seg = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) { seg[i * 2] = i % (P - 1); seg[i * 2 + 1] = Math.floor(i / (P - 1)) }
    g.setAttribute('aSeg', new THREE.InstancedBufferAttribute(seg, 2))
    g.instanceCount = n
    const m = new THREE.ShaderMaterial({
      uniforms: { tSmoke: { value: null }, uOn: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uWidth: { value: 1.3 } },
      vertexShader: smokeVert, fragmentShader: smokeFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    })
    const mesh = new THREE.Mesh(g, m)
    mesh.frustumCulled = false
    mesh.renderOrder = 7
    mesh.layers.set(1)
    return mesh
  }, [])

  // built ahead of time, while the garage is still opening, so nothing it compiles lands in a drive
  const wanted = on || loaded
  useEffect(() => {
    if (!wanted || sim.current) return
    let alive = true
    loadField().then((tex) => {
      if (!alive) return
      shared.uField.value = tex
      const gpu = new GPUComputationRenderer(W, H, gl)
      const init = gpu.createTexture()
      const a = init.image.data as unknown as Float32Array
      // start every particle somewhere along its seed's line, already spread through the tunnel, ages staggered
      for (let i = 0; i < W * H; i++) {
        const id = Math.floor(Math.random() * ROWS * COLS)
        const row = Math.floor(id / COLS), col = id % COLS
        a[i * 4] = X_GONE + Math.random() * (X_SPAWN - X_GONE)
        a[i * 4 + 1] = HEIGHTS[row]
        a[i * 4 + 2] = -1.15 + (2.3 * (col + 0.5)) / COLS
        a[i * 4 + 3] = Math.random() * 2.5
      }
      const pos = gpu.addVariable('tPos', simGlsl, init)
      gpu.setVariableDependencies(pos, [pos])
      Object.assign(pos.material.uniforms, shared, { uDt: { value: (1 / 60) * SPEED }, uHeights: { value: HEIGHTS } })
      pos.wrapS = pos.wrapT = THREE.ClampToEdgeWrapping
      const err = gpu.init()
      if (err) { console.warn('wind tunnel:', err); return }
      // the smoke rake: one row of puffs per wand, all starting at their wands
      const smoke = new GPUComputationRenderer(P, S, gl)
      const sInit = smoke.createTexture()
      const sa = sInit.image.data as unknown as Float32Array
      for (let w = 0; w < S; w++) for (let j = 0; j < P; j++) { const i = (w * P + j) * 4; sa[i] = WANDS[w].x; sa[i + 1] = WANDS[w].y; sa[i + 2] = WANDS[w].z; sa[i + 3] = -1 }
      const puffs = smoke.addVariable('tSmoke', smokeSim, sInit)
      smoke.setVariableDependencies(puffs, [puffs])
      Object.assign(puffs.material.uniforms, shared, { uDt: { value: (1 / 60) * SPEED }, uWands: { value: WANDS } })
      const err2 = smoke.init()
      if (err2) { console.warn('wind tunnel smoke:', err2); return }
      // the flow shaders are big: compiled on the GPU's own time (parallel shader compile), not in a frame, so
      // the drive into the corner never stalls on them. The sim only starts once they are ready.
      // Both are drawn into render targets (the sim's own, and the post-processing chain), and three keys a
      // program on where it draws, so they are compiled with a render target bound or the key would not match.
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), pos.material)
      const quad2 = new THREE.Mesh(quad.geometry, puffs.material)
      const rt = new THREE.WebGLRenderTarget(1, 1)
      const prev = gl.getRenderTarget()
      gl.setRenderTarget(rt)
      const ready = Promise.all([gl.compileAsync(quad, new THREE.Camera()), gl.compileAsync(quad2, new THREE.Camera()), gl.compileAsync(streaks, camera, scene), gl.compileAsync(lines, camera, scene)])
      gl.setRenderTarget(prev)
      ready.then(() => {
        quad.geometry.dispose()
        rt.dispose()
        if (alive) sim.current = { gpu, pos, smoke, puffs, warm: 0 }
      })
    })
    return () => { alive = false }
  }, [wanted, gl, shared, streaks, lines, camera, scene])

  useFrame((_, dt) => {
    const s = sim.current
    // warm the streams up a few steps a frame, so nothing stalls
    if (s && s.warm < WARM) {
      s.pos.material.uniforms.uDt.value = (1 / 60) * SPEED
      s.puffs.material.uniforms.uDt.value = (1 / 60) * SPEED
      for (let i = 0; i < 25 && s.warm < WARM; i++, s.warm++) { shared.uTime.value = s.warm / 60; s.gpu.compute(); s.smoke.compute() }
    }
    const ready = !!s && s.warm >= WARM
    // the flow is computed round the assembled car, so it steps aside while the car is pulled apart
    const assembled = fx.explode < 0.02
    tunnel.current = THREE.MathUtils.damp(tunnel.current, on && ready && assembled ? 1 : 0, on ? 2.2 : 3.5, dt)
    // parked on the Jobs corner, the air streams over the car on its own
    const jobs = chapter === 3 && store.get().hold && ready && assembled
    shown.current = THREE.MathUtils.damp(shown.current, Math.max(tunnel.current, jobs ? 1 : 0), jobs ? 1.8 : 3, dt)
    const k = tunnel.current
    fx.tunnel = k
    // the tunnel proper: the studio dims and the rolling road and the wheels run
    scene.environmentIntensity = 1.4 * (1 - 0.5 * k)
    drive.dist += k * 0.55 * 30 * dt
    const g = group.current
    if (!g) return
    g.visible = shown.current > 0.002 && ready
    if (!g.visible || !s) return
    if (carRig.root) { g.matrix.copy(carRig.root.matrixWorld); g.matrixWorldNeedsUpdate = true }
    shared.uTime.value += dt
    s.pos.material.uniforms.uDt.value = Math.min(dt, 1 / 30) * SPEED
    s.puffs.material.uniforms.uDt.value = Math.min(dt, 1 / 30) * SPEED
    s.gpu.compute()
    s.smoke.compute()
    const lm = lines.material as THREE.ShaderMaterial
    lm.uniforms.tSmoke.value = s.smoke.getCurrentRenderTarget(s.puffs).texture
    lm.uniforms.uOn.value = shown.current
    lm.uniforms.uRes.value.set(size.width * gl.getPixelRatio() * 0.5, size.height * gl.getPixelRatio() * 0.5)
    lm.uniforms.uWidth.value = 1.3 * gl.getPixelRatio()
    const mat = streaks.material as THREE.ShaderMaterial
    const dpr = gl.getPixelRatio()
    mat.uniforms.tPos.value = s.gpu.getCurrentRenderTarget(s.pos).texture
    mat.uniforms.uOn.value = shown.current
    mat.uniforms.uRes.value.set(size.width * dpr * 0.5, size.height * dpr * 0.5)
    mat.uniforms.uWidth.value = 1.25 * dpr
  })

  return (
    <group ref={group} matrixAutoUpdate={false} visible={false}>
      <primitive object={streaks} />
      <primitive object={lines} />
    </group>
  )
}
