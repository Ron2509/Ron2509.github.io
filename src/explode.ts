import * as THREE from 'three'
import type { Anchor, AssemblyId } from './content'

// Exploded assembly drawing of the car for the Projects corner. The model's parts are gathered into the
// assemblies a race team would draw them as. The project on show tells how it works one step per assembly
// (content.ts, brief): those assemblies slide out along their own lines in the order of the steps, and slide
// home when the project changes or the car leaves the corner. Offsets are in car-rig space (nose +X, up +Y, left -Z).

export type Assembly = {
  id: AssemblyId
  /** drawing number and name, as on the sheet */
  code: string
  name: string
  /** which project this assembly carries on the Projects corner, by its anchor */
  anchor?: Anchor
  /** rig-space travel when fully exploded */
  off: THREE.Vector3
  /** parts moved by this assembly, each with its rest position and its travel in its parent's space */
  parts: { obj: THREE.Object3D; rest: THREE.Vector3; travel: THREE.Vector3; up: THREE.Vector3 }[]
  /** the meshes of this assembly (for the inspection highlight) */
  meshes: THREE.Mesh[]
  /** rig-space centre of the assembly at rest, and its label point (top of its bounds) */
  centre: THREE.Vector3
  top: THREE.Vector3
  /** 0..1, how far out this assembly is right now (eased), its linear progress, where it is headed and when it
   * may set off (ms) */
  e: number
  p: number
  want: number
  start: number
}

type Spec = { id: AssemblyId; code: string; name: string; match: RegExp; off: [number, number, number]; anchor?: Anchor; sided?: boolean }

// order is also the order they leave in: outer parts first, then the shell, then what it was hiding
const SPECS: Spec[] = [
  { id: 'fwing', code: 'FW-100', name: 'Front wing assembly', match: /^(front_wing_mixer|front_wing_holders|body_front_wings)/, off: [0.95, 0.06, 0], anchor: 'nose' },
  { id: 'rwing', code: 'RW-300', name: 'Rear wing & DRS', match: /^(rear_wing|drs_)/, off: [-0.85, 0.5, 0] },
  { id: 'wheels', code: 'WH-500', name: 'Wheel & brake corners', match: /^(front-|rear-|wheelbrake)/, off: [0, 0.02, 0.82], sided: true },
  { id: 'fsusp', code: 'FS-210', name: 'Front suspension', match: /^(front_upper_arm|front_lower_arm|steering_rod|front_inner_cover_fins|front_brakeduct_inner|brakes_duct_front)/, off: [0, 0.04, 0.42], sided: true },
  { id: 'rsusp', code: 'RS-410', name: 'Rear suspension & ducts', match: /^(upper_arms|lower_arms|push_rod_rear|brakes_duct_rear|rear_brake_duct_blades)/, off: [0, 0.04, 0.42], sided: true },
  { id: 'body', code: 'BW-200', name: 'Bodywork & sidepods', match: /^(body_object|body_top_wing|body_side_top_wings|ram_intake_inner|mirror_|antennas|pitot_|cockpit_inner|front_arms_body_connection)/, off: [0, 1.0, 0], anchor: 'sidepod' },
  { id: 'pu', code: 'PU-600', name: 'Power unit & gearbox', match: /^(gearbox_cover|exhaust|rear_body_inner|rear_led|rear_arms_rubber_connection|rear_suspension_rubber)/, off: [-0.6, 0.32, 0], anchor: 'engine' },
  { id: 'cockpit', code: 'CK-700', name: 'Survival cell & driver', match: /^(seat|steering_wheel|paddle|helmet|shell|vizor|top_vent|Top_vent|shoes)/, off: [0, 0.52, 0], anchor: 'halo' },
  { id: 'floor', code: 'FL-800', name: 'Floor & plank', match: /^floor_/, off: [0, 0, 0] },
]

/** Which assembly a part of the model belongs to, by its node name (null for the loose odds and ends). */
export function assemblyOf(name: string): AssemblyId | null {
  return SPECS.find((sp) => sp.match.test(name))?.id ?? null
}

/** Gather the model's parts into assemblies. `s` is the model root holding the parts; `rigInv` takes world
 * space into car-rig space (identity while the model is not yet in the scene). */
export function buildAssemblies(s: THREE.Object3D, rigInv: THREE.Matrix4): Assembly[] {
  const out: Assembly[] = SPECS.map((sp) => ({
    id: sp.id, code: sp.code, name: sp.name, anchor: sp.anchor, off: new THREE.Vector3(...sp.off),
    parts: [], meshes: [], centre: new THREE.Vector3(), top: new THREE.Vector3(), e: 0, p: 0, want: 0, start: 0,
  }))
  const boxes = out.map(() => new THREE.Box3())
  const box = new THREE.Box3()
  const m3 = new THREE.Matrix3()
  for (const child of [...s.children]) {
    const i = SPECS.findIndex((sp) => sp.match.test(child.name))
    if (i < 0) continue
    const sp = SPECS[i]
    box.setFromObject(child).applyMatrix4(rigInv)
    boxes[i].union(box)
    // sided assemblies split left and right, each half going out its own side
    const c = box.getCenter(new THREE.Vector3())
    const off = new THREE.Vector3(...sp.off)
    if (sp.sided) off.z *= c.z < 0 ? -1 : 1
    // the travel, turned from rig space into the space the part's position lives in
    const parent = child.parent!
    m3.setFromMatrix4(new THREE.Matrix4().multiplyMatrices(rigInv, parent.matrixWorld)).invert()
    const travel = off.clone().applyMatrix3(m3)
    const up = new THREE.Vector3(0, 1, 0).applyMatrix3(m3)
    out[i].parts.push({ obj: child, rest: child.position.clone(), travel, up })
    child.traverse((o) => { if ((o as THREE.Mesh).isMesh) out[i].meshes.push(o as THREE.Mesh) })
  }
  out.forEach((a, i) => {
    boxes[i].getCenter(a.centre)
    a.top.set(a.centre.x, boxes[i].max.y, a.centre.z)
  })
  return out.filter((a) => a.parts.length)
}

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

/** Move each assembly towards where it should be. `order` lists the assemblies that come out, in the order
 * they leave (the steps of the project on show); the rest stay on the car. Coming out is one after another,
 * going home is all at once. `now` in ms. */
export function driveExplode(list: Assembly[], order: AssemblyId[] | null, now: number, dt: number, t: number) {
  list.forEach((a, i) => {
    const idx = order ? order.indexOf(a.id) : -1
    const want = idx >= 0 ? 1 : 0
    if (want !== a.want) { a.want = want; a.start = now + (want ? idx * 420 : 0) }
    if (now >= a.start) a.p += Math.sign(want - a.p) * Math.min(Math.abs(want - a.p), dt / (want ? 1.0 : 0.75))
    // a precise move: accelerate, glide, settle, like a motion-controlled rig
    const e = ease(a.p)
    a.e = e
    // out, each assembly floats a few millimetres, as if hung on wires
    const bob = Math.sin(t * 0.9 + i * 1.7) * 0.006 * e
    for (const p of a.parts) p.obj.position.copy(p.rest).addScaledVector(p.travel, e).addScaledVector(p.up, bob)
  })
}

/** Everything home at once (unmounting). */
export function resetExplode(list: Assembly[]) {
  for (const a of list) { a.p = a.e = a.want = 0; for (const p of a.parts) p.obj.position.copy(p.rest) }
}

/** Where an anchor's point sits right now: on its assembly as it moves out, on the bodywork at rest. */
export function liveAnchor(list: Assembly[], name: Anchor, rest: THREE.Vector3, out: THREE.Vector3) {
  const a = list.find((x) => x.anchor === name)
  if (!a || a.e <= 0) return out.copy(rest)
  // exploded, point at the assembly itself (the front wing for the nose project, the cockpit for the halo)
  const target = (name === 'sidepod' ? rest : a.top).clone().add(a.off)
  return out.copy(rest).lerp(target, a.e)
}
