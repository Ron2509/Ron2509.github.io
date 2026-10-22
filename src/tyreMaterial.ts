import * as THREE from 'three'

// Slick tyres read as real only with their sidewall dressing: a compound band, moulded lettering,
// a satin sidewall and a scuffed, grainy tread. The model has no UVs, so everything is drawn in polar
// coordinates around each tyre's own hub, worked out from its geometry.

const LETTERING = '  SLICK  ·  C3  ·  SOFT  ·  PORTFOLIO GP  ·  245/710 R18  ·  '

let letteringTex: THREE.CanvasTexture | null = null
function lettering() {
  if (letteringTex) return letteringTex
  const c = document.createElement('canvas')
  c.width = 4096
  c.height = 160
  const g = c.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#fff'
  g.textBaseline = 'middle'
  g.font = "expanded 700 104px 'Archivo', 'Helvetica Neue', Arial, sans-serif"
  // twice around the tyre, like the real thing
  const run = LETTERING + LETTERING
  const w = g.measureText(run).width
  g.save()
  g.scale(c.width / w, 1)
  g.fillText(run, 0, c.height / 2 + 4)
  g.restore()
  letteringTex = new THREE.CanvasTexture(c)
  letteringTex.anisotropy = 8
  return letteringTex
}

export function makeTyreMaterial(geometry: THREE.BufferGeometry, band = '#f2f1ec') {
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox!
  const size = bb.getSize(new THREE.Vector3())
  const hub = bb.getCenter(new THREE.Vector3())
  const dims = [size.x, size.y, size.z]
  const ai = dims.indexOf(Math.min(...dims))
  const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]
  const axis = axes[ai]
  const [b1, b2] = axes.filter((_, i) => i !== ai)
  const others = dims.filter((_, i) => i !== ai)

  // rubber is a dull dielectric: a weak reflection, or it washes out grey under the studio's softboxes
  const mat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.7, metalness: 0, specularIntensity: 0.4, envMapIntensity: 0.55, clearcoat: 0 })
  const u = {
    uHub: { value: hub },
    uAxis: { value: axis },
    uB1: { value: b1 },
    uB2: { value: b2 },
    uR: { value: Math.max(...others) / 2 },
    uHalfW: { value: dims[ai] / 2 },
    uText: { value: lettering() },
    uBand: { value: new THREE.Color(band) },
    /** 0..1 rotational blur: the lettering smears into a ring as the wheel spins up */
    uBlur: { value: 0 },
  }
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vT;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvT = transformed;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vT;
        uniform vec3 uHub, uAxis, uB1, uB2, uBand;
        uniform float uR, uHalfW, uBlur;
        uniform sampler2D uText;
        float tHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
        float tNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); vec2 w = f * f * (3.0 - 2.0 * f);
          return mix(mix(tHash(i), tHash(i + vec2(1, 0)), w.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), w.x), w.y);
        }
        float tyTread = 0.0;
        float tyMark = 0.0;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 rel = vT - uHub;
          float al = dot(rel, uAxis);
          vec2 rad = vec2(dot(rel, uB1), dot(rel, uB2));
          float r = length(rad) / uR;
          float ang = atan(rad.y, rad.x) * sign(al + 1e-5);
          float side = smoothstep(0.5, 0.7, abs(al) / uHalfW) * (1.0 - smoothstep(0.93, 0.97, r));
          tyTread = smoothstep(0.9, 0.97, r) * (1.0 - side);

          vec3 col = vec3(0.016, 0.016, 0.018);
          // satin sidewall, the faintest bit lighter than the tread
          col = mix(col, vec3(0.022, 0.022, 0.024), side);
          // the compound's coloured stripe, as bold as on a race weekend
          float aaR = fwidth(r) * 1.5;
          float band = smoothstep(0.8 - aaR, 0.8 + aaR, r) * (1.0 - smoothstep(0.85 - aaR, 0.85 + aaR, r)) * side;
          col = mix(col, uBand * 0.8, band);
          // moulded lettering ring
          vec2 tuv = vec2(ang / 6.2831853 + 0.5, (r - 0.655) / 0.115);
          float txt = 0.0;
          if (tuv.y > 0.0 && tuv.y < 1.0) {
            if (uBlur < 0.01) txt = texture2D(uText, tuv).r;
            else {
              for (int k = 0; k < 9; k++) txt += texture2D(uText, tuv + vec2((float(k) / 8.0 - 0.5) * uBlur * 0.45, 0.0)).r;
              txt = mix(txt / 9.0, 0.26, smoothstep(0.55, 1.0, uBlur));
            }
          }
          // the moulded lettering in the compound's colour, a touch softer than the stripe
          col = mix(col, mix(vec3(0.85, 0.84, 0.82), uBand, 0.75), txt * side * 0.9);
          tyMark = max(band, txt * side);
          // tread: worked rubber, with the faint lighter streaks of graining running round it
          float grain = tNoise(vec2(ang * 260.0, r * 30.0)) * tNoise(vec2(ang * 37.0, r * 9.0));
          col = mix(col, vec3(0.03, 0.03, 0.032) + grain * 0.012, tyTread);
          // shape: the sidewall tucks into the rim and rolls over the shoulder, so the tyre reads round and full
          float tuck = smoothstep(0.6, 0.72, r);
          float shoulder = 1.0 - 0.35 * smoothstep(0.9, 0.99, r) * side;
          col *= mix(0.45, 1.0, tuck) * shoulder;
          diffuseColor.rgb = col;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        // satin sidewall, a soft sheen on the tread, the markings a little glossier, all with a rubber grain
        roughnessFactor = mix(mix(0.58, 0.66, tyTread), 0.45, tyMark) + (tNoise(vT.xy * 900.0) - 0.5) * 0.08;`,
      )
  }
  mat.customProgramCacheKey = () => 'tyre-v5'
  mat.userData.tyre = u
  return mat
}
