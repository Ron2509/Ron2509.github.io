import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import gsap from 'gsap'
import * as THREE from 'three'
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh'
import { store, scroll } from './store'
import { LENS_OF, LIVERIES, trialLivery, petrolIn, type LiveryDef } from './liveries'
import { LiveryPainter } from './liveryMaterial'
import { makeTyreMaterial } from './tyreMaterial'
import { pitSwivel } from './PitWall'
import { engine } from './engine'
import { CHAPTERS } from './config'
import { SPONSOR_SETS } from './sponsors'
import { drive, fx, pit } from './fx'
import { PROJECTS, type Anchor, type AssemblyId } from './content'
import { buildAssemblies, driveExplode, liveAnchor, resetExplode, type Assembly } from './explode'
import { bakeRest } from './paintRest'
import { buildDust, driveDust, dustTumble, dustUniforms, hurryDust, patchDissolve, playDust, type Dust } from './dust'

// scene length of the car; the camera shots are framed around this scale
const CAR_LENGTH = 4.55
// full-detail car (2.45M tris) on desktop, the lighter build on phones and touch devices
// dev: ?carlo / ?carhi force one or the other, to compare
const FORCE = import.meta.env.DEV && typeof location !== 'undefined' ? (location.search.includes('carlo') ? 'lo' : location.search.includes('carhi') ? 'hi' : '') : ''
const MODEL = FORCE ? (FORCE === 'hi' ? `${import.meta.env.BASE_URL}models/car-hi.glb` : `${import.meta.env.BASE_URL}models/car.glb`)
  : typeof matchMedia !== 'undefined' && matchMedia('(min-width: 900px) and (pointer: fine)').matches
  ? `${import.meta.env.BASE_URL}models/car-hi.glb`
  : `${import.meta.env.BASE_URL}models/car.glb`
/** Livery shown in the paint lens: the hovered swatch, else the next one after what's on the car. */
// The lens always shows a livery in strong contrast with the car, so the change is unmistakable:
// light pearl over the dark cars, stealth black over the pearl car. A hovered swatch overrides it.
function lensLivery(current: LiveryDef) {
  const s = store.get()
  const byId = (id: string) => LIVERIES.find((l) => l.id === id) ?? LIVERIES[0]
  if (s.preview && s.preview !== current.id) return byId(s.preview)
  return byId(LENS_OF[current.id] ?? 'petrol')
}

const SCROLL_HOME = 0.6 // scroll speed above which the car eases back to its framed angle
// drags start anywhere except real controls, cards included; the paint lens also stays off while over a card
const INTERACTIVE = 'a, button, input, select, textarea, [role="button"], .top, .circuit'
const NO_LENS = INTERACTIVE + ', .card'

/** Positions in the car rig's local space, filled once the model is normalised. */
export const carRig = {
  root: null as THREE.Group | null,
  rearL: new THREE.Vector3(-1.9, 0.05, 0.75),
  rearR: new THREE.Vector3(-1.9, 0.05, -0.75),
  exhaust: new THREE.Vector3(-2.4, 0.55, 0),
  dragged: false,
  /** current car heading in radians, for things that move with the car */
  yaw: 0,
  /** how far the car is lifted off the floor right now (it rises to turn over on the last pages), metres */
  lift: 0,
  /** camera tilt from dragging up and down, radians; positive looks down from above */
  pitch: 0,
  /** one front wheel assembly and its transform in rig space, for the tyre stacks in the garage */
  wheel: null as { obj: THREE.Object3D; matrix: THREE.Matrix4 } | null,
  /** points on the bodywork the content blocks point at, in rig space */
  anchors: {} as Record<Anchor, THREE.Vector3>,
  /** the car as an exploded drawing on the Projects corner (see explode.ts) */
  assemblies: [] as Assembly[],
  /** the car as fine dust, for the last two corners (see dust.ts) */
  dust: null as Dust | null,
  /** 0..1, how far the car is pulled apart */
  explode: 0,
}

/** Where an anchor's point is right now, in rig space: it travels with its assembly when the car is exploded. */
export function anchorNow(name: Anchor, out: THREE.Vector3) {
  return liveAnchor(carRig.assemblies, name, carRig.anchors[name], out)
}

function makeMaterials() {
  const paint = new THREE.MeshPhysicalMaterial({
    color: '#ffffff', metalness: 0.08, roughness: 0.5, clearcoat: 0.18, clearcoatRoughness: 0.42, envMapIntensity: 1.15,
  })
  const carbon = new THREE.MeshPhysicalMaterial({ color: '#0d0e10', metalness: 0.2, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.12 })
  const carbonMatte = new THREE.MeshStandardMaterial({ color: '#0c0c0e', metalness: 0.15, roughness: 0.7 })
  const rubber = new THREE.MeshStandardMaterial({ color: '#121212', metalness: 0, roughness: 0.88 })
  // wheel covers and rims: deep, lacquered carbon with a metal edge to the light
  const rim = new THREE.MeshPhysicalMaterial({ color: '#0b0c0e', metalness: 0.35, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.18 })
  const metal = new THREE.MeshStandardMaterial({ color: '#8d9096', metalness: 1, roughness: 0.28 })
  const chrome = new THREE.MeshStandardMaterial({ color: '#d6d8dc', metalness: 1, roughness: 0.06 })
  const brass = new THREE.MeshStandardMaterial({ color: '#b08d57', metalness: 1, roughness: 0.3 })
  const glass = new THREE.MeshPhysicalMaterial({ color: '#0a0b0d', roughness: 0.02, transparent: true, opacity: 0.55, clearcoat: 1, envMapIntensity: 1.5 })
  const accent = new THREE.MeshPhysicalMaterial({ color: '#d9d6cf', metalness: 0.3, roughness: 0.35, clearcoat: 1 })
  const led = new THREE.MeshStandardMaterial({ color: '#200000', emissive: new THREE.Color('#ff1414'), emissiveIntensity: 0 })
  const fabric = new THREE.MeshStandardMaterial({ color: '#17181b', roughness: 0.95 })
  return { paint, carbon, carbonMatte, rubber, rim, metal, chrome, brass, glass, accent, led, fabric }
}
type Mats = ReturnType<typeof makeMaterials>

// Bodywork panels get the livery; aero parts stay bare carbon like a real car.
const PAINTED = /^(body_object|cockpit_inner|mirror_main_body|rear_wing_no_mod|rear_wing_drs_flap_sides|drs_wing_part)/

function pick(owner: string, matName: string, m: Mats): THREE.Material | null {
  const n = matName.toLowerCase()
  // dropped from the source scene: its studio light, a stray logo that floats behind the car and stretched the
  // bounds the livery is mapped to, and a branded dashboard screen
  if (/light_half_sphere|^bee|dashboard_screen/.test(owner)) return null
  if (n.includes('rear_led_emmitor')) return m.led
  if (n.includes('tyre') || n.startsWith('rubber')) return m.rubber
  if (n.includes('glossy_paint_wheel')) return m.rim
  if (n.includes('paint_wheel_cover')) return m.carbon
  if (n.includes('reflex_yellow')) return m.accent
  if (n.includes('chrome')) return m.chrome
  if (n.includes('brass')) return m.brass
  if (n.includes('anodized') || n === 'metal' || n.includes('degradable')) return m.metal
  if (n.includes('glass') || n.includes('polycarbonate') || n.includes('pp.001') || n === 'none') return m.glass
  if (/fabric|felt|seatbelt|suit|lather|leather/.test(n)) return m.fabric
  if (n.includes('carbon')) {
    if (PAINTED.test(owner) && (!n.includes('procedural') || /^(rear_wing|drs_wing)/.test(owner))) return m.paint
    return n.includes('rough') ? m.carbonMatte : m.carbon
  }
  return m.carbonMatte
}

const ownerName = (o: THREE.Object3D, root: THREE.Object3D) => {
  let cur: THREE.Object3D = o
  while (cur.parent && cur.parent !== root) cur = cur.parent
  return cur.name
}

export function Car() {
  const { scene } = useGLTF(MODEL, false, true)
  const { gl, camera } = useThree()
  const camRef = useRef(camera)
  camRef.current = camera
  const mats = useMemo(makeMaterials, [])
  const painter = useMemo(() => new LiveryPainter(Math.min(8, gl.capabilities.getMaxAnisotropy())), [gl])
  const uniforms = painter.uniforms
  const root = useRef<THREE.Group>(null)
  const yaw = useRef({ value: 0, vel: 0, dragging: false, lastX: 0, lastY: 0 })
  const hover = useRef({ x: -9999, y: -9999, on: false })
  // the paint lens lives on the car: a raycast finds the point under the cursor, a trail follows it
  const lens = useRef({ ray: new THREE.Raycaster(), ndc: new THREE.Vector2(), hit: new THREE.Vector3(0, -99, 0), last: new THREE.Vector3(0, -99, 0), ring: 1, onCar: false })
  const painted = useRef<THREE.Mesh[]>([])
  const livery = useRef({ current: '', tween: null as gsap.core.Tween | null, ready: false })
  const rearWheels = useRef<THREE.Group[]>([])
  // every wheel spins on its own hub; the fronts also steer
  const spinners = useRef<THREE.Group[]>([])
  const steerers = useRef<THREE.Group[]>([])
  const tyres = useRef<{ uBlur: { value: number } }[]>([])
  const pitTl = useRef<gsap.core.Timeline | null>(null)
  const lateralAxis = useRef<'x' | 'z'>('z')
  const body = useRef({ pitch: 0, roll: 0 })
  // the last two pages: the car can be picked up and turned any way at all (a trackball, in world space), with
  // a little spin left when it is let go; left alone, it rights itself and sets back down
  const free = useRef({ q: new THREE.Quaternion(), w: new THREE.Vector3(), at: 0 })
  const ends = useRef({ here: false, at: 0, flag: false, shadows: true })
  const shadowMat = useRef<THREE.MeshBasicMaterial>(null)
  const order = useRef({ key: '', pending: null as AssemblyId[] | null, now: null as AssemblyId[] | null })

  const model = useMemo(() => {
    const s = scene.clone(true)
    s.updateMatrixWorld(true)
    const drop: THREE.Object3D[] = []
    const list: THREE.Mesh[] = []
    // only the big panels wear the livery; the small pieces of bodywork (suspension fairings, louvres, cockpit
    // trim, cameras, aerials) are bare carbon, as on the real car, or the colour bleeds into the car's insides
    const carLen = new THREE.Box3().setFromObject(s).getSize(new THREE.Vector3()).length()
    const pieceBox = new THREE.Box3()
    s.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      let mat = pick(ownerName(mesh, s), (mesh.material as THREE.Material)?.name ?? '', mats)
      if (!mat) { drop.push(mesh); return }
      if (mat === mats.paint && /^body_object/.test(ownerName(mesh, s))) {
        const size = pieceBox.setFromObject(mesh).getSize(new THREE.Vector3())
        if (Math.max(size.x, size.y, size.z) < carLen * 0.12) mat = mats.carbon
      }
      // the four tyres get their own sidewall shader, keyed to each tyre's hub
      if (mat === mats.rubber && /^wheel(Ft|Bk)(L|R)_/.test(ownerName(mesh, s))) {
        const tm = makeTyreMaterial(mesh.geometry)
        tyres.current.push(tm.userData.tyre)
        mesh.material = tm
      } else mesh.material = mat
      mesh.castShadow = true
      mesh.receiveShadow = true
      if (mat === mats.paint) list.push(mesh)
    })
    drop.forEach((d) => d.removeFromParent())
    // a bounding-volume hierarchy on the painted panels keeps the per-frame lens raycast cheap
    for (const m of list) {
      const geo = m.geometry as THREE.BufferGeometry & { computeBoundsTree?: typeof computeBoundsTree }
      geo.computeBoundsTree = computeBoundsTree
      geo.computeBoundsTree()
      m.raycast = acceleratedRaycast
    }
    painted.current = list

    const rawSize = new THREE.Box3().setFromObject(s).getSize(new THREE.Vector3())
    lateralAxis.current = rawSize.z > rawSize.x ? 'x' : 'z'

    // Each wheel assembly gets a steer pivot at its hub (turned only on the fronts) holding a spin pivot.
    rearWheels.current = []
    spinners.current = []
    steerers.current = []
    for (const axle of ['Bk', 'Ft'] as const) {
      for (const side of ['L', 'R'] as const) {
        const prefix = (axle === 'Bk' ? 'r' : 'f') + (side === 'L' ? 'l_' : 'r_')
        // GLTFLoader strips dots from node names: "wheel.Bk.L_object" arrives as "wheelBkL_object"
        const parts = s.children.filter((c) => c.name.startsWith(`wheel${axle}${side}_`) || c.name.startsWith(prefix))
        const tyre = parts.find((c) => c.name.startsWith(`wheel${axle}${side}_`))
        if (!tyre) continue
        const hub = new THREE.Box3().setFromObject(tyre).getCenter(new THREE.Vector3())
        const steer = new THREE.Group()
        steer.name = `${axle === 'Bk' ? 'rear' : 'front'}-${side}`
        steer.position.copy(hub)
        const spin = new THREE.Group()
        steer.add(spin)
        s.add(steer)
        steer.updateMatrixWorld(true)
        // only what is round and centred on the axle turns with the wheel (tyre, rim, disc, nut); the upright, brake
        // duct and caliper sit off the axle and steer with the wheel but never spin, or they orbit the hub
        const tsize = new THREE.Box3().setFromObject(tyre).getSize(new THREE.Vector3())
        const axis = tsize.x < tsize.y && tsize.x < tsize.z ? 0 : tsize.y < tsize.z ? 1 : 2
        const plane = [0, 1, 2].filter((i) => i !== axis)
        const pb = new THREE.Box3(), pc = new THREE.Vector3(), ps = new THREE.Vector3()
        parts.forEach((p) => {
          pb.setFromObject(p); pb.getCenter(pc); pb.getSize(ps)
          const off = Math.hypot(pc.getComponent(plane[0]) - hub.getComponent(plane[0]), pc.getComponent(plane[1]) - hub.getComponent(plane[1]))
          const a = ps.getComponent(plane[0]), b = ps.getComponent(plane[1])
          const round = p === tyre || (off < 0.02 && Math.abs(a - b) <= 0.12 * Math.max(a, b))
          ;(round ? spin : steer).attach(p)
        })
        spinners.current.push(spin)
        if (axle === 'Bk') rearWheels.current.push(steer)
        else steerers.current.push(steer)
      }
    }

    // Normalise: length -> X, nose -> +X, wheels on the floor, real-world length.
    const wrap = new THREE.Group()
    wrap.add(s)
    if (rawSize.z > rawSize.x) wrap.rotation.y = Math.PI / 2
    wrap.updateMatrixWorld(true)
    const c2 = new THREE.Box3().setFromObject(wrap).getCenter(new THREE.Vector3())
    const front = s.children.find((c) => c.name.startsWith('front_wing_mixer'))
    if (front && new THREE.Box3().setFromObject(front).getCenter(new THREE.Vector3()).x < c2.x) wrap.rotation.y += Math.PI
    wrap.updateMatrixWorld(true)
    const b3 = new THREE.Box3().setFromObject(wrap)
    const k = CAR_LENGTH / b3.getSize(new THREE.Vector3()).x
    const c3 = b3.getCenter(new THREE.Vector3())
    wrap.position.set(-c3.x, -b3.min.y, -c3.z)
    const outer = new THREE.Group()
    outer.add(wrap)
    outer.scale.setScalar(k)
    outer.updateMatrixWorld(true)

    const fl = spinners.current[2]
    if (fl) carRig.wheel = { obj: fl, matrix: fl.matrixWorld.clone() }

    // Callout anchors: probe the painted panels straight down or in from the near flank, so each line lands
    // on real bodywork whatever the model's exact shape
    const probe = new THREE.Raycaster()
    ;(probe as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true
    const at = (o: [number, number, number], d: [number, number, number], fb: [number, number, number]) => {
      probe.set(new THREE.Vector3(...o), new THREE.Vector3(...d).normalize())
      const h = probe.intersectObjects(list, false)[0]
      return h ? h.point.clone() : new THREE.Vector3(...fb)
    }
    carRig.anchors = {
      nose: at([1.45, 3, 0], [0, -1, 0], [1.45, 0.3, 0]),
      halo: at([0.38, 3, 0], [0, -1, 0], [0.38, 0.6, 0]),
      sidepod: at([-0.35, 0.36, 4], [0, 0, -1], [-0.35, 0.36, 0.6]),
      engine: at([-0.95, 3, 0], [0, -1, 0], [-0.95, 0.75, 0]),
      rearwing: at([-2.12, 3, 0], [0, -1, 0], [-2.12, 0.95, 0]),
    }

    // Livery coordinate frame + emitter positions, all in rig space.
    const body = new THREE.Box3().setFromObject(outer)
    uniforms.uBMin.value.copy(body.min)
    uniforms.uBSize.value.copy(body.getSize(new THREE.Vector3()))
    for (const w of rearWheels.current) {
      const bb = new THREE.Box3().setFromObject(w)
      const v = bb.getCenter(new THREE.Vector3())
      v.y = 0.06
      v.x = bb.min.x + (bb.max.x - bb.min.x) * 0.45
      if (w.name === 'rear-L') carRig.rearL.copy(v)
      else carRig.rearR.copy(v)
    }
    const ex = s.children.find((c) => /^exhaust_Cylinder\d/.test(c.name))
    if (ex) {
      const bb = new THREE.Box3().setFromObject(ex)
      carRig.exhaust.set(bb.min.x, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2)
    }
    if (import.meta.env.DEV) Object.assign(window, { __car: outer, __THREE: THREE })
    return outer
  }, [scene, mats, uniforms])

  // the exploded drawing is built from the model actually on screen (in development React builds the memo twice)
  useEffect(() => {
    const s = model.children[0]?.children[0]
    if (!s) return
    model.updateWorldMatrix(true, true)
    const rigInv = model.parent ? model.parent.matrixWorld.clone().invert() : new THREE.Matrix4()
    carRig.assemblies = buildAssemblies(s, rigInv)
    carRig.explode = 0
    // the paint is baked onto each painted part at rest, so it stays on a part that moves
    bakeRest(model, rigInv, (m) => m.material === mats.paint)
    // the dust is sampled off the car's surface in idle time from here on
    const du = buildDust(model, rigInv, mats.paint, matchMedia('(pointer: coarse)').matches ? 120000 : 380000)
    const rig = model.parent
    rig?.add(du.points)
    carRig.dust = du
    return () => {
      resetExplode(carRig.assemblies)
      carRig.assemblies = []
      du.stop()
      rig?.remove(du.points)
      du.points.geometry.dispose()
      du.mat.dispose()
      carRig.dust = null
    }
  }, [model, mats])

  useEffect(() => {
    let alive = true
    painter.apply(mats.paint)
    // every material on the car learns to turn to dust (dust.ts), sharing the livery's car-space matrix and bounds
    dustUniforms.uDInv.value = uniforms.uCarInv.value
    dustUniforms.uDMin.value = uniforms.uBMin.value
    dustUniforms.uDSize.value = uniforms.uBSize.value
    patchDissolve(model)
    // lettering is painted into the atlas, so wait for the faces before the first paint
    Promise.all([
      document.fonts.load("800 64px 'Archivo'"),
      document.fonts.load("600 64px 'Archivo'"),
    ]).catch(() => {}).then(() => {
      if (!alive) return
      const first = LIVERIES.find((l) => l.id === store.get().liveries[0]) ?? LIVERIES[0]
      painter.set(first, SPONSOR_SETS[0])
      if (import.meta.env.DEV) (window as unknown as { __tryColour: (hex: string) => void }).__tryColour = (hex) => painter.set(trialLivery(hex), SPONSOR_SETS[2])
      if (import.meta.env.DEV) (window as unknown as { __tryPetrol: (hex: string) => void }).__tryPetrol = (hex) => painter.set(petrolIn(hex), SPONSOR_SETS[1])
      document.documentElement.style.setProperty('--accent', first.accent)
      livery.current.current = first.id + '|' + SPONSOR_SETS[0].id
      livery.current.ready = true
      performance.mark('car:painted')
      store.set({ loaded: true })
    })
    return () => { alive = false }
  }, [mats, painter])

  // Free 360° rotation on every chapter: drag anywhere that isn't a control.
  useEffect(() => {
    const y = yaw.current
    let startX = 0
    let startY = 0
    let decided: 'rotate' | 'scroll' | null = null
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      const t = e.target as HTMLElement
      if (t.closest(INTERACTIVE)) return
      y.dragging = true
      decided = e.pointerType === 'touch' ? null : 'rotate'
      startX = y.lastX = e.clientX
      startY = y.lastY = e.clientY
      y.vel = 0
      if (decided === 'rotate') document.body.classList.add('grabbing')
    }
    const move = (e: PointerEvent) => {
      if (!y.dragging) return
      // on touch, a mostly-vertical swipe stays a page scroll
      if (!decided) {
        const ax = Math.abs(e.clientX - startX), ay = Math.abs(e.clientY - startY)
        if (ax + ay < 8) return
        decided = ax > ay ? 'rotate' : 'scroll'
        if (decided === 'scroll') { y.dragging = false; return }
      }
      e.preventDefault()
      const dx = e.clientX - y.lastX
      y.lastX = e.clientX
      // on the Pit wall corner a sideways drag turns the stand instead of the car
      const st = store.get()
      if (st.chapter === 4 && st.hold) {
        if (st.pitZoomed) return
        pitSwivel.target = THREE.MathUtils.clamp(pitSwivel.target - dx * 0.005, -0.8, 0.8)
        y.lastY = e.clientY
        return
      }
      // the last page: any direction at all, the car turning about its own middle
      if (st.chapter === CHAPTERS.length - 1 && st.hold) {
        const dy = e.pointerType !== 'touch' ? e.clientY - y.lastY : 0
        y.lastY = e.clientY
        const len = Math.hypot(dx, dy)
        if (len < 0.01) return
        const f = free.current
        // drag right turns it about the camera's up, drag down rolls its top towards you
        freeAxis.set(dy, dx, 0).normalize().applyQuaternion(camRef.current.quaternion)
        const ang = len * 0.0075
        f.q.premultiply(freeDq.setFromAxisAngle(freeAxis, ang))
        f.w.copy(freeAxis).multiplyScalar(ang * 60)
        f.at = performance.now()
        if (!carRig.dragged) { carRig.dragged = true; store.set({ dragged: true }) }
        return
      }
      y.vel = dx * 0.0085
      y.value += y.vel
      // with a mouse, up and down tilts the view over or under the car (touch keeps vertical for scrolling)
      if (e.pointerType !== 'touch') {
        carRig.pitch = THREE.MathUtils.clamp(carRig.pitch + (e.clientY - y.lastY) * 0.004, -0.1, 0.38)
      }
      y.lastY = e.clientY
      if (Math.abs(dx) > 2 && !carRig.dragged) { carRig.dragged = true; store.set({ dragged: true }) }
    }
    const up = () => { y.dragging = false; document.body.classList.remove('grabbing') }
    const track = (e: PointerEvent) => {
      const h = hover.current
      h.x = e.clientX
      h.y = e.clientY
      h.on = e.pointerType === 'mouse' && !(e.target as HTMLElement).closest(NO_LENS)
    }
    const leave = () => { hover.current.on = false }
    window.addEventListener('pointermove', track)
    document.documentElement.addEventListener('pointerleave', leave)
    window.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', track)
      document.documentElement.removeEventListener('pointerleave', leave)
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [])

  useFrame((state, dt) => {
    const g = root.current
    if (!g) return
    carRig.root = g
    g.updateMatrixWorld()
    uniforms.uCarInv.value.copy(g.matrixWorld).invert()

    // livery for the chapter we're in, swept on nose to tail
    const s = store.get()
    // the chapter whose section is actually on screen, not a guess from scroll percentage
    const idx = Math.min(CHAPTERS.length - 1, s.chapter)
    const target = LIVERIES.find((l) => l.id === s.liveries[idx]) ?? LIVERIES[0]
    // each corner repaints the car with that chapter's partner marks
    const partners = SPONSOR_SETS[Math.min(idx, SPONSOR_SETS.length - 1)]
    const key = target.id + '|' + partners.id
    const lv = livery.current
    // the livery changes only once the car has pulled up at the corner: a pit stop. Jacks up, wheel guns,
    // the paint sweeps nose to tail, drop, gone. The stop time goes up on the pit board (PitBoard).
    if (lv.ready && key !== lv.current && s.hold) {
      lv.tween?.kill()
      pitTl.current?.kill()
      lv.current = key
      const stop = 1.9 + Math.random() * 0.5
      store.set({ pitAt: performance.now(), pitTime: stop })
      const tl = gsap.timeline()
      tl.to(pit, { lift: 0.06, duration: 0.22, ease: 'power2.out' }, 0)
        .to(pit, { gun: 1, duration: 0.08 }, 0.2)
        .to(pit, { gun: 0, duration: 0.25 }, 0.62)
        .call(() => {
          // painted in the background; the sweep runs once the new paint is ready
          void painter.next(target, partners).then((ok) => { if (ok) lv.tween = gsap.to(uniforms.uMix, { value: 1, duration: 1.7, ease: 'sine.inOut' }) })
          fx.aberration = 0.35
          store.set({ partners })
        }, [], 0.3)
        .to(pit, { gun: 1, duration: 0.08 }, 1.2)
        .to(pit, { gun: 0, duration: 0.25 }, 1.55)
        .to(pit, { lift: 0, duration: 0.42, ease: 'bounce.out' }, stop - 0.4)
      pitTl.current = tl
    }
    if (s.active.id !== target.id) {
      document.documentElement.style.setProperty('--accent', target.accent)
      store.set({ active: target })
    }
    paintFinish(mats.paint, mats.accent, mats.rim, uniforms.uFlake, target, dt)

    // paint lens, on every corner: wherever the cursor is on the car, that patch shows the next livery
    const h = hover.current
    const lensL = lensLivery(target)
    if (lv.ready) painter.preview(lensL, partners)
    // inside the reveal the paint is glossy, wet clear-coat against the matte body, so the patch catches the light
    uniforms.uLensMetal.value = 0.2
    uniforms.uLensRough.value = 0.14
    const L = lens.current
    L.onCar = false
    if (h.on) {
      L.ndc.set((h.x / state.size.width) * 2 - 1, -(h.y / state.size.height) * 2 + 1)
      L.ray.setFromCamera(L.ndc, state.camera)
      ;(L.ray as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true
      const hit = L.ray.intersectObjects(painted.current, false)[0]
      if (hit) {
        L.hit.copy(hit.point).applyMatrix4(uniforms.uCarInv.value)
        L.onCar = true
      }
    }
    const lensOn = L.onCar && !document.body.classList.contains('grabbing') && !document.body.classList.contains('burning')
    uniforms.uLens.value = THREE.MathUtils.damp(uniforms.uLens.value, lensOn ? 1 : 0, lensOn ? 6 : 4, dt)
    // blob 0 rides under the cursor; moving drops more blobs along the path, which linger and recede
    const sp = uniforms.uSplats.value
    sp[0].set(L.hit.x, L.hit.y, L.hit.z, uniforms.uLens.value)
    if (lensOn && L.hit.distanceTo(L.last) > 0.11) {
      sp[L.ring].set(L.hit.x, L.hit.y, L.hit.z, 1)
      L.ring = (L.ring % (sp.length - 1)) + 1
      L.last.copy(L.hit)
    }
    const fade = Math.exp(-dt * 0.85)
    for (let i = 1; i < sp.length; i++) sp[i].w *= fade
    uniforms.uTime.value += dt

    // yaw: spin freely on any chapter; scrolling hands the car back to the film camera's framing
    const y = yaw.current
    if (!y.dragging && Math.abs(scroll.velocity) > SCROLL_HOME) {
      const home = Math.round(y.value / (Math.PI * 2)) * Math.PI * 2
      y.value = THREE.MathUtils.damp(y.value, home, 2.5, dt)
      y.vel = 0
      carRig.pitch = THREE.MathUtils.damp(carRig.pitch, 0, 2.5, dt)
    } else if (!y.dragging) {
      y.value += y.vel
      y.vel *= Math.exp(-dt * 2.6)
    }
    carRig.yaw = y.value

    // engine on: idle shake, burnout squat
    const t = state.clock.elapsedTime
    const shake = engine.running ? 0.0012 + engine.throttle * 0.0022 : 0
    const hz = Math.max(engine.rpm, 300) / 60
    // driving between corners: road vibration, squat under power, nose dip under braking (about 1 degree)
    const d = drive
    const road = d.speed * 0.0009 * (Math.sin(t * 41) + Math.sin(t * 67) * 0.5)
    const baseY = Math.sin(t * hz * 2.1) * shake + (Math.random() - 0.5) * shake * 0.6 + road + pit.lift
    body.current.pitch = THREE.MathUtils.damp(body.current.pitch, d.accel * 0.016, 5, dt)
    body.current.roll = THREE.MathUtils.damp(body.current.roll, engine.burnout * 0.014 + body.current.pitch, 6, dt)
    const rz = body.current.roll + Math.sin(t * hz * 1.3) * shake * 0.4

    // where the car is held: its heading and squat, then turned about its own middle by the visitor's hand (the
    // last pages) and by the dust's roll in the air, lifted exactly as far as it needs to clear the floor
    const f = free.current
    const last = s.chapter === CHAPTERS.length - 1 && s.hold
    if (!y.dragging || !last) {
      const sp = f.w.length()
      if (sp > 1e-3) { f.q.premultiply(freeDq.setFromAxisAngle(freeAxis.copy(f.w).divideScalar(sp), sp * dt)); f.w.multiplyScalar(Math.exp(-dt * 2.4)) }
      if (!last || performance.now() - f.at > 2200) f.q.slerp(IDENT, 1 - Math.exp(-dt * (last ? 1.5 : 3.5)))
    } else f.w.multiplyScalar(Math.exp(-dt * 12))
    qBase.setFromEuler(eBase.set(0, y.value, rz))
    if (carRig.dust) dustTumble(carRig.dust, qDust)
    else qDust.identity()
    qAll.copy(f.q).multiply(qBase).multiply(qDust)
    const bm = uniforms.uBMin.value, bs = uniforms.uBSize.value
    cLocal.set(bm.x + bs.x / 2, bm.y + bs.y / 2, 0)
    // the lowest corner of the car's box, turned: how far it must rise to stay clear of the floor
    let low = Infinity
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? bm.x + bs.x : bm.x, i & 2 ? bm.y + bs.y : bm.y, i & 4 ? bs.z / 2 : -bs.z / 2).sub(cLocal).applyQuaternion(qAll)
      low = Math.min(low, corner.y)
    }
    const tilted = 1 - Math.abs(qAll.clone().multiply(qBase.clone().invert()).w)
    const lift = Math.max(0, (bm.y - cLocal.y) - low) + Math.min(0.12, tilted * 2)
    cWorld.copy(cLocal).applyQuaternion(qBase).setY(cWorld.y + baseY)
    g.quaternion.copy(qAll)
    // lifted, it also comes forward into the middle of the overhead frame, so it never rises out of the top of it
    g.position.copy(cWorld).add(corner.set(0, lift, lift * 0.85)).sub(cLocal.applyQuaternion(qAll))
    carRig.lift = lift
    // wheels: rolling at road speed, wheel guns in the pit, rear spin in a burnout
    const ax = lateralAxis.current
    // in the wind tunnel the car sits on a running rolling road, so the wheels turn too
    const roll = (d.speed + fx.tunnel * 0.55) * 30 * dt + pit.gun * 40 * dt
    spinners.current.forEach((w, i) => { w.rotation[ax] -= roll + (i < 2 ? engine.burnout * 75 * dt : 0) })
    for (const sw of steerers.current) sw.rotation.y = THREE.MathUtils.damp(sw.rotation.y, d.steer * 0.15, 6, dt)
    const blur = Math.min(1, (d.speed + fx.tunnel * 0.55) * 1.5 + pit.gun + engine.burnout)
    for (const ty of tyres.current) ty.uBlur.value = blur

    // Projects corner: once the car has pulled up and the pit stop is done, it comes apart into an exploded
    // drawing; it goes back together on the way out
    const pitDone = performance.now() > s.pitAt + s.pitTime * 1000 + 150
    const apart = s.chapter === 2 && s.hold && pitDone ? 1 : 0
    carRig.explode += Math.sign(apart - carRig.explode) * Math.min(Math.abs(apart - carRig.explode), dt / (apart ? 1.2 : 1.0))
    fx.explode = carRig.explode
    // the parts that carry the project's steps come out in the order the project works; a new project sends
    // the car back together first, then takes it apart its own way
    const project = apart ? PROJECTS[Math.min(s.step, PROJECTS.length - 1)] : null
    const ord = order.current
    const showing = project ? project.short : ''
    if (showing !== ord.key) { ord.key = showing; ord.pending = project ? project.brief.map((b) => b.on) : null; ord.now = null }
    if (!ord.now && ord.pending && carRig.assemblies.every((a) => a.p < 0.02)) ord.now = ord.pending
    driveExplode(carRig.assemblies, ord.now, performance.now(), dt, t)

    // the last two corners: the car turns to dust and comes back, once on arriving at Contact and again when the
    // chequered flag comes out; leaving cuts it short and the car comes straight back
    const du = carRig.dust
    if (du) {
      const now = performance.now()
      const end = ends.current
      // straight away on pulling up: the pit stop happens under the dust and the new paint is on when it reforms
      const atEnd = s.chapter === CHAPTERS.length - 1 && s.hold
      if (atEnd && !end.here) { end.here = true; end.at = now + 250 }
      if (!atEnd) { end.here = false; end.at = 0; hurryDust(du) }
      if (end.at && now >= end.at) { end.at = 0; playDust(du) }
      // the flag closes the garage on the car (Shutter.tsx); the dust is the Contact corner's alone
      if (s.finished && !end.flag) end.flag = true
      if (!s.finished) end.flag = false
      if (du.queued && du.t < 0 && atEnd) { du.queued = false; playDust(du) }
      camRig.copy(state.camera.position).applyMatrix4(uniforms.uCarInv.value)
      const pc = state.camera as THREE.PerspectiveCamera
      const scale = (state.size.height * state.gl.getPixelRatio()) / (2 * Math.tan((pc.fov * Math.PI) / 360))
      const bm = uniforms.uBMin.value, bs = uniforms.uBSize.value
      dustCentre.set(bm.x + bs.x / 2, bm.y + bs.y / 2, 0)
      driveDust(du, Math.min(dt, 1 / 30), camRig, scale, dustPaint.set(s.active.a), dustCentre)
      // the soft contact shadow goes with the dust, and with the car lifting off the floor
      if (shadowMat.current) shadowMat.current.opacity = (1 - du.k * 0.9) * (1 - Math.min(1, carRig.lift / 0.35))
      // the car's real shadow goes with it (the shadow pass does not know about the dust)
      const cast = du.k < 0.5
      if (cast !== end.shadows) {
        end.shadows = cast
        model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.userData.cast === undefined) m.userData.cast = m.castShadow; if (m.isMesh) m.castShadow = cast && m.userData.cast })
        state.gl.shadowMap.needsUpdate = true
      }
    }

    const blink = Math.sin(t * 2 * Math.PI * 1.25) > 0.2 ? 1 : 0
    mats.led.emissiveIntensity = 0.3 + blink * 6
  })

  return (
    <group ref={root}>
      <primitive object={model} />
      {/* soft contact shadow that turns with the car */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.004, 0]} renderOrder={1}>
        <planeGeometry args={[7.4, 3.4]} />
        <meshBasicMaterial ref={shadowMat} map={shadowTex} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  )
}

const shadowTex = (() => {
  const w = 512, h = 256
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')!
  g.translate(w / 2, h / 2)
  g.scale(1, h / w * 1.25)
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, w / 2)
  gr.addColorStop(0, 'rgba(0,0,0,0.9)')
  gr.addColorStop(0.45, 'rgba(0,0,0,0.65)')
  gr.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = gr
  g.fillRect(-w / 2, -w, w, w * 2)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
})()

function paintFinish(paint: THREE.MeshPhysicalMaterial, accent: THREE.MeshPhysicalMaterial, rim: THREE.MeshPhysicalMaterial, flake: { value: number }, l: LiveryDef, dt: number) {
  // matte by default: a soft, slightly rough clear coat over a flat base; the gunmetal is satin, with flake
  const f = 1 - Math.exp(-dt * 2.5)
  paint.roughness += (l.roughness - paint.roughness) * f
  paint.metalness += (l.metalness - paint.metalness) * f
  paint.clearcoat += (l.clearcoat - paint.clearcoat) * f
  paint.clearcoatRoughness += ((l.coatRough ?? 0.42) - paint.clearcoatRoughness) * f
  paint.iridescence += (0 - paint.iridescence) * f
  flake.value += ((l.flake ?? 0) - flake.value) * f
  accent.color.lerp(tmpColor.set(l.accent), f)
  rim.color.lerp(tmpColor.set(l.rim), f)
}
const tmpColor = new THREE.Color()
const camRig = new THREE.Vector3()
const freeAxis = new THREE.Vector3()
const freeDq = new THREE.Quaternion()
const IDENT = new THREE.Quaternion()
const qBase = new THREE.Quaternion()
const qDust = new THREE.Quaternion()
const qAll = new THREE.Quaternion()
const eBase = new THREE.Euler()
const cLocal = new THREE.Vector3()
const cWorld = new THREE.Vector3()
const corner = new THREE.Vector3()
const dustCentre = new THREE.Vector3()
const dustPaint = new THREE.Color()

useGLTF.preload(MODEL, false, true)
if (import.meta.env.DEV) (window as unknown as { __gsap: typeof gsap }).__gsap = gsap
if (import.meta.env.DEV) (window as unknown as { __carRig: typeof carRig }).__carRig = carRig
