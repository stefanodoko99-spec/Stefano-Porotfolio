import {
  CanvasTexture,
  Clock,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshMatcapMaterial,
  NoToneMapping,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

import { BLOOM_LAYER, createBloom } from './bloom'
import { CONTENT } from './content'
import { createInteraction, type Mode } from './interaction'
import { createHud } from './ui/hud'
import { createLoader } from './ui/loader'
import { BAKE_LIFT, createFloor } from './world/floor'
import { createHologram } from './world/hologram'
import { createScreens } from './world/screens'

/**
 * A ramen shop at night, after jesse-zhou.com.
 *
 * It was built and lit in Blender (blender/build_shop.py) and baked into four
 * atlases; nothing here is lit at runtime, every surface paints its atlas.
 * What stays live is what a bake cannot hold: the neon as flat colours on a
 * bloom layer, the screens as canvases, the fans, the hologram, the mirror
 * under everything, and the camera. Every mesh gets its role from the
 * manifest the bake wrote: which names are baked groups, which glow (and in
 * what colour), which are screens, click targets, text, moving parts.
 */
type Manifest = {
  groups: Record<string, { atlas: string; size: number }>
  glow: { palette: Record<string, { color: string; gain: number; bloom?: boolean }>; objects: Record<string, string> }
  live: Record<string, string[]>
}

const HINTS: Record<Mode, string> = {
  default: 'Drag to look around · Click a sign',
  projects: 'Click the buttons to browse · Click the poster to open it',
  about: 'Click a small screen · Esc to leave',
  credits: 'Click the screen to continue',
  name: 'Click anywhere to go back',
}

const BASE = import.meta.env.BASE_URL
const loader = createLoader()

function matcapTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  const g = ctx.createRadialGradient(44, 40, 4, 64, 64, 64)
  g.addColorStop(0, '#f2f4ff')
  g.addColorStop(0.35, '#9aa6cc')
  g.addColorStop(0.8, '#3a4068')
  g.addColorStop(1, '#141628')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const t = new CanvasTexture(canvas)
  t.colorSpace = SRGBColorSpace
  return t
}

/** The words on the screens, once more as plain text for assistive technology. */
function fillReadable(): void {
  const name = document.getElementById('sr-name')
  const body = document.getElementById('sr-body')
  if (!name || !body) return
  name.textContent = CONTENT.name
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
  const projects = CONTENT.projects
    .map((p) => `<li>${p.url ? `<a href="${esc(p.url)}">${esc(p.title)}</a>` : esc(p.title)}: ${esc(p.blurb)}</li>`)
    .join('')
  const skills = CONTENT.about.skills.map((s) => `<li>${esc(s.group)}: ${esc(s.items.join(', '))}</li>`).join('')
  const process = CONTENT.about.process.map((p) => `<li>${esc(p.label)}: ${esc(p.body)}</li>`).join('')
  const credits = CONTENT.credits.map((c) => `<li>${esc(c.title)}: ${esc(c.lines.join('. '))}</li>`).join('')
  const social = CONTENT.social.map((s) => `<li><a href="${esc(s.url)}">${esc(s.label)}</a></li>`).join('')
  body.innerHTML =
    `<p>${esc(CONTENT.roles.join(', '))}</p><h2>About</h2>${CONTENT.about.intro.map((p) => `<p>${esc(p)}</p>`).join('')}` +
    `<h3>Capabilities</h3><ul>${skills}</ul><h3>How the work runs</h3><ol>${process}</ol><h2>Work</h2><ul>${projects}</ul>` +
    `<h2>Credits</h2><ul>${credits}</ul><h2>Contact</h2><p><a href="${esc(CONTENT.contactUrl)}">Send a message</a></p><ul>${social}</ul>`
}

async function main() {
  fillReadable()
  const compact = window.innerWidth < 760 || window.matchMedia('(pointer: coarse)').matches
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const params = new URLSearchParams(location.search)
  const lite = params.has('lite')
  const pixelRatio = () => (lite ? 1 : Math.min(window.devicePixelRatio, compact ? 1.5 : 2))
  const viewport = () => ({ width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) })

  const app = document.getElementById('app') as HTMLElement
  const renderer = new WebGLRenderer({ antialias: lite, powerPreference: 'high-performance' })
  renderer.setPixelRatio(pixelRatio())
  renderer.setSize(viewport().width, viewport().height)
  renderer.toneMapping = NoToneMapping
  renderer.outputColorSpace = SRGBColorSpace
  renderer.setClearColor(0x000000, 1)
  app.appendChild(renderer.domElement)

  const scene = new Scene()
  scene.background = new Color(0x000000)
  const camera = new PerspectiveCamera(75, viewport().width / viewport().height, 0.4, 80)

  // ---- the shop: one GLB, four atlases, a manifest. The GLB does not wait for the manifest.
  let arrived = 0
  let total = 0
  const tick = () => {
    arrived++
    loader.step(0.05 + (arrived / Math.max(total, arrived + 1)) * 0.9)
  }
  const draco = new DRACOLoader()
  draco.setDecoderPath(`${BASE}draco/`)
  const gltfLoader = new GLTFLoader()
  gltfLoader.setDRACOLoader(draco)
  const gltfPromise = gltfLoader.loadAsync(`${BASE}models/shop.glb`).then((g) => {
    tick()
    return g
  })
  const manifest = (await fetch(`${BASE}models/shop-manifest.json`).then((r) => {
    if (!r.ok) throw new Error(`manifest ${r.status}`)
    return r.json()
  })) as Manifest
  const textureLoader = new TextureLoader()
  const groups = Object.entries(manifest.groups)
  total = groups.length + 1
  const atlasPath = (atlas: string) => `${BASE}textures/${compact ? atlas.replace(/\.(jpg|png)$/, '-half.$1') : atlas}`
  const [gltf, ...atlasTextures] = await Promise.all([
    gltfPromise,
    ...groups.map(([, { atlas }]) =>
      textureLoader.loadAsync(atlasPath(atlas)).then((texture) => {
        texture.flipY = false
        texture.colorSpace = SRGBColorSpace
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
        tick()
        return texture
      }),
    ),
  ])
  const atlases: Record<string, Texture> = {}
  groups.forEach(([name], i) => (atlases[name] = atlasTextures[i]))

  // ---- every mesh gets its role from the manifest
  const shop = gltf.scene as Group
  const screens = createScreens()
  const hitboxes = new Map<string, Object3D>()
  const plates = new Map<string, { material: MeshBasicMaterial; base: Color }>()
  const fans: Object3D[] = []
  const emissiveOf = manifest.glow.objects
  const palette = manifest.glow.palette
  const role = (name: string) => new Set(manifest.live[name] ?? [])
  const HITBOX = role('HITBOX')
  const DYNAMIC = role('DYNAMIC')
  const TEXT = role('TEXT')
  const MARKER = role('MARKER')
  const EMISSIVE = role('EMISSIVE')
  const matcap = new MeshMatcapMaterial({ matcap: matcapTexture() })
  const textMaterial = new MeshBasicMaterial({ color: '#f4f2ff' })
  const lift = new Color(BAKE_LIFT, BAKE_LIFT, BAKE_LIFT)
  let holoAt = new Vector3(-0.1, 2.05, -0.95)
  let floorBaked: Texture | null = null

  shop.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const name = object.name
    if (name === 'floor') {
      floorBaked = atlases.floor
      object.visible = false
      return
    }
    if (atlases[name]) {
      // the noren curtain is a single sheet inside the shop group, seen from both sides;
      // the bake lands a little dark for the reference's saturated look, so the atlases are lifted
      object.material = new MeshBasicMaterial({ map: atlases[name], color: lift, toneMapped: false, ...(name === 'shopJoined' ? { side: DoubleSide } : {}) })
      return
    }
    const glowKey = emissiveOf[name]
    if (glowKey && palette[glowKey]) {
      const base = new Color(palette[glowKey].color).multiplyScalar(palette[glowKey].gain)
      const material = new MeshBasicMaterial({ color: base, toneMapped: false })
      object.material = material
      if (palette[glowKey].bloom !== false) object.layers.enable(BLOOM_LAYER)
      if (name.startsWith('plate_')) plates.set(name.slice(6), { material, base })
      return
    }
    if (EMISSIVE.has(name)) console.warn(`ramen: emissive mesh "${name}" has no glow colour in the manifest; painted grey`)
    const screenMaterial = screens.material(name)
    if (screenMaterial) {
      object.material = screenMaterial
      return
    }
    if (HITBOX.has(name)) {
      object.material = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
      object.userData.skipBloom = true
      hitboxes.set(name, object)
      return
    }
    if (MARKER.has(name)) {
      if (name === 'holoMarker') holoAt = object.getWorldPosition(new Vector3())
      object.visible = false
      return
    }
    if (DYNAMIC.has(name)) {
      object.material = matcap
      if (/^fan\d$/.test(name)) fans.push(object)
      return
    }
    if (TEXT.has(name)) {
      object.material = textMaterial
      return
    }
    object.material = new MeshBasicMaterial({ color: '#5a5570' })
  })
  scene.add(shop)
  loader.step(0.97)

  // ---- what the bake could not hold
  const mirror = !compact && !lite
  const floor = createFloor(renderer, floorBaked ?? atlases.floor, mirror)
  scene.add(floor.mesh)
  const hologram = createHologram(holoAt, renderer.getPixelRatio())
  scene.add(hologram.points)
  const bloom = lite ? null : createBloom(renderer, scene, camera, compact ? 3 : 2, 0.75, !compact)

  const hud = createHud({ onGo: (mode) => go(mode), onBack: () => go('default') })
  const interaction = createInteraction(
    camera,
    renderer.domElement,
    hitboxes,
    { onHover: (name) => hover(name), onClick: (name) => click(name), onArrive: (mode) => arrive(mode) },
    { reducedMotion },
  )

  function hover(name: string | null): void {
    plates.forEach((p, id) => {
      const hot = name === `hit_${id}`
      p.material.color.copy(p.base).multiplyScalar(hot ? 1.6 : 1)
    })
    screens.setHover(name)
  }

  function go(mode: Mode): void {
    // a flight can only be interrupted to come back; everything else waits for the landing
    if (interaction.flying && mode !== 'default') return
    if (mode === interaction.mode && mode !== 'default') return
    interaction.setLive([])
    screens.setButtons(false)
    hud.setMode(mode)
    hud.setHint(mode === 'default' ? HINTS.default : '')
    interaction.flyTo(mode)
  }

  let lastArrived: Mode = 'default'
  function arrive(mode: Mode): void {
    interaction.setLive(Object.keys(ACTIONS[mode]))
    screens.setButtons(mode === 'about')
    // a refit after a resize lands in the same mode: the page being read stays open
    if (mode === 'about' && lastArrived !== 'about') screens.setAboutPage('intro')
    lastArrived = mode
    hud.setMode(mode)
    hud.setHint(HINTS[mode])
  }

  function open(url: string | undefined): void {
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  // what a click on each target does in each mode; the keys are also what the pointer can hit there
  const toProjects = () => go('projects')
  const toAbout = () => go('about')
  const toCredits = () => go('credits')
  const toContact = () => open(CONTENT.contactUrl)
  const nextCredits = () => screens.setCreditsPage(screens.creditsPage + 1)
  const ACTIONS: Record<Mode, Record<string, () => void>> = {
    default: {
      hit_projects: toProjects,
      hit_vending: toProjects,
      hit_vendScreen: toProjects,
      hit_about: toAbout,
      hit_bigScreen: toAbout,
      hit_credits: toCredits,
      hit_arcade: toCredits,
      hit_arcadeScreen: toCredits,
      hit_name: () => go('name'),
      hit_contact: toContact,
      hit_contact_easel: toContact,
    },
    projects: {
      hit_vend_prev: () => screens.setProject(screens.project - 1),
      hit_vend_next: () => screens.setProject(screens.project + 1),
      hit_vendScreen: () => open(CONTENT.projects[screens.project]?.url),
    },
    about: {
      hit_small3: () => screens.setAboutPage('skills'),
      hit_small2: () => screens.setAboutPage('process'),
      hit_small1: () => go('default'),
      hit_bigScreen: () => screens.setAboutPage('intro'),
    },
    credits: { hit_arcadeScreen: nextCredits, hit_arcade: nextCredits },
    name: {},
  }

  function click(name: string | null): void {
    const mode = interaction.mode
    const action = name ? ACTIONS[mode][name] : undefined
    if (action) action()
    else if (mode !== 'default') go('default')
  }

  // the viewport can change while the door is still up, so this listens from here on
  let refitTimer = 0
  window.addEventListener('resize', () => {
    const { width, height } = viewport()
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setPixelRatio(pixelRatio())
    renderer.setSize(width, height)
    hologram.setPixelRatio(renderer.getPixelRatio())
    bloom?.resize(width, height)
    floor.resize(width, height)
    // a parked close-up is re-aimed once the resizing settles (a rotation, a window drag)
    window.clearTimeout(refitTimer)
    refitTimer = window.setTimeout(() => interaction.refit(), 150)
  })

  // one frame behind the door, so the first thing seen is the shop
  renderer.render(scene, camera)
  await loader.ready()
  hud.show()
  hud.setHint(HINTS.default)
  interaction.intro()

  const clock = new Clock()
  let time = 0
  const frame = () => {
    const dt = Math.min(clock.getDelta(), 0.25)
    time += dt
    for (const [i, fan] of fans.entries()) fan.rotateZ(dt * (i ? -7 : 9))
    hologram.update(time)
    screens.update(time)
    interaction.update(dt)
    if (bloom) bloom.render()
    else renderer.render(scene, camera)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  if (import.meta.env.DEV) {
    ;(window as unknown as { __ramen: unknown }).__ramen = { scene, camera, renderer, interaction, screens, hitboxes, shop, bloom, go, manifest }
  }
}

main().catch((error: unknown) => {
  console.error(error)
  loader.fail('The shop could not load. This needs a browser with WebGL.')
})
