import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { carRig } from '../Car'
import { drive, fx } from '../fx'
import { store, useStore } from '../store'
import { loadField } from './flow'
import { makeField, sheets, type Stream } from './stream'

// The airflow over the car, drawn the way a CFD render shows it: exact streamlines traced once through the air
// round the car (stream.ts), as fine lines of blue light, deep where the air is slow and white-hot where it races,
// with pulses of light running along them downstream. Only the lines that actually work the car are kept: over
// the nose and the halo, along the sidepods, up off the rear wing, round the wheels, and the spirals off the wing
// tips. No noise, no particles: every line is smooth and every frame is the same picture, just flowing.
// It plays by itself while the car is parked on the Jobs corner, and in full (studio dimmed, rolling road
// running) whenever the wind tunnel is switched on (W).

/** how fast the pulses run along the lines, m/s (scene) */
const PULSE = 2.4

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
    // a crisp core in a soft glow
    float core = exp(-vSide * vSide * 18.0);
    float glow = exp(-vSide * vSide * 2.4);
    // light running downstream along the line: a sharp head with a fading tail, a comet every couple of metres
    float f = fract((vS - uTime * ${PULSE.toFixed(2)}) / 2.2 + vPhase);
    float pulse = smoothstep(0.0, 0.015, f) * (1.0 - smoothstep(0.015, 0.2, f));
    // deep blue where the air is slow, electric blue in the free stream, white where it races
    vec3 col = mix(vec3(0.05, 0.18, 0.8), vec3(0.1, 0.5, 1.0), smoothstep(1.0, 1.5, vSpeed));
    col = mix(col, vec3(0.75, 0.92, 1.0), smoothstep(2.0, 2.8, vSpeed));
    // in out of the dark ahead of the car, gone into it behind
    float ends = smoothstep(0.0, 0.14, vT) * (1.0 - smoothstep(0.8, 1.0, vT));
    float a = (core * (0.55 + pulse * 2.0) + glow * (0.07 + pulse * 0.5)) * ends * uOn;
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
          // over the top only: lines beside the car read, from the side, as lines through it
          zs: [0, 0.22, -0.22, 0.45, -0.45],
          ys: [0.06, 0.14, 0.25, 0.39, 0.57, 0.8],
          flankYs: [],
          flankZs: [],
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
    u.uWidth.value = 3.2 * dpr
  })

  return (
    <group ref={group} matrixAutoUpdate={false} visible={false}>
      <primitive object={rays} />
    </group>
  )
}
