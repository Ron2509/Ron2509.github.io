// Dev only (?bakesolid): voxelises the live car's skin for the CFD bake (scripts/bake-flow.mjs). Every grid node
// within ~0.8 of a cell of the bodywork is marked; the script floods the air in from the edges of the tunnel, so
// whatever the flood can't reach is solid car. Left on window.__solidBake as base64 for the script to collect.
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { carRig } from '../Car'
import { FLOW_GRID } from './flowGrid'

async function bake() {
  while (!carRig.root || !(window as unknown as { __car?: THREE.Object3D }).__car) await new Promise((r) => setTimeout(r, 200))
  const root = carRig.root
  root.updateMatrixWorld(true)
  const inv = root.matrixWorld.clone().invert()
  const parts: THREE.BufferGeometry[] = []
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !m.visible || !m.geometry?.attributes.position) return
    if ((m.geometry as THREE.BufferGeometry).type === 'PlaneGeometry') return
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
  const bvh = new MeshBVH(merged)
  const { n, min, h } = FLOW_GRID
  const [nx, ny, nz] = n
  const mask = new Uint8Array(nx * ny * nz)
  const p = new THREE.Vector3()
  const hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 }
  const reach = h * 0.8
  const t0 = performance.now()
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    p.set(min[0] + x * h, min[1] + y * h, min[2] + z * h)
    if (bvh.closestPointToPoint(p, hit, 0, reach)) mask[(z * ny + y) * nx + x] = 1
  }
  let bin = ''
  for (let i = 0; i < mask.length; i += 0x8000) bin += String.fromCharCode(...mask.subarray(i, i + 0x8000))
  ;(window as unknown as { __solidBake: string }).__solidBake = btoa(bin)
  console.log('solid bake done', Math.round(performance.now() - t0), 'ms')
}

bake()
