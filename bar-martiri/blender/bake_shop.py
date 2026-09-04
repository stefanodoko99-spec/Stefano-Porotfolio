# Headless: blender -b shop.blend -P bake_shop.py -- [samples] [group,group...]
# Joins each bake group into one mesh, smart-UV-unwraps it (the floor keeps its planar UV),
# bakes COMBINED lighting with Cycles (CPU) into one atlas per group, saves them, exports a
# Draco GLB with NO materials, and writes public/models/shop-manifest.json. The runtime
# paints the atlases back on by mesh name and gives every other mesh its role by name.
import bpy, os, sys, json, math, time

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SAMPLES = int(argv[0]) if len(argv) > 0 else 48
ONLY = argv[1].split(',') if len(argv) > 1 else None

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TEX_DIR = os.path.join(ROOT, 'public', 'textures')
MODEL_DIR = os.path.join(ROOT, 'public', 'models')
os.makedirs(TEX_DIR, exist_ok=True)
os.makedirs(MODEL_DIR, exist_ok=True)

# (collection, joined mesh name, atlas name, atlas size, keep the UV it has)
GROUPS = [('SHOP', 'shopJoined', 'shopBaked', 2048, False),
          ('MACHINES', 'machinesJoined', 'machinesBaked', 2048, False),
          ('SIGNPOST', 'signpostJoined', 'signpostBaked', 1024, False),
          ('FLOOR', 'floor', 'floorBaked', 2048, True)]
LIVE = ['TEXT', 'EMISSIVE', 'SCREENS', 'HITBOX', 'DYNAMIC', 'MARKER']

def log(*a):
    print('[bake]', *a, flush=True)

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = SAMPLES
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = 0.01
scene.cycles.use_denoising = True
scene.cycles.denoiser = 'OPENIMAGEDENOISE'
scene.cycles.max_bounces = 6
scene.cycles.diffuse_bounces = 4
scene.cycles.glossy_bounces = 2
scene.cycles.caustics_reflective = False
scene.cycles.caustics_refractive = False
scene.cycles.sample_clamp_indirect = 8.0
scene.cycles.bake_type = 'COMBINED'
b = scene.render.bake
b.use_pass_direct = True
b.use_pass_indirect = True
b.use_pass_color = True
b.use_pass_diffuse = True
b.use_pass_glossy = True
b.use_pass_emit = True
b.use_pass_transmission = False
b.margin = 10
b.margin_type = 'EXTEND'
b.use_selected_to_active = False
b.use_clear = True
scene.render.threads_mode = 'AUTO'
scene.render.image_settings.quality = 92

# the screens, the click targets and the markers take no part in the lighting
for coll in ('SCREENS', 'HITBOX', 'MARKER'):
    for o in bpy.data.collections[coll].objects:
        o.hide_render = True

def select_only(objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]

def join_group(coll_name, joined_name):
    coll = bpy.data.collections.get(coll_name)
    objs = [o for o in coll.objects if o.type == 'MESH'] if coll else []
    if not objs:
        return None
    select_only(objs, objs[0])
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = joined_name
    ob.data.name = joined_name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob

def unwrap(ob):
    select_only([ob], ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    try:
        bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
    except Exception as e:
        log('pack_islands skipped:', e)
    bpy.ops.object.mode_set(mode='OBJECT')

def attach_bake_image(ob, image):
    for slot in ob.material_slots:
        m = slot.material
        if m is None:
            continue
        nt = m.node_tree
        node = nt.nodes.get('BAKE_TARGET')
        if node is None:
            node = nt.nodes.new('ShaderNodeTexImage')
            node.name = 'BAKE_TARGET'
            node.location = (-600, 400)
        node.image = image
        node.select = True
        nt.nodes.active = node

def bake_group(ob, tex_name, size, png):
    image = bpy.data.images.get(tex_name) or bpy.data.images.new(tex_name, size, size, alpha=False, float_buffer=False)
    image.generated_color = (0, 0, 0, 1)
    attach_bake_image(ob, image)
    select_only([ob], ob)
    t0 = time.time()
    bpy.ops.object.bake(type='COMBINED')
    ext = 'png' if png else 'jpg'
    path = os.path.join(TEX_DIR, f'{tex_name}.{ext}')
    image.filepath_raw = path
    image.file_format = 'PNG' if png else 'JPEG'
    image.save()
    image.scale(size // 2, size // 2)
    image.filepath_raw = os.path.join(TEX_DIR, f'{tex_name}-half.{ext}')
    image.save()
    image.scale(size, size)
    log(f'{tex_name}: baked {size}px in {time.time() - t0:.0f}s -> {path}')
    return f'{tex_name}.{ext}'

with open(os.path.join(HERE, 'glow.json'), encoding='utf-8') as f:
    glow = json.load(f)

manifest = {'samples': SAMPLES, 'groups': {}, 'glow': glow, 'live': {}}
# a partial run keeps the atlases of the groups it skips, which must exist before any baking starts
if ONLY:
    for coll_name, joined_name, tex_name, size, planar in GROUPS:
        kept = f'{tex_name}.png' if planar else f'{tex_name}.jpg'
        if coll_name not in ONLY and not os.path.exists(os.path.join(TEX_DIR, kept)):
            raise SystemExit(f'{coll_name}: not in ONLY but {kept} does not exist yet; run a full bake first')
t_all = time.time()
for coll_name, joined_name, tex_name, size, planar in GROUPS:
    ob = join_group(coll_name, joined_name)
    if ob is None:
        continue
    log(f'{coll_name}: joined -> {joined_name} ({len(ob.data.vertices)} verts, {len(ob.material_slots)} mats)')
    if not planar:
        unwrap(ob)
    entry = {'size': size}
    manifest['groups'][joined_name] = entry
    if ONLY and coll_name not in ONLY:
        kept = f'{tex_name}.png' if planar else f'{tex_name}.jpg'
        log(f'{coll_name}: bake skipped (not in ONLY), keeping {kept}')
        entry['atlas'] = kept
        continue
    entry['atlas'] = bake_group(ob, tex_name, size, png=planar)

for coll in LIVE:
    manifest['live'][coll] = sorted(o.name for o in bpy.data.collections[coll].objects if o.type == 'MESH')

export_objs = [o for c in [g[0] for g in GROUPS] + LIVE if bpy.data.collections.get(c)
               for o in bpy.data.collections[c].objects if o.type == 'MESH']
for o in export_objs:
    o.hide_render = False
    o.hide_set(False)
select_only(export_objs, export_objs[0])
glb = os.path.join(MODEL_DIR, 'shop.glb')
kwargs = dict(filepath=glb, export_format='GLB', use_selection=True,
              export_materials='NONE', export_apply=True, export_yup=True,
              export_cameras=False, export_lights=False, export_animations=False,
              export_normals=True, export_texcoords=True,
              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
              export_draco_position_quantization=14, export_draco_normal_quantization=10,
              export_draco_texcoord_quantization=12)
try:
    bpy.ops.export_scene.gltf(export_colors=False, **kwargs)
except TypeError:
    bpy.ops.export_scene.gltf(**kwargs)
manifest['glb'] = 'shop.glb'
manifest['glbBytes'] = os.path.getsize(glb)
with open(os.path.join(MODEL_DIR, 'shop-manifest.json'), 'w', encoding='utf-8') as f:
    json.dump(manifest, f, indent=1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'shop_baked.blend'))
log(f'ALL DONE in {time.time() - t_all:.0f}s; glb {manifest["glbBytes"]} bytes')
