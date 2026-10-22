import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { carRig } from '../Car'
import { drive, fx } from '../fx'
import { store, useStore } from '../store'
import { makeAir, type Air } from './airflow'
import type { Stream } from './stream'

// The air round the car (airflow.ts): thousands of particles carried by a flow field baked from the car's own
// shape, drawn as short streaks along their velocity, so the incoming air arrives smooth and parallel, splits
// round the nose and the front tyres, speeds over the bodywork, rolls up into the wing-tip vortices and tumbles
// in the wakes behind the tyres, the rear wing and the diffuser. A few faint streamlines traced through the same
// field (public/models/flow.bin) give the flow its shape at a glance. Colour follows the local air speed: deep
// blue where it slows, cyan in the free stream, ice white where it races.
const FLOW_URL = `${import.meta.env.BASE_URL}models/flow.bin`
const FIELD_URL = `${import.meta.env.BASE_URL}models/field.bin`
/** particles in the air at once */
const PARTICLES = matchMedia("(pointer: coarse)").matches ? 3000 : 6000

/** how fast the wave of light travels with the air (scene seconds per unit of time of flight) */
const RUN = 0.55

const rayVert = /* glsl */ `
  attribute vec3 aNext;
  attribute float aSide;
  attribute float aT;
  attribute float aSpeed;
  attribute float aPhase;
  attribute float aTime;
  uniform vec2 uRes;
  uniform float uWidth;
  varying float vSide;
  varying float vT;
  varying float vSpeed;
  varying float vTime;
  void main() {
    mat4 mvp = projectionMatrix * modelViewMatrix;
    vec4 c = mvp * vec4(position, 1.0);
    vec4 n = mvp * vec4(aNext, 1.0);
    vec2 d = n.xy / n.w - c.xy / c.w;
    d = length(d) > 1e-6 ? normalize(d * uRes) : vec2(1.0, 0.0);
    // a ribbon wide enough for the line's glow; its ends taper to nothing
    float taper = smoothstep(0.0, 0.08, aT) * (1.0 - smoothstep(0.9, 1.0, aT));
    c.xy += vec2(-d.y, d.x) * aSide * uWidth * (0.35 + 0.65 * taper) / uRes * c.w;
    gl_Position = c;
    vSide = aSide; vT = aT; vSpeed = aSpeed; vTime = aTime;
  }
`
const rayFrag = /* glsl */ `
  uniform float uTime;
  uniform float uOn;
  varying float vSide;
  varying float vT;
  varying float vSpeed;
  varying float vTime;
  vec3 ramp(float u) {
    // deep blue in the slowed air, azure in the free stream, cyan-white where it races over the car
    vec3 c = mix(vec3(0.05, 0.13, 0.42), vec3(0.12, 0.45, 0.95), smoothstep(0.0, 0.45, u));
    return mix(c, vec3(0.78, 0.94, 1.0), smoothstep(0.45, 1.0, u));
  }
  void main() {
    // a thin, sharp core in a soft glow
    float x = abs(vSide);
    float core = exp(-x * x * 60.0);
    float glow = exp(-x * x * 6.0);
    // speed, from the slowed air at the nose to the fastest over the bodywork
    float u = smoothstep(0.86, 1.28, vSpeed);
    // one slow wave of light travelling with the air, the same instant on every line, so it reads as a puff of
    // air passing over the car
    float f = fract((vTime - uTime * ${RUN.toFixed(2)}) / 3.2);
    float wave = exp(-pow((f - 0.5) / 0.1, 2.0));
    float ends = smoothstep(0.0, 0.1, vT) * (1.0 - smoothstep(0.86, 1.0, vT));
    float lum = (0.5 + 0.5 * u) * (1.0 + 0.25 * wave);
    float a = (core * 0.2 + glow * 0.02) * lum * ends * uOn;
    if (a < 0.003) discard;
    gl_FragColor = vec4(ramp(u) * a, 1.0);
  }
`

// a particle drawn as a short streak from where it was a moment ago to where it is, so it reads as moving air
const streakVert = /* glsl */ `
  attribute vec2 corner;
  attribute vec3 iPos;
  attribute vec3 iVel;
  attribute vec4 iData;
  uniform vec2 uRes;
  uniform float uWidth;
  uniform float uTrail;
  varying float vAlong;
  varying float vSide;
  varying vec4 vData;
  void main() {
    mat4 mvp = projectionMatrix * modelViewMatrix;
    vec4 head = mvp * vec4(iPos, 1.0);
    // in the churned air of a wake the path bends quickly, so only its last moment is drawn
    vec4 tail = mvp * vec4(iPos - iVel * uTrail * (1.0 - 0.6 * iData.y), 1.0);
    // nothing at or behind the camera
    if (head.w < 0.2 || tail.w < 0.2 || iData.x < 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlong = 0.0; vSide = 0.0; vData = vec4(0.0); return; }
    vec2 hs = head.xy / head.w * uRes, ts = tail.xy / tail.w * uRes;
    vec2 d = hs - ts;
    float len = length(d);
    vec2 dir = len > 1e-3 ? d / len : vec2(1.0, 0.0);
    // never shorter than it is wide
    if (len < uWidth) ts = hs - dir * uWidth;
    // nearer particles a little larger
    float w = uWidth * clamp(3.5 / head.w, 0.55, 1.5) * (1.0 - 0.45 * iData.z);
    vec2 sp = mix(ts, hs, corner.x) + vec2(-dir.y, dir.x) * corner.y * w;
    float cw = mix(tail.w, head.w, corner.x), cz = mix(tail.z / tail.w, head.z / head.w, corner.x);
    gl_Position = vec4(sp / uRes * cw, cz * cw, cw);
    vAlong = corner.x; vSide = corner.y; vData = iData;
  }
`
const streakFrag = /* glsl */ `
  uniform float uOn;
  varying float vAlong;
  varying float vSide;
  varying vec4 vData;
  void main() {
    float a = vData.x * uOn;
    if (a < 0.002) discard;
    // a soft streak, brightest at its head
    float edge = 1.0 - smoothstep(0.25, 1.0, abs(vSide));
    float body = pow(clamp(vAlong, 0.0, 1.0), 1.6);
    // speed: deep blue where the air slows, cyan in the free stream, ice white where it races
    float u = smoothstep(0.55, 1.35, vData.w);
    vec3 col = mix(vec3(0.07, 0.2, 0.55), vec3(0.25, 0.68, 1.0), smoothstep(0.0, 0.55, u));
    col = mix(col, vec3(0.86, 0.95, 1.0), smoothstep(0.55, 1.0, u));
    // the wake's air is churned and diffuse, the skin's a quiet film along the bodywork
    float wake = vData.y, skin = vData.z;
    col = mix(col, vec3(0.32, 0.48, 0.66), wake * 0.45);
    float k = edge * body * a * (1.0 - 0.3 * wake) * (1.0 - 0.45 * skin) * 0.8;
    gl_FragColor = vec4(clamp(col * k, 0.0, 4.0), 1.0);
  }
`

function makeStreaks(A: Air) {
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), 2))
  g.setIndex([0, 2, 1, 1, 2, 3])
  g.setAttribute('iPos', new THREE.InstancedBufferAttribute(A.pos, 3).setUsage(THREE.DynamicDrawUsage))
  g.setAttribute('iVel', new THREE.InstancedBufferAttribute(A.vel, 3).setUsage(THREE.DynamicDrawUsage))
  g.setAttribute('iData', new THREE.InstancedBufferAttribute(A.data, 4).setUsage(THREE.DynamicDrawUsage))
  g.instanceCount = A.n
  const m = new THREE.ShaderMaterial({
    uniforms: { uRes: { value: new THREE.Vector2(1, 1) }, uWidth: { value: 2 }, uTrail: { value: 0.045 }, uOn: { value: 0 } },
    vertexShader: streakVert, fragmentShader: streakFrag,
    // depth written so the depth of field treats each streak at its own distance (not as the far wall behind it)
    transparent: true, depthWrite: true, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(g, m)
  mesh.frustumCulled = false
  mesh.renderOrder = 7
  return mesh
}

/** flow.bin: line count, point count, points per line, then x, y, z, speed per point (see bake-flow.mjs). */
function readFlow(buf: ArrayBuffer): Stream[] {
  const dv = new DataView(buf)
  const lines = dv.getUint32(0, true), total = dv.getUint32(4, true)
  const head = 8 + lines * 2, off = head + ((4 - (head % 4)) % 4)
  const q = new Int16Array(buf, off, total * 4)
  const out: Stream[] = []
  let k = 0
  for (let li = 0; li < lines; li++) {
    const n = dv.getUint16(8 + li * 2, true)
    const p = new Float32Array(n * 3), speed = new Float32Array(n), s = new Float32Array(n)
    for (let i = 0; i < n; i++, k++) {
      p[i * 3] = q[k * 4] / 4000; p[i * 3 + 1] = q[k * 4 + 1] / 4000; p[i * 3 + 2] = q[k * 4 + 2] / 4000
      speed[i] = q[k * 4 + 3] / 10000
      if (i) s[i] = s[i - 1] + Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 1] - p[i * 3 - 2], p[i * 3 + 2] - p[i * 3 - 1])
    }
    out.push({ p, speed, s, n, through: true })
  }
  return out
}

/** The lines as one strip geometry: every point twice (either side of the line). */
function buildRays(lines: Stream[]) {
  let verts = 0, tris = 0
  for (const l of lines) { verts += l.n * 2; tris += (l.n - 1) * 2 }
  const pos = new Float32Array(verts * 3), next = new Float32Array(verts * 3)
  const side = new Float32Array(verts), t = new Float32Array(verts), speed = new Float32Array(verts), phase = new Float32Array(verts), time = new Float32Array(verts)
  const index = new Uint32Array(tris * 3)
  let v = 0, k = 0
  lines.forEach((l, li) => {
    const total = l.s[l.n - 1] || 1
    // each line's particles leave at their own moment, so they read as a stream, not a marching front
    const ph = (li * 0.618034) % 1
    let tof = 0
    for (let i = 0; i < l.n; i++) {
      if (i > 0) tof += (l.s[i] - l.s[i - 1]) / Math.max(0.3, (l.speed[i] + l.speed[i - 1]) * 0.5)
      const j = i < l.n - 1 ? i + 1 : i - 1
      const flip = i < l.n - 1 ? 1 : -1
      for (const sd of [-1, 1]) {
        pos.set([l.p[i * 3], l.p[i * 3 + 1], l.p[i * 3 + 2]], v * 3)
        next.set([l.p[j * 3], l.p[j * 3 + 1], l.p[j * 3 + 2]], v * 3)
        side[v] = sd * flip; t[v] = l.s[i] / total; speed[v] = l.speed[i]; phase[v] = ph; time[v] = tof
        v++
      }
      if (i < l.n - 1) { const a = v - 2; index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], k); k += 6 }
    }
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aNext', new THREE.BufferAttribute(next, 3))
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1))
  g.setAttribute('aT', new THREE.BufferAttribute(t, 1))
  g.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1))
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
  g.setAttribute('aTime', new THREE.BufferAttribute(time, 1))
  g.setIndex(new THREE.BufferAttribute(index, 1))
  g.computeBoundingSphere()
  return g
}

export function WindTunnel() {
  const on = useStore((s) => s.tunnel)
  const chapter = useStore((s) => s.chapter)
  const loaded = useStore((s) => s.loaded)
  const { gl, scene, size } = useThree()
  const group = useRef<THREE.Group>(null)
  const ready = useRef(false)
  const tunnel = useRef(0)
  const shown = useRef(0)
  // the particles live in a worker (airWorker.ts); these arrays hold the latest state it sent, for drawing
  const air = useMemo(() => makeAir(PARTICLES), [])
  const streaks = useMemo(() => makeStreaks(air), [air])
  const sim = useRef({ worker: null as Worker | null, ready: false, busy: false, dt: 0 })

  const rays = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      uniforms: { uRes: { value: new THREE.Vector2(1, 1) }, uWidth: { value: 4 }, uTime: { value: 0 }, uOn: { value: 0 } },
      vertexShader: rayVert, fragmentShader: rayFrag,
      // a ribbon faces whichever way its line runs on screen, so both faces are drawn
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), m)
    mesh.frustumCulled = false
    mesh.renderOrder = 6
    return mesh
  }, [])

  // the baked streamlines, fetched once the garage is open
  useEffect(() => {
    if (!(on || loaded) || ready.current) return
    let alive = true
    fetch(FLOW_URL).then((r) => r.arrayBuffer()).then((buf) => {
      if (!alive) return
      rays.geometry.dispose()
      rays.geometry = buildRays(readFlow(buf))
      ready.current = true
    }).catch(() => {})
    const S = sim.current
    if (!S.worker) {
      const w = new Worker(new URL('./airWorker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (e: MessageEvent<{ type: string; pos?: Float32Array; vel?: Float32Array; data?: Float32Array }>) => {
        if (e.data.type === 'ready') { S.ready = true; return }
        if (e.data.type === 'frame') {
          S.busy = false
          air.pos.set(e.data.pos!); air.vel.set(e.data.vel!); air.data.set(e.data.data!)
          const sg = streaks.geometry as THREE.InstancedBufferGeometry
          for (const name of ['iPos', 'iVel', 'iData']) (sg.getAttribute(name) as THREE.InstancedBufferAttribute).needsUpdate = true
        }
      }
      w.postMessage({ type: 'init', url: new URL(FIELD_URL, location.href).href, n: PARTICLES })
      S.worker = w
    }
    return () => { alive = false }
  }, [on, loaded, rays, air, streaks])

  useFrame((_, dt) => {
    const ok = ready.current
    // the flow is computed round the assembled car, so it steps aside while the car is pulled apart
    const assembled = fx.explode < 0.02
    tunnel.current = THREE.MathUtils.damp(tunnel.current, on && ok && assembled ? 1 : 0, on ? 2.2 : 3.5, dt)
    // parked on the Jobs corner, the air streams over the car on its own
    const jobs = chapter === 3 && store.get().hold && ok && assembled
    shown.current = THREE.MathUtils.damp(shown.current, Math.max(tunnel.current, jobs ? 1 : 0), jobs ? 1.8 : 3, dt)
    const k = tunnel.current
    fx.tunnel = k
    // the tunnel proper: the studio dims and the rolling road and the wheels run
    scene.environmentIntensity = 1.4 * (1 - 0.5 * k)
    drive.dist += k * 0.55 * 30 * dt
    const g = group.current
    if (!g) return
    g.visible = shown.current > 0.002 && ok
    if (!g.visible) return
    if (carRig.root) { g.matrix.copy(carRig.root.matrixWorld); g.matrixWorldNeedsUpdate = true }
    const u = (rays.material as THREE.ShaderMaterial).uniforms
    const dpr = gl.getPixelRatio()
    u.uTime.value += dt
    u.uOn.value = shown.current
    u.uRes.value.set(size.width * dpr * 0.5, size.height * dpr * 0.5)
    u.uWidth.value = 2.6 * dpr
    // the air moves on: the worker carries every particle a step through the field (one step in flight at a
    // time, with whatever time has passed since the last)
    const S = sim.current
    if (S.ready) {
      S.dt += dt
      if (!S.busy) { S.busy = true; S.worker!.postMessage({ type: 'step', dt: S.dt }); S.dt = 0 }
      const su = (streaks.material as THREE.ShaderMaterial).uniforms
      su.uOn.value = shown.current
      su.uRes.value.set(size.width * dpr * 0.5, size.height * dpr * 0.5)
      su.uWidth.value = 1.15 * dpr
      // each streak shows the last ~0.12 s of its path
      su.uTrail.value = 0.12
    }
  })

  return (
    <group ref={group} matrixAutoUpdate={false} visible={false}>
      <primitive object={rays} />
      <primitive object={streaks} />
    </group>
  )
}
