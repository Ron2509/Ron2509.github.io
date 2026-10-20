import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { engine } from './engine'
import { carRig } from './Car'
import { fx, WALL, wallRight, wallToCam } from './fx'

const MAX = 3600

function smokeTexture() {
  // fractal value noise under a round falloff: wispy edges and holes instead of a flat disc
  const size = 256
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const img = g.createImageData(size, size)
  const grid = (n: number) => Array.from({ length: (n + 1) * (n + 1) }, () => Math.random())
  const octaves = [4, 8, 16, 32].map((n) => ({ n, g: grid(n) }))
  const sample = (o: { n: number; g: number[] }, x: number, y: number) => {
    const fx = x * o.n, fy = y * o.n
    const ix = Math.floor(fx), iy = Math.floor(fy)
    const tx = fx - ix, ty = fy - iy
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty)
    const at = (i: number, j: number) => o.g[Math.min(o.n, j) * (o.n + 1) + Math.min(o.n, i)]
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx
    return a + (b - a) * sy
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size
      let n = 0, amp = 0.55
      for (const o of octaves) { n += sample(o, u, v) * amp; amp *= 0.5 }
      const d = Math.hypot(u - 0.5, v - 0.5) * 2
      const fall = Math.max(0, 1 - d * d)
      const a = Math.max(0, n - 0.38) * 1.9 * fall
      const i = (y * size + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
      img.data[i + 3] = Math.min(255, a * 255)
    }
  }
  g.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const vert = /* glsl */ `
  attribute float aLife;
  attribute float aSize;
  attribute float aRot;
  attribute float aAlpha;
  attribute float aShade;
  uniform float uScale;
  varying float vShade;
  varying float vLife;
  varying float vRot;
  varying float vNear;
  varying float vAlpha;
  void main() {
    vLife = aLife;
    vAlpha = aAlpha;
    vShade = aShade;
    vRot = aRot;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = -mv.z;
    vNear = smoothstep(1.5, 4.5, dist); // fade out instead of filling the lens
    gl_PointSize = aLife < 0.0 ? 0.0 : min(aSize * uScale / dist, 420.0);
  }
`
const frag = /* glsl */ `
  uniform sampler2D uTex;
  varying float vLife;
  varying float vRot;
  varying float vNear;
  varying float vAlpha;
  varying float vShade;
  void main() {
    if (vLife < 0.0) discard;
    vec2 p = gl_PointCoord - 0.5;
    float c = cos(vRot), s = sin(vRot);
    p = mat2(c, -s, s, c) * p + 0.5;
    vec4 t = texture2D(uTex, p);
    float fade = smoothstep(0.0, 0.08, vLife) * pow(1.0 - vLife, 1.6);
    // lit from above: brighter crowns, greyer undersides
    // lit from above with per-puff variation: brighter crowns, darker cores, greyer as it ages
    float top = 1.0 - gl_PointCoord.y;
    float core = 1.0 - t.a;
    vec3 col = mix(vec3(0.74, 0.75, 0.78), vec3(0.36, 0.37, 0.4), vLife) * (0.62 + 0.45 * top) * vShade;
    col *= 1.0 - 0.25 * core;
    gl_FragColor = vec4(col, min(1.0, t.a * fade * vNear * 0.55 * vAlpha));
  }
`

type P = { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; dur: number; size: number; grow: number; rot: number; spin: number; curl: number; alpha: number; shade: number }

export function Smoke() {
  const parts = useMemo<P[]>(() => [], [])
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3))
    g.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(MAX).fill(-1), 1))
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MAX), 1))
    g.setAttribute('aRot', new THREE.BufferAttribute(new Float32Array(MAX), 1))
    g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(MAX), 1))
    g.setAttribute('aShade', new THREE.BufferAttribute(new Float32Array(MAX), 1))
    return g
  }, [])
  const curtainAcc = useRef(0)
  const mat = useMemo(
    () => new THREE.ShaderMaterial({
      uniforms: { uTex: { value: smokeTexture() }, uScale: { value: 400 } },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
    }),
    [],
  )
  const acc = useRef(0)
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const fwd = useMemo(() => new THREE.Vector3(), [])

  const spawn = (local: THREE.Vector3, root: THREE.Object3D, kind: 'tyre' | 'exhaust') => {
    if (parts.length >= MAX) parts.shift()
    tmp.copy(local).applyMatrix4(root.matrixWorld)
    fwd.set(1, 0, 0).applyQuaternion(root.quaternion)
    const side = local.z > 0 ? 1 : -1
    const lat = new THREE.Vector3(0, 0, side).applyQuaternion(root.quaternion)
    const tyre = kind === 'tyre'
    const back = tyre ? 1.6 + Math.random() * 2.2 : 1 + Math.random()
    parts.push({
      x: tmp.x + (Math.random() - 0.5) * 0.25,
      y: tmp.y + Math.random() * 0.1,
      z: tmp.z + (Math.random() - 0.5) * 0.25,
      vx: -fwd.x * back + lat.x * (tyre ? Math.random() * 1.2 : 0),
      vy: tyre ? 0.14 + Math.random() * 0.36 : 0.3,
      vz: -fwd.z * back + lat.z * (tyre ? Math.random() * 1.2 : 0),
      life: 0,
      // a real burnout: the cloud billows, climbs and hangs, and the studio fills behind the car
      dur: tyre ? 3.2 + Math.random() * 2.4 : 1.4 + Math.random(),
      size: tyre ? 0.36 + Math.random() * 0.4 : 0.25,
      grow: tyre ? 2.2 + Math.random() * 1.9 : 1.2,
      rot: Math.random() * 6.28,
      spin: (Math.random() - 0.5) * 0.8,
      curl: 0.18,
      alpha: tyre ? 0.62 : 0.85,
      shade: 0.78 + Math.random() * 0.3,
    })
  }

  useFrame((state, dt) => {
    const cam = state.camera as THREE.PerspectiveCamera
    mat.uniforms.uScale.value = state.size.height * state.viewport.dpr * 0.5 * cam.projectionMatrix.elements[5]
    const root = carRig.root
    const now = state.clock.elapsedTime

    // the reveal: a wall of smoke rolls across the backdrop, then thins to show the name behind it
    if (fx.curtain > 0) {
      curtainAcc.current += fx.curtain * 260 * dt
      while (curtainAcc.current >= 1) {
        curtainAcc.current -= 1
        if (parts.length >= MAX) parts.shift()
        const across = (Math.random() - 0.5) * WALL.width * 1.15
        const out = 0.6 + Math.random() * 2.6
        parts.push({
          x: WALL.center.x + wallRight.x * across + wallToCam.x * out,
          y: Math.random() * WALL.height * 0.9,
          z: WALL.center.z + wallRight.z * across + wallToCam.z * out,
          vx: (Math.random() - 0.5) * 0.5,
          vy: 0.12 + Math.random() * 0.3,
          vz: (Math.random() - 0.5) * 0.5,
          life: 0,
          dur: 2.4 + Math.random() * 1.8,
          size: 0.7 + Math.random() * 0.7,
          grow: 1.8 + Math.random() * 1.6,
          rot: Math.random() * 6.28,
          spin: (Math.random() - 0.5) * 0.6,
          curl: 0.3,
          alpha: 1,
          shade: 0.8 + Math.random() * 0.25,
        })
      }
    }

    if (root) {
      const rate = engine.burnout * 300 + engine.puff * 40
      acc.current += rate * dt
      while (acc.current >= 1) {
        acc.current -= 1
        if (engine.burnout > 0.05 && Math.random() < engine.burnout) {
          spawn(Math.random() < 0.5 ? carRig.rearL : carRig.rearR, root, 'tyre')
        } else if (engine.puff > 0.02) {
          spawn(carRig.exhaust, root, 'exhaust')
        }
      }
    }
    const pos = geo.attributes.position.array as Float32Array
    const life = geo.attributes.aLife.array as Float32Array
    const size = geo.attributes.aSize.array as Float32Array
    const rot = geo.attributes.aRot.array as Float32Array
    const alpha = geo.attributes.aAlpha.array as Float32Array
    const shade = geo.attributes.aShade.array as Float32Array
    const t = now
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]
      p.life += dt / p.dur
      if (p.life >= 1) { parts.splice(i, 1); continue }
      const drag = Math.exp(-dt * 1.4)
      p.vx *= drag; p.vz *= drag
      p.vy = p.vy * Math.exp(-dt * 0.6) + dt * (p.curl > 0 ? 0.18 : 0.05)
      // cheap curl; lettering stays crisp at first, then the wind takes it
      const curl = p.curl > 0 ? p.curl : Math.max(0, p.life - 0.45) * 0.6
      p.x += (p.vx + Math.sin(p.y * 2.1 + t * 0.7 + i) * curl) * dt
      p.y += p.vy * dt
      p.z += (p.vz + Math.cos(p.x * 1.7 + t * 0.5) * curl) * dt
      p.rot += p.spin * dt
    }
    for (let i = 0; i < MAX; i++) {
      const p = parts[i]
      if (!p) { life[i] = -1; continue }
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z
      life[i] = p.life
      size[i] = p.size + p.grow * Math.sqrt(p.life)
      // a billboard that dips into the floor shows a hard cut line; keep every puff resting on it
      if (p.y < size[i] * 0.42) p.y = size[i] * 0.42
      pos[i * 3 + 1] = p.y
      rot[i] = p.rot
      alpha[i] = p.alpha
      shade[i] = p.shade
    }
    geo.attributes.position.needsUpdate = true
    geo.attributes.aLife.needsUpdate = true
    geo.attributes.aSize.needsUpdate = true
    geo.attributes.aRot.needsUpdate = true
    geo.attributes.aAlpha.needsUpdate = true
    geo.attributes.aShade.needsUpdate = true
  })

  return <points geometry={geo} material={mat} frustumCulled={false} renderOrder={5} />
}
