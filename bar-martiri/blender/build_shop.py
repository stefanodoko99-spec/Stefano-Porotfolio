# The ramen shop, built in Blender so it can be lit in Blender.
#
# After jesse-zhou.com: a night-time street stall on a mirror floor. A cube of
# a building with four different faces — the counter under an awning and a
# neon sign, a noren curtain with fans above it, a wall of screens with an
# arcade cabinet and a vending machine, and a utility wall of bricks, pipes and
# boxes — a cluttered roof (solar panels, a hologram pedestal, masts and
# cables, a big screen with a speaker on it, a dish), and beside it a signpost
# with five arrow signs under two globe lamps. The neon lights the scene:
# bake_shop.py bakes it all into atlases and the browser only paints them.
#
# Everything is authored in three.js coordinates (x right, y up, z toward the
# viewer) so the camera numbers measured on the reference carry over; T() and
# D() turn them into Blender's z-up on the way in, and the glTF exporter turns
# them back (export_yup) on the way out.
#
# Collections mirror the runtime roles:
#   SHOP, MACHINES, SIGNPOST, FLOOR   baked, one atlas each (FLOOR keeps a planar UV)
#   TEXT                              flat white at runtime (the name on the floor)
#   EMISSIVE                          flat colour + bloom at runtime; lights the bake
#   SCREENS                           planes the runtime paints with canvases
#   HITBOX                            invisible click targets
#   DYNAMIC                           matcap + animated (the fans)
#   MARKER                            invisible points the runtime reads (hologram)
#   LIGHTS                            bake only, never exported
#
# run:  blender -b -P build_shop.py   (saves shop.blend beside this file, renders previews)
import bpy, bmesh, math, os, json, random
from mathutils import Vector, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
with open(os.path.join(ROOT, 'src', 'content', 'labels.json'), encoding='utf-8') as f:
    LABELS = json.load(f)
random.seed(11)

bpy.ops.wm.read_homefile(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
for m in list(bpy.data.materials): bpy.data.materials.remove(m)

GROUPS = ['SHOP', 'MACHINES', 'SIGNPOST', 'FLOOR', 'TEXT', 'EMISSIVE', 'SCREENS', 'HITBOX', 'DYNAMIC', 'MARKER', 'LIGHTS']
COLL = {}
for g in GROUPS:
    c = bpy.data.collections.new(g); scene.collection.children.link(c); COLL[g] = c

# ---------------------------------------------------------------- coordinates: three.js in, Blender out
F = -2.9                     # the floor, in three.js y
def T(x, y, z): return (x, -z, y)            # three (x, y, z) -> Blender (x, -z, y)
def D(w, h, d): return (w, d, h)             # three (w, h, d) -> Blender dims
# text and screens: stand up (rx 90) then yaw to face a three.js direction
FACING = {'+z': (math.pi / 2, 0, 0), '-x': (math.pi / 2, 0, -math.pi / 2), '-z': (math.pi / 2, 0, math.pi), '+x': (math.pi / 2, 0, math.pi / 2)}
FLOOR_TEXT = (0, 0, -math.pi / 2)             # lying down, read from the -x/-z corner

# ---------------------------------------------------------------- fonts
#
# Four roles, by weight and character rather than by name: a bold monospace
# for the signage, a bold informal/rounded face for the neon script, a gothic
# sans standing in for the floor's "kanji" slot (the label it actually carries,
# LABELS['kanji'], is the Latin word "SPILLE" — no CJK glyphs are ever drawn
# through it, so any face with Latin coverage serves), and a bold sans for the
# floor labels. Each of these was a single Windows path, because this was
# built on Windows and had never run anywhere else — the first candidate that
# exists on the machine actually running this is what gets used.
FONT_CANDIDATES = {
    'sign': (r'C:\Windows\Fonts\consolab.ttf',
             '/System/Library/Fonts/Supplemental/Courier New Bold.ttf',
             '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'),
    'neon': (r'C:\Windows\Fonts\comicbd.ttf',
             '/System/Library/Fonts/Supplemental/Comic Sans MS Bold.ttf',
             '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'),
    'kanji': (r'C:\Windows\Fonts\msgothic.ttc',
              '/System/Library/Fonts/Hiragino Sans GB.ttc',
              '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'),
    'floor': (r'C:\Windows\Fonts\segoeuib.ttf',
              '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
              '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'),
}
def font(role):
    for p in FONT_CANDIDATES[role]:
        if os.path.exists(p):
            return bpy.data.fonts.load(p)
    raise SystemExit(f'font: none of the candidates for {role!r} exist on this machine; add its real path')
FONT = {role: font(role) for role in FONT_CANDIDATES}
def face_for(body):
    # kana and kanji need the gothic face; Latin words read better in the rounded one
    return 'kanji' if any(ord(ch) > 0x2fff for ch in body) else 'neon'

# ---------------------------------------------------------------- materials
def srgb(hex_):
    h = hex_.lstrip('#'); out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)

def _socket(node, *names):
    for n in names:
        if n in node.inputs: return node.inputs[n]
    raise KeyError(f'{node.name}: none of {names}')

MATS = {}
def mat(name, hex_, rough=0.7, metal=0.0, emit=None, strength=0.0):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    col = srgb(hex_)
    _socket(b, 'Base Color').default_value = (*col, 1.0)
    _socket(b, 'Roughness').default_value = rough
    _socket(b, 'Metallic').default_value = metal
    if emit is not None:
        _socket(b, 'Emission Color', 'Emission').default_value = (*srgb(emit), 1.0)
        _socket(b, 'Emission Strength').default_value = strength
    m.diffuse_color = (*col, 1.0)
    MATS[name] = m
    return m

def mat_wood(name, tones):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    co = nt.nodes.new('ShaderNodeTexCoord'); co.location = (-900, 0)
    mp = nt.nodes.new('ShaderNodeMapping'); mp.location = (-700, 0)
    mp.inputs['Scale'].default_value = (1.0, 0.15, 1.0)
    nt.links.new(co.outputs['Object'], mp.inputs['Vector'])
    wave = nt.nodes.new('ShaderNodeTexWave'); wave.location = (-500, 0)
    wave.inputs['Scale'].default_value = 3.0; wave.inputs['Distortion'].default_value = 2.5
    wave.inputs['Detail'].default_value = 2.0
    nt.links.new(mp.outputs['Vector'], wave.inputs['Vector'])
    r = nt.nodes.new('ShaderNodeValToRGB'); r.location = (-300, 0)
    r.color_ramp.elements[0].color = (*srgb(tones[0]), 1); r.color_ramp.elements[1].color = (*srgb(tones[1]), 1)
    nt.links.new(wave.outputs['Fac'], r.inputs['Fac'])
    nt.links.new(r.outputs['Color'], _socket(b, 'Base Color'))
    _socket(b, 'Roughness').default_value = 0.65
    m.diffuse_color = (*srgb(tones[0]), 1)
    MATS[name] = m
    return m

M = {k: mat(k, *v) for k, v in {
    'wall':        ('#f1ebdd', 0.85),
    'wallDark':    ('#2a8fa3', 0.85),
    'wallBlue':    ('#56c4d8', 0.85),
    'brick':       ('#d8c7a6', 0.9),
    'spray':       ('#4a4460', 0.88),
    'roof':        ('#b28a52', 0.85),
    'trim':        ('#1f6d7c', 0.8),
    'orange':      ('#e8712f', 0.6),
    'red':         ('#d8323c', 0.55),
    'redDark':     ('#a6202c', 0.6),
    'fabric':      ('#2fb3c9', 0.95),
    'fabricLight': ('#f2efe6', 0.95),
    'metal':       ('#8f9bc4', 0.35, 0.6),
    'metalDark':   ('#4c527a', 0.45, 0.5),
    'pipe':        ('#a9b3d6', 0.3, 0.7),
    'black':       ('#0c0b16', 0.6),
    'screenBack':  ('#07070d', 0.4),
    'teal':        ('#1c7d95', 0.6),
    'tealDark':    ('#124d5e', 0.65),
    'cyanBody':    ('#22b7cf', 0.5),
    'blueStripe':  ('#2447cc', 0.5),
    'white':       ('#e9e9f2', 0.6),
    'grey':        ('#9aa0b8', 0.7),
    'panelBlue':   ('#1b3ab0', 0.25, 0.2),
    'panelFrame':  ('#b9c3e6', 0.4, 0.5),
    'green':       ('#3f9a3f', 0.7),
    'greenDark':   ('#2b6b2b', 0.7),
    'yellow':      ('#f2c230', 0.5),
    'cream':       ('#f1e6c8', 0.7),
    'floor':       ('#0d0c16', 0.9),
    'hitbox':      ('#ff0000', 1.0),
    'text':        ('#f4f2ff', 0.6),
    'ink':         ('#0a0812', 0.7),
}.items()}
M['wood'] = mat_wood('wood', ('#c9a86a', '#e6cd93'))
M['woodDark'] = mat_wood('woodDark', ('#8a6a3c', '#b08f55'))

# neon and lamps: hex colour the runtime paints, bake emission strength, runtime gain,
# and whether the runtime blooms it (the white lamps and the sign plates are painted flat and crisp)
GLOW = {
    # the neon runs above 1.0 so its core burns toward white and its halo carries the colour
    'pink':    ('#ff2f9c', 6, 1.25),
    'cyan':    ('#28e7ff', 5, 1.2),
    'green':   ('#41ff8f', 5, 1.2),
    'yellow':  ('#ffd23a', 4, 1.15),
    'orange':  ('#ff8c2a', 3, 1.1),
    'red':     ('#ff3b5c', 3, 1.1),
    'blue':    ('#3d6bff', 3, 1.1),
    'white':   ('#f2f4ff', 2.5, 0.75, False),
    'lantern': ('#ffe3a8', 5, 0.8),
    'holo':    ('#3cf5ff', 12, 0.9),
    'platePink':   ('#ff2f7a', 1.2, 1.0, False),
    'plateCyan':   ('#27dcff', 1.2, 1.0, False),
    'plateGreen':  ('#45ff96', 1.2, 1.0, False),
    'plateOrange': ('#ff9d2a', 1.2, 1.0, False),
    'plateRed':    ('#ff3a5f', 1.2, 1.0, False),
    'plateWhite':  ('#f8f6ff', 1.2, 0.5),
    'vendGlow':    ('#dcf6ff', 4, 0.7),
    'vendHeader':  ('#8fe9ff', 3, 0.6),
    'ledCyan':     ('#5df3ff', 3, 0.9),
    'ledRed':      ('#ff4a5a', 3, 0.9),
    'ledGreen':    ('#5cff8a', 3, 0.9),
    'ledWhite':    ('#ffffff', 3, 0.8),
}
EM = {k: mat('glow_' + k, v[0], 0.5, emit=v[0], strength=v[1]) for k, v in GLOW.items()}
GLOW_OF = {}   # object name -> glow key, written to the manifest by the bake

# ---------------------------------------------------------------- mesh helpers (three.js coordinates in)
def _finish(name, bm, coll, material, loc=(0, 0, 0), rot=(0, 0, 0), smooth=True):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); ob.location = loc; ob.rotation_euler = Euler(rot)
    if material is not None:
        for m in (material if isinstance(material, (list, tuple)) else [material]): me.materials.append(m)
    for p in me.polygons: p.use_smooth = smooth
    COLL[coll].objects.link(ob)
    return ob

def bx(name, w, h, d, x, y, z, coll, material, yaw=0.0, rot=None, bevel=True):
    """A box of three.js size (w, h, d) centred at three.js (x, y, z)."""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(D(w, h, d)), verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.verts[:] + bm.edges[:], offset=min(w, h, d) * 0.08, segments=1, affect='EDGES', clamp_overlap=True)
    return _finish(name, bm, coll, material, T(x, y, z), rot if rot is not None else (0, 0, yaw), smooth=False)

AXIS_ROT = {'y': (0, 0, 0), 'x': (0, math.pi / 2, 0), 'z': (math.pi / 2, 0, 0)}
def cy(name, r, h, x, y, z, coll, material, seg=16, axis='y', r2=None, smooth=True, rot=None):
    """A cylinder of radius r and length h along a three.js axis, centred at (x, y, z)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=(r if r2 is None else r2), depth=h)
    return _finish(name, bm, coll, material, T(x, y, z), rot if rot is not None else AXIS_ROT[axis], smooth)

def sph(name, r, x, y, z, coll, material, seg=20):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=r)
    return _finish(name, bm, coll, material, T(x, y, z))

def prism(name, pts, t, x, coll, material):
    """A prism along x: a polygon of three.js (y, z) points at x + t/2, extruded to x - t/2."""
    bm = bmesh.new()
    vs = [bm.verts.new((x + t / 2, -z, y)) for (y, z) in pts]
    f = bm.faces.new(vs)
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    bmesh.ops.translate(bm, vec=Vector((-t, 0, 0)), verts=[g for g in r['geom'] if isinstance(g, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # the arrow outline is concave, and a concave n-gon tessellates with cracks: cut it up here
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method='BEAUTY', ngon_method='BEAUTY')
    return _finish(name, bm, coll, material, smooth=False)

def screen(name, w, h, x, y, z, facing, coll='SCREENS', material=None):
    """A quad with a (0,0)-(1,1) UV, facing a three.js direction."""
    bm = bmesh.new()
    v = [bm.verts.new(p) for p in [(-w / 2, -h / 2, 0), (w / 2, -h / 2, 0), (w / 2, h / 2, 0), (-w / 2, h / 2, 0)]]
    f = bm.faces.new(v); uv = bm.loops.layers.uv.new('UVMap')
    for loop, t in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]): loop[uv].uv = t
    return _finish(name, bm, coll, material or M['screenBack'], T(x, y, z), FACING[facing], smooth=False)

def convert(ob):
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target='MESH')

def text(name, body, fontkey, size, x, y, z, coll, material, facing='-x', tube=None, extrude=0.012, bold=0.0, flat=False, align='CENTER'):
    """Text as a mesh: filled and extruded, or as neon tubes along the outlines (tube = radius)."""
    cu = bpy.data.curves.new(name + 'Curve', type='FONT')
    cu.body = body; cu.font = FONT[fontkey]; cu.size = size; cu.offset = bold
    cu.align_x = align; cu.align_y = 'CENTER'
    if tube:
        cu.fill_mode = 'NONE'; cu.bevel_depth = tube; cu.bevel_resolution = 1; cu.resolution_u = 3; cu.use_fill_caps = True
    else:
        cu.fill_mode = 'BOTH'; cu.extrude = extrude; cu.resolution_u = 4
    ob = bpy.data.objects.new(name, cu); COLL[coll].objects.link(ob)
    ob.rotation_euler = Euler(FLOOR_TEXT if flat else FACING[facing]); ob.location = T(x, y, z)
    convert(ob)
    ob.data.materials.append(material)
    for p in ob.data.polygons: p.use_smooth = bool(tube)
    return ob

def tube(name, pts, r, coll, material, cyclic=False, res=2):
    """A tube along three.js points: neon, cables, pipes with bends."""
    cu = bpy.data.curves.new(name + 'Curve', type='CURVE'); cu.dimensions = '3D'
    sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
    for p, (x, y, z) in zip(sp.points, pts): p.co = (*T(x, y, z), 1.0)
    sp.use_cyclic_u = cyclic; sp.use_smooth = True
    cu.bevel_depth = r; cu.bevel_resolution = res; cu.resolution_u = 3; cu.use_fill_caps = not cyclic
    ob = bpy.data.objects.new(name, cu); COLL[coll].objects.link(ob)
    convert(ob)
    ob.data.materials.append(material)
    for p in ob.data.polygons: p.use_smooth = True
    return ob

def arc(cx, cy_, cz, r, a0, a1, n=14, plane='yz'):
    """Points on an arc in a three.js plane ('yz' faces ±x, 'xy' faces ±z)."""
    out = []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        if plane == 'yz': out.append((cx, cy_ + math.sin(a) * r, cz + math.cos(a) * r))
        else: out.append((cx + math.cos(a) * r, cy_ + math.sin(a) * r, cz))
    return out

def catenary(a, b, sag, n=14):
    out = []
    for i in range(n + 1):
        t = i / n
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t))
    return out

def glow(ob, key):
    GLOW_OF[ob.name] = key
    return ob

def hit(name, w, h, d, x, y, z):
    return bx('hit_' + name, w, h, d, x, y, z, 'HITBOX', M['hitbox'], bevel=False)

# ---------------------------------------------------------------- the floor: a disc with a planar UV the runtime mirror shares
FLOOR_R = 25.0
bm = bmesh.new(); bmesh.ops.create_circle(bm, cap_ends=True, radius=FLOOR_R, segments=72)
uv = bm.loops.layers.uv.new('UVMap')
for f in bm.faces:
    for loop in f.loops:
        loop[uv].uv = (loop.vert.co.x / (2 * FLOOR_R) + 0.5, loop.vert.co.y / (2 * FLOOR_R) + 0.5)
_finish('floor', bm, 'FLOOR', M['floor'], T(0, F, 0), smooth=False)

# the name on the floor, read from where the camera starts
text('floorName', LABELS['name'], 'floor', 0.62, -4.7, F + 0.006, 0.3, 'TEXT', M['text'], flat=True, extrude=0.004, align='LEFT')
for i, role in enumerate(LABELS['roles']):
    text(f'floorRole{i}', role, 'floor', 0.26, -5.15 - i * 0.36, F + 0.006, 0.4 + i * 0.25, 'TEXT', M['text'], flat=True, extrude=0.003, align='LEFT')

# ---------------------------------------------------------------- the body
BX0, BX1, BZ0, BZ1, R = -1.7, 2.3, -4.05, 2.0, 0.5      # the closed box: x, z extents and the roof line
CX0 = -2.6                                                # the counter porch reaches out to here
W, DD = BX1 - BX0, BZ1 - BZ0
bx('body', W, R - F, DD, (BX0 + BX1) / 2, (F + R) / 2, (BZ0 + BZ1) / 2, 'SHOP', M['wall'])
bx('roofDeck', W + (BX0 - CX0) + 0.2, 0.14, DD + 0.2, (CX0 + BX1) / 2, R + 0.07, (BZ0 + BZ1) / 2, 'SHOP', M['roof'])
# roof lip
for zc, dz in ((BZ0 - 0.06, 0.12), (BZ1 + 0.06, 0.12)):
    bx(f'roofLip{zc:.1f}', W + (BX0 - CX0) + 0.32, 0.26, dz, (CX0 + BX1) / 2, R + 0.2, zc, 'SHOP', M['trim'])
bx('roofLipX', 0.12, 0.26, DD + 0.24, BX1 + 0.06, R + 0.2, (BZ0 + BZ1) / 2, 'SHOP', M['trim'])
# the porch: side walls and header over the counter, back wall is the body face
for zc in (BZ0 + 0.1, BZ1 - 0.1):
    bx(f'porchWall{zc:.1f}', BX0 - CX0, R - F, 0.2, (CX0 + BX0) / 2, (F + R) / 2, zc, 'SHOP', M['wallDark'])
bx('porchHeader', BX0 - CX0, 0.5, DD, (CX0 + BX0) / 2, R - 0.25, (BZ0 + BZ1) / 2, 'SHOP', M['wallDark'])
bx('porchFloor', BX0 - CX0 + 1.4, 0.1, DD, (CX0 + BX0) / 2 - 0.7, F + 0.05, (BZ0 + BZ1) / 2, 'SHOP', M['trim'])

# ---------------------------------------------------------------- the counter face (-x)
# counter: wood top, orange front, the recess behind it
bx('counterTop', 1.15, 0.12, 5.3, -2.95, -1.72, -1.05, 'SHOP', M['wood'])
for i in range(7):
    bx(f'counterPlank{i}', 1.1, 0.02, 0.62, -2.95, -1.65, -3.4 + i * 0.75, 'SHOP', M['woodDark'], bevel=False)
bx('counterFront', 0.2, 1.1, 5.3, -2.5, F + 0.55, -1.05, 'SHOP', M['orange'])
bx('counterBase', 0.3, 0.16, 5.4, -2.55, F + 0.08, -1.05, 'SHOP', M['redDark'])
for zc in (-3.5, -1.05, 1.4):
    bx(f'counterLeg{zc:.1f}', 0.9, 1.15, 0.12, -2.95, F + 0.58, zc, 'SHOP', M['redDark'])
# shelves and bottles on the back wall of the recess
for i, yy in enumerate((-1.25, -0.55)):
    bx(f'shelf{i}', 0.28, 0.05, 3.4, BX0 - 0.14, yy, -1.3, 'SHOP', M['orange'])
    for j in range(7):
        col = ['green', 'white', 'yellow', 'red', 'cream', 'teal', 'orange'][(i * 3 + j) % 7]
        cy(f'bottle{i}_{j}', 0.055, 0.34 - (j % 3) * 0.06, BX0 - 0.14, yy + 0.2, -2.85 + j * 0.5, 'SHOP', M[col], seg=10)
# the kanji in green neon on the back wall, and the pots
glow(text('neonKanji', LABELS['kanji'], face_for(LABELS['kanji']), 0.62, BX0 - 0.03, -0.78, -1.0, 'EMISSIVE', EM['orange'], facing='-x', tube=0.018), 'orange')
cy('pot', 0.26, 0.3, -2.1, -1.5, -3.3, 'SHOP', M['metalDark'], seg=18)
cy('potLid', 0.28, 0.05, -2.1, -1.33, -3.3, 'SHOP', M['metal'], seg=18)
# bowls, cups and chopsticks on the counter
for i, zc in enumerate((-2.3, 0.4)):
    cy(f'cup{i}', 0.08, 0.2, -2.95, -1.56, zc, 'SHOP', M['white'], seg=14, r2=0.11)
    sph(f'scoop{i}', 0.1, -2.95, -1.4, zc, 'SHOP', M['red'] if i else M['cream'], seg=14)
    cy(f'straw{i}', 0.012, 0.36, -2.9, -1.36, zc + 0.06, 'SHOP', M['orange'], seg=6, rot=(0.35, 0, 0))
cy('cup', 0.07, 0.17, -3.2, -1.57, -0.9, 'SHOP', M['white'], seg=12)
cy('bottleSake', 0.065, 0.36, -2.75, -1.48, -1.4, 'SHOP', M['green'], seg=12)
cy('bottleSakeNeck', 0.03, 0.12, -2.75, -1.26, -1.4, 'SHOP', M['green'], seg=10)
# stools
for i, zc in enumerate((-2.25, -0.35)):
    bx(f'stoolSeat{i}', 0.5, 0.08, 0.5, -3.65, F + 0.62, zc, 'SHOP', M['wood'])
    for dx, dz in ((-0.2, -0.2), (0.2, -0.2), (-0.2, 0.2), (0.2, 0.2)):
        cy(f'stoolLeg{i}_{dx:+.0f}{dz:+.0f}', 0.035, 0.6, -3.65 + dx, F + 0.3, zc + dz, 'SHOP', M['orange'], seg=8)
    bx(f'stoolRail{i}', 0.42, 0.03, 0.03, -3.65, F + 0.22, zc + 0.2, 'SHOP', M['orange'], bevel=False)
# posts and the awning
A_TOP, A_OUT, A_Y0, A_Y1 = CX0, -4.05, 0.32, -0.18
for zc in (BZ0 + 0.1, BZ1 - 0.1):
    bx(f'post{zc:.1f}', 0.16, A_Y1 - F, 0.16, A_OUT + 0.1, (F + A_Y1) / 2, zc, 'SHOP', M['orange'])
tilt = math.atan2(A_Y0 - A_Y1, A_TOP - A_OUT)
slab_len = math.hypot(A_Y0 - A_Y1, A_TOP - A_OUT)
n_slats = 6
for i in range(n_slats):
    zc = BZ0 + (i + 0.5) * DD / n_slats
    bx(f'awning{i}', slab_len, 0.07, DD / n_slats - 0.05, (A_TOP + A_OUT) / 2, (A_Y0 + A_Y1) / 2, zc, 'SHOP',
       M['wallBlue'] if i % 2 else M['white'], rot=(0, -tilt, 0))
bx('awningBeam', 0.12, 0.12, DD + 0.1, A_OUT + 0.1, A_Y1 + 0.02, (BZ0 + BZ1) / 2, 'SHOP', M['trim'])
# paper lanterns hanging under the awning
for i, zc in enumerate((-2.0, 0.1)):
    cy(f'lanternCord{i}', 0.012, 0.3, -3.3, -0.3, zc, 'SHOP', M['black'], seg=6)
    glow(cy(f'lantern{i}', 0.15, 0.44, -3.3, -0.66, zc, 'EMISSIVE', EM['lantern'], seg=14), 'lantern')
    cy(f'lanternCap{i}', 0.09, 0.05, -3.3, -0.42, zc, 'SHOP', M['black'], seg=10)
    cy(f'lanternFoot{i}', 0.09, 0.05, -3.3, -0.9, zc, 'SHOP', M['black'], seg=10)
# the sign box over the awning: a dark box, a cyan neon frame, the name in pink neon
SX, SY, SZ = -2.95, 1.05, -0.95
SIGN_W = 5.2                                              # the box; the awning below is 6.05 wide
bx('signBox', 0.45, 1.05, SIGN_W, SX + 0.2, SY, SZ, 'MACHINES', M['black'])
bx('signBoxBack', 0.5, 1.2, SIGN_W + 0.15, SX + 0.3, SY, SZ, 'MACHINES', M['trim'])
fx = SX - 0.03
hw = SIGN_W / 2 - 0.15
glow(tube('neonFrame', [(fx, SY - 0.4, SZ - hw), (fx, SY - 0.4, SZ + hw), (fx, SY + 0.4, SZ + hw), (fx, SY + 0.4, SZ - hw)], 0.018, 'EMISSIVE', EM['orange'], cyclic=True), 'orange')
# the name shrinks to fit the box: about 0.36 units per letter at size 1 in this face
name_size = min(0.55, (SIGN_W - 0.9) / (0.62 * max(1, len(LABELS['shop']))))
glow(text('neonName', LABELS['shop'], 'neon', name_size, fx - 0.03, SY, SZ, 'EMISSIVE', EM['cyan'], facing='-x', tube=0.013), 'cyan')
# the TV over the sign, and a little one under it
bx('tvFrame', 0.24, 1.15, 2.4, -1.55, 3.3, -2.05, 'MACHINES', M['metalDark'])
screen('tvScreen', 2.2, 1.0, -1.68, 3.3, -2.05, '-x')
bx('tvStand', 0.16, 1.1, 0.16, -1.4, 2.2, -2.05, 'MACHINES', M['metalDark'])
bx('tvFoot', 0.5, 0.08, 0.5, -1.4, R + 0.18, -2.05, 'MACHINES', M['metalDark'])
bx('littleTvFrame', 0.22, 0.6, 1.15, -1.75, 2.3, -2.4, 'MACHINES', M['grey'])
screen('littleTvScreen', 1.0, 0.48, -1.87, 2.3, -2.4, '-x')
# open sign in yellow neon
glow(text('neonOpen', LABELS['open'], face_for(LABELS['open']), 0.26, -2.34, 2.95, 0.55, 'EMISSIVE', EM['green'], facing='-x', tube=0.012), 'green')
bx('neonOpenBoard', 0.06, 0.5, 1.0, -2.25, 2.95, 0.55, 'MACHINES', M['black'])
bx('neonOpenPost', 0.08, 2.4, 0.08, -2.2, R + 1.3, 0.55, 'MACHINES', M['metalDark'])
# chalkboard easel at the +z end of the counter
EX, EZ = -3.05, 2.45
# The rotation tilts each leg about its OWN centre, not about the point where
# it actually meets the ground or the board — so the sign of the angle is
# what decides which end ends up wider. The signs here had it backwards: legs
# that pinched to a point at the floor and splayed apart at the top, which is
# a table balanced on its own scissors rather than a stable A-frame. Rendered
# side-on to confirm before and after; flipping the sign is the whole fix.
for s, (dx, dz) in enumerate(((-0.12, 0), (0.12, 0))):
    for k, zz in enumerate((-0.3, 0.3)):
        cy(f'easelLeg{s}{k}', 0.025, 1.25, EX + dx * (1.4 if s else 1.0), F + 0.62, EZ + zz, 'SHOP', M['woodDark'], seg=8,
           rot=(0, (-0.22 if s else 0.22), 0))
bx('easelBoard', 0.06, 0.9, 0.7, EX - 0.05, F + 0.78, EZ, 'SHOP', M['black'], rot=(0, -0.22, 0))
bx('easelFrame', 0.04, 1.0, 0.8, EX - 0.02, F + 0.78, EZ, 'SHOP', M['woodDark'], rot=(0, -0.22, 0))
for k in range(4):
    bx(f'chalk{k}', 0.02, 0.03, 0.35 - k * 0.05, EX - 0.1 + k * 0.03, F + 0.55 + k * 0.14, EZ + 0.1, 'SHOP', M['white'], bevel=False, rot=(0, -0.22, 0))
hit('contact_easel', 0.6, 1.3, 1.0, EX - 0.1, F + 0.65, EZ)

# ---------------------------------------------------------------- the noren face (-z)
# the curtain: a waved grid hanging from the header
bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=30, y_segments=8, size=0.5)
NW, NH = 3.3, 2.0
bmesh.ops.scale(bm, vec=Vector((NW, NH, 1)), verts=bm.verts)
for v in bm.verts:
    t = v.co.y / NH + 0.5                       # 0 at the hem, 1 at the rod
    v.co.z = (math.sin(v.co.x * 7.0) * 0.07 + math.sin(v.co.x * 2.3 + 0.8) * 0.05) * (1.2 - t)
uv = bm.loops.layers.uv.new('UVMap')
for f in bm.faces:
    for loop in f.loops:
        loop[uv].uv = (loop.vert.co.x / NW + 0.5, loop.vert.co.y / NH + 0.5)
_finish('noren', bm, 'SHOP', M['fabric'], T(-0.25, R - 0.35 - NH / 2, BZ0 - 0.1), FACING['-z'], smooth=True)
bx('norenRod', NW + 0.3, 0.05, 0.05, -0.25, R - 0.33, BZ0 - 0.12, 'SHOP', M['woodDark'], bevel=False)
for i in range(4):
    bx(f'norenStripe{i}', 0.6, 0.06, 0.02, -1.45 + i * 0.8, R - 0.5, BZ0 - 0.22, 'SHOP', M['fabricLight'], bevel=False)
# doorway with an orange frame at the +x end
bx('door', 0.9, 2.5, 0.12, 1.75, F + 1.25, BZ0 - 0.06, 'SHOP', M['trim'])
bx('doorFrameL', 0.12, 2.6, 0.16, 1.24, F + 1.3, BZ0 - 0.08, 'SHOP', M['orange'])
bx('doorFrameR', 0.12, 2.6, 0.16, 2.26, F + 1.3, BZ0 - 0.08, 'SHOP', M['orange'])
bx('doorFrameT', 1.14, 0.12, 0.16, 1.75, F + 2.58, BZ0 - 0.08, 'SHOP', M['orange'])
# the machine box on the roof edge with two fans and a grille
bx('fanBox', 2.3, 0.7, 0.8, 0.85, R + 0.5, BZ0 + 0.3, 'MACHINES', M['grey'])
for i, xc in enumerate((0.3, 1.0)):
    cy(f'fanRing{i}', 0.28, 0.08, xc, R + 0.5, BZ0 - 0.14, 'MACHINES', M['metalDark'], seg=20, axis='z')
    cy(f'fanHub{i}', 0.05, 0.1, xc, R + 0.5, BZ0 - 0.16, 'DYNAMIC', M['metal'], seg=8, axis='z')
    # the blades: a cross of thin boxes, spun at runtime around z
    bm = bmesh.new()
    for k in range(5):
        a = k / 5 * math.tau
        bmesh.ops.create_cube(bm, size=1.0)
        blade = bm.verts[-8:]
        bmesh.ops.scale(bm, vec=Vector((0.22, 0.08, 0.015)), verts=blade)
        bmesh.ops.translate(bm, vec=Vector((0.13, 0, 0)), verts=blade)
        bmesh.ops.rotate(bm, cent=Vector((0, 0, 0)), matrix=Euler((0.5, 0, 0)).to_matrix(), verts=blade)
        bmesh.ops.rotate(bm, cent=Vector((0, 0, 0)), matrix=Euler((0, 0, a)).to_matrix(), verts=blade)
    _finish(f'fan{i}', bm, 'DYNAMIC', M['metal'], T(xc, R + 0.5, BZ0 - 0.17), FACING['-z'], smooth=False)
bx('grilleBox', 0.5, 0.45, 0.3, 1.85, R + 0.5, BZ0 - 0.1, 'MACHINES', M['metalDark'])
for k in range(5):
    bx(f'grilleSlat{k}', 0.4, 0.03, 0.04, 1.85, R + 0.34 + k * 0.08, BZ0 - 0.27, 'MACHINES', M['metal'], bevel=False)
tube('pipeNoren', [(-1.0, R + 0.9, BZ0 - 0.25), (-1.0, R + 0.25, BZ0 - 0.25), (-1.0, R + 0.25, BZ0 - 0.6), (-2.45, R + 0.25, BZ0 - 0.6), (-2.45, R - 1.2, BZ0 - 0.6)], 0.05, 'SHOP', M['pipe'])

# ---------------------------------------------------------------- the screen wall (+z): arcade, vending machine, ticker, screens
# arcade cabinet
AX, AZ0, AZ1 = -0.58, 1.36, 3.05
# the body stops short of the front so the screen sits in a recess between two side walls
bx('arcadeBody', 1.2, 2.2, 1.2, AX, F + 1.1, AZ0 + 0.6, 'MACHINES', M['teal'])
for s in (-1, 1):
    bx(f'arcadeSide{s:+d}', 0.1, 2.2, 0.55, AX + s * 0.55, F + 1.1, AZ1 - 0.3, 'MACHINES', M['teal'])
bx('arcadeHead', 1.2, 0.72, 1.4, AX, F + 2.5, (AZ0 + AZ1) / 2 + 0.1, 'MACHINES', M['tealDark'])
bx('arcadeMarquee', 1.05, 0.34, 0.06, AX, F + 2.5, AZ1 + 0.02, 'MACHINES', M['black'])
bx('arcadeScreenBack', 1.02, 0.9, 0.3, AX, F + 1.72, AZ1 - 0.42, 'MACHINES', M['black'])
screen('arcadeScreen', 0.9, 0.72, AX, F + 1.72, AZ1 - 0.26, '+z')
bx('arcadePanel', 1.1, 0.14, 0.55, AX, F + 1.1, AZ1 - 0.22, 'MACHINES', M['tealDark'], rot=(0.25, 0, 0))
cy('joystickStem', 0.03, 0.22, AX - 0.28, F + 1.28, AZ1 - 0.28, 'MACHINES', M['metal'], seg=8)
sph('joystickBall', 0.075, AX - 0.28, F + 1.42, AZ1 - 0.28, 'MACHINES', M['red'])
glow(cy('arcadeBtnA', 0.06, 0.05, AX + 0.12, F + 1.2, AZ1 - 0.3, 'EMISSIVE', EM['ledGreen'], seg=12), 'ledGreen')
glow(cy('arcadeBtnB', 0.06, 0.05, AX + 0.3, F + 1.2, AZ1 - 0.22, 'EMISSIVE', EM['ledCyan'], seg=12), 'ledCyan')
cy('arcadeBtnC', 0.06, 0.05, AX + 0.02, F + 1.17, AZ1 - 0.12, 'MACHINES', M['redDark'], seg=12)
bx('arcadeKick', 1.0, 0.5, 0.8, AX, F + 0.25, AZ1 - 0.6, 'MACHINES', M['tealDark'])
glow(bx('arcadeCoin', 0.12, 0.05, 0.02, AX + 0.02, F + 0.75, AZ1 - 0.19, 'EMISSIVE', EM['ledRed'], bevel=False), 'ledRed')
# cyan neon rim around the cabinet front
rz = AZ1 + 0.03
glow(tube('arcadeRimL', [(AX - 0.62, F + 0.05, rz - 0.6), (AX - 0.62, F + 2.2, rz - 0.6), (AX - 0.62, F + 2.9, rz + 0.1), (AX - 0.62, F + 2.9, rz + 0.1)], 0.02, 'EMISSIVE', EM['cyan']), 'cyan')
glow(tube('arcadeRimR', [(AX + 0.62, F + 0.05, rz - 0.6), (AX + 0.62, F + 2.2, rz - 0.6), (AX + 0.62, F + 2.9, rz + 0.1)], 0.02, 'EMISSIVE', EM['cyan']), 'cyan')
glow(tube('arcadeRimT', [(AX - 0.62, F + 2.9, rz + 0.1), (AX + 0.62, F + 2.9, rz + 0.1)], 0.02, 'EMISSIVE', EM['cyan']), 'cyan')
hit('arcade', 1.4, 3.0, 1.9, AX, F + 1.5, (AZ0 + AZ1) / 2)
hit('arcadeScreen', 1.0, 0.9, 0.3, AX, F + 1.72, AZ1 - 0.15)
# vending machine
VX, VZ = 1.15, 2.5
bx('vendBody', 1.3, 2.9, 1.0, VX, F + 1.45, VZ, 'MACHINES', M['cyanBody'])
bx('vendHeaderBox', 1.34, 0.42, 0.9, VX, F + 3.05, VZ - 0.05, 'MACHINES', M['cyanBody'])
glow(screen('vendHeader', 1.2, 0.3, VX, F + 3.05, VZ + 0.41, '+z', coll='EMISSIVE', material=EM['vendHeader']), 'vendHeader')
for i, yy in enumerate((F + 2.72, F + 2.6)):
    bx(f'vendStripe{i}', 1.32, 0.05, 1.02, VX, yy, VZ, 'MACHINES', M['blueStripe'], bevel=False)
bx('vendBezel', 1.14, 1.62, 0.08, VX, F + 1.85, VZ + 0.51, 'MACHINES', M['black'])
screen('vendScreen', 1.0, 1.48, VX, F + 1.85, VZ + 0.56, '+z')
bx('vendSlot', 0.8, 0.16, 0.1, VX, F + 0.62, VZ + 0.52, 'MACHINES', M['black'])
bx('vendSlotLip', 0.86, 0.04, 0.16, VX, F + 0.52, VZ + 0.55, 'MACHINES', M['metal'], bevel=False)
for i, key in enumerate(('prev', 'next')):
    glow(bx(f'vendBtn_{key}', 0.22, 0.12, 0.06, VX - 0.2 + i * 0.4, F + 0.86, VZ + 0.52, 'EMISSIVE', EM['plateWhite']), 'plateWhite')
    hit(f'vend_{key}', 0.3, 0.2, 0.2, VX - 0.2 + i * 0.4, F + 0.86, VZ + 0.55)
bx('vendFoot', 1.2, 0.2, 0.9, VX, F + 0.1, VZ, 'MACHINES', M['tealDark'])
glow(bx('vendGlow', 1.1, 0.03, 0.8, VX, F + 0.02, VZ + 0.15, 'EMISSIVE', EM['vendGlow'], bevel=False), 'vendGlow')
hit('vending', 1.5, 3.3, 1.3, VX, F + 1.6, VZ)
hit('vendScreen', 1.1, 1.5, 0.2, VX, F + 1.85, VZ + 0.6)
# green sandwich board in front of the arcade
for s in (-1, 1):
    bx(f'greenBoard{s:+d}', 0.7, 0.9, 0.05, -1.95, F + 0.45, 2.75 + s * 0.16, 'SHOP', M['green'] if s < 0 else M['greenDark'], rot=(s * 0.28, 0, 0))
bx('greenBoardTop', 0.72, 0.05, 0.12, -1.95, F + 0.9, 2.75, 'SHOP', M['greenDark'])
# the ticker box on the roof edge, its screen, and the small screens above it
bx('tickerBox', 4.5, 1.1, 0.35, 0.05, R + 0.57, BZ1 - 0.1, 'MACHINES', M['black'])
bx('tickerBezel', 4.35, 0.95, 0.06, 0.05, R + 0.57, BZ1 + 0.09, 'MACHINES', M['trim'])
screen('tickerScreen', 4.15, 0.75, 0.05, R + 0.57, BZ1 + 0.125, '+z')
def screen_edge(name, w, x, y, z):
    """A thin cyan strip along a screen's bottom edge, sitting proud of the
    bezel: the ambient backlight a real LED panel shows around its own frame,
    and the cheapest cue that this is a screen rather than a picture on the
    wall. bigScreen already had one (portalStrip, below); the rest of the bank
    gets the same treatment rather than being the one modern panel among five
    plain ones."""
    return glow(bx(name, w, 0.035, 0.035, x, y, z, 'EMISSIVE', EM['cyan'], bevel=False), 'cyan')

for i, xc in enumerate((0.77, -0.33, -1.44)):
    bx(f'smallFrame{i + 1}', 0.86, 0.74, 0.16, xc, R + 1.62, 1.28, 'MACHINES', M['metalDark'])
    screen(f'smallScreen{i + 1}', 0.76, 0.64, xc, R + 1.62, 1.37, '+z')
    hit(f'small{i + 1}', 0.86, 0.74, 0.3, xc, R + 1.62, 1.4)
    screen_edge(f'smallEdge{i + 1}', 0.71, xc, R + 1.16, 1.41)
bx('smallShelf', 3.3, 0.06, 0.4, -0.33, R + 1.22, 1.2, 'MACHINES', M['metal'])
# the stack on the mast at the -x corner: a small screen, a tall one, another small one
bx('smallFrame4', 0.86, 0.74, 0.16, -1.46, R + 2.58, 1.31, 'MACHINES', M['metalDark'])
screen('smallScreen4', 0.76, 0.64, -1.46, R + 2.58, 1.4, '+z')
screen_edge('smallEdge4', 0.71, -1.46, R + 2.12, 1.44)
bx('tallFrame', 0.9, 1.26, 0.16, -1.49, R + 3.8, 1.36, 'MACHINES', M['metalDark'])
screen('tallScreen', 0.8, 1.16, -1.49, R + 3.8, 1.45, '+z')
screen_edge('tallEdge', 0.75, -1.49, R + 3.08, 1.49)
bx('smallFrame5', 0.86, 0.74, 0.16, -1.51, R + 5.05, 1.4, 'MACHINES', M['metalDark'])
screen('smallScreen5', 0.76, 0.64, -1.51, R + 5.05, 1.49, '+z')
screen_edge('smallEdge5', 0.71, -1.51, R + 4.59, 1.53)
cy('mastScreens', 0.06, 6.2, -1.5, R + 3.1, 1.15, 'MACHINES', M['metalDark'], seg=10)
# the big screen on its stand, the speaker on top
BSX, BSY, BSZ = 0.68, 3.8, 0.52
bx('bigFrame', 3.15, 2.0, 0.18, BSX, BSY, BSZ - 0.1, 'MACHINES', M['metalDark'])
screen('bigScreen', 2.95, 1.8, BSX, BSY, BSZ, '+z')
hit('bigScreen', 3.2, 2.1, 0.4, BSX, BSY, BSZ)
for xc in (BSX - 1.1, BSX + 1.1):
    cy(f'bigPost{xc:.1f}', 0.07, 2.4, xc, R + 1.25, BSZ - 0.2, 'MACHINES', M['metalDark'], seg=10)
bx('bigBase', 2.8, 0.12, 0.7, BSX, R + 0.13, BSZ - 0.2, 'MACHINES', M['metalDark'])
glow(bx('portalStrip', 2.9, 0.05, 0.05, BSX, BSY - 1.04, BSZ + 0.04, 'EMISSIVE', EM['cyan'], bevel=False), 'cyan')
bx('speakerBox', 1.0, 1.3, 0.85, 1.55, BSY + 1.7, -0.15, 'MACHINES', M['tealDark'])
cy('speakerCone', 0.32, 0.12, 1.55, BSY + 1.95, 0.3, 'MACHINES', M['black'], seg=20, axis='z', r2=0.18)
cy('speakerTweeter', 0.13, 0.1, 1.55, BSY + 1.42, 0.3, 'MACHINES', M['black'], seg=16, axis='z', r2=0.07)
cy('speakerPost', 0.06, 0.6, 1.55, BSY + 1.0, -0.15, 'MACHINES', M['metalDark'], seg=8)
# satellite dish
cy('dish', 0.6, 0.22, 1.7, R + 1.75, 1.3, 'MACHINES', M['grey'], seg=24, r2=0.04, rot=(1.1, 0, 0.3))
cy('dishFeed', 0.04, 0.5, 1.7, R + 1.95, 1.55, 'MACHINES', M['metalDark'], seg=8, rot=(1.1, 0, 0.3))
cy('dishArm', 0.03, 0.55, 1.7, R + 1.55, 1.15, 'MACHINES', M['metalDark'], seg=8, rot=(0.6, 0, 0))
cy('dishPost', 0.05, 1.1, 1.7, R + 0.7, 0.9, 'MACHINES', M['metalDark'], seg=8)

# ---------------------------------------------------------------- the utility wall (+x): bricks, pipes, boxes
UX = BX1 + 0.02
for i in range(22):
    bx(f'brick{i}', 0.08, 0.16, 0.5, UX + 0.02, F + 0.5 + random.random() * 2.6, BZ0 + 0.4 + random.random() * (DD - 0.8), 'SHOP', M['brick'], bevel=False)
tube('pipeUtil1', [(UX + 0.15, R + 0.3, -1.6), (UX + 0.15, F + 0.6, -1.6), (UX + 0.15, F + 0.6, -0.4), (UX + 0.15, F + 1.4, -0.4)], 0.06, 'SHOP', M['pipe'])
tube('pipeUtil2', [(UX + 0.12, R + 0.6, 0.6), (UX + 0.12, F + 1.1, 0.6), (UX + 0.12, F + 1.1, 1.5), (UX + 0.12, F + 0.3, 1.5)], 0.045, 'SHOP', M['pipe'])
tube('pipeUtil3', [(UX + 0.2, R + 0.1, -3.4), (UX + 0.2, F + 2.3, -3.4), (UX + 0.6, F + 2.3, -3.4), (UX + 0.6, F + 2.3, -2.2)], 0.05, 'SHOP', M['pipe'])
text('grafitiTag', LABELS['kanji'], 'neon', 0.42, UX + 0.03, F + 1.35, -2.9, 'SHOP', M['spray'],
     facing='+x', extrude=0.003)
bx('powerWall', 0.14, 1.25, 0.8, UX + 0.07, F + 1.2, -0.9, 'SHOP', M['white'])
bx('powerWallLogo', 0.02, 0.06, 0.4, UX + 0.15, F + 1.55, -0.9, 'SHOP', M['grey'], bevel=False)
bx('junction1', 0.18, 0.5, 0.4, UX + 0.09, F + 1.9, 0.0, 'SHOP', M['grey'])
bx('junction2', 0.14, 0.35, 0.3, UX + 0.07, F + 2.4, 1.3, 'SHOP', M['metalDark'])
bx('meter', 0.2, 0.3, 0.3, UX + 0.1, F + 1.3, 1.1, 'SHOP', M['metalDark'])
cy('meterDial', 0.1, 0.04, UX + 0.21, F + 1.3, 1.1, 'SHOP', M['white'], seg=14, axis='x')
bx('acUnit', 0.45, 0.6, 0.7, UX + 0.22, F + 1.1, -2.6, 'SHOP', M['grey'])
cy('acFan', 0.24, 0.05, UX + 0.46, F + 1.1, -2.6, 'SHOP', M['metalDark'], seg=18, axis='x')
tube('cableUtil', catenary((UX + 0.1, F + 2.9, -3.8), (UX + 0.1, F + 2.2, 1.8), 0.6, 12), 0.02, 'SHOP', M['black'])

# ---------------------------------------------------------------- the roof: solar panels, hologram pedestal, lanterns, masts, tank
def solar(name, x, y, z, yaw, pitch):
    r = (pitch, 0, yaw)
    bx(name + 'Panel', 1.7, 0.06, 1.15, x, y, z, 'SHOP', M['panelBlue'], rot=r)
    bx(name + 'Frame', 1.76, 0.04, 1.21, x, y - 0.03, z, 'SHOP', M['panelFrame'], rot=r)
    # the grid: bars the frame colour laid on the panel
    for i in range(1, 3):
        bx(name + f'GridZ{i}', 1.7, 0.02, 0.03, x, y + 0.035, z - 0.575 + i * 1.15 / 3, 'SHOP', M['panelFrame'], bevel=False, rot=r)
    for i in range(1, 4):
        bx(name + f'GridX{i}', 0.03, 0.02, 1.15, x - 0.85 + i * 1.7 / 4, y + 0.035, z, 'SHOP', M['panelFrame'], bevel=False, rot=r)
    cy(name + 'Post', 0.06, y - R, x, (y + R) / 2, z, 'SHOP', M['metal'], seg=10)
    bx(name + 'Foot', 0.4, 0.1, 0.4, x, R + 0.18, z, 'SHOP', M['metalDark'])
solar('solarA', 1.35, R + 1.8, -2.7, -0.2, 0.42)
solar('solarB', -0.35, R + 2.1, -3.15, 0.1, 0.42)
# hologram pedestal: a drum with a cyan ring on top; the runtime grows the bowl of points over it
HX, HZ = -0.1, -0.95
cy('holoDrum', 0.48, 1.3, HX, R + 0.75, HZ, 'MACHINES', M['metalDark'], seg=24)
cy('holoDrumBand', 0.52, 0.12, HX, R + 0.5, HZ, 'MACHINES', M['metal'], seg=24)
glow(cy('holoRing', 0.5, 0.1, HX, R + 1.44, HZ, 'EMISSIVE', EM['holo'], seg=24, r2=0.44), 'holo')
bx('holoMarker', 0.1, 0.1, 0.1, HX, R + 1.55, HZ, 'MARKER', M['hitbox'], bevel=False)
# a bake-only glow where the bowl of light will be, so the roof remembers it
cy('holoLight', 0.55, 0.9, HX, R + 2.1, HZ, 'LIGHTS', mat('holoLightMat', '#3cf5ff', emit='#3cf5ff', strength=4), seg=16, r2=0.25)
# the white lantern stack
for i in range(4):
    glow(cy(f'ringLamp{i}', 0.42, 0.11, 1.5, R + 1.15 + i * 0.19, -1.2, 'EMISSIVE', EM['white'], seg=22), 'white')
cy('ringLampBase', 0.3, 0.55, 1.5, R + 0.36, -1.2, 'SHOP', M['metalDark'], seg=16)
cy('ringLampCap', 0.3, 0.08, 1.5, R + 1.92, -1.2, 'SHOP', M['metalDark'], seg=16)
# fluorescent tubes standing near the corner
for i in range(4):
    glow(cy(f'fluoTube{i}', 0.07, 1.25, -0.85 + i * 0.22, R + 1.3, 0.55 - (i % 2) * 0.2, 'EMISSIVE', EM['white'], seg=10), 'white')
bx('fluoBase', 1.0, 0.1, 0.6, -0.5, R + 0.19, 0.45, 'SHOP', M['metalDark'])
# the tank behind the big screen
bx('tank', 1.15, 1.55, 1.25, 1.3, BSY - 0.2, -1.05, 'SHOP', M['grey'])
bx('tankBand', 1.21, 0.08, 1.31, 1.3, BSY - 0.6, -1.05, 'SHOP', M['metalDark'], bevel=False)
for xc in (0.9, 1.7):
    cy(f'tankLeg{xc:.1f}', 0.05, BSY - 0.97 - R, xc, (BSY - 0.97 + R) / 2, -1.05, 'SHOP', M['metalDark'], seg=8)
# masts with cables
MASTS = [(-2.15, R + 6.4, -0.6), (-1.2, R + 6.9, 0.35)]
for i, (mx, my, mz) in enumerate(MASTS):
    cy(f'mast{i}', 0.05, my - R, mx, (my + R) / 2, mz, 'SHOP', M['metalDark'], seg=8)
    bx(f'mastBar{i}', 0.5, 0.05, 0.05, mx, my - 0.6, mz, 'SHOP', M['metalDark'], bevel=False)
    bx(f'mastBox{i}', 0.24, 0.5, 0.2, mx, my - 1.5, mz, 'SHOP', M['grey'])
tube('cable0', catenary((MASTS[0][0], MASTS[0][1] - 0.6, MASTS[0][2]), (MASTS[1][0], MASTS[1][1] - 0.6, MASTS[1][2]), 0.25, 10), 0.015, 'SHOP', M['black'])
tube('cable1', catenary((MASTS[1][0], MASTS[1][1] - 0.6, MASTS[1][2]), (1.55, BSY + 2.3, -0.15), 0.9, 12), 0.015, 'SHOP', M['black'])
tube('cable2', catenary((MASTS[0][0], MASTS[0][1] - 1.2, MASTS[0][2]), (1.3, BSY + 0.6, -1.05), 0.8, 12), 0.015, 'SHOP', M['black'])
tube('cable3', catenary((MASTS[1][0], MASTS[1][1] - 0.3, MASTS[1][2]), (-1.5, R + 5.6, 1.15), 0.15, 8), 0.015, 'SHOP', M['black'])
# the neon ice-cream cone at the -x/+z corner: a hatched cone, two scoops and a cherry
NBX, NBY, NBZ = -2.45, 2.55, 1.05
glow(tube('neonCone', [(NBX, NBY - 0.55, NBZ), (NBX, NBY + 0.15, NBZ - 0.32), (NBX, NBY + 0.15, NBZ + 0.32)], 0.02, 'EMISSIVE', EM['orange'], cyclic=True), 'orange')
glow(tube('neonConeHatch0', [(NBX, NBY - 0.22, NBZ - 0.15), (NBX, NBY + 0.08, NBZ + 0.17)], 0.013, 'EMISSIVE', EM['orange']), 'orange')
glow(tube('neonConeHatch1', [(NBX, NBY - 0.22, NBZ + 0.15), (NBX, NBY + 0.08, NBZ - 0.17)], 0.013, 'EMISSIVE', EM['orange']), 'orange')
glow(tube('neonScoop0', arc(NBX, NBY + 0.15, NBZ, 0.34, 0, math.pi, 16), 0.02, 'EMISSIVE', EM['pink']), 'pink')
glow(tube('neonScoop1', arc(NBX, NBY + 0.46, NBZ + 0.06, 0.25, 0, math.pi, 12), 0.018, 'EMISSIVE', EM['pink']), 'pink')
glow(tube('neonCherry', arc(NBX, NBY + 0.78, NBZ + 0.03, 0.07, 0, 2 * math.pi, 10), 0.013, 'EMISSIVE', EM['red'], cyclic=True), 'red')
bx('neonConeBoard', 0.06, 1.7, 1.4, NBX + 0.1, NBY + 0.35, NBZ, 'MACHINES', M['black'])
bx('neonConePost', 0.08, 1.7, 0.08, NBX + 0.15, R + 0.95, NBZ, 'MACHINES', M['metalDark'])
# pipes across the roof
tube('pipeRoof', [(-2.4, R + 0.25, -2.0), (0.6, R + 0.25, -2.0), (0.6, R + 0.25, -0.2), (1.9, R + 0.25, -0.2)], 0.05, 'SHOP', M['pipe'])


# ---------------------------------------------------------------- the beach: a parasol, a sunbed and a ball by the curtain face
PBX, PBZ = 0.9, -5.9
cy('parasolPole', 0.035, 2.7, PBX + 1.0, F + 1.35, PBZ - 0.4, 'SHOP', M['white'], seg=8, rot=(0.12, 0, 0))
cy('parasol', 1.15, 0.42, PBX + 1.0, F + 2.62, PBZ - 0.7, 'SHOP', M['wallBlue'], seg=12, r2=0.0, smooth=False)
cy('parasolTop', 0.06, 0.12, PBX + 1.0, F + 2.88, PBZ - 0.72, 'SHOP', M['white'], seg=8, r2=0.0)
bx('sunbedFrame', 0.72, 0.06, 1.8, PBX, F + 0.32, PBZ, 'SHOP', M['woodDark'])
for k in range(7):
    bx(f'sunbedSlat{k}', 0.66, 0.03, 0.18, PBX, F + 0.37, PBZ - 0.75 + k * 0.25, 'SHOP', M['wood'], bevel=False)
# The board was rotated about its own centre, which is not where a reclining
# backrest actually pivots — the centre of a tilted board and the edge where
# it meets the bed are two different points, and only the second one should
# stay put. Positioned by its own centre, the whole board floated well above
# and beyond the bed with a visible gap of air under it. Measured from the
# built scene: the board's lowest corner needed to move (0, -0.56, +0.02) in
# Blender space to land on the slats' rear edge, which in these three.js
# coordinates is z -0.56 closer and y +0.02 higher — the position below is
# the old one plus that correction, not a re-guess.
bx('sunbedBack', 0.66, 0.05, 0.62, PBX, F + 0.6434, PBZ - 0.4869, 'SHOP', M['wood'], rot=(-0.9, 0, 0))
bx('sunbedTowel', 0.5, 0.03, 1.1, PBX, F + 0.4, PBZ + 0.25, 'SHOP', M['fabric'], bevel=False)
for dx, dz in ((-0.3, -0.75), (0.3, -0.75), (-0.3, 0.75), (0.3, 0.75)):
    cy(f'sunbedLeg{dx:+.0f}{dz:+.0f}', 0.025, 0.3, PBX + dx, F + 0.15, PBZ + dz, 'SHOP', M['woodDark'], seg=6)
sph('beachBall', 0.22, PBX + 1.55, F + 0.22, PBZ + 0.9, 'SHOP', M['orange'], seg=16)

# ---------------------------------------------------------------- the signpost
PX, PZ = -4.05, -5.05
# One low plinth instead of the three stacked, tapering cubes the base used to
# be — a wedding-cake base is the same "ornamental ironwork" read as the glass
# globes below were, and it is gone for the same reason.
cy('postBase', 0.55, 0.14, PX, F + 0.07, PZ, 'SIGNPOST', M['trim'], seg=24)
# The mast itself, 1.4m taller: base unchanged at the floor, everything above
# it — top cap, beacon, arm, lamps — carried up by the same amount so the
# whole assembly stays proportioned rather than just stretching the shaft.
cy('pole', 0.09, 7.6, PX, F + 3.8, PZ, 'SIGNPOST', M['black'], seg=12)
cy('poleTop', 0.05, 1.1, PX, F + 8.15, PZ, 'SIGNPOST', M['metalDark'], seg=8)
glow(bx('poleTip', 0.08, 0.14, 0.08, PX, F + 8.75, PZ, 'EMISSIVE', EM['ledCyan']), 'ledCyan')
# The arm stays at its original height, not carried up with the mast.
#
# Moving it up by the same 1.4m as the mast is what made this "taller" in the
# first place, but the sign boards below it never moved — so the gap between
# the top sign and the lamp arm more than doubled (0.98m to 2.38m, measured),
# splitting the post into signs bunched low and a lamp stranded high with
# nothing between them. The mast above the arm is still the full 1.4m taller;
# only the arm+fixture, which has to stay grouped with the signs it lights,
# went back to where it read correctly.
GY = 2.1
bx('poleArm', 0.1, 0.1, 2.4, PX, GY, PZ, 'SIGNPOST', M['black'])
bx('poleArmBox', 0.3, 0.3, 0.3, PX, GY, PZ, 'SIGNPOST', M['metalDark'])
# A pair of flat LED luminaires where the old lamp hung a pair of frosted
# glass globes. A round glass globe on an iron arm is a Victorian street
# lamp's whole silhouette; a flat bar recessed into a dark housing is a
# modern one, and it is lit in the shop's own neon cyan rather than the
# pale antique pink the globe used, so the fixture reads as the same
# lighting design as the signage below it instead of an older one bolted on.
for i, zc in enumerate((PZ - 1.05, PZ + 1.05)):
    cy(f'lampStem{i}', 0.03, 0.3, PX, GY - 0.2, zc, 'SIGNPOST', M['black'], seg=8)
    bx(f'lampHousing{i}', 0.4, 0.09, 0.22, PX, GY - 0.42, zc, 'SIGNPOST', M['metalDark'])
    glow(bx(f'lampBar{i}', 0.34, 0.03, 0.16, PX - 0.05, GY - 0.465, zc, 'EMISSIVE', EM['cyan']), 'cyan')
# LEDs on the pole between the signs
for i, (yy, key) in enumerate(((1.2, 'ledCyan'), (0.85, 'ledRed'), (-0.4, 'ledGreen'), (-1.5, 'ledWhite'), (1.55, 'ledGreen'), (-2.6, 'ledRed'))):
    glow(bx(f'poleLed{i}', 0.08, 0.08, 0.08, PX - 0.11, yy, PZ + (0.12 if i % 2 else -0.12), 'EMISSIVE', EM[key]), key)
# the arrow signs: (id, label, plate key, y centre, arrow toward +z or -z)
SIGNS = [('projects', LABELS['signs']['projects'], 'platePink', 0.4, +1),
         ('contact', LABELS['signs']['contact'], 'plateRed', -1.22, -1),
         ('about', LABELS['signs']['about'], 'plateCyan', -1.82, -1),
         ('credits', LABELS['signs']['credits'], 'plateOrange', -2.27, +1)]
SW, SH, SL = 0.06, 0.38, 1.45
# A board shaped like an arrow, point and all, is a wooden trail-sign fingerpost
# — the same "old-school" silhouette the frosted glass lamp globes used to be.
# These are a plain rectangular tab now, like a modern wayfinding plaque, and
# directionality moves to one small chevron at the end rather than the whole
# board's outline: legible at a glance without dressing every sign as a fork
# in a forest path.
for sid, label, key, yc, d in SIGNS:
    frame = prism('signFrame_' + sid, [(yc - SH / 2 - 0.05, PZ - SL / 2 - 0.05), (yc - SH / 2 - 0.05, PZ + SL / 2 + 0.05),
                                       (yc + SH / 2 + 0.05, PZ + SL / 2 + 0.05), (yc + SH / 2 + 0.05, PZ - SL / 2 - 0.05)],
                  0.08, PX - 0.06, 'SIGNPOST', M['black'])
    plate = prism('plate_' + sid, [(yc - SH / 2, PZ - SL / 2), (yc - SH / 2, PZ + SL / 2),
                                   (yc + SH / 2, PZ + SL / 2), (yc + SH / 2, PZ - SL / 2)],
                  0.05, PX - 0.1, 'EMISSIVE', EM[key])
    glow(plate, key)
    # the one small arrow: a flat black chevron just past whichever end points home
    tip_z = PZ + SL / 2 if d > 0 else PZ - SL / 2
    prism('signTip_' + sid, [(yc - 0.09, tip_z), (yc + 0.09, tip_z), (yc, tip_z + d * 0.16)],
          0.05, PX - 0.06, 'SIGNPOST', M['black'])
    # white on the warm plates, ink on the cool ones, the way the reference's read at a distance
    ink = M['text'] if key in ('platePink', 'plateRed') else M['ink']
    text('signText_' + sid, label, 'sign', 0.25, PX - 0.145, yc + 0.005, PZ, 'SIGNPOST', ink, facing='-x', extrude=0.012, bold=0.004)
    hit(sid, 0.5, SH + 0.15, SL + 0.4, PX - 0.05, yc, PZ)
# the name tag: a pink plate with a barcode and the short name, and a green square beside it
NY = -0.42
prism('nameFrame', [(NY - 0.4, PZ - 0.3), (NY - 0.4, PZ + 0.5), (NY + 0.4, PZ + 0.5), (NY + 0.4, PZ - 0.3)], 0.08, PX - 0.06, 'SIGNPOST', M['black'])
glow(prism('plate_name', [(NY - 0.35, PZ - 0.25), (NY - 0.35, PZ + 0.45), (NY + 0.35, PZ + 0.45), (NY + 0.35, PZ - 0.25)], 0.05, PX - 0.1, 'EMISSIVE', EM['platePink']), 'platePink')
for i in range(14):
    w = 0.02 + (i % 3) * 0.012
    bx(f'barcode{i}', 0.02, 0.3, w, PX - 0.145, NY + 0.14, PZ - 0.18 + i * 0.042, 'SIGNPOST', M['ink'], bevel=False)
text('nameText', LABELS['shortName'], 'sign', 0.11, PX - 0.145, NY - 0.2, PZ + 0.1, 'SIGNPOST', M['ink'], facing='-x', extrude=0.01)
hit('name', 0.5, 0.9, 1.0, PX - 0.05, NY, PZ + 0.1)
prism('greenFrame', [(NY - 0.55, PZ - 0.85), (NY - 0.55, PZ - 0.35), (NY + 0.15, PZ - 0.35), (NY + 0.15, PZ - 0.85)], 0.08, PX - 0.06, 'SIGNPOST', M['black'])
glow(prism('plate_green', [(NY - 0.5, PZ - 0.8), (NY - 0.5, PZ - 0.4), (NY + 0.1, PZ - 0.4), (NY + 0.1, PZ - 0.8)], 0.05, PX - 0.1, 'EMISSIVE', EM['plateGreen']), 'plateGreen')
glow(bx('greenDot', 0.06, 0.06, 0.06, PX - 0.15, NY - 0.7, PZ - 0.6, 'EMISSIVE', EM['ledRed']), 'ledRed')

# ---------------------------------------------------------------- light for the bake: the neon does most of it
world = bpy.data.worlds.new('night'); scene.world = world; world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs['Color'].default_value = (0.72, 0.74, 0.92, 1.0)
# the reference's stall is lit bright and even, like a diorama under a soft sky; the floor stays
# black because its material is nearly black, not because the light is dim
bg.inputs['Strength'].default_value = float(os.environ.get('SHOP_AMBIENT', '1.0'))

def light(name, kind, x, y, z, energy, color=(1, 1, 1), size=1.0, rot=(0, 0, 0), cone=None, blend=0.6):
    ld = bpy.data.lights.new(name, kind); ld.energy = energy; ld.color = color
    if kind == 'AREA': ld.size = size
    if kind == 'SPOT':
        ld.spot_size = math.radians(cone); ld.spot_blend = blend; ld.shadow_soft_size = size
    ob = bpy.data.objects.new(name, ld); ob.location = T(x, y, z); ob.rotation_euler = Euler(rot)
    COLL['LIGHTS'].objects.link(ob); return ob
# the light is concentrated on the stall: a cool spot from high up whose cone ends just past the
# signpost, so the roof and the faces read while the floor beyond stays dark
light('key', 'SPOT', 1.0, 15.0, 0.5, float(os.environ.get('SHOP_KEY', '700')), (0.62, 0.7, 1.0), size=2.5, rot=(math.radians(-6), math.radians(4), 0), cone=46, blend=0.7)
# two pools on the floor: cyan by the machines, pink by the signpost, spots pointing down so they
# stay pools instead of washing the whole disc
light('cyanFill', 'SPOT', 3.0, -0.4, 5.6, float(os.environ.get('SHOP_CYAN', '7500')), (0.2, 0.9, 1.0), size=0.8, rot=(0, 0, 0), cone=135, blend=0.9)
light('pinkFill', 'SPOT', -6.2, -0.4, -4.6, float(os.environ.get('SHOP_PINK', '7500')), (1.0, 0.18, 0.6), size=0.8, rot=(0, 0, 0), cone=135, blend=0.9)

# ---------------------------------------------------------------- cameras and previews
def camera(name, pos, lens=22):
    cd = bpy.data.cameras.new(name); cd.lens = lens; cd.sensor_fit = 'HORIZONTAL'; cd.sensor_width = 36
    ob = bpy.data.objects.new(name, cd); ob.location = T(*pos); scene.collection.objects.link(ob); return ob
tgt = bpy.data.objects.new('target', None); scene.collection.objects.link(tgt)
CAMS = {'ref': ((-11.1, -1.0, -7.6), (0, 0, -1)), 'back': ((2.0, 2.0, 11.0), (0, 0, -1)), 'top': ((-6, 11, -6), (0, 0, -1)),
        'counter': ((-5.0, 0.2, -7.0), (-1, -1, -1)), 'signs': ((-7.2, -0.6, -5.6), (-4.1, -0.9, -5.0)), 'vend': ((1.15, -1.05, 5.4), (1.15, -1.05, 3.0)),
        'arcade': ((-0.58, -1.12, 4.5), (-0.58, -1.18, 2.85))}
for name, (pos, look) in CAMS.items():
    c = camera('Camera_' + name, pos)
    con = c.constraints.new('TRACK_TO'); con.target = tgt; con.track_axis = 'TRACK_NEGATIVE_Z'; con.up_axis = 'UP_Y'
scene.camera = bpy.data.objects['Camera_ref']

counts = {g: len(COLL[g].objects) for g in GROUPS}
verts = sum(len(o.data.vertices) for c in COLL.values() for o in c.objects if o.type == 'MESH')
print('BUILD OK', counts, 'verts', verts, flush=True)
with open(os.path.join(HERE, 'glow.json'), 'w', encoding='utf-8') as f:
    json.dump({'palette': {k: {'color': v[0], 'gain': v[2], 'bloom': (v[3] if len(v) > 3 else True)} for k, v in GLOW.items()}, 'objects': GLOW_OF}, f, indent=1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'shop.blend'))

if os.environ.get('SHOP_NO_PREVIEW') != '1':
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = int(os.environ.get('SHOP_PREVIEW_SAMPLES', '16'))
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 4
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.render.film_transparent = False
    for cname in ('HITBOX', 'MARKER', 'SCREENS'):
        for o in COLL[cname].objects: o.hide_render = True
    which = os.environ.get('SHOP_PREVIEWS', 'ref,back').split(',')
    for name in which:
        pos, look = CAMS[name]
        tgt.location = T(*look)
        scene.camera = bpy.data.objects['Camera_' + name]
        scene.render.resolution_x, scene.render.resolution_y = 960, 620
        scene.render.filepath = os.path.join(HERE, f'preview_{name}.png')
        bpy.ops.render.render(write_still=True)
    print('PREVIEWS OK', flush=True)
