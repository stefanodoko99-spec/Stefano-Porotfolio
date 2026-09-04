# Bar Martiri

Stefano Doko's portfolio as a beach bar at night, after
[jesse-zhou.com](https://www.jesse-zhou.com/)'s ramen shop: the same neon stall
on a mirror floor, built and lit in Blender, baked into four textures, looked
at like a diorama, dressed as [barmartiri.com](https://barmartiri.com), one of
his shipped sites. Four arrow signs on the post beside it
are the navigation; each flies the camera to the machine or screen in the
world that holds that section. Vite + Three.js; the only downloads are one
Draco GLB, the atlases and a manifest.

```bash
npm install
npm run dev        # http://localhost:5192
npm run build      # dist/
npm run preview    # serve the build on 5193
npm run typecheck
```

## Put your own words in

Two files.

- [`src/content/labels.json`](src/content/labels.json) — the words that are
  **modelled into the world**: the name in neon over the counter, the name and
  roles painted on the floor, the four sign labels, the name tag. Change
  these, then rebuild and rebake (below).
- [`src/content.ts`](src/content.ts) — everything painted on the screens at
  runtime: the about pages, the project posters, the credits, the ticker, the
  links. Change these and reload.

## Rebuild the shop

The scenery is code. Edit [`blender/build_shop.py`](blender/build_shop.py),
rebuild, bake, and the browser picks the new files up (Blender 3.6 or newer;
Windows fonts are used for the text, see `FONT` in the builder):

```bash
blender -b -P blender/build_shop.py                          # blender/shop.blend + preview_*.png (SHOP_NO_PREVIEW=1 to skip)
blender -b blender/shop.blend -P blender/bake_shop.py -- 64  # public/textures/*.jpg|png (+ -half copies), public/models/shop.glb + shop-manifest.json
```

Names are the contract. `shopJoined`, `machinesJoined`, `signpostJoined` and
`floor` take their atlases; anything the bake's manifest lists under `glow`
is painted flat and bloomed; the twelve screen planes are painted by
`src/world/screens.ts`; anything starting with `hit_` is a click target;
`fan0`/`fan1` spin; `holoMarker` is where the hologram grows.

## Where things are

| File | What |
| --- | --- |
| `blender/build_shop.py` | the shop, from the floor disc to the cables |
| `blender/bake_shop.py` | join, unwrap, bake, export, manifest |
| `src/main.ts` | load, assign by name, the modes, the loop |
| `src/interaction.ts` | orbit, hover, click, the camera flights and their limits |
| `src/world/screens.ts` | the twelve canvases |
| `src/world/floor.ts` | the mirror with the baked pools under it |
| `src/world/hologram.ts` | the bowl of points on the roof |
| `src/bloom.ts` | selective bloom + SMAA |
| `src/ui/` | the loading screen and the few words over the canvas |

See [SPEC.md](SPEC.md) for the decisions behind it.
