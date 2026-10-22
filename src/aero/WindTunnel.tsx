import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { carRig } from '../Car'
import { drive, fx } from '../fx'
import { store, useStore } from '../store'
import { loadField } from './flow'
import { makeField, sheets, type Stream } from './stream'

// The airflow over the car, drawn the way a wind tunnel's smoke rake shows it under a light sheet: streamlines
// computed from potential-flow physics (stream.ts), dead straight far ahead of the car, lifting smoothly before
// the nose, hugging the bodywork, and settling back to straight in the wake. Fine, dim filaments in a muted
// steel blue, paler where the air is squeezed and fast, darker where it slows against the nose, with the smoke's
// density drifting slowly downstream.
// It plays by itself while the car is parked on the Jobs corner, and in full (studio dimmed, rolling road
// running) whenever the wind tunnel is switched on (W).

/** how fast the smoke's density drifts along the lines, m/s (scene) */
const DRIFT = 1.6

const rayVert = /* glsl */ `
  attribute vec3 aNext;
  attribute float aSide;
  attribute float aS;
  attribute float aT;
  attribute float aSpeed;
  attribute float aPhase;
  uniform vec2 uRes;
  uniform float uWidth;
  varying float vSide;
  varying float vS;
  varying float vT;
  varying float vSpeed;
  varying float vPhase;
  void main() {
    mat4 mvp = projectionMatrix * modelViewMatrix;
    vec4 c = mvp * vec4(position, 1.0);
    vec4 n = mvp * vec4(aNext, 1.0);
    vec2 d = n.xy / n.w - c.xy / c.w;
    d = length(d) > 1e-6 ? normalize(d * uRes) : vec2(1.0, 0.0);
    c.xy += vec2(-d.y, d.x) * aSide * uWidth / uRes * c.w;
    gl_Position = c;
    vSide = aSide; vS = aS; vT = aT; vSpeed = aSpeed; vPhase = aPhase;
  }
`
const rayFrag = /* glsl */ `
  uniform float uTime;
  uniform float uOn;
  varying float vSide;
  varying float vS;
  varying float vT;
  varying float vSpeed;
  varying float vPhase;
  void main() {
    // a fine filament, the way a smoke line looks under a light sheet
    float core = exp(-vSide * vSide * 9.0);
    // the smoke's density drifts downstream in long, soft swells: it moves, without anything flashing
    float f = fract((vS - uTime * ${DRIFT.toFixed(2)}) / 1.6 + vPhase);
    float swell = smoothstep(0.0, 0.55, f) * (1.0 - smoothstep(0.55, 1.0, f));
    // muted steel blue: dimmer where the air slows (ahead of the nose), paler and brighter where it is squeezed
    // over the bodywork and runs fast
    float fast = smoothstep(1.0, 1.7, vSpeed), slow = 1.0 - smoothstep(0.55, 1.0, vSpeed);
    vec3 col = mix(vec3(0.34, 0.5, 0.74), vec3(0.72, 0.84, 0.98), fast);
    col = mix(col, vec3(0.16, 0.26, 0.48), slow);
    float lum = mix(1.0, 1.9, fast) * mix(1.0, 0.7, slow);
    // fades in far upstream and out far downstream, so the straight runs either side of the car read fully
    float ends = smoothstep(0.0, 0.07, vT) * (1.0 - smoothstep(0.9, 1.0, vT));
    float a = core * 0.26 * lum * (0.7 + 0.45 * swell) * ends * uOn;
    if (a < 0.002) discard;
    gl_FragColor = vec4(col * a, 1.0);
  }
`

/** The lines as one strip geometry: every point twice (either side of the line). */
function buildRays(lines: Stream[]) {
  let verts = 0, tris = 0
  for (const l of lines) { verts += l.n * 2; tris += (l.n - 1) * 2 }
  const pos = new Float32Array(verts * 3), next = new Float32Array(verts * 3)
  const side = new Float32Array(verts), s = new Float32Array(verts), t = new Float32Array(verts), speed = new Float32Array(verts), phase = new Float32Array(verts)
  const index = new Uint32Array(tris * 3)
  let v = 0, k = 0
  lines.forEach((l, li) => {
    const total = l.s[l.n - 1] || 1
    const ph = (li * 0.618034) % 1
    for (let i = 0; i < l.n; i++) {
      const j = i < l.n - 1 ? i + 1 : i - 1
      const flip = i < l.n - 1 ? 1 : -1
      for (const sd of [-1, 1]) {
        pos.set([l.p[i * 3], l.p[i * 3 + 1], l.p[i * 3 + 2]], v * 3)
        next.set([l.p[j * 3], l.p[j * 3 + 1], l.p[j * 3 + 2]], v * 3)
        side[v] = sd * flip; s[v] = l.s[i]; t[v] = l.s[i] / total; speed[v] = l.speed[i]; phase[v] = ph
        v++
      }
      if (i < l.n - 1) { const a = v - 2; index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], k); k += 6 }
    }
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aNext', new THREE.BufferAttribute(next, 3))
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1))
  g.setAttribute('aS', new THREE.BufferAttribute(s, 1))
  g.setAttribute('aT', new THREE.BufferAttribute(t, 1))
  g.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1))
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
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

  // traced once the garage is open, a few lines at a time so no frame waits on it
  useEffect(() => {
    if (!(on || loaded) || ready.current) return
    let alive = true
    loadField().then((tex) => {
      if (!alive) return
      const F = makeField(tex.image.data as unknown as Uint8Array)
      // measured off the car in idle time, so no frame waits on it
      const ch = new MessageChannel()
      ch.port1.onmessage = () => {
        if (!alive) return
        const lines = sheets(F, {
          // three sheets over the top, lines from just off the bodywork up to well clear of it
          zs: [0, 0.3, -0.3],
          ys: [0.06, 0.13, 0.22, 0.33, 0.47, 0.64, 0.85],
        })
        rays.geometry.dispose()
        rays.geometry = buildRays(lines)
        ready.current = true
      }
      ch.port2.postMessage(0)
    })
    return () => { alive = false }
  }, [on, loaded, rays])

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
    u.uWidth.value = 1.8 * dpr
  })

  return (
    <group ref={group} matrixAutoUpdate={false} visible={false}>
      <primitive object={rays} />
    </group>
  )
}
