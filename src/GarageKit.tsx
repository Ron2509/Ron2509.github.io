import { useEffect, useState } from 'react'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { carRig } from './Car'

// Garage dressing around the pit wall. The tyre stacks are built to the car's own wheel size, but light: a lathed
// tyre with real shoulders, a rim and a cover, a few thousand triangles each instead of the car's 160 thousand.
// They sit back in the dark, out of focus, so that is all they need. The roll cabinets are brushed graphite with
// aluminium pulls, unbranded, like team-issue kit.

const tyreMat = new THREE.MeshStandardMaterial({ color: '#111112', roughness: 0.86, metalness: 0 })
const bandMat = new THREE.MeshStandardMaterial({ color: '#77777a', roughness: 0.8, metalness: 0 })
const rimMat = new THREE.MeshStandardMaterial({ color: '#17181b', roughness: 0.42, metalness: 0.6 })
const coverMat = new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: 0.5, metalness: 0.2 })

/** A wheel lying flat with its base at y = 0, centred on the origin. Built once, to the car's wheel size. */
let flatWheel: { obj: THREE.Object3D; height: number; radius: number } | null = null
function makeFlatWheel() {
  if (flatWheel || !carRig.wheel) return flatWheel
  // the car's wheel, measured in rig space: its diameter and its width across the axle
  const box = new THREE.Box3().setFromObject(carRig.wheel.obj).applyMatrix4(
    carRig.wheel.obj.matrixWorld.clone().invert().premultiply(carRig.wheel.matrix))
  const size = box.getSize(new THREE.Vector3())
  const R = Math.max(size.x, size.y) / 2
  const H = Math.min(size.z, R * 1.1)
  const ri = R * 0.62
  // the tyre's cross-section, inner bead to tread and back, with rounded shoulders
  const prof: THREE.Vector2[] = []
  const sh = H * 0.22
  prof.push(new THREE.Vector2(ri, H * 0.06))
  prof.push(new THREE.Vector2(ri * 1.04, 0.0))
  for (let k = 0; k <= 6; k++) { const a = (k / 6) * (Math.PI / 2); prof.push(new THREE.Vector2(R - sh + Math.sin(a) * sh, sh - Math.cos(a) * sh)) }
  for (let k = 0; k <= 6; k++) { const a = (k / 6) * (Math.PI / 2); prof.push(new THREE.Vector2(R - sh + Math.cos(a) * sh, H - sh + Math.sin(a) * sh)) }
  prof.push(new THREE.Vector2(ri * 1.04, H))
  prof.push(new THREE.Vector2(ri, H * 0.94))
  const tyre = new THREE.Mesh(new THREE.LatheGeometry(prof, 72), tyreMat)
  // the compound band on the upper sidewall
  const band = new THREE.Mesh(new THREE.RingGeometry(R * 0.8, R * 0.84, 72), bandMat)
  band.rotation.x = -Math.PI / 2
  band.position.y = H + 0.001
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(ri * 0.99, ri * 0.99, H * 0.86, 48, 1, true), rimMat)
  rim.position.y = H / 2
  const cover = new THREE.Mesh(new THREE.CircleGeometry(ri * 0.99, 48), coverMat)
  cover.rotation.x = -Math.PI / 2
  cover.position.y = H * 0.93
  const obj = new THREE.Group()
  for (const m of [tyre, band, rim, cover]) { m.castShadow = true; m.receiveShadow = true; obj.add(m) }
  flatWheel = { obj, height: H, radius: R }
  return flatWheel
}

export function WheelStack({ position, count = 4, turn = 0 }: { position: [number, number, number]; count?: number; turn?: number }) {
  const [wheels, setWheels] = useState<THREE.Object3D[]>([])
  useEffect(() => {
    // the car builds its wheel template on load; wait a frame for it
    let raf = 0
    const go = () => {
      const fw = makeFlatWheel()
      if (!fw) { raf = requestAnimationFrame(go); return }
      setWheels(Array.from({ length: count }, (_, i) => {
        const o = fw.obj.clone(true)
        // stacked by hand: each one a little off-centre and turned
        o.position.set(Math.sin(i * 2.1 + turn) * 0.012, i * fw.height * 0.985, Math.cos(i * 1.7) * 0.012)
        o.rotation.y = turn + i * 0.9
        return o
      }))
    }
    go()
    return () => cancelAnimationFrame(raf)
  }, [count, turn])
  return (
    <group position={position}>
      {wheels.map((w, i) => <primitive key={i} object={w} />)}
    </group>
  )
}

const body = new THREE.MeshStandardMaterial({ color: '#1b1c1f', metalness: 0.55, roughness: 0.42 })
const front = new THREE.MeshStandardMaterial({ color: '#232428', metalness: 0.6, roughness: 0.36 })
const pull = new THREE.MeshStandardMaterial({ color: '#a7a9ad', metalness: 1, roughness: 0.28 })
const top = new THREE.MeshStandardMaterial({ color: '#0f0f11', metalness: 0.1, roughness: 0.7 })
const rubber = new THREE.MeshStandardMaterial({ color: '#0b0b0b', roughness: 0.9 })

/** A roll cabinet with a top chest: drawers, pulls, a rubber worktop and casters. */
export function ToolCabinet({ position, yaw = 0, width = 0.92 }: { position: [number, number, number]; yaw?: number; width?: number }) {
  const D = 0.52
  const baseH = 0.96
  const chestH = 0.46
  const drawers = (y0: number, h: number, n: number, keyPrefix: string) => {
    const gap = 0.012
    const dh = (h - gap * (n + 1)) / n
    return Array.from({ length: n }, (_, i) => {
      const y = y0 + gap + dh / 2 + i * (dh + gap)
      return (
        <group key={keyPrefix + i} position={[0, y, D / 2 + 0.004]}>
          <RoundedBox args={[width - 0.05, dh, 0.012]} radius={0.003} smoothness={2} material={front} />
          <mesh material={pull} position={[0, dh / 2 - 0.022, 0.012]}>
            <boxGeometry args={[width - 0.16, 0.012, 0.014]} />
          </mesh>
        </group>
      )
    })
  }
  return (
    <group position={position} rotation-y={yaw}>
      {/* casters */}
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => (
        <mesh key={`${sx}${sz}`} material={rubber} position={[sx * (width / 2 - 0.06), 0.045, sz * (D / 2 - 0.06)]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.045, 0.045, 0.035, 16]} />
        </mesh>
      )))}
      <RoundedBox args={[width, baseH, D]} radius={0.01} smoothness={3} material={body} position={[0, 0.09 + baseH / 2, 0]} castShadow receiveShadow />
      {drawers(0.09, baseH, 6, 'b')}
      <mesh material={top} position={[0, 0.09 + baseH + 0.012, 0]} castShadow>
        <boxGeometry args={[width + 0.02, 0.024, D + 0.02]} />
      </mesh>
      <RoundedBox args={[width, chestH, D * 0.85]} radius={0.01} smoothness={3} material={body} position={[0, 0.09 + baseH + 0.024 + chestH / 2, -D * 0.075]} castShadow />
      <group position={[0, 0, -D * 0.075]}>
        <group position={[0, 0, -D * 0.075]}>{drawers(0.09 + baseH + 0.024, chestH, 4, 't')}</group>
      </group>
      {/* side push handle */}
      <mesh material={pull} position={[width / 2 + 0.05, 0.09 + baseH - 0.05, 0]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.013, 0.013, D - 0.08, 12]} />
      </mesh>
    </group>
  )
}
