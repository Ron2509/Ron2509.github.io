// Dev only (?bakeaero): bakes the wind-tunnel flow field around the live car model and leaves it on
// window.__aeroBake as base64, for scripts to save to public/models/aero.bin.
//   R: unsigned distance to the nearest bodywork, 0..DIST_MAX m
//   G: wake: how closely a body sits upstream (+X) of the cell, blurred so the wake spreads like a real one
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { carRig } from '../Car'
import { AERO, aeroIndex } from './grid'

const WAKE_REACH = 2.6

async function bake() {
  while (!carRig.root || !(window as unknown as { __car?: THREE.Object3D }).__car) await new Promise((r) => setTimeout(r, 200))
  const root = carRig.root
  root.updateMatrixWorld(true)
  const inv = root.matrixWorld.clone().invert()
  const parts: THREE.BufferGeometry[] = []
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !m.visible || !m.geometry?.attributes.position) return
    // only the car itself: skip the soft shadow plane under it
    if ((m.geometry as THREE.BufferGeometry).type === 'PlaneGeometry') return
    // positions may arrive quantised or interleaved (meshopt): read them out as plain floats
    const src = m.geometry.attributes.position
    const pos = new Float32Array(src.count * 3)
    for (let i = 0; i < src.count; i++) { pos[i * 3] = src.getX(i); pos[i * 3 + 1] = src.getY(i); pos[i * 3 + 2] = src.getZ(i) }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    if (m.geometry.index) g.setIndex(Array.from(m.geometry.index.array))
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld))
    parts.push(g)
  })
  const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!
  const t0 = performance.now()
  const bvh = new MeshBVH(merged)
  console.log('bvh', Math.round(performance.now() - t0), 'ms', merged.attributes.position.count / 3, 'tris')

  const [nx, ny, nz] = AERO.n
  const dist = new Uint8Array(nx * ny * nz)
  const wake = new Float32Array(nx * ny * nz)
  const p = new THREE.Vector3()
  const hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 }
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(1, 0, 0))
  const at = (i: number, k: number) => AERO.min[k] + ((AERO.max[k] - AERO.min[k]) * i) / (AERO.n[k] - 1)
  const t1 = performance.now()
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        p.set(at(x, 0), at(y, 1), at(z, 2))
        const r = bvh.closestPointToPoint(p, hit, 0, AERO.DIST_MAX)
        const d = r ? r.distance : AERO.DIST_MAX
        const i = aeroIndex(x, y, z)
        dist[i] = Math.round(Math.min(1, d / AERO.DIST_MAX) * 255)
        ray.origin.copy(p)
        const h = bvh.raycastFirst(ray, THREE.DoubleSide, 0, WAKE_REACH)
        wake[i] = h ? Math.exp(-h.distance / 1.1) : 0
      }
    }
  }
  console.log('fields', Math.round(performance.now() - t1), 'ms')

  // spread the wake: a few separable box blurs across y and z (and a little along x)
  const blur = (src: Float32Array, axis: 0 | 1 | 2, rad: number) => {
    const out = new Float32Array(src.length)
    const n = AERO.n
    for (let z = 0; z < n[2]; z++) for (let y = 0; y < n[1]; y++) for (let x = 0; x < n[0]; x++) {
      let s = 0, c = 0
      for (let k = -rad; k <= rad; k++) {
        const q = [x, y, z]
        q[axis] += k
        if (q[axis] < 0 || q[axis] >= n[axis]) continue
        s += src[aeroIndex(q[0], q[1], q[2])]; c++
      }
      out[aeroIndex(x, y, z)] = s / c
    }
    return out
  }
  let w = wake
  for (let pass = 0; pass < 2; pass++) { w = blur(w, 1, 2); w = blur(w, 2, 2); w = blur(w, 0, 1) }

  const bytes = new Uint8Array(nx * ny * nz * 2)
  for (let i = 0; i < dist.length; i++) {
    bytes[i * 2] = dist[i]
    bytes[i * 2 + 1] = Math.round(Math.min(1, w[i] * 1.4) * 255)
  }
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  ;(window as unknown as { __aeroBake: string }).__aeroBake = btoa(bin)
  console.log('aero bake done', bytes.length, 'bytes')
}

bake()
