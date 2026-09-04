/**
 * Everything the tower has to fetch before it can be drawn.
 *
 * Declared here rather than inside the 3D component because two places need it
 * and only one of them can import three: the scene loads these, and the loading
 * screen — which lives in the main bundle and must stay free of the 3D stack —
 * counts them off the network as they land.
 *
 * Keyed, not ordered. This was two parallel structures — an array the scene
 * destructured by position and a separate map of labels — which is a trap for
 * anyone adding a model. Reorder the array and the monitor quietly loads the
 * desk; insert one in the middle and everything after it shifts; add one and
 * forget the label map and its line on the boot readout comes up blank. One
 * entry per asset, addressed by name, and none of those are possible.
 *
 * To add an asset: put it here, then reference it as SCENE.yourKey. Nothing
 * else needs to know. If it is missed here entirely the loader still finishes
 * on the scene's own ready signal — the count degrades, never the dismissal.
 */
export type SceneAsset = {
  /** Served path, and the string resource timing is matched against. */
  readonly path: string
  /**
   * What to call it while it is arriving.
   *
   * The loading screen prints these as a boot readout, one line per file, and a
   * line turns over only when that file has actually landed. So these are names
   * of real things being fetched, not set dressing.
   *
   * Not in the dictionary, and not translated. A device name on a boot readout
   * is an identifier in the register of the machine, the same as the timecode,
   * and the overlay is aria-hidden and inert so nothing announces them.
   */
  readonly label: string
}

/**
 * One Draco GLB for the geometry and one baked atlas per group.
 *
 * Four atlases, not eight. The scene was five places along a street and is now
 * one workshop, so the four groups that were the other shops are gone — which
 * halves what a visitor downloads before anything is on screen, and is most of
 * why this got playable again. The GLB carries
 * no materials at all: the scene assigns them by mesh name, and the atlases are
 * the light. Source and bake scripts live in `scripts/tower/`.
 */
/**
 * WebP, at 4096. The atlases are the lighting — nothing in the scene is lit at
 * runtime — so their resolution is the scene's, and 2048 across a nine-metre
 * workshop went soft the moment the camera walked to the monitor. Lossy WebP
 * at quality 92 puts a 4K sheet on the wire for about what the 2K PNG cost,
 * which is the only reason four times the texels is affordable. See
 * scripts/tower/bake_export.py.
 */
export const SCENE = {
  tower: { path: '/models/tower/tower.glb', label: 'SHOP GEOMETRY' },
  shell: { path: '/models/tower/shellBaked.webp', label: 'WALLS + ROOFS' },
  ground: { path: '/models/tower/groundBaked.webp', label: 'ROAD' },
  exterior: { path: '/models/tower/exteriorBaked.webp', label: 'FACADES' },
  garage: { path: '/models/tower/garageBaked.webp', label: 'GARAGE' },
} as const satisfies Record<string, SceneAsset>

/** Every asset, in declaration order, for anything that has to walk the set. */
export const SCENE_ASSETS: readonly SceneAsset[] = Object.values(SCENE)

