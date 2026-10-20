import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import gsap from 'gsap'
import * as THREE from 'three'
import { scroll, store } from './store'
import { engine } from './engine'
import { fx, WALL } from './fx'
import { carRig } from './Car'

// The driver's name, set as a giant backdrop in the studio. Hidden until the first hard burnout:
// a smoke curtain rolls across it, then the letters burn through the haze in a staggered rise.
// Afterwards it lives with the car: spin the car and the name slides in parallax and leans into the motion.
// Texture channels: R = first name (solid), G = surname (outline). Everything else about the driver is on the car.
const TW = 4096
const TH = 1500
// one line of caps: its size and baseline in the texture, and the top of the caps as a fraction of the wall
// height above its centre (the screen line it must stay below is SAFE_TOP)
const BASELINE = 1000
/** measured when the name is painted: top of the caps as a fraction of the wall height above its centre */
let TEXT_TOP = 0.2
/** u-span and v-centre of each of the 11 letters, filled by paint() */
const LETTERS: THREE.Vector4[] = []
const N_LETTERS = 11
/** seconds between letters, and how long each one takes to pop */
const POP_STEP = 0.14
/** How long the burnout must have been smoking before the name starts to come through, seconds. */
const SMOKE_FIRST = 1.9
const POP_DUR = 0.5
const POP_END = (N_LETTERS - 1) * POP_STEP + POP_DUR
const SAFE_TOP = 88
const WALL_H = (WALL.width * TH) / TW
const DISPLAY = "'Big Shoulders Display', 'Archivo', 'Helvetica Neue', Arial, sans-serif"

function paint(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = TW
  c.height = TH
  const g = c.getContext('2d')! as CanvasRenderingContext2D & { letterSpacing?: string }
  g.fillStyle = '#000'
  g.fillRect(0, 0, TW, TH)
  g.globalCompositeOperation = 'lighter'
  g.textBaseline = 'alphabetic'
  g.textAlign = 'left'
  // "Behind the car": one line in Big Shoulders Display Black, the first name solid, the surname a thin outline
  // in the livery's red. The car stands in front of it and cuts across its lower edge.
  // fit the line to the texture, then measure the caps so the name can be placed by its real top edge
  let px = 860
  const set = () => { g.font = `900 ${px}px ${DISPLAY}`; g.letterSpacing = `${-0.005 * px}px` }
  set()
  const total = () => g.measureText('RAUNAK').width + 0.18 * px + g.measureText('SAOJI').width
  px = Math.floor(px * Math.min(1, (TW * 0.95) / total()))
  set()
  const FONT_PX = px
  const gap = 0.18 * FONT_PX
  const w1 = g.measureText('RAUNAK').width
  const w2 = g.measureText('SAOJI').width
  TEXT_TOP = (TH / 2 - (BASELINE - g.measureText('RAUNAK').actualBoundingBoxAscent)) / TH
  const x1 = (TW - (w1 + gap + w2)) / 2
  const x2 = x1 + w1 + gap
  // each letter's span across the texture (u) and the caps' middle (v), so the shader can pop them one by one
  const ascent = g.measureText('RAUNAK').actualBoundingBoxAscent
  const cy = 1 - (BASELINE - ascent / 2) / TH
  LETTERS.length = 0
  ;[['RAUNAK', x1], ['SAOJI', x2]].forEach(([word, x0]) => {
    const w = word as string
    for (let k = 0; k < w.length; k++) {
      const a = g.measureText(w.slice(0, k)).width
      const b = g.measureText(w.slice(0, k + 1)).width
      LETTERS.push(new THREE.Vector4(((x0 as number) + a) / TW, ((x0 as number) + b) / TW, cy, 0))
    }
  })
  g.fillStyle = '#ff0000'
  g.fillText('RAUNAK', x1, BASELINE)
  g.strokeStyle = '#00ff00'
  g.lineWidth = 0.0105 * FONT_PX
  g.lineJoin = 'round'
  g.strokeText('SAOJI', x2, BASELINE)
  return c
}

const vert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
const frag = /* glsl */ `
  uniform sampler2D uTex;
  uniform vec3 uInk;
  uniform vec3 uAccent;
  uniform float uPop;
  uniform float uOpacity;
  uniform float uSkew;
  uniform vec4 uLetters[${N_LETTERS}];
  varying vec2 vUv;

  void main() {
    // lean into the car's spin: a shear that grows towards the top of the lockup
    vec2 uv = vUv;
    uv.x += (uv.y - 0.5) * uSkew;
    // which letter this pixel belongs to
    int idx = -1;
    vec4 L = vec4(0.0);
    for (int i = 0; i < ${N_LETTERS}; i++) {
      vec4 l = uLetters[i];
      if (uv.x >= l.x && uv.x < l.y) { idx = i; L = l; }
    }
    if (idx < 0) discard;
    // letter by letter, left to right: each one pops up out of nothing with a little overshoot, then settles
    float lt = clamp((uPop - float(idx) * ${POP_STEP}) / ${POP_DUR}, 0.0, 1.0);
    float k1 = 1.15;
    float s = 1.0 + (k1 + 1.0) * pow(lt - 1.0, 3.0) + k1 * pow(lt - 1.0, 2.0);
    s = max(s, 0.001);
    float cx = (L.x + L.y) * 0.5;
    vec2 suv = vec2(cx + (uv.x - cx) / s, L.z + (uv.y - L.z) / s - (1.0 - lt) * 0.05);
    // sampled with the unscaled footprint, so a letter still tiny doesn't smear its whole column
    vec3 t = (s > 0.06 && suv.x >= L.x && suv.x < L.y && suv.y > 0.0 && suv.y < 1.0) ? textureGrad(uTex, suv, dFdx(uv), dFdy(uv)).rgb : vec3(0.0);
    float pop = smoothstep(0.0, 0.3, lt);
    float letters = max(t.r, t.g);
    // brushed-metal falloff on the solid name, the outline in the livery's accent; a brief flash as each lands
    vec3 ink = uInk * (0.8 + 0.28 * vUv.y);
    vec3 col = ink * t.r + uAccent * 1.35 * t.g;
    col += uInk * 0.5 * letters * (1.0 - smoothstep(0.35, 0.8, lt)) * pop;
    float a = letters * pop * uOpacity;
    if (a < 0.002) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`

export function NameWall() {
  const [ready, setReady] = useState(false)
  const mesh = useRef<THREE.Mesh>(null)
  const motion = useRef({ lastYaw: 0, vel: 0, slide: 0, skew: 0 })
  /** seconds of heavy burnout so far: the name waits until the smoke has built up */
  const smoke = useRef(0)
  const mat = useMemo(
    () => new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: null },
        uInk: { value: new THREE.Color('#dedbd4') },
        uAccent: { value: new THREE.Color('#a7484d') },
        uPop: { value: 0 },
        uLetters: { value: Array.from({ length: N_LETTERS }, () => new THREE.Vector4(2, 2, 0.5, 0)) },
        uOpacity: { value: 1 },
        uTime: { value: 0 },
        uSkew: { value: 0 },
      },
      vertexShader: vert,
      fragmentShader: frag,
      // drawn in the opaque pass right after the floor and before the car, blended and without depth, so it is
      // always behind the car and never hidden by the floor
      transparent: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      // never hidden by the floor (the depth test always passes), but writes its depth so the depth of field
      // reads it at its own distance, in focus, instead of the far studio's (WebGL skips depth writes when the
      // test is off, hence ALWAYS rather than off)
      depthTest: true,
      depthFunc: THREE.AlwaysDepth,
      depthWrite: true,
      toneMapped: false,
    }),
    [],
  )

  useEffect(() => {
    let alive = true
    Promise.all([document.fonts.load(`900 64px ${DISPLAY}`)])
      .catch(() => {})
      .then(() => {
        if (!alive) return
        const t = new THREE.CanvasTexture(paint())
        LETTERS.forEach((v, k) => mat.uniforms.uLetters.value[k]?.copy(v))
        t.anisotropy = 8
        mat.uniforms.uTex.value = t
        setReady(true)
      })
    return () => { alive = false }
  }, [mat])

  const target = useMemo(() => new THREE.Color(), [])
  const base = useMemo(() => new THREE.Vector3(), [])
  const fwd = useMemo(() => new THREE.Vector3(), [])
  const carCentre = useMemo(() => new THREE.Vector3(0, 0.45, 0), [])
  const camUp = useMemo(() => new THREE.Vector3(), [])
  const camRight = useMemo(() => new THREE.Vector3(), [])
  useFrame((state, dt) => {
    const u = mat.uniforms
    u.uTime.value = state.clock.elapsedTime
    target.set(store.get().active.accent)
    u.uAccent.value.lerp(target, 1 - Math.exp(-dt * 3))
    u.uOpacity.value = 1 - THREE.MathUtils.smoothstep(scroll.progress, 0.03, 0.13)

    // the name follows the car: parallax slide with the car's heading, a lean with its spin speed
    const m = motion.current
    const yaw = carRig.yaw
    const w = (yaw - m.lastYaw) / Math.max(dt, 1e-3)
    m.lastYaw = yaw
    m.vel = THREE.MathUtils.damp(m.vel, w, 6, dt)
    m.slide = THREE.MathUtils.damp(m.slide, Math.sin(yaw) * 0.9, 4, dt)
    m.skew = THREE.MathUtils.damp(m.skew, THREE.MathUtils.clamp(-m.vel * 0.035, -0.22, 0.22), 8, dt)
    u.uSkew.value = m.skew
    // only in the scene while it can be seen, so its depth never sharpens a patch of the out-of-focus studio
    if (mesh.current) mesh.current.visible = fx.revealed && u.uOpacity.value > 0.01
    if (mesh.current) {
      // The name hangs in the studio a few metres behind the car, but is placed from the camera every frame:
      // centred, its top just under the header, sized to the screen. So no camera angle, tilt or window shape
      // can push it out of frame. It still slides with the car's heading.
      const cam = state.camera as THREE.PerspectiveCamera
      cam.getWorldDirection(fwd)
      camUp.set(0, 1, 0).applyQuaternion(cam.quaternion)
      camRight.set(1, 0, 0).applyQuaternion(cam.quaternion)
      // just beyond the car's far end, so the lens keeps it as sharp as the car
      const D = cam.position.distanceTo(carCentre) + 2.6
      const half = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * D
      // phones shift the camera's frame (setViewOffset in CameraRig); place the name in the visible window
      const v = cam.view && cam.view.enabled ? cam.view : null
      const fullW = v ? v.fullWidth : state.size.width
      const fullH = v ? v.fullHeight : state.size.height
      const portrait = state.size.width < state.size.height
      const visW = 2 * half * (fullW / fullH)
      const W = Math.min(visW * (portrait ? 0.94 : 0.7), half * 3.8)
      const k = W / WALL.width
      // the caps start a little below the header, low enough that the car stands across their lower edge
      const topPx = Math.max(SAFE_TOP, state.size.height * 0.11)
      const topNdc = 1 - (2 * (topPx + (v ? v.offsetY : 0))) / fullH
      const midNdc = v ? (2 * (v.offsetX + v.width / 2)) / fullW - 1 : 0
      const lift = topNdc * half - TEXT_TOP * WALL_H * k
      base.copy(cam.position).addScaledVector(fwd, D).addScaledVector(camUp, lift)
        .addScaledVector(camRight, midNdc * (visW / 2) - m.slide * k)
      mesh.current.position.copy(base)
      mesh.current.quaternion.copy(cam.quaternion)
      mesh.current.scale.setScalar(k)
    }

    smoke.current = engine.burnout > 0.6 ? smoke.current + dt : Math.max(0, smoke.current - dt * 0.5)
    if (!fx.revealed && ready && (smoke.current > SMOKE_FIRST || fx.requestReveal) && scroll.progress < 0.08) {
      fx.revealed = true
      store.set({ revealed: true })
      document.body.classList.add('burning')
      const tl = gsap.timeline({ onComplete: () => document.body.classList.remove('burning') })
      // the letters pop up one after another behind the burnout
      tl.to(u.uPop, { value: POP_END, duration: POP_END, ease: 'none' }, 0.45)
        .call(() => { fx.aberration = 0.35 }, [], 0.45 + POP_END - 0.2)
        // the name is fully up: the lap opens
        .call(() => store.set({ entered: true }), [], 0.45 + POP_END + 0.2)
        .set({}, {}, 0.45 + POP_END + 0.6)
    }
  })

  if (!ready) return null
  return (
    // layer 1: seen by the camera but kept out of the floor reflection
    <mesh ref={mesh} position={WALL.center} material={mat} renderOrder={-1} onUpdate={(o) => o.layers.set(1)}>
      <planeGeometry args={[WALL.width, (WALL.width * TH) / TW]} />
    </mesh>
  )
}
