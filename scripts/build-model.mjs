// Turns the converted source GLB into a web-ready car: no textures (materials are set in code),
// welded + simplified geometry, meshopt-compressed. Usage: node scripts/build-model.mjs <in.glb> <out.glb> [ratio]
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions'
import { dedup, weld, simplify, prune, meshopt, quantize } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import { statSync } from 'node:fs'

const [, , input, output, ratioArg = '0.35', errorArg = '0.0004'] = process.argv
const ratio = Number(ratioArg)

await MeshoptEncoder.ready
await MeshoptSimplifier.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })

const doc = await io.read(input)
const root = doc.getRoot()

// Materials are replaced at runtime, so drop every texture and the UVs that only served them.
for (const mat of root.listMaterials()) {
  mat.setBaseColorTexture(null).setNormalTexture(null).setEmissiveTexture(null)
    .setMetallicRoughnessTexture(null).setOcclusionTexture(null)
}
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    for (const sem of prim.listSemantics()) if (sem.startsWith('TEXCOORD')) prim.setAttribute(sem, null)
  }
}

const tris = () => root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((a, p) => a + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0)
console.log('triangles before', Math.round(tris()).toLocaleString())

await doc.transform(
  prune(),
  dedup(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio, error: Number(errorArg), lockBorder: true }),
  prune(),
  quantize(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
)
doc.createExtension(EXTMeshoptCompression).setRequired(true)
console.log('triangles after', Math.round(tris()).toLocaleString())

await io.write(output, doc)
console.log('wrote', output, (statSync(output).size / 1e6).toFixed(2), 'MB')
