import * as THREE from 'three'
import { ATLAS_H, ATLAS_W, LIVERIES, paintAtlas, type LiveryDef } from './liveries'
import type { SponsorSet } from './sponsors'

/**
 * Two painted livery atlases (outgoing + incoming) projected onto the bodywork from the side and
 * from above, blended by surface normal, with a glowing paint sweep from nose to tail between them.
 */
export const LENS_N = 20

/** Every livery atlas texture, so the start-up can put them on the GPU before the first frame (Scene.tsx). */
export const liveryTextures = new Set<THREE.Texture>()

export class LiveryPainter {
  uniforms = {
    uTex0: { value: null as THREE.Texture | null },
    uTex1: { value: null as THREE.Texture | null },
    uMix: { value: 1 },
    uSeam: { value: new THREE.Color('#ffffff') },
    uCarInv: { value: new THREE.Matrix4() },
    uBMin: { value: new THREE.Vector3() },
    uBSize: { value: new THREE.Vector3(1, 1, 1) },
    /** metallic flake strength, follows the livery's metalness */
    uFlake: { value: 0.3 },
    // paint lens: a third livery revealed under the cursor (drawing-buffer pixels), Lando-helmet style
    uTexP: { value: null as THREE.Texture | null },
    uLens: { value: 0 },
    // the lens is a trail of paint blobs in the car rig's own space (xyz, strength), so the floor reflection
    // carries it too; blob 0 sits under the cursor, the rest are dropped along its path and recede
    uSplats: { value: Array.from({ length: LENS_N }, () => new THREE.Vector4(0, -99, 0, 0)) },
    uTime: { value: 0 },
    uLensR: { value: 0.6 },
    uLensMetal: { value: 1 },
    uLensRough: { value: 0.12 },
  }
  private slots: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; id: string }[] = []
  private front = 1
  private ticket = 0
  // the atlases after the first are painted by a worker (atlasWorker.ts), off the main thread
  private worker: Worker | null = null
  private jobs = new Map<number, (bmp: ImageBitmap | null) => void>()
  private jobId = 0

  constructor(anisotropy: number) {
    for (let i = 0; i < 3; i++) {
      const canvas = document.createElement('canvas')
      canvas.width = ATLAS_W
      canvas.height = ATLAS_H
      const tex = new THREE.CanvasTexture(canvas)
      // stored as plain RGBA8 and decoded from sRGB in the shader (sampleLivery): an sRGB texture this size takes
      // four times as long to upload on ANGLE, and its mipmaps are built the slow way, a quarter-second stall
      tex.colorSpace = THREE.NoColorSpace
      tex.anisotropy = anisotropy
      tex.generateMipmaps = true
      tex.minFilter = THREE.LinearMipmapLinearFilter
      // uploaded as the canvas holds it, which Chrome copies GPU to GPU; flipping a 4096 canvas on upload goes
      // through the CPU and stalled every pit stop. The shader reads it the other way up instead (sampleLivery).
      tex.flipY = false
      tex.premultiplyAlpha = true
      this.slots.push({ canvas, tex, id: '' })
      liveryTextures.add(tex)
    }
  }

  /** On the main thread, at once (the first paint, behind the loader, and the dev colour trials). */
  private paint(slot: number, l: LiveryDef, set: SponsorSet) {
    const s = this.slots[slot]
    const key = l.id + '|' + set.id
    if (s.id === key) return
    const size = this.uniforms.uBSize.value
    paintAtlas(s.canvas.getContext('2d')!, l, set, { x: size.x, y: size.y, z: size.z })
    s.id = key
    this.show(s, s.canvas)
  }

  private show(s: (typeof this.slots)[number], image: HTMLCanvasElement | ImageBitmap) {
    const old = s.tex.image as HTMLCanvasElement | ImageBitmap
    s.tex.image = image
    s.tex.needsUpdate = true
    if (old && old !== image && 'close' in old) old.close()
  }

  /** In the worker; resolves once the slot holds the new paint (falling back to the main thread if it must). */
  private paintAsync(slot: number, l: LiveryDef, set: SponsorSet): Promise<void> {
    const s = this.slots[slot]
    const key = l.id + '|' + set.id
    if (s.id === key) return Promise.resolve()
    const known = LIVERIES.includes(l)
    if (!known || typeof OffscreenCanvas === 'undefined' || typeof Worker === 'undefined') { this.paint(slot, l, set); return Promise.resolve() }
    if (!this.worker) {
      try {
        this.worker = new Worker(new URL('./atlasWorker.ts', import.meta.url), { type: 'module' })
        this.worker.onmessage = (e: MessageEvent<{ id: number; bmp?: ImageBitmap; error?: boolean }>) => {
          const done = this.jobs.get(e.data.id)
          this.jobs.delete(e.data.id)
          done?.(e.data.bmp ?? null)
        }
      } catch { this.paint(slot, l, set); return Promise.resolve() }
    }
    s.id = key
    const id = ++this.jobId
    const size = this.uniforms.uBSize.value
    return new Promise((resolve) => {
      this.jobs.set(id, (bmp) => {
        // a later paint of the same slot has taken over
        if (s.id !== key) { bmp?.close(); resolve(); return }
        if (bmp) this.show(s, bmp)
        else { s.id = ''; this.paint(slot, l, set) }
        resolve()
      })
      this.worker!.postMessage({ id, livery: l.id, set: set.id, size: { x: size.x, y: size.y, z: size.z } })
    })
  }

  /** Show `l` immediately with no sweep. */
  set(l: LiveryDef, set: SponsorSet) {
    this.paint(this.front, l, set)
    this.uniforms.uTex0.value = this.slots[this.front].tex
    this.uniforms.uTex1.value = this.slots[this.front].tex
    this.uniforms.uMix.value = 1
  }

  /** Prepare a sweep from what is on the car now to `l`; resolves true once it is painted and ready, when the
   *  caller animates uniforms.uMix 0 -> 1 (false if a later change took its place meanwhile). */
  next(l: LiveryDef, set: SponsorSet): Promise<boolean> {
    const ticket = ++this.ticket
    const back = 1 - this.front
    return this.paintAsync(back, l, set).then(() => {
      if (ticket !== this.ticket) return false
      this.uniforms.uTex0.value = this.slots[this.front].tex
      this.uniforms.uTex1.value = this.slots[back].tex
      this.uniforms.uSeam.value.set(l.accent)
      this.uniforms.uMix.value = 0
      this.front = back
      return true
    })
  }

  /** Paint `l` into the lens slot (slot 2), shown under the cursor while uLens > 0. */
  preview(l: LiveryDef, set: SponsorSet) {
    void this.paintAsync(2, l, set)
    this.uniforms.uTexP.value = this.slots[2].tex
  }

  apply(mat: THREE.MeshPhysicalMaterial) {
    const u = this.uniforms
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u)
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform mat4 uCarInv;\nuniform vec3 uBMin;\nuniform vec3 uBSize;\nattribute vec4 aRest;\nattribute vec3 aRestN;\nvarying vec3 vCar;\nvarying vec3 vCarN;\nvarying vec3 vRig;\nvarying vec3 vRest;',
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vec3 lvC = (uCarInv * (modelMatrix * vec4(transformed, 1.0))).xyz;
          // the paint is laid where the part sits on the car at rest (aRest, baked at load; w = 2 when present), so
          // it stays stuck to a part that is pulled off or flung across the studio
          bool lvRest = aRest.w > 1.5;
          vec3 lvP = lvRest ? aRest.xyz : lvC;
          vCar = vec3((lvP.x - uBMin.x) / uBSize.x, (lvP.y - uBMin.y) / uBSize.y, lvP.z / (uBSize.z * 0.5));
          vCarN = lvRest ? aRestN : mat3(uCarInv) * normalize(mat3(modelMatrix) * objectNormal);
          vRig = lvC;
          vRest = lvP;`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D uTex0;
          uniform sampler2D uTex1;
          uniform float uMix;
          uniform vec3 uSeam;
          uniform float uFlake;
          uniform sampler2D uTexP;
          uniform float uLens;
          uniform vec4 uSplats[${LENS_N}];
          uniform float uTime;
          uniform float uLensR;
          float lvHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
          float lvNoise(vec3 x) {
            vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(lvHash(i), lvHash(i + vec3(1, 0, 0)), f.x), mix(lvHash(i + vec3(0, 1, 0)), lvHash(i + vec3(1, 1, 0)), f.x), f.y),
                       mix(mix(lvHash(i + vec3(0, 0, 1)), lvHash(i + vec3(1, 0, 1)), f.x), mix(lvHash(i + vec3(0, 1, 1)), lvHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
          }
          varying vec3 vRig;
          uniform float uLensMetal;
          uniform float uLensRough;
          varying vec3 vCar;
          varying vec3 vCarN;
          varying vec3 vRest;
          vec3 sampleLivery(sampler2D tex, vec3 p, vec3 n) {
            float x = clamp(p.x, 0.002, 0.998);
            float y = clamp(p.y, 0.004, 0.996);
            vec2 uvSide = vec2(x, n.z >= 0.0 ? 0.625 + y * 0.375 : 0.25 + y * 0.375); // by facing, so inner faces read right too
            vec2 uvTop = vec2(x, clamp(0.5 - p.z * 0.5, 0.01, 0.99) * 0.25);
            float wSide = n.z * n.z + n.x * n.x * 0.7 + max(-n.y, 0.0);
            float wTop = max(n.y, 0.0);
            wTop = wTop * wTop * wTop * 1.6;
            float t = smoothstep(0.42, 0.58, wTop / (wTop + wSide + 1e-4));
            // the atlas is uploaded unflipped: canvas rows run top down
            uvSide.y = 1.0 - uvSide.y;
            uvTop.y = 1.0 - uvTop.y;
            vec3 c = mix(texture2D(tex, uvSide).rgb, texture2D(tex, uvTop).rgb, t);
            // the atlas holds sRGB values in a plain texture: decode them here
            return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
          }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec3 lvN = normalize(vCarN);
          // the new paint flows on from the nose: the front is a liquid edge that wanders with a slow noise and
          // ripples along the bodywork, rather than a straight wipe
          float sweep = uMix * 1.45 - 0.22;
          float flowN = lvNoise(vRig * 2.6 + vec3(0.0, uTime * 0.35, 0.0)) * 0.7 + lvNoise(vRig * 7.0 - uTime * 0.5) * 0.3;
          float sd = (1.0 - vCar.x) - sweep + (flowN - 0.5) * 0.16 + sin(vCar.y * 11.0 + uTime * 2.0) * 0.012;
          float sm = 1.0 - smoothstep(-0.03, 0.03, sd);
          vec3 lvCol = sm > 0.999 ? sampleLivery(uTex1, vCar, lvN)
                     : sm < 0.001 ? sampleLivery(uTex0, vCar, lvN)
                     : mix(sampleLivery(uTex0, vCar, lvN), sampleLivery(uTex1, vCar, lvN), sm);
          // the lens, Lando-helmet style: metaball paint blobs along the cursor's path melt into one gooey
          // shape, the edge wobbles with a slow noise, and each blob shrinks away as it fades
          float field = 0.0;
          for (int i = 0; i < ${LENS_N}; i++) {
            vec4 sp = uSplats[i];
            if (sp.w < 0.003) continue;
            float r = uLensR * (0.4 + 0.6 * sp.w);
            vec3 dv = vRig - sp.xyz;
            float q = max(0.0, 1.0 - dot(dv, dv) / (r * r));
            field += q * q * sp.w;
          }
          float lnz = lvNoise(vRig * 4.5 + vec3(0.0, uTime * 0.5, 0.0)) * 0.65 + lvNoise(vRig * 12.0 - uTime * 0.35) * 0.35;
          float fld = field + (lnz - 0.5) * 0.3 * min(field * 3.0, 1.0);
          float laa = max(fwidth(fld) * 1.1, 0.004);
          float lensM = smoothstep(0.26 - laa, 0.26 + laa, fld);
          // against these dark matte cars the revealed paint is lifted a step, so the new colour reads at once
          if (lensM > 0.001) {
            vec3 rev = sampleLivery(uTexP, vCar, lvN);
            float rl = dot(rev, vec3(0.2126, 0.7152, 0.0722));
            // only a dark revealed paint is lifted; a light one already stands out
            lvCol = mix(lvCol, rev * mix(1.7, 1.0, smoothstep(0.04, 0.25, rl)), lensM);
          }
          diffuseColor.rgb = lvCol;
          // the cockpit is bare black carbon inside, as on the real car: the tub below the rim (the opening runs
          // from the roll hoop to the halo's pillar, rig space), the walls that face in and the floor
          float lvPit = 0.0;
          {
            vec3 q = vRest;
            float box = smoothstep(-0.27, -0.22, q.x) * (1.0 - smoothstep(0.42, 0.47, q.x))
                      * (1.0 - smoothstep(0.24, 0.28, abs(q.z)))
                      * (1.0 - smoothstep(0.6, 0.64, q.y)) * smoothstep(0.3, 0.34, q.y);
            float inward = 1.0 - smoothstep(0.25, 0.6, lvN.z * sign(q.z));
            lvPit = box * inward;
            // a little deeper in shadow towards the floor
            vec3 pitCol = vec3(0.012, 0.012, 0.014) * mix(0.55, 1.0, smoothstep(0.42, 0.6, q.y));
            diffuseColor.rgb = mix(diffuseColor.rgb, pitCol, lvPit);
          }
          // black lettering and panels are gloss on the satin colour, the way real decals catch the light
          float inkM = 1.0 - smoothstep(0.004, 0.0068, max(lvCol.r, max(lvCol.g, lvCol.b)));
          #ifdef LIVERY_DEBUG
          {
            float wS = lvN.z * lvN.z + lvN.x * lvN.x * 0.7 + max(-lvN.y, 0.0);
            float wT = max(lvN.y, 0.0); wT = wT * wT * wT * 1.6;
            float tt = smoothstep(0.42, 0.58, wT / (wT + wS + 1e-4));
            vec2 sv = vec2(vCar.x, vCar.y);
            vec2 tv = vec2(vCar.x, 0.5 - vCar.z * 0.5);
            vec2 gv = tt > 0.5 ? tv : sv;
            vec2 gl = abs(fract(gv * 20.0 + 0.5) - 0.5) / fwidth(gv * 20.0);
            vec2 gl2 = abs(fract(gv * 4.0 + 0.5) - 0.5) / fwidth(gv * 4.0);
            float line = 1.0 - min(min(gl.x, gl.y), 1.0);
            float line2 = 1.0 - min(min(gl2.x, gl2.y), 1.0);
            diffuseColor.rgb = mix(vec3(0.5, 0.08, 0.08), vec3(0.08, 0.4, 0.12), tt);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9), line * 0.6);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.9, 0.2), line2);
          }
          #endif
          float live = step(0.001, uMix) * step(uMix, 0.999);
          // the edge of a paint change is the paint itself meeting: no bright outline, only a faint sheen of the
          // incoming colour
          vec3 livSeam = uSeam * (1.0 - smoothstep(0.0, 0.014, abs(sd))) * live * 0.35;`,
        )
        // inside the lens the finish follows the revealed livery
        .replace(
          '#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\nroughnessFactor = mix(mix(mix(roughnessFactor, uLensRough, lensM), 0.12, inkM), 0.5, lvPit);',
        )
        .replace(
          '#include <metalnessmap_fragment>',
          '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, uLensMetal, lensM);',
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          // metallic flake: a tiny per-flake normal jitter in the base coat; the clear coat keeps its smooth normal
          {
            vec3 fc = floor(vCar * vec3(9000.0, 1800.0, 3600.0));
            vec3 fr = fract(sin(vec3(dot(fc, vec3(12.99, 78.23, 37.72)), dot(fc, vec3(39.35, 11.13, 83.15)), dot(fc, vec3(73.16, 52.24, 19.47)))) * 43758.5453);
            normal = normalize(normal + (fr - 0.5) * 0.22 * uFlake);
          }`,
        )
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += livSeam;')
    }
    if (import.meta.env.DEV && location.search.includes('liverydebug')) mat.defines = { ...mat.defines, LIVERY_DEBUG: '' }
    mat.customProgramCacheKey = () => 'livery-atlas-v13' + (mat.defines?.LIVERY_DEBUG !== undefined ? 'd' : '')
    mat.needsUpdate = true
  }
}
