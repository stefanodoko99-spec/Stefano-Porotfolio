# Headless: blender -b shop.blend -P bake_shop.py -- [samples] [group,group...]
# Joins each bake group into one mesh, smart-UV-unwraps it (the floor keeps its planar UV),
# bakes COMBINED lighting with Cycles (CPU) into one atlas per group, saves them, exports a
# Draco GLB with NO materials, and writes public/models/shop-manifest.json. The runtime
# paints the atlases back on by mesh name and gives every other mesh its role by name.
#
# Every atlas saves as PNG now, not JPEG. JPEG's encoder halves the resolution of
# the two colour channels (4:2:0 chroma subsampling) and has no Python-exposed
# switch to turn that off — it is not a quality slider, it is baked into the
# format. On a bake that is mostly thin, saturated neon on near-black, that
# subsampling is exactly what read as "low resolution colours": the colour
# smears a few pixels wide around every tube and every letter of signage,
# because the file genuinely carries less colour information than luma. PNG is
# lossless in all three channels, at the cost of a heavier download.
import bpy, os, sys, json, math, time

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SAMPLES = int(argv[0]) if len(argv) > 0 else 512
ONLY = argv[1].split(',') if len(argv) > 1 else None

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TEX_DIR = os.path.join(ROOT, 'public', 'textures')
MODEL_DIR = os.path.join(ROOT, 'public', 'models')
os.makedirs(TEX_DIR, exist_ok=True)
os.makedirs(MODEL_DIR, exist_ok=True)

# (collection, joined mesh name, atlas name, atlas size, keep the UV it has, save as PNG)
#
# SHOP, MACHINES and SIGNPOST doubled again, from 2048 to 4096: close-up
# detail (the bottles, the stools, signage lettering, neon tubing) is what
# visitors actually stop and look at, and 2048 was still the first place a
# texel became a visible block on those. FLOOR stays at 2048 — it is seen at
# a shallow, distant grazing angle for the whole visit and never gets a
# close-up look the other three groups do, so the extra memory has nothing to
# buy there. Every group is PNG now; nothing bakes to JPEG any more, so the
# `png` column is the same for all four, but it stays a column rather than a
# constant because a future group with no fine colour detail (a flat
# backdrop, say) is a legitimate reason to trade back to JPEG.
GROUPS = [('SHOP', 'shopJoined', 'shopBaked', 4096, False, True),
          ('MACHINES', 'machinesJoined', 'machinesBaked', 4096, False, True),
          ('SIGNPOST', 'signpostJoined', 'signpostBaked', 4096, False, True),
          ('FLOOR', 'floor', 'floorBaked', 2048, True, True)]
LIVE = ['TEXT', 'EMISSIVE', 'SCREENS', 'HITBOX', 'DYNAMIC', 'MARKER']

def log(*a):
    print('[bake]', *a, flush=True)

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = SAMPLES
scene.cycles.use_adaptive_sampling = True
# Tighter again (0.006 -> 0.005) alongside the samples bump (128 -> 512):
# PNG keeps whatever grain Cycles leaves in the bake exactly as rendered,
# where JPEG's own blur used to hide it for free, so a lower noise floor is
# what actually pays for going lossless rather than the sample count alone.
scene.cycles.adaptive_threshold = 0.005
scene.cycles.use_denoising = True
scene.cycles.denoiser = 'OPENIMAGEDENOISE'
# use_denoising only runs on a bake when the bake writes the COMBINED pass —
# every other bake pass type skips it silently. Asserted again right at the
# bake call below, where it actually matters, rather than trusted here.
scene.cycles.max_bounces = 8
scene.cycles.diffuse_bounces = 4
scene.cycles.glossy_bounces = 3
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
# Dilation, not just seam padding. At 10px this only just covered the ~6-8px
# gutter between tightly-packed islands — everywhere else in the atlas (every
# small prop unwrapped on its own, with the packer's margin around it, and
# every stretch the packer simply couldn't fill) stayed pure black. That black
# is real image data: mipmapping averages it into every texel once the object
# is more than a few metres from the camera, which is what actually explains
# a scene that reads vivid close up in Blender and flat, dark, and washed out
# from the site's own default distance. Bumped hard, not tuned to the gutter.
# (The far side of that same problem — everything outside this margin, where
# the packer left no island at all — is handled separately, after export, by
# a nearest-colour fill over the exported PNG; the two do not overlap.)
#
# A generic bake starting point is 16px, and that is the right number for a
# seam ring alone. It is the wrong number for THIS pipeline: mipmapping halves
# resolution repeatedly regardless of the atlas's base size, so how many mip
# levels a margin survives before a seam reappears is set by its absolute
# pixel count, not its share of the texture. Doubling the atlas to 4096 and
# also shrinking the margin to 16px would make seams reappear at a HIGHER mip
# level than the 2048/48px combination this project already measured and
# fixed — a regression dressed up as following the spec's default. 48px
# carries forward unchanged so that mip-level behaviour does not move either.
b.margin = 48
b.margin_type = 'EXTEND'
b.use_selected_to_active = False
b.use_clear = True
scene.render.threads_mode = 'AUTO'
# Unused while every group above saves as PNG; kept sane rather than deleted,
# so a group added back as JPEG later does not inherit Blender's default 90
# without anyone having chosen it.
scene.render.image_settings.quality = 96

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
    # Never reuse a found image datablock as-is: a rerun of this script over an
    # older .blend still holding a 2048 "shopBaked" from a previous pass would
    # otherwise hand that datablock straight to the bake operator, and its
    # canvas would stay 2048 while everything else here moved to 4096 — the
    # exact "resize an old bake and call it a 4K rebake" shortcut the spec
    # rules out, except silent. Dropping any existing image and always
    # creating a fresh one at the requested size makes that impossible: the
    # canvas below is guaranteed new, and use_clear=True (set above) then has
    # the bake operator overwrite every pixel of it before anything is saved.
    old = bpy.data.images.get(tex_name)
    if old is not None:
        bpy.data.images.remove(old)
    image = bpy.data.images.new(tex_name, size, size, alpha=False, float_buffer=False)
    # A baked image holds scene-linear values — the bake operator writes the lit
    # result directly, the same numbers any render pass works with, before any
    # display transform. It has to be LABELLED that way too, or save_render
    # below has no idea what it is holding: a new image defaults to 'sRGB',
    # which would tell the exporter these bytes are already gamma-encoded and
    # skip the transform meant to be applied to them.
    image.colorspace_settings.name = 'Linear Rec.709'
    image.generated_color = (0, 0, 0, 1)
    attach_bake_image(ob, image)
    select_only([ob], ob)
    t0 = time.time()
    # use_denoising only takes effect on a COMBINED bake — confirmed against
    # Blender's own tracker, since the render-time flag silently doing nothing
    # for other bake pass types is exactly the kind of failure that would not
    # show up as an error, only as extra noise in the delivered atlas. This
    # script only ever bakes COMBINED, so the assert is cheap and permanent
    # insurance against a future edit changing that without noticing.
    assert scene.cycles.bake_type == 'COMBINED' and scene.cycles.use_denoising, \
        'denoising silently does not apply outside a COMBINED bake'
    bpy.ops.object.bake(type='COMBINED')

    def save(path):
        # image.save() writes the colour-managed bytes as a flat linear-to-sRGB
        # gamma encode: correct for a photo, and flat and washed out next to
        # what every preview render in this pipeline actually shows, because
        # every one of those renders (bpy.ops.render.render) goes through the
        # scene's own view transform (AgX here) on the way to disk and this did
        # not. save_render runs the same view transform save uses for a normal
        # render, so the exported atlas finally matches the Blender viewport
        # instead of a paler, flatter version of it.
        scene.render.image_settings.file_format = 'PNG' if png else 'JPEG'
        image.save_render(path, scene=scene)

    ext = 'png' if png else 'jpg'
    # The clean full-resolution master, at whatever size this group bakes at
    # (4096 for shop/machines/signpost, 2048 for the floor) — this file is
    # never itself downscaled or re-derived from anything smaller.
    master_path = os.path.join(TEX_DIR, f'{tex_name}.{ext}')
    save(master_path)
    # A second, smaller pass generated from the master, purely for the
    # runtime's own narrow/`compact`-viewport path (see main.ts's atlasPath) —
    # a deliberate extra output, not a byproduct of the master save above.
    image.scale(size // 2, size // 2)
    save(os.path.join(TEX_DIR, f'{tex_name}-half.{ext}'))
    image.scale(size, size)
    log(f'{tex_name}: baked {size}px in {time.time() - t0:.0f}s -> {master_path}')
    return f'{tex_name}.{ext}'

with open(os.path.join(HERE, 'glow.json'), encoding='utf-8') as f:
    glow = json.load(f)

manifest = {'samples': SAMPLES, 'groups': {}, 'glow': glow, 'live': {}}
# a partial run keeps the atlases of the groups it skips, which must exist before any baking starts
if ONLY:
    for coll_name, joined_name, tex_name, size, keep_uv, png in GROUPS:
        kept = f'{tex_name}.png' if png else f'{tex_name}.jpg'
        if coll_name not in ONLY and not os.path.exists(os.path.join(TEX_DIR, kept)):
            raise SystemExit(f'{coll_name}: not in ONLY but {kept} does not exist yet; run a full bake first')
t_all = time.time()
for coll_name, joined_name, tex_name, size, keep_uv, png in GROUPS:
    ob = join_group(coll_name, joined_name)
    if ob is None:
        continue
    log(f'{coll_name}: joined -> {joined_name} ({len(ob.data.vertices)} verts, {len(ob.material_slots)} mats)')
    if not keep_uv:
        unwrap(ob)
    entry = {'size': size}
    manifest['groups'][joined_name] = entry
    if ONLY and coll_name not in ONLY:
        kept = f'{tex_name}.png' if png else f'{tex_name}.jpg'
        log(f'{coll_name}: bake skipped (not in ONLY), keeping {kept}')
        entry['atlas'] = kept
        continue
    entry['atlas'] = bake_group(ob, tex_name, size, png=png)

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
