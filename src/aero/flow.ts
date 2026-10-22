import * as THREE from 'three'
import { AERO } from './grid'

// The airflow round the car, for the wind tunnel and the Jobs corner: the baked
// distance-to-bodywork and wake maps (src/aero/bake.ts) as a 3D texture, and the GLSL that turns them into an
// air velocity. Free stream is 1 along -x in car-rig space.

let field: Promise<THREE.Data3DTexture> | null = null

/** The baked field as a 3D texture, fetched once. */
export function loadField() {
  if (!field) {
    field = fetch(AERO.url).then((r) => r.arrayBuffer()).then((b) => {
      const tex = new THREE.Data3DTexture(new Uint8Array(b), AERO.n[0], AERO.n[1], AERO.n[2])
      tex.format = THREE.RGFormat
      tex.type = THREE.UnsignedByteType
      tex.minFilter = tex.magFilter = THREE.LinearFilter
      tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping
      tex.unpackAlignment = 1
      tex.needsUpdate = true
      return tex
    })
    field.catch(() => { field = null })
  }
  return field
}

export const fieldUniforms = () => ({
  uField: { value: null as THREE.Data3DTexture | null },
  uMin: { value: new THREE.Vector3(...AERO.min) },
  uSize: { value: new THREE.Vector3(AERO.max[0] - AERO.min[0], AERO.max[1] - AERO.min[1], AERO.max[2] - AERO.min[2]) },
  uTime: { value: 0 },
  /** how hard the wake churns (smoke lines run calmer than the free particles) */
  uTurb: { value: 1 },
})

export const flowGlsl = /* glsl */ `
  precision highp sampler3D;
  uniform sampler3D uField;
  uniform vec3 uMin;
  uniform vec3 uSize;
  uniform float uTime;
  uniform float uTurb;
  const float DMAX = ${AERO.DIST_MAX.toFixed(3)};

  float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float vnoise(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float a = mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y);
    float b = mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y);
    return mix(a, b, f.z);
  }
  // divergence-free turbulence: the curl of a noise vector potential
  vec3 curl(vec3 p) {
    const float e = 0.12;
    vec3 dx = vec3(e, 0, 0), dy = vec3(0, e, 0), dz = vec3(0, 0, e);
    vec3 o1 = vec3(31.4, 0, 0), o2 = vec3(0, 57.1, 0);
    float a = vnoise(p + dy + o2) - vnoise(p - dy + o2);
    float b = vnoise(p + dz + o1) - vnoise(p - dz + o1);
    float c = vnoise(p + dz) - vnoise(p - dz);
    float d = vnoise(p + dx + o2) - vnoise(p - dx + o2);
    float g = vnoise(p + dx + o1) - vnoise(p - dx + o1);
    float h = vnoise(p + dy) - vnoise(p - dy);
    return vec3(a - b, c - d, g - h) / (2.0 * e);
  }
  float inBox(vec3 p) {
    vec3 t = (p - uMin) / uSize;
    // a long taper at the downstream end so the wakes thin out instead of stopping at the grid's edge
    vec3 m = vec3(smoothstep(0.0, 0.22, t.x), smoothstep(0.0, 0.06, t.y), smoothstep(0.0, 0.06, t.z)) * smoothstep(vec3(1.0), vec3(0.94), t);
    return m.x * m.y * m.z;
  }
  vec2 field(vec3 p) {
    float k = inBox(p);
    vec2 f = texture(uField, (p - uMin) / uSize).rg;
    return vec2(mix(DMAX, f.r * DMAX, k), f.g * k);
  }
  float dist(vec3 p) { return field(p).x; }
  vec3 normalAt(vec3 p) {
    const float e = 0.045;
    vec3 g = vec3(dist(p + vec3(e, 0, 0)) - dist(p - vec3(e, 0, 0)),
                  dist(p + vec3(0, e, 0)) - dist(p - vec3(0, e, 0)),
                  dist(p + vec3(0, 0, e)) - dist(p - vec3(0, 0, e)));
    return g / max(length(g), 1e-5);
  }
  // a trailing vortex rolled up off a wing tip, spinning about the stream direction
  vec3 vortex(vec3 p, vec3 c, float s) {
    vec2 r = p.yz - c.yz;
    float rr = dot(r, r);
    float behind = smoothstep(c.x + 0.05, c.x - 0.35, p.x) * smoothstep(c.x - 4.6, c.x - 1.4, p.x);
    float k = s * 0.13 * behind * exp(-rr / 0.06) / (rr + 0.0025);
    return vec3(0.0, -k * r.y, k * r.x);
  }
  vec3 flow(vec3 p, out float wake, out float press) {
    vec2 f = field(p);
    float d = f.x;
    wake = f.y;
    vec3 v = vec3(-1.0, 0.0, 0.0);
    vec3 n = normalAt(p);
    // the body is felt before it is reached: a soft layer turns the air along the surface, a thin skin forbids entry
    float soft = 1.0 - smoothstep(0.0, 0.42, d);
    float skin = 1.0 - smoothstep(0.0, 0.08, d);
    float into = dot(v, n);
    // stagnation ahead of the nose and the tyres: the air slows as it meets the body head-on
    press = soft * max(0.0, -into);
    if (into < 0.0) v -= n * into * (soft * 1.05 + skin * 0.4);
    // and it speeds up running along it
    v *= 1.0 + 0.55 * soft * (1.0 - abs(into)) - 0.55 * press;
    v.y += max(0.0, 0.08 - p.y) * 3.0;
    // wakes: slower and unsteady, churning behind the wheels and the body
    v.x *= 1.0 - 0.5 * wake;
    v += curl(p * vec3(1.4, 2.4, 2.4) + vec3(uTime * 1.1, 0.0, 0.0)) * wake * 0.9 * uTurb;
    // downforce, made visible: the rear wing flings the air up and over, the diffuser pulls the floor flow up
    float span = 1.0 - smoothstep(0.42, 0.62, abs(p.z));
    v.y += 0.62 * span * smoothstep(-1.9, -2.35, p.x) * smoothstep(-4.2, -2.6, p.x) * smoothstep(0.42, 0.7, p.y) * (1.0 - smoothstep(1.25, 1.7, p.y));
    v.y += 0.3 * (1.0 - smoothstep(0.5, 0.75, abs(p.z))) * smoothstep(-1.55, -2.1, p.x) * smoothstep(-3.6, -2.4, p.x) * (1.0 - smoothstep(0.25, 0.5, p.y));
    // tip vortices: rear wing, front wing end plates, the Y250 under the nose
    v += vortex(p, vec3(-2.2, 0.79, 0.5), 1.0) + vortex(p, vec3(-2.2, 0.79, -0.5), -1.0);
    v += vortex(p, vec3(1.7, 0.24, 0.8), -0.8) + vortex(p, vec3(1.7, 0.24, -0.8), 0.8);
    v += vortex(p, vec3(1.55, 0.2, 0.24), 0.5) + vortex(p, vec3(1.55, 0.2, -0.24), -0.5);
    return v;
  }
`
