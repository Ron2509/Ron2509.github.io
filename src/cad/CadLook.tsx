import { useContext, useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { EffectComposerContext } from '@react-three/postprocessing'
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing'
import * as THREE from 'three'
import { carRig } from '../Car'
import { fx } from '../fx'
import { store } from '../store'

// The exploded drawing's look, the way a CAD package renders an assembly for a design review: the parts keep
// their real materials, every crease and silhouette gets a fine feature line, the studio falls away to deep
// blueprint navy, and the floor becomes the drawing's grid, with real dimensions on it.

/* ---------- feature lines: screen-space edges from depth and normals ---------- */

const linesFrag = /* glsl */ `
  uniform sampler2D tNormal;
  uniform float uAmount;
  uniform vec3 uLine;
  float lin(const in vec2 uv) { return -getViewZ(readDepth(uv)); }
  vec3 nrm(const in vec2 uv) { return normalize(texture2D(tNormal, uv).xyz * 2.0 - 1.0); }
  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    if (uAmount < 0.001) { outputColor = inputColor; return; }
    vec2 o = texelSize;
    float d0 = -getViewZ(depth);
    float dl = lin(uv - vec2(o.x, 0.0)), dr = lin(uv + vec2(o.x, 0.0));
    float du = lin(uv + vec2(0.0, o.y)), dd = lin(uv - vec2(0.0, o.y));
    // depth: a jump (silhouette) or a kink (fold), relative to distance so far and near read the same. Only the
    // near side of a jump is marked, so a silhouette is one pixel, not two
    float jump = max(max(dl - d0, dr - d0), max(du - d0, dd - d0)) / d0;
    float kink = (abs(dl + dr - 2.0 * d0) + abs(du + dd - 2.0 * d0)) / d0;
    float eD = max(smoothstep(0.018, 0.05, jump), smoothstep(0.006, 0.02, kink) * 0.7);
    // normals: a crease between two faces
    vec3 n0 = nrm(uv);
    float c = min(min(dot(n0, nrm(uv - vec2(o.x, 0.0))), dot(n0, nrm(uv + vec2(o.x, 0.0)))),
                  min(dot(n0, nrm(uv + vec2(0.0, o.y))), dot(n0, nrm(uv - vec2(0.0, o.y)))));
    float eN = smoothstep(0.93, 0.7, c);
    // only the drawing gets lines: the car and its parts, not the far studio
    float onCar = 1.0 - smoothstep(12.0, 16.0, d0);
    float edge = max(eD, eN) * onCar;
    // the grade: the car keeps its own colours, a touch cooler; everything far falls to blueprint navy
    vec3 col = inputColor.rgb;
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    vec3 cool = mix(col, vec3(l) * vec3(0.8, 0.9, 1.05), 0.3);
    vec3 navy = vec3(0.006, 0.012, 0.028) + l * vec3(0.18, 0.3, 0.5);
    vec3 graded = mix(cool, navy, 1.0 - onCar);
    col = mix(col, graded, uAmount);
    col = mix(col, uLine, edge * uAmount * 0.62);
    outputColor = vec4(col, inputColor.a);
  }
`

class CadLinesEffect extends Effect {
  constructor() {
    super('CadLinesEffect', linesFrag, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['tNormal', new THREE.Uniform(null)],
        ['uAmount', new THREE.Uniform(0)],
        ['uLine', new THREE.Uniform(new THREE.Color(0.55, 0.76, 1.0).multiplyScalar(0.8))],
      ]),
    })
  }
}

/** Goes inside the EffectComposer (which must have enableNormalPass). */
export function CadLines() {
  const { normalPass } = useContext(EffectComposerContext)
  const effect = useMemo(() => new CadLinesEffect(), [])
  useEffect(() => () => effect.dispose(), [effect])
  const warmed = useRef(0)
  useFrame(({ gl, scene, camera }) => {
    const k = fx.explode
    effect.uniforms.get('uAmount')!.value = k
    // the normal buffer costs a second render of the scene, so it only runs while the drawing is up; it runs a
    // couple of frames at load too, behind the loader, so its shaders are built before the Projects corner
    const warm = store.get().loaded && warmed.current < 3
    if (warm) warmed.current++
    // and every mesh in the studio, in view or not, gets its normal-pass shader compiled then too, in the
    // background: the pass's own material swap (one copy per side and shading), into a render target
    if (warm && warmed.current === 3 && normalPass) {
      type Manager = { replaceMaterial: (o: THREE.Object3D) => void; originalMaterials: Map<THREE.Mesh, THREE.Material>; meshCount: number }
      const mgr = (normalPass as unknown as { renderPass: { overrideMaterialManager: Manager | null } }).renderPass.overrideMaterialManager
      if (mgr) {
        scene.traverse(mgr.replaceMaterial)
        const rt = new THREE.WebGLRenderTarget(1, 1)
        const prev = gl.getRenderTarget()
        gl.setRenderTarget(rt)
        gl.compile(scene, camera)
        gl.setRenderTarget(prev)
        for (const [m, x] of mgr.originalMaterials) m.material = x
        mgr.originalMaterials.clear()
        mgr.meshCount = 0
        rt.dispose()
      }
    }
  })
  return <primitive object={effect} dispose={null} />
}

/* ---------- the drawing's floor: grid, axes and dimensions ---------- */

const gridVert = /* glsl */ `
  varying vec2 vP;
  void main() { vec4 w = modelMatrix * vec4(position, 1.0); vP = (position.xy); gl_Position = projectionMatrix * viewMatrix * w; }
`
const gridFrag = /* glsl */ `
  uniform float uAmount;
  uniform float uTime;
  varying vec2 vP;
  float line(float x, float w) { float d = abs(fract(x - 0.5) - 0.5) / fwidth(x); return 1.0 - smoothstep(w - 0.5, w + 0.5, d); }
  void main() {
    // plane x = car x, plane y = car -z (the plane lies flat under the car)
    vec2 p = vP;
    float minor = max(line(p.x * 10.0, 0.5), line(p.y * 10.0, 0.5));
    float mid = max(line(p.x * 2.0, 0.7), line(p.y * 2.0, 0.7));
    float major = max(line(p.x, 0.9), line(p.y, 0.9));
    float r = length(p * vec2(0.6, 1.0));
    float fade = 1.0 - smoothstep(0.9, 3.1, r);
    // the drawing draws itself out from under the car
    float reveal = smoothstep(uAmount * 5.0 - 0.6, uAmount * 5.0, r);
    float a = (minor * 0.028 + mid * 0.05 + major * 0.11) * fade * (1.0 - reveal);
    // centreline and the axle lines, a touch brighter
    float axes = max(1.0 - smoothstep(0.0, 1.2, abs(p.y) / fwidth(p.y)), 0.0) * 0.22 * fade * (1.0 - reveal);
    vec3 col = vec3(0.42, 0.66, 1.0) * (a + axes);
    gl_FragColor = vec4(col * uAmount, 1.0);
  }
`

// dimensions are shown in real-car millimetres: the model is the real car at 1 : 1.21
const MM = 1000 * (5.5 / 4.55)

/** Where the dimension figures sit on screen, for the labels overlay. */
export const dims: { text: string; mid: THREE.Vector3 }[] = []

export function Blueprint() {
  const group = useRef<THREE.Group>(null)
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uAmount: { value: 0 }, uTime: { value: 0 } },
    vertexShader: gridVert, fragmentShader: gridFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }), [])
  const lineMat = useMemo(() => new THREE.LineBasicMaterial({ color: new THREE.Color(0.5, 0.75, 1.0), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), [])
  // wheelbase and track as dimension lines on the floor, with ticks, measured off the car
  const dimLines = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3))
    return new THREE.LineSegments(g, lineMat)
  }, [lineMat])
  useEffect(() => { dimLines.layers.set(1) }, [dimLines])

  const built = useRef(false)
  const warmed = useRef(0)
  useFrame((_, dt) => {
    const k = fx.explode
    mat.uniforms.uAmount.value = k
    mat.uniforms.uTime.value += dt
    lineMat.opacity = Math.max(0, (k - 0.5) * 2) * 0.7
    const g = group.current
    if (!g) return
    // drawn (at zero opacity) for a few frames once the car is in, so its shaders are built behind the loader
    const warm = store.get().loaded && warmed.current < 3
    if (warm) warmed.current++
    g.visible = k > 0.002 || warm
    if (carRig.root) { g.matrix.copy(carRig.root.matrixWorld); g.matrixWorldNeedsUpdate = true }
    if (!built.current && carRig.assemblies.length) {
      built.current = true
      const w = carRig.assemblies.find((a) => a.id === 'wheels')
      if (!w) return
      // the four wheel centres, from the wheel parts' bounds
      const box = new THREE.Box3()
      const xs: number[] = [], zs: number[] = []
      for (const p of w.parts) {
        if (!/^(front|rear)-/.test(p.obj.name)) continue
        box.setFromObject(p.obj)
        const c = box.getCenter(new THREE.Vector3())
        if (carRig.root) c.applyMatrix4(carRig.root.matrixWorld.clone().invert())
        xs.push(c.x); zs.push(c.z)
      }
      const front = Math.max(...xs), rear = Math.min(...xs)
      const halfTrack = Math.max(...zs.map(Math.abs))
      const zLine = 1.75, xLine = rear - 0.7
      const y = 0.004, t = 0.07
      const v = [
        // wheelbase, along the near side
        rear, y, zLine, front, y, zLine,
        rear, y, zLine - t, rear, y, zLine + t, front, y, zLine - t, front, y, zLine + t,
        rear, y, halfTrack, rear, y, zLine + t, front, y, halfTrack, front, y, zLine + t,
        // track, across behind the car
        xLine, y, -halfTrack, xLine, y, halfTrack,
        xLine - t, y, -halfTrack, xLine + t, y, -halfTrack, xLine - t, y, halfTrack, xLine + t, y, halfTrack,
      ]
      const pos = dimLines.geometry.attributes.position as THREE.BufferAttribute
      ;(pos.array as Float32Array).set(v)
      pos.needsUpdate = true
      dimLines.geometry.setDrawRange(0, v.length / 3)
      dims.length = 0
      dims.push({ text: `WHEELBASE ${Math.round((front - rear) * MM).toLocaleString('en-US').replace(',', ' ')}`, mid: new THREE.Vector3((front + rear) / 2, y, zLine) })
      dims.push({ text: `TRACK ${Math.round(halfTrack * 2 * MM).toLocaleString('en-US').replace(',', ' ')}`, mid: new THREE.Vector3(xLine, y, 0) })
    }
  })
  return (
    <group ref={group} matrixAutoUpdate={false} visible={false}>
      <mesh material={mat} rotation-x={-Math.PI / 2} position={[0, 0.003, 0]} renderOrder={1} onUpdate={(o) => o.layers.set(1)}>
        <planeGeometry args={[12, 7]} />
      </mesh>
      <primitive object={dimLines} />
    </group>
  )
}
