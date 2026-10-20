import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing'
import * as THREE from 'three'
import { weather } from '../weather'

// Rain at the visitor's location, in the studio: drops gathering and running on the camera lens, rain falling
// through the lights, rings spreading on a floor gone wet and mirror-like. `rain.k` eases between dry and wet.

export const rain = { k: 0 }

/** Eases the studio towards the weather. Mount once. */
export function RainDriver() {
  useFrame((_, dt) => { rain.k = THREE.MathUtils.damp(rain.k, weather.wet(), 0.8, dt) })
  return null
}

/* ---------- the lens: drops that form, sit and evaporate, and drops that run, leaving a trail ---------- */

const lensFrag = /* glsl */ `
  uniform float uWet;
  uniform float uTime;
  float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec2 h2(vec2 p) { return vec2(h1(p), h1(p + 19.19)); }

  // one layer of beaded drops; returns the refraction offset (xy, in cell units) and coverage (z)
  vec3 beads(vec2 p, float t, float density) {
    vec2 id = floor(p), f = fract(p) - 0.5;
    vec2 r2 = h2(id);
    float life = fract(t * (0.035 + 0.05 * r2.x) + r2.y);
    float size = mix(0.1, 0.3, pow(h1(id + 3.1), 2.0)) * smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.82, 1.0, life));
    float on = step(h1(id + 7.7), density);
    vec2 d = f - (r2 - 0.5) * 0.55;
    float dist = length(d);
    // a drop on the lens is far out of focus: a soft edge, no outline
    float m = smoothstep(size, size * 0.45, dist) * on;
    vec2 n = d / max(size, 1e-3);
    // it is a tiny lens: the world through it is flipped and drawn in from around it
    return vec3(-n * size * 2.4, m);
  }
  // drops running down: one per column, sliding in fits and starts, shedding small beads behind
  vec3 runners(vec2 p, float t, float aspect) {
    float col = floor(p.x);
    float r = h1(vec2(col, 4.2));
    if (r > 0.5) return vec3(0.0);
    float speed = 0.06 + r * 0.16;
    float ph = t * speed + h1(vec2(col, 9.1));
    // stick-slip: the drop holds, then lets go
    float y = 1.0 - fract(ph + 0.08 * sin(ph * 31.0) * sin(ph * 7.0));
    vec2 f = vec2(fract(p.x) - 0.5 - 0.15 * sin(p.y * 3.0 + col), p.y - y * 14.0);
    vec2 e = f / vec2(0.16, 0.24);
    float dist = length(e);
    float m = smoothstep(1.0, 0.8, dist);
    vec2 off = -e * 0.16 * m;
    // the trail: little beads strung out above the runner
    float above = clamp((f.y) / 4.0, 0.0, 1.0);
    vec2 tf = vec2(f.x, fract(p.y * 3.0) - 0.5);
    float tr = smoothstep(0.07, 0.04, length(tf * vec2(1.0, 1.4))) * step(0.02, f.y) * (1.0 - above) * step(f.y, 4.0);
    return vec3(off - tf * 0.4 * tr, max(m, tr * 0.8));
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    if (uWet < 0.01) { outputColor = inputColor; return; }
    float aspect = resolution.x / resolution.y;
    vec2 q = uv * vec2(aspect, 1.0);
    vec3 a = beads(q * 9.0, uTime, 0.32 * uWet);
    vec3 b = beads(q * 22.0 + 3.7, uTime * 1.3, 0.55 * uWet);
    vec3 c = runners(q * vec2(7.0, 14.0), uTime, aspect) * step(0.35, uWet);
    vec2 off = a.xy / 9.0 * a.z + b.xy / 22.0 * b.z + c.xy / 7.0 * c.z;
    float cover = max(a.z, max(b.z, c.z));
    off *= vec2(1.0 / aspect, 1.0);
    // through a drop the world is flipped and squeezed, a little brighter, with a dark rim
    // seen through a drop: refracted and softened (a few taps, the drop is out of focus)
    vec2 tx = 1.5 / resolution;
    vec2 su = uv + off * 1.6;
    vec3 seen = (texture2D(inputBuffer, su).rgb * 2.0 + texture2D(inputBuffer, su + vec2(tx.x, 0.0)).rgb + texture2D(inputBuffer, su - vec2(tx.x, 0.0)).rgb
      + texture2D(inputBuffer, su + vec2(0.0, tx.y)).rgb + texture2D(inputBuffer, su - vec2(0.0, tx.y)).rgb) / 6.0;
    vec3 col = mix(inputColor.rgb, seen, cover);
    // wet glass: a faint veil over the whole frame
    col = mix(col, col * 0.95 + vec3(0.003, 0.004, 0.006), uWet * 0.5);
    outputColor = vec4(col, inputColor.a);
  }
`

class RainLensEffect extends Effect {
  constructor() {
    super('RainLensEffect', lensFrag, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([['uWet', new THREE.Uniform(0)], ['uTime', new THREE.Uniform(0)]]),
    })
  }
}

/** Goes inside the EffectComposer. */
export function RainLens() {
  const effect = useMemo(() => new RainLensEffect(), [])
  useEffect(() => () => effect.dispose(), [effect])
  useFrame((_, dt) => {
    effect.uniforms.get('uWet')!.value = rain.k
    effect.uniforms.get('uTime')!.value += dt
  })
  return <primitive object={effect} dispose={null} />
}

/* ---------- the floor: wet to a mirror, and rings where drops land ---------- */

type Reflector = THREE.Material & { roughness: number; mixStrength: number; mixBlur: number; metalness: number; color: THREE.Color }
export const floor = { mat: null as Reflector | null }
const DRY = new THREE.Color('#141416')
const WET = new THREE.Color('#09090a')

/** Takes the floor from dry studio concrete to wet. */
export function WetFloor() {
  useFrame(() => {
    const m = floor.mat
    if (!m) return
    const k = rain.k
    // wet concrete is darker, and its reflections sharpen rather than brighten
    m.roughness = THREE.MathUtils.lerp(0.8, 0.48, k)
    m.mixStrength = THREE.MathUtils.lerp(32, 22, k)
    m.color.copy(DRY).lerp(WET, k)
    m.mixBlur = THREE.MathUtils.lerp(1, 0.7, k)
    m.metalness = THREE.MathUtils.lerp(0.4, 0.5, k)
  })
  return null
}

const rippleVert = /* glsl */ `
  varying vec3 vW;
  void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`
const rippleFrag = /* glsl */ `
  uniform float uWet;
  uniform float uTime;
  varying vec3 vW;
  float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  // rings spreading from where drops land, a few per square metre at any moment
  float rings(vec2 p, float t) {
    float s = 0.0;
    for (int k = 0; k < 2; k++) {
      float sc = k == 0 ? 5.0 : 8.5;
      vec2 q = p * sc + float(k) * 13.1;
      float px = length(fwidth(p)) * sc;
      vec2 id = floor(q), f = fract(q);
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 o = vec2(float(i), float(j));
        vec2 c = o + vec2(h1(id + o), h1(id + o + 5.3));
        // not every cell has a drop at once
        float live = step(0.45, h1(id + o + 1.3 + floor(t * 0.7)));
        float life = fract(t * (0.55 + 0.4 * h1(id + o + 2.7)) + h1(id + o + 9.1));
        float r = length(f - c);
        float R = life * 0.38;
        float w = px * 1.2 + 0.003;
        s += (1.0 - smoothstep(0.0, w, abs(r - R))) * pow(1.0 - life, 3.0) * live;
      }
    }
    return s;
  }
  void main() {
    if (uWet < 0.01) discard;
    float d = length(vW.xz);
    float near = 1.0 - smoothstep(2.0, 7.0, d);
    float a = rings(vW.xz, uTime) * near * uWet;
    // the crests catch the overhead softbox: cool white, faint
    gl_FragColor = vec4(vec3(0.55, 0.6, 0.68) * a * 0.2, 1.0);
  }
`
export function Ripples() {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uWet: { value: 0 }, uTime: { value: 0 } },
    vertexShader: rippleVert, fragmentShader: rippleFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }), [])
  const mesh = useRef<THREE.Mesh>(null)
  useFrame((_, dt) => {
    mat.uniforms.uWet.value = rain.k
    mat.uniforms.uTime.value += dt
    if (mesh.current) mesh.current.visible = rain.k > 0.01
  })
  return (
    <mesh ref={mesh} material={mat} rotation-x={-Math.PI / 2} position={[0, 0.0035, 0]} renderOrder={1} visible={false} onUpdate={(o) => o.layers.set(1)}>
      <planeGeometry args={[24, 24]} />
    </mesh>
  )
}

/* ---------- the rain itself: thin streaks falling through the studio lights ---------- */

const FALL_N = typeof matchMedia !== 'undefined' && matchMedia('(min-width: 900px)').matches ? 5000 : 1800
const fallVert = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uWet;
  varying float vA;
  varying float vV;
  void main() {
    // each streak falls through a 7 m tall box round the car and wraps to the top
    float speed = 6.5 + aSeed.w * 3.0;
    float y = 7.0 - mod(aSeed.y * 7.0 + uTime * speed, 7.0);
    vec3 base = vec3(aSeed.x, y, aSeed.z);
    // a camera-facing ribbon, stretched along the fall by the shutter
    vec3 toCam = normalize(cameraPosition - base);
    vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    float len = 0.12 + aSeed.w * aSeed.w * 0.38;
    vec3 p = base + side * position.x * 0.0035 + vec3(0.0, position.y * len, 0.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    // lit by the overhead softbox: brightest under it, near the car
    float lit = exp(-dot(base.xz, base.xz) / 18.0) * 0.8 + 0.2;
    float dist = length(cameraPosition - base);
    vA = uWet * lit * (0.35 + 0.65 * fract(aSeed.x * 7.13)) * smoothstep(1.2, 3.0, dist) * (1.0 - smoothstep(10.0, 18.0, dist)) * smoothstep(0.0, 0.6, y);
    vV = position.y;
  }
`
const fallFrag = /* glsl */ `
  varying float vA;
  varying float vV;
  void main() {
    // the leading end of each streak is the brightest
    float a = vA * (0.35 + 0.65 * (0.5 - vV));
    gl_FragColor = vec4(vec3(0.7, 0.75, 0.82) * a * 0.075, 1.0);
  }
`
export function RainFall() {
  const geo = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry()
    const quad = new THREE.PlaneGeometry(1, 1)
    g.index = quad.index
    g.setAttribute('position', quad.attributes.position)
    const seeds = new Float32Array(FALL_N * 4)
    for (let i = 0; i < FALL_N; i++) {
      seeds[i * 4] = (Math.random() - 0.5) * 18
      seeds[i * 4 + 1] = Math.random()
      seeds[i * 4 + 2] = (Math.random() - 0.5) * 14
      seeds[i * 4 + 3] = Math.random()
    }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4))
    g.instanceCount = FALL_N
    return g
  }, [])
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uWet: { value: 0 } },
    vertexShader: fallVert, fragmentShader: fallFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
  }), [])
  const mesh = useRef<THREE.Mesh>(null)
  useFrame((_, dt) => {
    mat.uniforms.uTime.value += dt
    mat.uniforms.uWet.value = rain.k
    if (mesh.current) mesh.current.visible = rain.k > 0.01
  })
  return <mesh ref={mesh} geometry={geo} material={mat} frustumCulled={false} renderOrder={8} visible={false} onUpdate={(o) => o.layers.set(1)} />
}
