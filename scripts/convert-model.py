"""Turn the AMR23 (one baked mesh) into the site's car: real geometry with the smoothing applied, split into its
loose pieces, each piece named and given a material the way the site's original model was, so Car.tsx, the
exploded drawing, the wheels and the livery find their parts. Exports a texture-free glTF.

Car axes in this file: length along Y with the nose at -Y, width X, up Z. Run with --disable-autoexec."""
import bpy, bmesh, json, sys
import numpy as np
from mathutils import Vector

OUT, REPORT = sys.argv[-2], sys.argv[-1]
src = bpy.data.objects['Body_Baked']
for o in list(bpy.data.objects):
    if o is not src: bpy.data.objects.remove(o, do_unlink=True)

# 1. smoothing applied at its render level, so the full detail is real geometry
bpy.context.view_layer.objects.active = src
src.select_set(True)
for m in src.modifiers:
    if m.type == 'SUBSURF': m.levels = m.render_levels
for m in list(src.modifiers):
    bpy.ops.object.modifier_apply(modifier=m.name)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

# the baked colour, metalness and roughness, to tell paint from carbon, rubber and metal
def image(name_part):
    for img in bpy.data.images:
        if name_part.lower() in img.name.lower() and img.size[0] > 0:
            w, h = img.size
            px = np.empty(w * h * 4, dtype=np.float32)
            img.pixels.foreach_get(px)
            return px.reshape(h, w, 4), w, h
    return None, 0, 0
diff, dw, dh = image('Diffuse')
metal, mw, mh = image('Metalness')

# 2. the loose pieces, with what each one is made of (sampled from the bake through its UVs)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.separate(type='LOOSE')
bpy.ops.object.mode_set(mode='OBJECT')
parts = [o for o in bpy.data.objects if o.type == 'MESH']

def sample(o):
    me = o.data
    uv = me.uv_layers.active
    if uv is None or diff is None: return (0.1, 0.1, 0.1), 0.0
    n = len(uv.data)
    co = np.empty(n * 2, dtype=np.float32); uv.data.foreach_get('uv', co); co = co.reshape(n, 2)
    idx = np.linspace(0, n - 1, min(n, 4000)).astype(int)
    u = np.clip((co[idx, 0] % 1.0) * (dw - 1), 0, dw - 1).astype(int)
    v = np.clip((co[idx, 1] % 1.0) * (dh - 1), 0, dh - 1).astype(int)
    c = diff[v, u, :3]
    # the median colour: robust to the odd decal on a part
    col = tuple(float(x) for x in np.median(c, axis=0))
    mt = float(np.median(metal[np.clip(v * mh // dh, 0, mh - 1), np.clip(u * mw // dw, 0, mw - 1), 2])) if metal is not None else 0.0
    return col, mt

info = []
for o in parts:
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    mn = Vector([min(p[i] for p in bb) for i in range(3)]); mx = Vector([max(p[i] for p in bb) for i in range(3)])
    col, mt = sample(o)
    info.append({'o': o, 'min': mn, 'max': mx, 'c': (mn + mx) / 2, 'd': mx - mn, 'n': len(o.data.vertices), 'col': col, 'metal': mt})

allmin = Vector([min(i['min'][k] for i in info) for k in range(3)]); allmax = Vector([max(i['max'][k] for i in info) for k in range(3)])
L = allmax.y - allmin.y
ny = lambda y: (y - allmin.y) / L          # 0 at the nose, 1 at the tail
Z = allmax.z - allmin.z
nz = lambda z: (z - allmin.z) / Z

# 3. the four tyres: the big round pieces at the corners
cands = [i for i in info if i['d'].x < 0.4 and abs(i['d'].y - i['d'].z) < 0.08 and i['d'].z > 0.4]
cands.sort(key=lambda i: -i['n'])
tyres = {}
for i in cands:
    key = ('Ft' if ny(i['c'].y) < 0.5 else 'Bk') + ('L' if i['c'].x > 0 else 'R')
    if key not in tyres: tyres[key] = i
hubs = {k: t['c'] for k, t in tyres.items()}
rad = {k: max(t['d'].y, t['d'].z) / 2 for k, t in tyres.items()}

lum = lambda c: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
sat = lambda c: max(c) - min(c)

names, mats = {}, {}
count = {}
def name(i, base, mat):
    count[base] = count.get(base, 0) + 1
    names[i['o']] = f"{base}{'' if count[base] == 1 else '%03d' % count[base]}"
    mats[i['o']] = mat

for k, t in tyres.items():
    name(t, f'wheel{k}_object', 'rubber_tyre')

for i in info:
    if i['o'] in names: continue
    c, d, col = i['c'], i['d'], i['col']
    y, z = ny(c.y), nz(c.z)
    # a wheel's own bits: inside the tyre's radius, around its hub: rim, brake, nut. They spin with it.
    hub = next((k for k, h in hubs.items() if (Vector((0, c.y, c.z)) - Vector((0, h.y, h.z))).length < rad[k] * 0.95 and abs(c.x - h.x) < 0.22), None)
    if hub:
        pre = ('f' if hub.startswith('Ft') else 'r') + ('l_' if hub.endswith('L') else 'r_')
        name(i, pre + 'wheel_part', 'glossy_paint_wheel' if max(d.y, d.z) > rad[hub] * 1.1 else 'anodized')
        continue
    # materials by what the part is, as on the original model: bodywork, mirrors and the rear wing wear the
    # livery; the front wing, floor and suspension are bare carbon (the bake is mostly black, so colour can't tell)
    # wings: ahead of the front wheels, low; behind the rear wheels, high
    if y < 0.13 and z < 0.5: name(i, 'front_wing_mixer', 'carbon_gloss'); continue
    if y > 0.84 and z > 0.35: name(i, 'rear_wing_no_mod', 'carbon_paint'); continue
    # the floor and its strakes: low and flat
    if z < 0.2 and d.z < 0.16: name(i, 'floor_main', 'carbon_rough'); continue
    # wishbones and push rods: thin, out between the body and a wheel, near an axle
    thin = min(d.x, d.y, d.z) < 0.05 and abs(c.x) > 0.12
    front_axle = abs(c.y - (hubs.get('FtL', c).y + hubs.get('FtR', c).y) / 2) < 0.3
    rear_axle = abs(c.y - (hubs.get('BkL', c).y + hubs.get('BkR', c).y) / 2) < 0.3
    if thin and front_axle: name(i, 'front_upper_arm', 'carbon_gloss'); continue
    if thin and rear_axle: name(i, 'upper_arms', 'carbon_gloss'); continue
    # the halo, roll hoop and airbox: high over the cockpit, on the centreline
    if z > 0.72 and 0.28 < y < 0.64 and abs(c.x) < 0.3: name(i, 'shell_halo', 'carbon_gloss'); continue
    # mirrors: either side of the cockpit
    if 0.28 < y < 0.5 and abs(c.x) > 0.2 and z > 0.55 and max(d) < 0.3: name(i, 'mirror_main_body', 'carbon_paint'); continue
    # the gearbox end of the car: low at the tail, behind the engine cover
    if y > 0.8 and z < 0.5: name(i, 'gearbox_cover', 'carbon_gloss'); continue
    name(i, 'body_object', 'carbon_paint')

for o, n in names.items():
    o.name = n
    o.data.name = n
    m = bpy.data.materials.get(mats[o]) or bpy.data.materials.new(mats[o])
    o.data.materials.clear()
    o.data.materials.append(m)

json.dump({
    'parts': len(parts), 'tris': sum(sum(max(0, len(p.vertices) - 2) for p in o.data.polygons) for o in parts),
    'tyres': list(tyres.keys()),
    'groups': {b: count[b] for b in sorted(count)},
    'mats': {m: sum(1 for x in mats.values() if x == m) for m in set(mats.values())},
    'detail': sorted([{'name': names[i['o']], 'n': i['n'], 'y': round(ny(i['c'].y), 2), 'z': round(nz(i['c'].z), 2), 'col': [round(v, 2) for v in i['col']], 'mat': mats[i['o']]} for i in info], key=lambda r: -r['n'])[:60],
}, open(REPORT, 'w'), indent=1)

# 4. a texture-free glTF of the pieces
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_image_format='NONE', export_materials='EXPORT', export_normals=True, export_texcoords=False, export_apply=True, use_selection=False)
print('EXPORTED', OUT)
