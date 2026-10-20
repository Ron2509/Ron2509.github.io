# Raunak Saoji — Portfolio

A studio scene around a real F1 2022 car: scroll moves a film camera between five chapters, the circuit on the
right is navigation and lap progress, and the livery picker repaints the car (and the site accent) live.

Stack: Vite + React + TypeScript, React Three Fiber + drei, postprocessing, Lenis.

```bash
npm install
npm run dev
```

## The car model

The car is ["Aston Martin F1 AMR23 2023"](https://sketchfab.com/3d-models/aston-martin-f1-amr23-2023-f6ba825a43b146a9b669934a4e1fd529) by **Redgrund**, licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (credited on the Contact page and in
`public/models/CREDITS.md`). It has been modified: split into its parts, textures removed (the livery is drawn by
the site), and compressed for the web.

Rebuilding the web model from the Sketchfab source download (`source/*.blend`), with a portable Blender 4.2:

```bash
# 1. apply the smoothing, split the car into its 131 pieces, name and assign each one the way src/Car.tsx and
#    src/explode.ts expect, export a texture-free GLB
blender -b --disable-autoexec source/Sketchfab_*.blend --python scripts/convert-model.py -- car-raw.glb report.json
# 2. weld and meshopt-compress: <in> <out> <ratio> <error>
node scripts/build-model.mjs car-raw.glb public/models/car-hi.glb 1 0.0001     # 645k tris, 3.8 MB (desktop)
node scripts/build-model.mjs car-raw.glb public/models/car.glb 0.45 0.0006     # 290k tris, 2.0 MB (phones)
# 3. re-bake the wind-tunnel flow field around it: open the dev server with ?bakeaero (src/aero/bake.ts)
```

Materials are assigned in `src/Car.tsx` by source material name, so no textures ship.

## Where things live

- `src/Scene.tsx` — studio lighting, reflective floor, camera shots per chapter, post effects
- `src/Car.tsx` — model normalisation and physically based materials, paint transitions, rear rain light
- `src/CircuitNav.tsx` — circuit outline, lap progress, chapter jumps
- `src/App.tsx` — chapter copy (placeholder content lives here), Lenis scroll, loader, livery picker
