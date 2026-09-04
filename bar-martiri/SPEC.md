# Bar Martiri — spec

A personal portfolio built as a copy of jesse-zhou.com's ramen shop and then
dressed as Bar Martiri, a beach bar Stefano Doko shipped (barmartiri.com, on
the sand at Spille): the same night stall on a mirror floor, looked at from
outside like a diorama, with a signpost of arrow signs beside it — now in
white and turquoise with a bamboo bar, cups of ice cream, an ice-cream cone in
neon where the ramen bowl was, and a parasol, a sunbed and a ball on the sand
side. The four signs are the site's navigation.
Clicking one flies the camera to the thing in the world that holds that
section — a vending machine full of project posters, a big screen with the
about pages, an arcade cabinet that plays the credits — and the section is
read there, on the screen, not in a panel over the canvas. Contact opens the
form on Stefano's other site. Everything the owner has to change is in two files.

## Pipeline

1. `blender/build_shop.py` builds every object from code, in three.js
   coordinates, into collections that mirror runtime roles (SHOP, MACHINES,
   SIGNPOST, FLOOR baked; TEXT, EMISSIVE, SCREENS, HITBOX, DYNAMIC, MARKER
   live; LIGHTS bake-only). Text is real geometry: the neon is Blender text
   with the outline bevelled into tubes, the sign labels are extruded text, the
   name on the floor is flat text. It reads `src/content/labels.json` for the
   words it models, and renders Cycles previews to judge the composition.
2. `blender/bake_shop.py` joins each baked collection into one mesh,
   smart-unwraps it (the floor keeps a planar UV the runtime mirror shares),
   bakes combined lighting with Cycles into one atlas per group, and exports a
   Draco GLB with no materials plus a manifest that maps every live mesh to
   its role and every emissive mesh to its colour.
3. The browser loads the GLB, the four atlases and the manifest, and assigns
   materials by mesh name. Nothing is lit at runtime.

```bash
blender -b -P blender/build_shop.py                        # shop.blend + previews (SHOP_NO_PREVIEW=1 to skip)
blender -b blender/shop.blend -P blender/bake_shop.py -- 64  # public/textures/*, public/models/shop.glb
```

## Light

The reference's trick is two separate decisions: the stall is lit bright and
even, like a diorama under a soft sky, while the floor is black because its
material is nearly black, not because the light is dim. So the world is a
cool light at full strength (the bake does not include the sky, only its
light on the surfaces), a spot from fifteen metres up keys the roof, and the
floor's albedo is close to zero so the same light leaves it dark. Two strong
spots two and a half metres above the floor make the pink pool under the
signpost and the cyan one by the machines. Every emissive mesh carries a
Cycles emission set per colour in the builder's `GLOW` table, kept low: with
the lamps switched off the emitters alone had once washed the whole floor an
even grey. The bake lands in 8-bit atlases with no tone mapping; the runtime
lifts the shop's atlases by 1.3 and leaves the floor's alone.

At runtime the neon carries gains above 1.0 (pink 1.25, cyan and green 1.2),
so its core burns toward white and the bloom (strength 0.75, radius 0.05,
threshold 0) puts the colour in a short halo against the dark: contrast, not
haze. A wider or stronger bloom fogs the whole frame through its coarse blur
levels, which is exactly the bleed the reference does not have.

## What stays live

- Neon, LEDs, lamps and sign plates: flat colours from the manifest, rendered
  with the black-pass trick so only the bloom layer glows (UnrealBloom
  strength 0.75, radius 0.05, threshold 0); the white lamps and the sign
  plates are painted flat and kept off the bloom layer, so the plates'
  lettering stays crisp as in the reference.
- Twelve screens: canvases. The big screen holds the about pages (intro,
  capabilities, how the work runs); the three small screens under it are its buttons while
  the camera is close and art otherwise; the vending machine shows one project
  poster at a time; the arcade shows the credits pages; the rest play — a
  ticker, a synthwave horizon, falling katakana, colour bars, a clock, static.
- The floor: a Reflector with the baked pools composited under the mirror.
- The hologram: a bowl of cyan points over the pedestal on the roof.
- The two fans, matcap-shaded, spinning.
- The camera.

## Camera

After the reference's Camera.js: fov 75, default view from (-11.1, -1, -7.6)
at (0, 0, -1), distance 7–16, tilt 0.63–1.73 rad, no pan. START sweeps in from
(15.9, 6.8, -11.4). Each place has its own limits; flights take 1.5 s with a
quadratic ease. On narrow screens the close views stand further back.

| Sign | Goes to | Then |
| --- | --- | --- |
| projects | the vending machine | two buttons page the posters; the poster opens the project |
| about me | the big screen | the small screens switch intro / capabilities / process / back |
| contact | (the form on his site, in a new tab) | |
| credits | the arcade | the screen advances a page per click |
| name tag | a high view from the far side | click anywhere to return |

Click targets are invisible boxes in the model (`hit_*`); what each does in
each mode is one table in `main.ts`, and the same table says what the pointer
can hit there. Hovering a sign brightens its plate. A click is one
primary-button pointer that went down and up within 8 px and 700 ms with no
other pointer down, so drags, pinches and right-clicks are not clicks. A click
on nothing while close returns to the default view; so do Escape and the Back
control, and both work mid-flight. Upright phones get their own framing for
the about view and stand further back elsewhere; a resize re-aims a parked
close-up.

## Interface

Black loading screen with a count and a thin START, like the reference. Over
the canvas only a wordmark, four small links (the same four signs, for a
keyboard), a Back control while away, and a one-line hint. The words on the
screens are repeated as plain text in a visually hidden section for assistive
technology.

## Phones and slow machines

Under 760 px or with a coarse pointer: half-size atlases, bloom at a third of
the resolution, no mirror, no SMAA, pixel ratio capped at 1.5. `?lite` turns
bloom and the mirror off entirely.

## Not built

Sound; the reference's per-screen videos (the screens here are drawn, not
played); a day variant.
