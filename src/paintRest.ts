import * as THREE from 'three'

/** Bake each painted mesh's resting place into its vertices (aRest, aRestN), so the livery, which is projected
 *  in car space, stays stuck to the part when the part moves (here and on the Projects drawing). */
export function bakeRest(root: THREE.Object3D, rigInv: THREE.Matrix4, painted: (m: THREE.Mesh) => boolean) {
  const v = new THREE.Vector3(), n = new THREE.Vector3()
  const m4 = new THREE.Matrix4(), nm = new THREE.Matrix3()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !painted(mesh) || mesh.geometry.getAttribute('aRest')) return
    const g = mesh.geometry
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal')
    m4.multiplyMatrices(rigInv, mesh.matrixWorld)
    nm.getNormalMatrix(m4)
    const rest = new Float32Array(pos.count * 4), restN = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m4)
      rest.set([v.x, v.y, v.z, 2], i * 4)
      if (nor) { n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); restN.set([n.x, n.y, n.z], i * 3) }
    }
    g.setAttribute('aRest', new THREE.BufferAttribute(rest, 4))
    g.setAttribute('aRestN', new THREE.BufferAttribute(restN, 3))
  })
}
