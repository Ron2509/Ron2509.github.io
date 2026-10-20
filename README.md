# Raunak Saoji — Portfolio

A studio scene around a real F1 2022 car: scroll moves a film camera between five chapters, the circuit on the
right is navigation and lap progress, and the livery picker repaints the car (and the site accent) live.

Stack: Vite + React + TypeScript, React Three Fiber + drei, postprocessing, Lenis.

```bash
npm install
npm run dev
```

## The car model

`public/models/` is git-ignored on purpose. The car is by Peter Kiss (instagram.com/peterkissdesign), licensed
CC BY-NC-SA with a "do not share or distribute" note. Get his permission before deploying it publicly, or swap
in a model with an open license.

Rebuilding the web model from the source download:

```bash
# 1. OBJ -> GLB (needs ~10 GB of free RAM for the 687 MB OBJ)
node --max-old-space-size=10000 node_modules/obj2gltf/bin/obj2gltf.js -i OBJ.obj -o car-raw.glb
# 2. strip textures, simplify, meshopt-compress: <in> <out> <ratio> <error>
node scripts/build-model.mjs car-raw.glb public/models/car.glb 0.1 0.0015     # ~0.84M tris, 5.9 MB
node scripts/build-model.mjs car-raw.glb public/models/car-hi.glb 0.3 0.0004  # ~2.45M tris, 15 MB
```

Materials are assigned in `src/Car.tsx` by source material name, so no textures ship.

## Where things live

- `src/Scene.tsx` — studio lighting, reflective floor, camera shots per chapter, post effects
- `src/Car.tsx` — model normalisation and physically based materials, paint transitions, rear rain light
- `src/CircuitNav.tsx` — circuit outline, lap progress, chapter jumps
- `src/App.tsx` — chapter copy (placeholder content lives here), Lenis scroll, loader, livery picker
