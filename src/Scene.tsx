import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, MeshReflectorMaterial, PerformanceMonitor } from '@react-three/drei'
import { Bloom, ChromaticAberration, DepthOfField, EffectComposer, N8AO, Noise, ToneMapping, Vignette } from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode, type DepthOfFieldEffect } from 'postprocessing'
import * as THREE from 'three'
import { Car, anchorNow, carRig } from './Car'
import { Smoke } from './Smoke'
import { NameWall } from './NameWall'
import { PitWall, pitZoom } from './PitWall'
import { ToolCabinet, WheelStack } from './GarageKit'
import { drive, fx } from './fx'
import { engine } from './engine'
import { scroll, store, useStore } from './store'
import { EXPERIENCE } from './content'
import { WindTunnel } from './aero/WindTunnel'
import { Blueprint, CadLines } from './cad/CadLook'
import { floor, RainDriver, RainFall, RainLens, Ripples, WetFloor } from './rain/Rain'
import { useWeather, weather } from './weather'

// Camera stops, one per chapter. Car nose points to +X, centred on the origin.
// Content blocks hold the left of the frame, so every stop after the hero parks the car in the right half.
const SHOTS: { pos: [number, number, number]; look: [number, number, number]; fov: number }[] = [
  { pos: [7.2, 1.25, 5.6], look: [0.4, 0.34, 0.3], fov: 26 }, // hero: low front three-quarter, room between the name and the car
  { pos: [5.8, 1.15, 5.2], look: [1.0, 0.42, -1.11], fov: 30 }, // profile: front three-quarter, car left (driver card right)
  { pos: [6.2, 4.6, 10.4], look: [-1.9, 0.6, 1.6], fov: 34 }, // projects: high front three-quarter, the whole pulled-apart car in the right half
  { pos: [-6.2, 2.0, 5.4], look: [0, -0.25, 0], fov: 30 }, // experience: rear three-quarter, car high (lower-third below)
  { pos: [-3.27, 1.4, 1.59], look: [-8.3, 1.2, 0.32], fov: 34 }, // pit wall: back from the left stand, all six screens in the right half
  { pos: [0.2, 10.5, 3.4], look: [0.1, 0, 1.7], fov: 32 }, // contact: overhead, car up top (radio caption below)
]

/** The live camera, for DOM overlays that project points from the scene (Callouts). */
export const view = { camera: null as THREE.Camera | null }
if (import.meta.env.DEV) (window as unknown as { __view: typeof view }).__view = view

function CameraRig() {
  const { camera, pointer } = useThree()
  view.camera = camera
  const posCurve = useMemo(
    () => new THREE.CatmullRomCurve3(SHOTS.map((s) => new THREE.Vector3(...s.pos)), false, 'centripetal'),
    [],
  )
  const lookCurve = useMemo(
    () => new THREE.CatmullRomCurve3(SHOTS.map((s) => new THREE.Vector3(...s.look)), false, 'centripetal'),
    [],
  )
  const p = useRef(0)
  const lastP = useRef(0)
  const pos = useRef(new THREE.Vector3(...SHOTS[0].pos))
  const look = useRef(new THREE.Vector3(...SHOTS[0].look))
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const tmp2 = useMemo(() => new THREE.Vector3(), [])
  const orbit = useMemo(() => new THREE.Vector3(), [])
  // close-up on the car part each season is about (Experience corner)
  const part = useRef({ blend: 0, key: '', fast: 0 })
  const partPos = useMemo(() => new THREE.Vector3(), [])
  const partLook = useMemo(() => new THREE.Vector3(), [])
  const pd = useMemo(() => new THREE.Vector3(), [])
  const liveA = useMemo(() => new THREE.Vector3(), [])
  // close-up on one pit-wall screen (click a screen on the Pit wall corner)
  const zoom = useRef({ blend: 0 })
  const zc = useMemo(() => new THREE.Vector3(), [])
  const zn = useMemo(() => new THREE.Vector3(), [])
  const zl = useMemo(() => new THREE.Vector3(), [])
  const zPos = useMemo(() => new THREE.Vector3(), [])
  const zLook = useMemo(() => new THREE.Vector3(), [])
  const sph = useMemo(() => new THREE.Spherical(), [])

  useEffect(() => { camera.layers.enable(1) }, [camera])
  useFrame((state, dt) => {
    // dev only: a fixed camera for inspecting the livery
    const ov = import.meta.env.DEV ? (window as unknown as { __cam?: { pos: number[]; look: number[]; fov: number } }).__cam : undefined
    if (ov) {
      const cam = camera as THREE.PerspectiveCamera
      cam.position.set(ov.pos[0], ov.pos[1], ov.pos[2])
      cam.lookAt(ov.look[0], ov.look[1], ov.look[2])
      if (cam.fov !== ov.fov) { cam.fov = ov.fov; cam.updateProjectionMatrix() }
      return
    }
    p.current = THREE.MathUtils.damp(p.current, scroll.progress, 3.2, dt)
    const u = THREE.MathUtils.clamp(p.current, 0, 1)
    // how fast the camera is flying between corners is how fast the car is "driving"
    const legs = SHOTS.length - 1
    const v = (Math.abs(p.current - lastP.current) / Math.max(dt, 1e-3)) * legs
    lastP.current = p.current
    const prevSpeed = drive.speed
    drive.speed = THREE.MathUtils.damp(drive.speed, THREE.MathUtils.clamp(v / 0.55, 0, 1), 3, dt)
    const acc = (drive.speed - prevSpeed) / Math.max(dt, 1e-3)
    drive.accel = THREE.MathUtils.damp(drive.accel, THREE.MathUtils.clamp(acc * 0.8, -1, 1), 5, dt)
    drive.dist += drive.speed * 30 * dt
    const legI = Math.min(legs - 1, Math.floor(u * legs))
    const legT = u * legs - legI
    drive.steer = Math.sin(Math.PI * legT) * (legI % 2 ? 1 : -1) * drive.speed
    posCurve.getPoint(u, tmp)
    lookCurve.getPoint(u, tmp2)
    // Experience: the camera moves in on the part of the car the season on show is about; changing season
    // whips across to the next part
    const st = store.get()
    // (Projects keeps one wide shot of the pulled-apart car; its detail is the drawing beside it)
    const items = st.chapter === 3 ? EXPERIENCE : null
    // phones keep the chapter's own shot: the blocks fill the lower half there, so a close-up would sit behind them
    const anchorName = items && st.hold && state.size.width >= state.size.height ? items[Math.min(st.step, items.length - 1)].anchor : null
    const A = anchorName && carRig.root ? anchorNow(anchorName, liveA) : null
    const pt = part.current
    if (A && carRig.root) {
      const base = SHOTS[st.chapter]
      pd.set(base.pos[0] - base.look[0], base.pos[1] - base.look[1], base.pos[2] - base.look[2]).normalize()
      // far enough back that the car sits in its air, the flow running in and out of the frame round it
      const near = 8.4
      partLook.copy(A).applyMatrix4(carRig.root.matrixWorld)
      partPos.copy(partLook).addScaledVector(pd, near)
      partPos.y += 0.2
      const halfH = near * Math.tan(THREE.MathUtils.degToRad(base.fov) / 2)
      // Experience: the part centred and high, above the lower-third
      partLook.y -= 0.42 * halfH
      const key = st.chapter + ':' + anchorName
      if (key !== pt.key) {
        if (pt.key && pt.blend > 0.5) { pt.fast = 1; fx.aberration = Math.max(fx.aberration, 0.55) }
        pt.key = key
      }
    }
    pt.blend = THREE.MathUtils.damp(pt.blend, A ? 1 : 0, A ? 1.6 : 3, dt)
    pt.fast = THREE.MathUtils.damp(pt.fast, 0, 1.5, dt)
    if (pt.blend > 0.001) {
      const k = THREE.MathUtils.smoothstep(pt.blend, 0, 1)
      tmp.lerp(partPos, k)
      tmp2.lerp(partLook, k)
    }

    // a clicked pit-wall screen: square on to it, close enough to read, kept in the right of the frame so the
    // wire's list stays clear on the left
    const zm = pitZoom.mesh
    const zb = zoom.current
    zb.blend = THREE.MathUtils.damp(zb.blend, zm ? 1 : 0, 3.2, dt)
    if (zm) {
      zm.getWorldPosition(zc)
      zn.set(0, 0, 1).transformDirection(zm.matrixWorld)
      zl.crossVectors(zn, THREE.Object3D.DEFAULT_UP).normalize() // the camera's left, facing the screen
      const D = 1.25
      const cam = camera as THREE.PerspectiveCamera
      const halfW = D * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * (state.size.width / state.size.height)
      const off = state.size.width < state.size.height ? 0 : 0.42 * halfW
      zLook.copy(zc).addScaledVector(zl, off)
      zPos.copy(zLook).addScaledVector(zn, D)
    }
    if (zb.blend > 0.001) {
      const k = THREE.MathUtils.smoothstep(zb.blend, 0, 1)
      tmp.lerp(zPos, k)
      tmp2.lerp(zLook, k)
    }

    // drag up/down orbits the camera over the car, never below the floor
    if (carRig.pitch !== 0) {
      orbit.subVectors(tmp, tmp2)
      sph.setFromVector3(orbit)
      sph.phi = THREE.MathUtils.clamp(sph.phi - carRig.pitch, 0.12, 1.52)
      tmp.copy(tmp2).add(orbit.setFromSpherical(sph))
    }
    // slow breathing drift + a little mouse parallax so the frame never sits dead still
    const t = state.clock.elapsedTime
    tmp.x += Math.sin(t * 0.15) * 0.12 + pointer.x * 0.25
    tmp.y += Math.cos(t * 0.11) * 0.05 + pointer.y * 0.12
    // chase-car vibration at speed
    tmp.x += (Math.sin(t * 23) + Math.sin(t * 37) * 0.5) * 0.01 * drive.speed
    tmp.y += (Math.sin(t * 29 + 1) + Math.sin(t * 53) * 0.4) * 0.007 * drive.speed
    // a whip between parts moves faster than the drift of a held shot
    const follow = 4 + part.current.fast * 6 + zoom.current.blend * 3
    pos.current.lerp(tmp, 1 - Math.exp(-dt * follow))
    look.current.lerp(tmp2, 1 - Math.exp(-dt * follow))
    camera.position.copy(pos.current)
    camera.lookAt(look.current)
    const seg = u * (SHOTS.length - 1)
    const i = Math.min(SHOTS.length - 2, Math.floor(seg))
    const f = THREE.MathUtils.smoothstep(seg - i, 0, 1)
    const cam = camera as THREE.PerspectiveCamera
    // portrait screens: the blocks fill the lower half, so widen the lens and slide the frame so the car sits
    // centred in the top half instead of the right half
    const portrait = state.size.width < state.size.height
    const fov = THREE.MathUtils.lerp(SHOTS[i].fov, SHOTS[i + 1].fov, f) * (portrait ? 1.7 : 1)
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix() }
    const { width: W, height: H } = state.size
    // which way each stop's framing is shifted on a phone so the car lands centred above the blocks:
    // car framed right on desktop -> slide the window right; car framed left -> slide it left; centred -> none
    const PHONE_SHIFT = [0, -0.2, 0.22, 0, 0.22, 0]
    const shiftAt = THREE.MathUtils.lerp(PHONE_SHIFT[i] ?? 0, PHONE_SHIFT[i + 1] ?? 0, f)
    const ox = portrait ? W * shiftAt : 0
    const oy = portrait ? H * 0.2 : 0
    if (!cam.view || cam.view.offsetX !== ox || cam.view.offsetY !== oy || cam.view.fullWidth !== W) {
      if (portrait) cam.setViewOffset(W, H, ox, oy, W, H)
      else if (cam.view) cam.clearViewOffset()
    }
  })
  return null
}

// Studio lighting. Parked, it is one long overhead softbox and side strips. Driving, the softbox gives way to a
// row of light bars and side panels streaming past nose to tail, so highlights race over the bodywork the way
// they do on a rolling-road commercial shoot. The environment is re-rendered only while the car is moving.
const TOP_N = 8
const TOP_GAP = 3.2
const SIDE_N = 10
const SIDE_GAP = 2.6
const stream = (i: number, gap: number, n: number) => {
  const span = gap * n
  return span / 2 - ((((i * gap + drive.dist) % span) + span) % span)
}
const glow = (m: THREE.Mesh | null, k: number) => {
  if (m) (m.material as THREE.MeshBasicMaterial).color.setScalar(k)
}

function Studio() {
  const [moving, setMoving] = useState(false)
  const movingRef = useRef(false)
  const soft = useRef<THREE.Mesh>(null)
  const top = useRef<(THREE.Mesh | null)[]>([])
  const side = useRef<(THREE.Mesh | null)[]>([])
  useFrame(() => {
    const on = drive.speed > 0.015
    if (on !== movingRef.current) { movingRef.current = on; setMoving(on) }
    if (!on) return
    const k = drive.speed
    glow(soft.current, 5 * (1 - 0.7 * k))
    top.current.forEach((m, i) => { if (m) { m.position.x = stream(i, TOP_GAP, TOP_N); glow(m, 7 * k) } })
    side.current.forEach((m, i) => { if (m) { m.position.x = stream(i % SIDE_N, SIDE_GAP, SIDE_N) + (i >= SIDE_N ? SIDE_GAP / 2 : 0); glow(m, 5 * k) } })
  })
  return (
    <Environment resolution={256} frames={moving ? Infinity : 1} background={false} environmentIntensity={1.4}>
      <color attach="background" args={['#050506']} />
      {/* overhead softbox: the long reflection running down the bodywork */}
      <Lightformer ref={soft} form="rect" intensity={5} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[12, 2.4, 1]} />
      <Lightformer form="rect" intensity={2.5} position={[0, 6, -2.8]} rotation-x={Math.PI / 2} scale={[12, 0.6, 1]} />
      <Lightformer form="rect" intensity={2.5} position={[0, 6, 2.8]} rotation-x={Math.PI / 2} scale={[12, 0.6, 1]} />
      {/* driving: light bars across the roof and panels down both flanks, streaming past */}
      {Array.from({ length: TOP_N }, (_, i) => (
        <Lightformer key={'t' + i} ref={(m: THREE.Mesh | null) => { top.current[i] = m }} form="rect" intensity={0}
          position={[stream(i, TOP_GAP, TOP_N), 5.5, 0]} rotation-x={Math.PI / 2} scale={[0.9, 7, 1]} />
      ))}
      {Array.from({ length: SIDE_N * 2 }, (_, i) => (
        <Lightformer key={'s' + i} ref={(m: THREE.Mesh | null) => { side.current[i] = m }} form="rect" intensity={0}
          position={[0, 1.5, i < SIDE_N ? 7 : -7]} rotation-y={i < SIDE_N ? Math.PI : 0} scale={[0.5, 2.6, 1]} />
      ))}
      {/* side strips for crisp edge highlights */}
      <Lightformer form="rect" intensity={6} position={[-9, 1.4, 0]} rotation-y={Math.PI / 2} scale={[14, 0.4, 1]} />
      <Lightformer form="rect" intensity={6} position={[9, 1.4, 0]} rotation-y={-Math.PI / 2} scale={[14, 0.4, 1]} />
      {/* large soft fills front and back so dark paint still reads */}
      <Lightformer form="rect" intensity={1.4} position={[0, 2.5, 10]} scale={[16, 4, 1]} onUpdate={(s) => s.lookAt(0, 0, 0)} />
      <Lightformer form="rect" intensity={1.4} position={[0, 2.5, -10]} scale={[16, 4, 1]} onUpdate={(s) => s.lookAt(0, 0, 0)} />
      <Lightformer form="ring" intensity={2} position={[10, 3, 0]} scale={2.5} onUpdate={(s) => s.lookAt(0, 0, 0)} />
    </Environment>
  )
}

/**
 * Rolling road: while the car drives, the floor under it streaks past (panel joints and grain smeared by
 * motion blur, brightest near the car) and thin lights in the far studio whip by like a long-exposure chase
 * shot. Both fade to nothing when the car is parked. Kept out of the floor reflection (layer 1).
 */
const roadVert = /* glsl */ `
  varying vec3 vW;
  void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`
const roadFrag = /* glsl */ `
  uniform float uDist, uSpeed;
  varying vec3 vW;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    float u = vW.x + uDist;
    // motion blur: the faster, the longer each feature smears along the direction of travel
    float smear = 1.0 + uSpeed * 40.0;
    float grain = n(vec2(u * 3.0 / smear, vW.z * 9.0)) * n(vec2(u * 1.3 / smear, vW.z * 3.1 + 7.0));
    float jw = 0.012 + uSpeed * 0.5;
    float joint = 1.0 - smoothstep(0.0, jw, abs(fract(u / 2.6) - 0.5) * 2.6);
    joint *= 0.02 / jw;
    float r = length(vW.xz);
    float near = 1.0 - smoothstep(1.5, 8.5, r);
    float a = (grain * grain * 0.32 + joint * 0.5) * near * uSpeed;
    gl_FragColor = vec4(vec3(0.5, 0.5, 0.53) * a, 1.0);
  }
`
function RollingRoad() {
  const mesh = useRef<THREE.Mesh>(null)
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uDist: { value: 0 }, uSpeed: { value: 0 } },
    vertexShader: roadVert, fragmentShader: roadFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }), [])
  useFrame(() => {
    // also runs under the car in the wind tunnel
    const k = Math.max(drive.speed, fx.tunnel * 0.55)
    mat.uniforms.uDist.value = drive.dist
    mat.uniforms.uSpeed.value = k
    if (mesh.current) mesh.current.visible = k > 0.01
  })
  return (
    <mesh ref={mesh} material={mat} rotation-x={-Math.PI / 2} position={[0, 0.003, 0]} renderOrder={0} visible={false} onUpdate={(o) => o.layers.set(1)}>
      <planeGeometry args={[30, 30]} />
    </mesh>
  )
}

const STREAKS = 32
function LightStreaks() {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const seeds = useMemo(() => Array.from({ length: STREAKS }, (_, i) => {
    const side = i % 2 ? 1 : -1
    return { x: Math.random() * 40, y: 0.25 + Math.random() * 3.2, z: side * (6 + Math.random() * 10), h: 0.012 + Math.random() * 0.03, b: 0.4 + Math.random() * 0.6 }
  }), [])
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.7), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }), [])
  const o = useMemo(() => new THREE.Object3D(), [])
  useFrame((state) => {
    const m = mesh.current
    if (!m) return
    const k = drive.speed
    // background lights only: always on the far side of the car from the camera
    const far = state.camera.position.z >= 0 ? -1 : 1
    m.visible = k > 0.01
    if (!m.visible) return
    mat.opacity = Math.min(0.75, k * 0.85)
    const len = 0.3 + k * 5
    seeds.forEach((s, i) => {
      const x = 20 - ((((s.x + drive.dist * 1.0) % 40) + 40) % 40)
      o.position.set(x, s.y, Math.abs(s.z) * far)
      o.scale.set(len * s.b, s.h, 1)
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
    })
    m.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, STREAKS]} material={mat} visible={false} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
    </instancedMesh>
  )
}

/**
 * The studio cove: a seamless curved backdrop all round the car, graphite rather than black. A lighter haze
 * band where floor meets wall, falling off to near-black overhead, with a soft pool of light behind the car's
 * position, the way a real car studio is lit. Dithered so the gradient never bands.
 */
const coveVert = /* glsl */ `
  varying vec3 vDir;
  void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
const coveFrag = /* glsl */ `
  varying vec3 vDir;
  float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    float y = vDir.y;
    // linear values: band matches the fog (#121316), top falls to near-black
    vec3 top = vec3(0.0016, 0.0017, 0.002);
    vec3 band = vec3(0.0060, 0.0065, 0.0075);
    vec3 low = vec3(0.0060, 0.0065, 0.0075);
    vec3 col = mix(band, top, smoothstep(0.02, 0.55, y));
    col = mix(col, low, smoothstep(0.0, -0.25, y));
    // a broad soft light pool on the wall, strongest low down, wrapping right round the cove
    col += vec3(0.0035, 0.0036, 0.0042) * exp(-pow((y - 0.06) / 0.14, 2.0));
    col += (h(gl_FragCoord.xy) - 0.5) / 900.0;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`
function Cove() {
  const mat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: coveVert, fragmentShader: coveFrag, side: THREE.BackSide, depthWrite: false, fog: false }), [])
  return (
    <mesh material={mat} renderOrder={-3} position={[0, 0, 0]}>
      <sphereGeometry args={[40, 48, 24]} />
    </mesh>
  )
}

function Floor() {
  return (
    // drawn first so the name wall can sit over it (see NameWall)
    <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]} renderOrder={-2}>
      <planeGeometry args={[60, 60]} />
      <MeshReflectorMaterial
        ref={(m: unknown) => { floor.mat = m as typeof floor.mat }}
        blur={[500, 120]}
        resolution={512}
        mixBlur={1}
        mixStrength={32}
        mixContrast={1.1}
        roughness={0.8}
        depthScale={1.1}
        minDepthThreshold={0.3}
        maxDepthThreshold={1.6}
        color="#141416"
        metalness={0.4}
      />
    </mesh>
  )
}

// dev: ?nodof turns the lens blur off to inspect the studio kit up close
const LENS_DOF = !(import.meta.env.DEV && location.search.includes('nodof'))
// dev: ?perf=noao,nobloom,noreflect,noshadow,nopost,nopit switch single costs off, to measure them
const PERF = import.meta.env.DEV ? new URLSearchParams(location.search).get('perf') ?? '' : ''
const off = (k: string) => PERF.includes(k)

// livery swaps and burnouts kick a brief lens split, igloo-style
const caOffset = new THREE.Vector2(0, 0)
/** Once the car is in, every material in the studio is compiled in the background (parallel shader compile),
 *  into a render target the way the post-processing chain draws them, so the first sight of anything later in
 *  the lap doesn't stall a frame while its shader builds. */
function WarmUp() {
  const { gl, scene, camera } = useThree()
  const loaded = useStore((s) => s.loaded)
  useEffect(() => {
    if (!loaded) return
    const rt = new THREE.WebGLRenderTarget(1, 1)
    const prev = gl.getRenderTarget()
    gl.setRenderTarget(rt)
    const done = gl.compileAsync(scene, camera)
    gl.setRenderTarget(prev)
    done.then(() => rt.dispose())
  }, [loaded, gl, scene, camera])
  return null
}

function AberrationDriver() {
  useFrame((_, dt) => {
    fx.aberration = Math.max(0, fx.aberration - dt * 1.4)
    const k = fx.aberration * fx.aberration * 0.006 + engine.burnout * 0.0012 + drive.speed * 0.0016
    caOffset.set(k, k * 0.6)
  })
  return null
}

// the left pit-wall stand's screens, where the lens pulls focus on the Pit wall corner
export const PIT_FOCUS = new THREE.Vector3(-7.6, 1.25, -0.9)
const CAR_FOCUS = new THREE.Vector3(0, 0.45, 0)
/** Pulls focus from the car to the pit-wall screens as the camera arrives at that corner, and back. */
const zf = new THREE.Vector3()
function FocusPuller({ dof }: { dof: React.RefObject<DepthOfFieldEffect | null> }) {
  const w = useRef(0)
  const focusK = useRef(0)
  useFrame((_, dt) => {
    const e = dof.current
    if (!e || !e.target) return
    const at = scroll.progress * (SHOTS.length - 1)
    w.current = THREE.MathUtils.damp(w.current, Math.max(0, 1 - Math.abs(at - 4) * 1.6), 4, dt)
    e.target.copy(CAR_FOCUS).lerp(PIT_FOCUS, THREE.MathUtils.clamp(w.current, 0, 1))
    // a zoomed screen takes the focus
    if (pitZoom.mesh) { pitZoom.mesh.getWorldPosition(zf); focusK.current = THREE.MathUtils.damp(focusK.current, 1, 5, dt) }
    else focusK.current = THREE.MathUtils.damp(focusK.current, 0, 5, dt)
    if (focusK.current > 0.001) e.target.lerp(zf, focusK.current)
  })
  return null
}

const parked = () => store.get().hold && drive.speed < 0.01

export function Scene() {
  const dof = useRef<DepthOfFieldEffect | null>(null)
  // the lens rain is a full-screen pass of its own, so it is only in the chain while it is raining
  useWeather()
  const wet = weather.wet() > 0
  // resolution steps down if the frame rate can't keep up, and back up when it can
  const [dpr, setDpr] = useState(() => Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 1.5))
  return (
    <Canvas
      className="stage"
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%' }}
      shadows={off('noshadow') ? false : 'soft'}
      dpr={dpr}
      gl={{ antialias: false, powerPreference: 'high-performance', toneMapping: THREE.NoToneMapping }}
      camera={{ position: SHOTS[0].pos, fov: SHOTS[0].fov, near: 0.1, far: 80 }}
    >
      {/* a resolution change reallocates every render target, a visible hitch, so it only ever happens with
          the car parked, never in the middle of a drive */}
      <PerformanceMonitor bounds={() => [48, 58]} flipflops={4}
        onDecline={() => { if (parked()) setDpr((d) => Math.max(0.85, +(d - 0.25).toFixed(2))) }}
        onIncline={() => { if (parked()) setDpr((d) => Math.min(Math.min(devicePixelRatio, 1.5), +(d + 0.25).toFixed(2))) }} />
      <color attach="background" args={['#0d0e10']} />
      {/* haze the colour of the cove's horizon band, so the floor melts into the backdrop instead of a black edge */}
      <fog attach="fog" args={['#121316', 10, 26]} />
      <Cove />
      <Studio />
      <spotLight position={[2, 9, 3]} angle={0.55} penumbra={1} intensity={220} decay={2} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0001} />
      <spotLight position={[-6, 3, -5]} angle={0.6} penumbra={1} intensity={80} decay={2} color="#dfe6ff" />
      <Suspense fallback={null}>
        <Car />
        <Smoke />
        <NameWall />
        <WindTunnel />
        <Blueprint />
        {/* the garage: two pit-wall stands in the dark either side of the car, angled to the hero camera,
            with roll cabinets and stacked wheels; the lens keeps them softly out of focus */}
        {off('nopit') ? <></> : <><PitWall position={[-7.6, 0, -0.9]} yaw={1.05} swivel>
          <ToolCabinet position={[-2.15, 0, 0.05]} yaw={0.08} />
          <ToolCabinet position={[-3.12, 0, 0.12]} yaw={0.02} width={0.78} />
          <WheelStack position={[1.95, 0, 0.45]} count={4} turn={0.3} />
          <WheelStack position={[2.6, 0, 0.1]} count={3} turn={1.4} />
        </PitWall>
        <PitWall position={[-3.1, 0, -9.6]} yaw={0.6} order={[4, 3, 5, 0, 1, 2]}>
          <WheelStack position={[-1.95, 0, 0.4]} count={4} turn={2.2} />
          <ToolCabinet position={[2.15, 0, 0.05]} yaw={-0.08} />
        </PitWall></>}
      </Suspense>
      {off('noreflect') ? <></> : <Floor />}
      {/* the visitor's weather: a wet floor, rings, rain through the lights (and drops on the lens, below) */}
      <RainDriver />
      <WetFloor />
      <Ripples />
      <RainFall />
      <RollingRoad />
      <LightStreaks />
      <CameraRig />
      <WarmUp />
      <AberrationDriver />
      <EffectComposer multisampling={off('nomsaa') ? 0 : 2} enableNormalPass enabled={!off('nopost')}>
        {/* contact darkening in seams, under the floor and around the suspension: the biggest step away from 'CG' */}
        {off('noao') ? <></> : <N8AO aoRadius={0.45} distanceFalloff={0.6} intensity={2.6} quality="medium" halfRes />}
        {/* the exploded drawing's feature lines and blueprint grade (Projects corner) */}
        <CadLines />
        {/* a real lens: sharp on the car, the studio and the kit around it falling softly out of focus */}
        {LENS_DOF ? <DepthOfField ref={dof} target={[0, 0.45, 0]} worldFocusRange={9} bokehScale={2.4} /> : <></>}
        <FocusPuller dof={dof} />
        {off('nobloom') ? <></> : <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.2} intensity={0.55} />}
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <ChromaticAberration offset={caOffset} radialModulation modulationOffset={0.25} />
        {wet ? <RainLens /> : <></>}
        <Vignette offset={0.25} darkness={0.75} />
        <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.18} />
      </EffectComposer>
    </Canvas>
  )
}
