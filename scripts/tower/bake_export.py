# Headless: blender -b garage.blend -P bake_export.py -- [size] [samples] [only] [variant] [png]
#   variant: 'night' (default, the authored look) or 'day'. See lighting.py.
# Joins each bake group into one mesh, smart-UV-unwraps it, bakes COMBINED lighting with Cycles (CPU)
# into one atlas per group, saves PNGs, then exports a Draco GLB with NO materials (like jesse-zhou.com).
import bpy, os, sys, json, math, time

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SIZE = int(argv[0]) if len(argv) > 0 else 4096
SAMPLES = int(argv[1]) if len(argv) > 1 else 48
ONLY = argv[2].split(',') if len(argv) > 2 and argv[2] and argv[2] not in ('day', 'night') else None
VARIANT = next((a for a in argv if a in ('day', 'night')), 'night')

# WebP, not PNG.
#
# The atlases ARE the lighting here — nothing is lit at runtime — so their
# resolution is the resolution of the whole scene, and 2048 across a nine-metre
# workshop is about forty texels to the metre: enough from the road, visibly
# soft once the camera has walked to the monitor. Four thousand and ninety-six
# fixes that and quadruples the bytes, and a lossless 4K sheet is six megabytes
# it is not worth asking anyone to download four of.
#
# Lossy WebP at 92 lands a 4K sheet at roughly what the 2K PNG cost. That is
# the whole trade: four times the texels for the same wire. It is also the
# right codec to be lossy in here, because what is in these images is baked
# diffuse light — large, smooth, low-frequency gradients, which is the case
# every DCT-derived codec is best at. The lettering and the neon are not in
# them; they are SIGNS and EMISSIVE meshes, drawn flat at runtime.
FORMAT = 'PNG' if 'png' in argv else 'WEBP'
EXT = '.png' if FORMAT == 'PNG' else '.webp'

# Day writes its own atlases beside the night ones rather than over them, so a
# day bake can never cost you the night set that the site is currently serving.
SUFFIX = '' if VARIANT == 'night' else 'Day'

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lighting
lighting.apply(VARIANT)

# The blend lives at <repo>/assets/blender/garage.blend, so the repo root is
# three levels up, not two. With two it resolved to <repo>/assets and the bake
# wrote a stray assets/public/textures/baked/ that the site never reads, while
# the atlases the site does read sat in public/models/tower/ and went stale.
# Derived from this script's own location instead, which does not move.
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEX_DIR = os.path.join(ROOT, 'public', 'models', 'tower')
MODEL_DIR = os.path.join(ROOT, 'public', 'models', 'tower')
os.makedirs(TEX_DIR, exist_ok=True)
os.makedirs(MODEL_DIR, exist_ok=True)

GROUPS = [('SHELL', 'shellJoined', 'shellBaked'),
          ('GROUND', 'groundJoined', 'groundBaked'),
          ('GARAGE', 'garageJoined', 'garageBaked'),
          ('BANK', 'bankJoined', 'bankBaked'),
          ('MILANO', 'milanoJoined', 'milanoBaked'),
          ('FARMACIA', 'farmaciaJoined', 'farmaciaBaked'),
          ('BEACH', 'beachJoined', 'beachBaked'),
          ('EXTERIOR', 'exteriorJoined', 'exteriorBaked')]
BAKE_COLLS = [g[0] for g in GROUPS]

def log(*a):
    print('[bake]', *a, flush=True)

# --- how far apart the islands sit --------------------------------------------
#
# The bake dilates each island outward by BAKE_MARGIN pixels so that a texel
# sampled just off the edge still has colour under it. That dilation has to fit
# in the gutter between islands, and it did not: the gutter was 0.002 of the
# atlas — four pixels at 2048 — while the dilation wrote eight. Every island was
# bleeding into its neighbour, and with roughly sixty to eighty-five pixels per
# face, the neighbour of a neon sign is usually a dark wall. Pulling the camera
# back made it worse rather than better, because mipmapping collapses a four
# pixel gutter first.
#
# So the gutter is now derived from the dilation instead of guessed: room for
# the bleed on both sides of the seam, and a little over. Islands lose a few
# texels each; they stop being contaminated by the one next door.
# Four pixels of dilation, not eight. Eight was sized for islands far larger
# than this atlas actually holds: at roughly sixty to eighty-five pixels a face,
# an eight pixel skirt on every side is a fifth of the island spent on bleed.
# Four clears the seam at mip 0, which is what the skirt is for.
BAKE_MARGIN = 4

# The gutter has to be wider than the dilation on both sides of a seam, or
# neighbouring islands write into each other. It also has to be as narrow as
# that allows: measured, going to a 20px gutter cleared the bleed and halved
# the lit area of the atlas, which trades a contamination artefact for a
# sharpness one. 2.5x the dilation clears it with a pixel to spare.
#
# Divided by SIZE, not by a hard 2048. The gutter is expressed in UV, so a
# constant one costs twice as many pixels on a 4K sheet as on a 2K one — the
# bake would spend the new resolution on empty space between islands and hand
# back a sharper picture of the gutters. Derived from the atlas actually being
# written, the gutter stays ten pixels wide at every size.
ISLAND_MARGIN = (BAKE_MARGIN * 2.5) / float(SIZE)     # ~10px, whatever SIZE is
PACK_MARGIN = (BAKE_MARGIN * 3.0) / float(SIZE)       # ~12px, whatever SIZE is

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
# The street is lit almost entirely by emissive geometry — neon, tubes, LEDs,
# lit windows — which is the worst case Cycles has: many small bright emitters
# throwing indirect light around an interior. Fireflies and blotching there are
# not a sampling accident, they are what that setup produces at low sample
# counts, and no denoiser rescues it because there is nothing coherent to
# denoise. Hence all four of these together rather than any one of them.
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = 'GPU'
except Exception as exc:                      # falls back rather than failing
    scene.cycles.device = 'CPU'
    print('[bake] GPU unavailable, using CPU:', exc)

scene.cycles.samples = SAMPLES
scene.cycles.use_adaptive_sampling = True
# 0.05 stopped sampling while the image was still visibly grainy. Adaptive
# sampling spends its budget where the variance is, so tightening the threshold
# costs time only in the places that were noisy.
scene.cycles.adaptive_threshold = 0.005
scene.cycles.use_denoising = True
scene.cycles.denoiser = 'OPENIMAGEDENOISE'
scene.cycles.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
# One firefly is one pixel that sampled a neon tube head-on. Clamping indirect
# throws those away; it costs a little energy in the bounce and removes the
# white speckle that survives denoising.
scene.cycles.sample_clamp_indirect = 8.0
scene.cycles.blur_glossy = 1.0
# Light that only bounces three times in a room with walls, a ceiling and a
# floor never reaches the back of it: the corners go flat black and read as
# painted-on shadow. Realism here is mostly bounce count and roughness.
scene.cycles.max_bounces = 8
scene.cycles.diffuse_bounces = 4
scene.cycles.glossy_bounces = 4
scene.cycles.transmission_bounces = 4
scene.cycles.caustics_reflective = False
scene.cycles.caustics_refractive = False
scene.cycles.bake_type = 'COMBINED'
b = scene.render.bake
b.use_pass_direct = True
b.use_pass_indirect = True
b.use_pass_color = True
b.use_pass_diffuse = True
b.use_pass_glossy = True
b.use_pass_emit = True
b.use_pass_transmission = False
b.margin = BAKE_MARGIN
b.margin_type = 'EXTEND'
b.use_selected_to_active = False
b.use_clear = True
scene.render.threads_mode = 'AUTO'

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
    existing = bpy.data.objects.get(joined_name)
    if existing and len(objs) == 1 and objs[0] is existing:
        return existing
    select_only(objs, objs[0])
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = joined_name
    ob.data.name = joined_name
    # apply transforms so the UV unwrap sees world-space geometry
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob

def unwrap(ob):
    select_only([ob], ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=ISLAND_MARGIN, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    try:
        bpy.ops.uv.pack_islands(rotate=True, margin=PACK_MARGIN)
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

def bake_group(ob, tex_name):
    image = bpy.data.images.get(tex_name) or bpy.data.images.new(tex_name, SIZE, SIZE, alpha=False, float_buffer=False)
    image.generated_color = (0, 0, 0, 1)
    attach_bake_image(ob, image)
    select_only([ob], ob)
    t0 = time.time()
    bpy.ops.object.bake(type='COMBINED')
    path = os.path.join(TEX_DIR, tex_name + SUFFIX + EXT)
    image.filepath_raw = path
    image.file_format = FORMAT
    scene.render.image_settings.file_format = FORMAT
    scene.render.image_settings.quality = 92
    image.save(quality=92) if FORMAT == 'WEBP' else image.save()
    log(f'{tex_name}: baked {SIZE}px in {time.time() - t0:.0f}s -> {path} '
        f'({os.path.getsize(path) / 1e6:.2f} MB)')

manifest = {'size': SIZE, 'samples': SAMPLES, 'format': FORMAT, 'groups': {}, 'emissive': [], 'screens': [], 'signs': [], 'hitboxes': [], 'dynamic': []}
t_all = time.time()
for coll_name, joined_name, tex_name in GROUPS:
    # A group with nothing in it is not an error any more: the scene is one
    # shop, so the four collections that used to be the other lots are empty.
    # Baking them would write a 2048 of pure black and the site would fetch it.
    _coll = bpy.data.collections.get(coll_name)
    if _coll is None or not _coll.objects:
        log(f'{coll_name}: empty, skipped')
        continue
    # every group is joined + unwrapped so the exported GLB is always complete; ONLY limits which ones get baked
    ob = join_group(coll_name, joined_name)
    if ob is None:
        continue
    log(f'{coll_name}: joined -> {joined_name} ({len(ob.data.vertices)} verts, {len(ob.material_slots)} mats)')
    unwrap(ob)
    manifest['groups'][joined_name] = tex_name + SUFFIX + EXT
    if ONLY and coll_name not in ONLY:
        log(f'{coll_name}: bake skipped (not in ONLY)')
        continue
    bake_group(ob, tex_name)

for key, coll in (('emissive', 'EMISSIVE'), ('screens', 'SCREENS'), ('signs', 'SIGNS'), ('hitboxes', 'HITBOX'), ('dynamic', 'DYNAMIC')):
    manifest[key] = sorted(o.name for o in bpy.data.collections[coll].objects if o.type == 'MESH')

# ---- screens: give every 4-vert plane a 0..1 UV quad (the build helper made no UV layer)
for o in bpy.data.collections['SCREENS'].objects:
    me = o.data
    if len(me.polygons) != 1 or len(me.polygons[0].vertices) != 4:
        continue
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    quad = [(0, 0), (1, 0), (1, 1), (0, 1)]
    for li, loop in enumerate(me.polygons[0].loop_indices):
        uv.data[loop].uv = quad[li]
    log(f'{o.name}: screen UVs written')

# ---- export GLB (Draco, no materials, meshes only)
export_objs = [o for c in BAKE_COLLS + ['EMISSIVE', 'SCREENS', 'SIGNS', 'HITBOX', 'DYNAMIC'] if bpy.data.collections.get(c)
               for o in bpy.data.collections[c].objects if o.type == 'MESH']
for o in export_objs:
    o.hide_render = False
    o.hide_set(False)
select_only(export_objs, export_objs[0])
glb = os.path.join(MODEL_DIR, 'tower.glb')   # what SCENE.tower actually loads
# export_colors was dropped from the glTF exporter in Blender 5.x and raises
# "keyword export_colors unrecognized", which killed the export after every
# bake had already been paid for. The meshes carry no vertex colours anyway —
# the light is in the atlases.
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True,
                          export_materials='NONE', export_apply=True, export_yup=True,
                          export_cameras=False, export_lights=False, export_animations=False,
                          export_normals=True, export_texcoords=True,
                          export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
                          export_draco_position_quantization=14, export_draco_normal_quantization=10,
                          export_draco_texcoord_quantization=12)
manifest['glb'] = 'garage.glb'
manifest['glbBytes'] = os.path.getsize(glb)
with open(os.path.join(MODEL_DIR, 'manifest.json'), 'w', encoding='utf-8') as f:
    json.dump(manifest, f, indent=2)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(
    os.path.dirname(bpy.data.filepath), f'garage_baked_{VARIANT}.blend'))
log(f'ALL DONE in {time.time() - t_all:.0f}s; glb {manifest["glbBytes"]} bytes')
