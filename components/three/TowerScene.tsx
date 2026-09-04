'use client'

/**
 * The tower.
 *
 * One workshop on a corner, built and lit in Blender and baked into four
 * texture atlases. It was five places along a street, and then six on the faces
 * of a cube; both cost more to draw than they were worth, and a single shop the
 * camera can stand in front of is what the frame budget actually buys. Nothing in here is lit at runtime: every
 * surface is a MeshBasicMaterial painting its atlas, the neon and LEDs are flat
 * colours on a bloom layer, and the moving parts wear a matcap. The recipe is
 * jesse-zhou.com's; the Blender source is `assets/blender/` and the scripts are `scripts/tower/`.
 *
 * What the rest of the page relies on is unchanged: a panel mesh the DOM
 * interface is pinned to (PanelProjection), a camera that walks toward it on
 * the Cinema timeline (CameraRig), and clickable hotspots that pick a screen
 * view. The panel now sits in the frame of the reception monitor on the garage
 * floor, which the tower exports as a plane named `garageScreen`.
 */
import { OrbitControls, useGLTF } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useFrame, useLoader, useThree, type ThreeEvent } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, type RefObject } from 'react'
import {
  BackSide,
  Box3,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Layers,
  Mesh,
  MeshBasicMaterial,
  MeshMatcapMaterial,
  Object3D,
  type PerspectiveCamera,
  Points,
  PointsMaterial,
  Quaternion,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
} from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { Reflector } from 'three/addons/objects/Reflector.js'

import { cinema } from '@/lib/motion/cinema'
import { loadingState, setSceneProgress } from '@/lib/motion/loading'
import { SCENE } from '@/lib/motion/sceneAssets'
import { damp } from '@/lib/motion/pointer'
import { MACHINE_MESH, type Billboard, type Machine, type ScreenView } from '@/lib/screen'
import type { Project } from '@/lib/projects'

import { SCREEN_PAINTERS, makeArcadeAttract, makeBillboard, type Painter } from './screens'

const TOWER = SCENE.tower.path
const DRACO = '/draco/'

/**
 * The wide shot, fitted to the frame.
 *
 * This framed a sixty-metre row from the left. The places are on a cube now —
 * fourteen on a side, centred on the origin, corner-to-corner about twelve from
 * the middle — so the shot is a three-quarter corner view instead: the only
 * angle that shows three faces at once, which is the entire reason for putting
 * them on a cube. Portrait stands off further and higher, because a cube seen
 * through a narrow frame needs the height more than it needs the width.
 *
 * Still solved from the field of view and the aspect rather than typed, so a
 * resize re-fits instead of re-guessing.
 */
type Shot = { position: Vector3; target: Vector3 }

const SHOP_RADIUS = 7.4

function homeFor(aspect: number, fov: number): Shot {
  const portrait = aspect < 1
  const tangent = Math.tan((fov * Math.PI) / 360)
  // Fit the whole cube both ways round: vertically by the field of view, and
  // horizontally by the same divided by the aspect, whichever needs more room.
  const distance = Math.max(SHOP_RADIUS / tangent, SHOP_RADIUS / (tangent * aspect)) * (portrait ? 1.12 : 1.02)
  const target = new Vector3(0, 2.0, 0)
  const bearing = (portrait ? new Vector3(-0.42, 0.58, 1.0) : new Vector3(-0.61, 0.42, 1.0)).normalize()
  return { position: target.clone().addScaledVector(bearing, distance), target }
}

/** Where the wide shot looks before the first frame has been measured. */
const HOME_LOOK = new Vector3(0, 2.0, 0)

/**
 * The panel.
 *
 * What is on it is the project itself: the site's own hero photograph, its own
 * headline, its own palette, drawn into a canvas texture at twice the panel's
 * pixel count so it holds up when the camera is close enough to touch it.
 *
 * The texture is the far view. Once the camera is near, a real DOM interface
 * fades in over the top of it — the switcher and the link out have to be
 * focusable, clickable, translatable and legible to a screen reader, and none
 * of those things are true of pixels painted into WebGL. The texture exists so
 * that the monitor across the room is showing something real rather than a
 * placeholder; the DOM exists so that the monitor you are standing at works.
 */
/** The panel's real size in the room, in metres. */
/**
 * How much room is left around the panel when the walk ends.
 *
 * 1 would put the panel's edges exactly on the frame edges. Above that, the
 * chassis and some of the desk stay in shot, which is what keeps the site
 * looking like something running on a machine rather than a page that has
 * replaced one.
 */
const PANEL_FRAMING = 1.34

const PANEL_W = 0.84
const PANEL_H = 0.49


/**
 * Where the camera stands before it walks in, relative to where the scroll
 * says it should be. Metres.
 *
 * Small on purpose, for two reasons. A dramatic swing from across the room
 * would fight the scroll walk that follows and would have to be sat through on
 * every reload; this reads as the last step of arriving rather than as a title
 * sequence.
 *
 * The second reason is a failure mode. The settle is animated in the frame
 * loop, so a starved loop leaves it at zero and the camera parked here for
 * good. That has to be a wider shot of the desk, not a shot of the ceiling: at
 * 2.4 back and 0.85 up the desk left the frame entirely. These values keep the
 * whole room composed even if the settle never runs at all.
 */
const ENTER_BACK = 1.1
const ENTER_LIFT = 0.32


/** What is outside the room: the background and the fog, which must be one value. */
/**
 * The room, in navy.
 *
 * It started near black, on the theory that a dark room makes a bright screen.
 * True, and it also meant there was nothing to look at but the screen. Navy is
 * the middle of that argument: dark enough that the panel is still the
 * brightest thing in frame, light enough to have a shape — the ambient is held
 * up so the walls, the reveal and the floor separate instead of merging into
 * one void. A colour needs light on it to read as a colour.
 */
const ROOM_VOID = '#04050c'

const SCREEN_W = 2048
const SCREEN_H = 1152

/**
 * How hard the screen is driven.
 *
 * The panel is unlit on purpose: a screen makes its own light, so it takes a
 * meshBasicMaterial and no lamp in the room can touch it. The consequence is
 * that it shows the texture's literal colours, and the projects it shows are
 * dark sites: one of them grounds at #0b0a09, very nearly black, so a faithful
 * panel read as a switched-off monitor.
 *
 * A material colour above 1 multiplies the map in linear space, which lifts the
 * midtones without washing the blacks to grey the way adding a constant would.
 * The texture stays the project's real palette; only the backlight changes.
 */
const SCREEN_GAIN = 1.85
const SCREEN_DRIVE = new Color().setScalar(SCREEN_GAIN)

/**
 * The tube.
 *
 * Painted into the texture rather than run as a shader, for two reasons. The
 * texture is already a 2D canvas repainted only when the project or the view
 * changes, so this costs nothing per frame on the integrated GPU this has to
 * run on. And a raw ShaderMaterial would have taken the sRGB decode off three's
 * shoulders and onto mine, which is a colour-space bug waiting to happen for a
 * pair of dark lines.
 *
 * Scanlines belong to the screen, not to the viewer, so baking them at texture
 * resolution is also the physically honest place for them: they do not get
 * coarser as you walk up to it.
 *
 * Depth is deliberately low. These sit under type that has to stay readable at
 * both distances, and a CRT that costs a contrast ratio is a costume.
 */
const SCAN_PERIOD = 4
const SCAN_THICKNESS = 2
const SCAN_DEPTH = 0.055
const VIGNETTE_DEPTH = 0.34

function tube(context: CanvasRenderingContext2D): void {
  context.save()

  context.fillStyle = '#000'
  context.globalAlpha = SCAN_DEPTH
  for (let y = 0; y < SCREEN_H; y += SCAN_PERIOD) {
    context.fillRect(0, y, SCREEN_W, SCAN_THICKNESS)
  }

  // The glass falling away at the edges. Elliptical rather than round, because
  // the panel is wider than it is tall and a circular falloff would darken the
  // long sides while leaving the corners lit.
  context.globalAlpha = 1
  const vignette = context.createRadialGradient(
    SCREEN_W / 2,
    SCREEN_H / 2,
    SCREEN_H * 0.18,
    SCREEN_W / 2,
    SCREEN_H / 2,
    SCREEN_W * 0.72,
  )
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, `rgba(0,0,0,${VIGNETTE_DEPTH})`)
  context.fillStyle = vignette
  context.fillRect(0, 0, SCREEN_W, SCREEN_H)

  context.restore()
}

function MonitorScreen({
  project,
  register,
  view,
  hint,
  onEnter,
  position,
  quaternion,
}: {
  project: Project
  register: (entry: MachineEntry | null) => void
  view: ScreenView
  hint: string
  onEnter: () => void
  position: Vector3
  quaternion: Quaternion
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = SCREEN_W
    canvas.height = SCREEN_H
    const next = new CanvasTexture(canvas)
    next.colorSpace = SRGBColorSpace
    next.anisotropy = 8
    return next
  }, [])

  useEffect(() => {
    const canvas = texture.image as HTMLCanvasElement
    const context = canvas.getContext('2d')
    if (!context) return
    let cancelled = false

    const paint = (photo: HTMLImageElement | null) => {
      if (cancelled) return

      context.fillStyle = project.screen.ground
      context.fillRect(0, 0, SCREEN_W, SCREEN_H)

      // At rest the panel is not a poster of the work, it is a machine waiting
      // to be used. Painting the same invitation the DOM shows once you are
      // close means the screen says one thing from both distances.
      if (view === 'home') {
        context.fillStyle = project.screen.ink
        context.font = '600 96px system-ui, sans-serif'
        context.fillText('STEFANO DOKO', 110, SCREEN_H * 0.42)

        context.fillStyle = project.screen.muted
        context.font = '400 40px ui-monospace, monospace'
        context.fillText(hint.toUpperCase(), 112, SCREEN_H * 0.53)

        context.fillStyle = project.screen.accent
        context.fillRect(110, SCREEN_H * 0.63, 430, 88)
        context.fillStyle = project.screen.ground
        context.font = '600 34px ui-monospace, monospace'
        context.fillText('VIEW MY WORK', 150, SCREEN_H * 0.63 + 56)

        tube(context)
        // eslint-disable-next-line react-hooks/immutability
        texture.needsUpdate = true
        return
      }

      // The photograph fills the right half, bled off the edge and faded into
      // the ground rather than boxed, the way both sites set their own heroes.
      if (photo) {
        const boxX = SCREEN_W * 0.46
        const boxW = SCREEN_W - boxX
        const boxY = SCREEN_H * 0.12
        const boxH = SCREEN_H - boxY
        const cover = Math.max(boxW / photo.width, boxH / photo.height)
        const drawW = photo.width * cover
        const drawH = photo.height * cover
        context.save()
        context.beginPath()
        context.rect(boxX, boxY, boxW, boxH)
        context.clip()
        context.drawImage(
          photo,
          boxX + (boxW - drawW) / 2,
          boxY + (boxH - drawH) / 2,
          drawW,
          drawH,
        )
        const fade = context.createLinearGradient(boxX, 0, boxX + boxW * 0.42, 0)
        fade.addColorStop(0, project.screen.ground)
        fade.addColorStop(1, 'rgba(0,0,0,0)')
        context.fillStyle = fade
        context.fillRect(boxX, boxY, boxW, boxH)
        context.restore()
      }

      // The site's own chrome bar.
      context.fillStyle = project.screen.raised
      context.fillRect(0, 0, SCREEN_W, SCREEN_H * 0.075)
      context.fillStyle = project.screen.muted
      context.font = '500 30px ui-monospace, monospace'
      context.fillText(project.host, 96, SCREEN_H * 0.05)

      context.fillStyle = project.screen.accent
      context.font = '600 30px ui-monospace, monospace'
      context.fillText(project.index, SCREEN_W - 160, SCREEN_H * 0.05)

      // The headline, set the way the site sets it.
      context.fillStyle = project.screen.ink
      context.font = '400 104px Georgia, "Times New Roman", serif'
      wrap(context, project.headline, 96, SCREEN_H * 0.42, SCREEN_W * 0.4, 118)

      context.fillStyle = project.screen.muted
      context.font = '400 34px system-ui, sans-serif'
      wrap(context, project.standfirst, 96, SCREEN_H * 0.72, SCREEN_W * 0.36, 46)

      context.fillStyle = project.screen.accent
      context.fillRect(96, SCREEN_H * 0.83, 300, 8)

      tube(context)

      // The canvas is GPU memory, not React state: the texture object must stay
      // the same object while its pixels are re-uploaded. This is an upload, not
      // a mutation of anything React is tracking.
      texture.needsUpdate = true
    }

    paint(null)

    const photo = new Image()
    photo.crossOrigin = 'anonymous'
    photo.src = project.image.src
    photo.decode().then(
      () => paint(photo),
      () => {},
    )

    return () => {
      cancelled = true
    }
  }, [project, texture, view, hint])

  useEffect(() => () => texture.dispose(), [texture])

  return (
    <mesh
      ref={(mesh) => register(mesh ? { mesh, w: PANEL_W, h: PANEL_H } : null)}
      position={position}
      quaternion={quaternion}
      onClick={(event) => {
        event.stopPropagation()
        onEnter()
      }}
      onPointerOver={(event) => {
        event.stopPropagation()
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        document.body.style.cursor = ''
      }}
    >
      <planeGeometry args={[PANEL_W, PANEL_H]} />
      <meshBasicMaterial map={texture} toneMapped={false} color={SCREEN_DRIVE} />
    </mesh>
  )
}

/** Canvas has no line breaking of its own. */
function wrap(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const words = text.split(' ')
  let line = ''
  let cursor = y
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (context.measureText(candidate).width > maxWidth && line) {
      context.fillText(line, x, cursor)
      line = word
      cursor += lineHeight
    } else {
      line = candidate
    }
  }
  if (line) context.fillText(line, x, cursor)
}

/**
 * The camera.
 *
 * Scroll is a distance, not a timeline: progress 0 stands where you can see the
 * whole desk, progress 1 stands close enough that the panel covers the frame,
 * and the position between them is interpolated with an ease that mimics
 * walking — even speed underfoot, an accelerating picture.
 *
 * The end distance is solved from the panel rather than typed in. The panel's
 * world position and world scale are read every frame, which is what makes this
 * survive the breakpoint offsets the rig applies, the pointer parallax still
 * decaying underneath, and any future change to where the desk sits. A hardcoded
 * z would be correct at exactly one viewport.
 */
/**
 * Where the panel is on screen, in CSS pixels, republished every frame.
 *
 * The site is drawn in ordinary DOM over the canvas rather than inside it, and
 * this is what tells it where the monitor currently is: the panel's four world
 * corners projected through the live camera into an axis-aligned box, written
 * to custom properties on the root so the CSS can follow the monitor without
 * React re-rendering sixty times a second.
 *
 * Axis-aligned rather than a full four-corner homography, on purpose. The walk
 * ends square on to the panel, which is the only point at which the interface
 * is meant to be read and operated, and the slight keystone earlier in the
 * approach falls inside the fade the overlay is already doing. A matrix3d would
 * be correct at every frame and legible at none of them.
 */
const PANEL_CORNERS = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
] as const

/** One screen the camera can walk up to: the live plane in its frame, and its size in metres. */
type MachineEntry = { mesh: Mesh; w: number; h: number }
type Machines = Record<Machine, MachineEntry | null>

function PanelProjection({ machines, machine }: { machines: RefObject<Machines>; machine: Machine }) {
  const { camera, size } = useThree()
  const corner = useMemo(() => new Vector3(), [])
  const last = useRef('')

  useFrame(() => {
    const entry = machines.current[machine]
    if (!entry) return
    const mesh = entry.mesh

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const [x, y] of PANEL_CORNERS) {
      corner.set(x * entry.w, y * entry.h, 0)
      mesh.localToWorld(corner)
      corner.project(camera)
      const px = ((corner.x + 1) / 2) * size.width
      const py = ((1 - corner.y) / 2) * size.height
      minX = Math.min(minX, px)
      maxX = Math.max(maxX, px)
      minY = Math.min(minY, py)
      maxY = Math.max(maxY, py)
    }

    const box = [minX, minY, maxX - minX, maxY - minY].map(Math.round)
    const next = box.join(',')
    if (next === last.current) return
    last.current = next

    const root = document.documentElement.style
    root.setProperty('--panel-x', `${box[0]}px`)
    root.setProperty('--panel-y', `${box[1]}px`)
    root.setProperty('--panel-w', `${box[2]}px`)
    root.setProperty('--panel-h', `${box[3]}px`)
  })

  return null
}

// The React Compiler rules are off from here down: the rig, the zoom store and the
// three.js resources below are mutated on purpose inside the frame loop (see the note
// at the tower section).
/* eslint-disable react-hooks/immutability, react-hooks/purity */

/**
 * Where the camera wants to be when nobody is walking in.
 *
 * A tiny store, like `cinema`: the hotspots write a goal, the rig damps the
 * orbit toward it, a drag on the controls clears it. `zoomHome` is exported so
 * a click on empty space (HeroStage) can zoom back out to the wide shot.
 */
const zoom = {
  /** last frame step in ms, for probing from devtools */
  lastStep: 0,
  goal: null as { position: Vector3; target: Vector3; key: string } | null,
  /** the hotspot the camera is currently parked on, if any */
  parked: null as string | null,
}
/** The fitted wide shot for the current frame. TowerScene writes it on every resize. */
let home: Shot = { position: new Vector3(-10.2, 7.0, 16.7), target: HOME_LOOK.clone() }

function setHome(shot: Shot): void {
  home = shot
}

export function zoomHome(): void {
  zoom.goal = { position: home.position.clone(), target: home.target.clone(), key: 'home' }
  zoom.parked = null
}

/** Frame one object: stand back from its bounds, on the street side, a little above. */
function zoomTo(bounds: Box3, key: string, camera: PerspectiveCamera): void {
  const centre = bounds.getCenter(new Vector3())
  const size = bounds.getSize(new Vector3())
  const radius = Math.max(size.x, size.y, size.z) / 2
  const tangent = Math.tan((camera.fov * Math.PI) / 360)
  const distance = Math.max(radius / tangent, 4) * 1.35
  // keep the visitor's current bearing but always look from the street (+z) and above
  const bearing = new Vector3().subVectors(camera.position, centre)
  bearing.y = 0
  if (bearing.z < 2) bearing.z = 2
  bearing.normalize()
  const position = centre.clone().addScaledVector(bearing, distance)
  position.y = centre.y + distance * 0.45
  zoom.goal = { position, target: centre.clone().add(new Vector3(0, size.y * 0.1, 0)), key }
  zoom.parked = key
}

function CameraRig({
  machines,
  machine,
  controls,
}: {
  machines: RefObject<Machines>
  machine: Machine
  controls: RefObject<OrbitControlsImpl | null>
}) {
  const { camera, size } = useThree()
  /** where the walk starts: the orbit position at the moment the Cinema goes live */
  const walkFrom = useMemo(() => ({ position: new Vector3(), target: new Vector3() }), [])
  const wasLive = useRef(false)
  const focus = useMemo(() => new Vector3(), [])
  const scale = useMemo(() => new Vector3(), [])
  const panelNormal = useMemo(() => new Vector3(), [])
  const panelGoal = useMemo(() => new Vector3(), [])
  const scrollPos = useMemo(() => new Vector3(), [])
  const arrival = useRef(0)
  const enterPos = useMemo(() => new Vector3(), [])
  const lookAt = useMemo(() => new Vector3(), [])

  // A drag or a wheel is the visitor taking over: drop any pending zoom goal.
  useEffect(() => {
    const orbit = controls.current
    if (!orbit) return
    const cancel = () => {
      zoom.goal = null
    }
    orbit.addEventListener('start', cancel)
    return () => orbit.removeEventListener('start', cancel)
  }, [controls])

  useFrame((_, delta) => {
    const entry = machines.current[machine]
    const orbit = controls.current
    if (!entry || !orbit) return
    const mesh = entry.mesh
    const step = Math.min(delta, 1 / 20) * 1000
    zoom.lastStep = step
    const { progress, live } = cinema()
    // `live` only says a walk exists on this viewport; the walk is *happening*
    // while its progress is above zero (playing, parked at 1, or reversing).
    const walking = live && progress > 0

    if (!walking) {
      if (wasLive.current) {
        // back from the monitor: hand the orbit back and glide out to the wide shot
        wasLive.current = false
        zoomHome()
      }
      orbit.enabled = true
      const goal = zoom.goal
      if (goal) {
        // damp both ends of the orbit toward the goal; OrbitControls.update()
        // (drei runs it after this) then keeps the camera on its sphere
        camera.position.x = damp(camera.position.x, goal.position.x, 3.2, step)
        camera.position.y = damp(camera.position.y, goal.position.y, 3.2, step)
        camera.position.z = damp(camera.position.z, goal.position.z, 3.2, step)
        orbit.target.x = damp(orbit.target.x, goal.target.x, 3.2, step)
        orbit.target.y = damp(orbit.target.y, goal.target.y, 3.2, step)
        orbit.target.z = damp(orbit.target.z, goal.target.z, 3.2, step)
        if (camera.position.distanceTo(goal.position) < 0.05 && orbit.target.distanceTo(goal.target) < 0.05) zoom.goal = null
      }
      return
    }

    // walking in: the controls step aside and the rig owns the camera
    if (!wasLive.current) {
      wasLive.current = true
      walkFrom.position.copy(camera.position)
      walkFrom.target.copy(orbit.target)
      zoom.goal = null
      arrival.current = 0
    }
    orbit.enabled = false

    const perspective = camera as PerspectiveCamera
    const tangent = Math.tan(((perspective.fov ?? 44) * Math.PI) / 360)
    const aspect = size.width / Math.max(size.height, 1)

    mesh.getWorldPosition(focus)
    mesh.getWorldScale(scale)
    const halfHeight = (entry.h * scale.y) / 2
    const halfWidth = (entry.w * scale.x) / 2

    // Distance at which the panel fits the frame, with room for the bezel and desk around it.
    const fit = Math.max(halfHeight / tangent, halfWidth / (tangent * aspect))
    const near = fit * PANEL_FRAMING

    // Ease-in on the approach: the last strides change the picture far more
    // than the first ones, which is what walking toward something looks like.
    const eased = progress * progress * (3 - 2 * progress) * 0.35 + progress * progress * 0.65

    mesh.getWorldDirection(panelNormal).normalize()
    panelGoal.copy(focus).addScaledVector(panelNormal, near)
    scrollPos.lerpVectors(walkFrom.position, panelGoal, eased)

    if (loadingState().progress >= 1) {
      arrival.current = damp(arrival.current, 1, 0.9, step)
    }
    const entering = 1 - arrival.current
    enterPos.set(scrollPos.x, scrollPos.y + ENTER_LIFT * entering, scrollPos.z + ENTER_BACK * entering)

    camera.position.copy(enterPos)
    // the look swings from wherever the orbit was pointing onto the monitor
    lookAt.lerpVectors(walkFrom.target, focus, eased)
    camera.lookAt(lookAt)
    // keep the controls' target on the monitor so the hand-back on exit is seamless
    orbit.target.copy(lookAt)
  })

  return null
}

// ---------------------------------------------------------------------------
// The tower itself: materials by mesh name, hotspots, bloom.
//
// The React Compiler rules below are disabled for this half of the file on
// purpose. Everything here builds three.js objects once inside useMemo and
// then mutates them (textures get their flipY set after loading, composers are
// sized, a canvas is drawn for the matcap, stars are scattered with
// Math.random). Those are GPU resources, not React state: the compiler's
// immutability and purity rules have no memoisable alternative for them, and
// the four idiomatic rewrites all fail the same lint.
// ---------------------------------------------------------------------------

const BLOOM_LAYER = 1
const PALETTE = {
  pink: '#ff2fd5', blue: '#01ddff', yellow: '#fff668', green: '#1eff51', warm: '#fff1d6',
  red: '#ff112b', led: '#00ff55', orange: '#ff5100', white: '#ffffff', black: '#000000', window: '#ffc48a',
} as const

/** joined bake group -> its atlas in the manifest */
const BAKED: Record<string, keyof typeof SCENE> = {
  shellJoined: 'shell',
  groundJoined: 'ground',
  garageJoined: 'garage',
  exteriorJoined: 'exterior',
}
const EMISSIVE_RULES: readonly (readonly [RegExp, string])[] = [
  [/^(neonPink|neonPinkArcade|ledStripBench)$/, PALETTE.pink],
  // The two cabinets in the corner: each one's marquee, the strips down its
  // front edges, its coin slot and the wash it throws on the floor, all one
  // colour, because a machine that glows in three is a Christmas tree.
  [/^arcA(Edge[LR]|Under|Coin)$/, PALETTE.pink],
  [/^arcB(Edge[LR]|Under|Coin)$/, PALETTE.blue],
  [/^lanternGlow\d$/, PALETTE.orange],
  // The traffic light's three lamps. Their colours are swapped every few
  // seconds in the frame loop; these are the colours they start with.
  [/^trafficRed$/, PALETTE.red],
  [/^trafficAmber$/, PALETTE.orange],
  [/^trafficGreen$/, PALETTE.led],
  [/^[GBMF]win[LRB]\d+Pane$/, PALETTE.window],
  [/^[GBMF]lamp[LRB]Bulb$|^FbillboardLamp\d$|^MroofBulb\d$|^deckBulb\d+$|^lampGlobe[LR]\d$|^parkedHead[LR]$/, PALETTE.warm],
  [/^BantennaLED$/, PALETTE.red],
  [/^neonOrangeBar$/, PALETTE.orange],
  [/^(neonBlue|neonBlueArcade|neonBlueSpille|storageLight|vendLight|vendUnder|vendEdge[LR])$/, PALETTE.blue],
  [/^(neonYellow|neonYellowArcade|neonYellowBank|poleLight|atmLight|atmOutLight|madonnina)$/, PALETTE.yellow],
  [/^(neonGreen|neonGreenFarmacia|neonGreenBar|cross[VH]|ledStripPharma)$/, PALETTE.green],
  [/^(neonWhiteMilano|neonWhiteBar)$/, PALETTE.white],
  [/^neonRedBar$/, PALETTE.red],
  [/^(tubeLight\d|lampBulb\d|lampGlobe[LR]|carHead[LR]|bankPanel\d|pharmaPanel\d|stringBulb\d)$/, PALETTE.warm],
  [/(redLED|LEDred|carTail[LR]|tellerLED1)$/i, PALETTE.red],
  [/(greenLED|LEDgreen|tellerLED[02])$/i, PALETTE.led],
]
const SIGN_COLOURS: Record<string, string> = {
  Red: PALETTE.red, Blue: PALETTE.blue, Pink: PALETTE.pink, Green: PALETTE.green, Orange: PALETTE.orange, Yellow: PALETTE.yellow,
}
const SIGN = /^(garage|bank|milano|farmacia|bar|credits)(Black|Tip|White|Red|Blue|Pink|Green|Orange|Yellow)$/
const SCREENS = /^(vendScreen|garageSmallScreen|arcadeBScreen|atmScreen|ticketScreen|milanoScreen|pharmaScreen|easelFrontGraphic|barScreen|heroScreen)$/
const DYNAMIC = /^(fan[12]|dish|dishStand|spareWheel|spareHub|vaultWheel|vaultSpoke\d|vespa\w+|heroPost\d|heroFrame)$/
/** GLB plane -> the machine whose screen it is. Hidden; a live plane of our own takes its frame. */
const MACHINE_BY_MESH: Record<string, Machine> = Object.fromEntries(
  (Object.keys(MACHINE_MESH) as Machine[]).map((machine) => [MACHINE_MESH[machine], machine]),
)
/** Hotspot -> the small screen behind it, which brightens while the pointer is over it. */
const WAKES: Record<string, string> = {
  vendHitBox: 'vendScreen',
  arcadeBHitBox: 'arcadeBScreen',
  garageSmallHitBox: 'garageSmallScreen',
  atmHitBox: 'atmScreen',
  ticketHitBox: 'ticketScreen',
  milanoScreenHitBox: 'milanoScreen',
  pharmaScreenHitBox: 'pharmaScreen',
  easelHitBox: 'easelFrontGraphic',
  barScreenHitBox: 'barScreen',
}
/**
 * The tubes that are on their way out.
 *
 * A neon street where every tube burns at exactly its nominal value reads as a
 * render of a neon street. Real ones fail unevenly: a starter that misses, a
 * tube that stutters twice and catches. Four of them here do that and the rest
 * are steady, because the effect only works while it is the exception.
 */
const FLICKER = /^(neonPink|neonWhiteMilano|neonGreenFarmacia|neonOrangeBar)$/
const WHITE = new Color('#ffffff')
const TRAFFIC_ON = { red: PALETTE.red, amber: PALETTE.orange, green: PALETTE.led } as const
/** Dark enough to fall under the bloom threshold: an unlit lamp, not a dim one. */
const TRAFFIC_OFF = '#0a0a0c'

/**
 * The five lots, in the GLB's own metres (Blender: lot pitch 12.1 m, Milano at
 * the origin, fronts toward +z). Clicking anywhere on a lot zooms to its frame,
 * whichever prop was under the pointer; the building's own surfaces would
 * otherwise hide the invisible hitboxes from most angles.
 */
/**
 * The five places, addressed by the mesh each one bakes down to.
 *
 * There is one place now — the workshop — so every board on the directory
 * frames the same building and differs only in the view it puts on the
 * monitor. The keys are kept because the boards in Blender are named after
 * them and the site maps them to screen views; renaming one would silently
 * remove a destination.
 *
 * These used to carry a hand-measured centre and size along a street: lots at
 * a fixed pitch on the x axis, so "which lot is this?" was `Math.abs(x - c)`.
 * The places are on the six faces of a cube now — two of them are above and
 * below the camera — and every one of those numbers became a fiction. Worse,
 * they were a *quiet* fiction: a click still resolved to some lot, just not the
 * one under the pointer.
 *
 * So nothing is measured here any more. Each place is named by its joined mesh
 * and its bounds are read from the geometry, which is generated by the same
 * script that decides where the faces are. Move a place in Blender and this
 * follows it; there is no second copy of the layout to keep in step.
 */
const LOTS: readonly { key: string; view: ScreenView; mesh: string }[] = [
  { key: 'garage', view: 'home', mesh: 'garageJoined' },
  { key: 'bank', view: 'process', mesh: 'garageJoined' },
  { key: 'milano', view: 'about', mesh: 'garageJoined' },
  { key: 'farmacia', view: 'contact', mesh: 'garageJoined' },
  { key: 'bar', view: 'work', mesh: 'garageJoined' },
]
function lotBox(lot: (typeof LOTS)[number], root: Object3D): Box3 {
  const mesh = root.getObjectByName(lot.mesh)
  return new Box3().setFromObject(mesh ?? root)
}
/**
 * Which place a click landed in, by where it landed rather than by what it hit.
 * `distanceToPoint` is zero inside a box, so a hit on a lot's own geometry
 * resolves to that lot outright, and a hit on something loose — a sign, a bin,
 * the frame around an opening — resolves to whichever place it is nearest.
 */
function lotAtPoint(point: Vector3, root: Object3D) {
  let best = LOTS[0]
  let nearest = Infinity
  for (const lot of LOTS) {
    const distance = lotBox(lot, root).distanceToPoint(point)
    if (distance < nearest) {
      nearest = distance
      best = lot
    }
  }
  return best
}

/** A sphere-shaded gradient drawn once: the matcap for the moving metal parts. */
function makeMatcap(base: string, highlight: string, rim: string): Texture {
  const s = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = s
  const context = canvas.getContext('2d')!
  const g = context.createRadialGradient(s * 0.38, s * 0.34, s * 0.02, s * 0.5, s * 0.5, s * 0.5)
  g.addColorStop(0, highlight)
  g.addColorStop(0.35, base)
  g.addColorStop(0.85, '#1c1f24')
  g.addColorStop(1, rim)
  context.fillStyle = g
  context.fillRect(0, 0, s, s)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/** Dark glass for a screen nothing paints. */
function screenMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: '#05060c', side: DoubleSide })
}

/** A screen in the street that paints itself: its canvas, its painter, and when it last did. */
type LiveScreen = {
  name: string
  material: MeshBasicMaterial
  texture: CanvasTexture
  context: CanvasRenderingContext2D
  painter: Painter
  last: number
}

/** Where a machine's screen sits in the GLB and how big it is, read off the exported plane. */
type MachineFrame = { position: Vector3; quaternion: Quaternion; w: number; h: number }

type Dressed = {
  root: Group
  hitboxes: Mesh[]
  /** Neon with a fault, and the colour it sits at when it is behaving. */
  flicker: { material: MeshBasicMaterial; base: Color; phase: number }[]
  /** The eight atlas-wearing meshes, so the sheet can be changed under them. */
  baked: { key: keyof typeof SCENE; material: MeshBasicMaterial }[]
  fans: Mesh[]
  vault: Mesh[]
  dishPivot: Group | null
  machines: Record<Machine, MachineFrame | null>
  live: LiveScreen[]
  signs: Map<string, { material: MeshBasicMaterial; base: Color }>
  traffic: Partial<Record<'red' | 'amber' | 'green', MeshBasicMaterial>>
}

function dress(scene: Group, atlases: Record<string, Texture>, painters: Record<string, Painter>): Dressed {
  const root = scene.clone(true)
  const matcap = makeMatcap('#9aa0a8', '#ffffff', PALETTE.blue)
  const matcapRed = makeMatcap('#c8202a', '#ffd0d0', PALETTE.pink)
  const matcapDark = makeMatcap('#1c1f26', '#6a6f78', PALETTE.blue)
  const hitboxMaterial = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  const hitboxes: Mesh[] = []
  const flicker: Dressed['flicker'] = []
  const baked: Dressed['baked'] = []
  const fans: Mesh[] = []
  const vault: Mesh[] = []
  const machines: Record<Machine, MachineFrame | null> = { monitor: null, arcade: null, atm: null }
  const live: LiveScreen[] = []
  const signs = new Map<string, { material: MeshBasicMaterial; base: Color }>()
  const traffic: Dressed['traffic'] = {}

  root.updateMatrixWorld(true)
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const name = object.name
    if (BAKED[name]) {
      const material = new MeshBasicMaterial({ map: atlases[BAKED[name]], toneMapped: false })
      object.material = material
      baked.push({ key: BAKED[name], material })
      return
    }
    const emissive = EMISSIVE_RULES.find(([pattern]) => pattern.test(name))
    if (emissive) {
      const material = new MeshBasicMaterial({ color: emissive[1], toneMapped: false })
      object.material = material
      object.layers.enable(BLOOM_LAYER)
      const lamp = name.match(/^traffic(Red|Amber|Green)$/)
      if (lamp) traffic[lamp[1].toLowerCase() as 'red' | 'amber' | 'green'] = material
      if (FLICKER.test(name)) {
        // The phase is derived from the name so each tube fails on its own
        // schedule and the same tube fails the same way on every reload.
        let phase = 0
        for (let i = 0; i < name.length; i += 1) phase = (phase * 31 + name.charCodeAt(i)) % 1000
        flicker.push({ material, base: material.color.clone(), phase: phase / 1000 * 10 })
      }
      return
    }
    const machine = MACHINE_BY_MESH[name]
    if (machine) {
      // The exported plane is the frame. Its size is read rather than typed, so
      // a screen resized in Blender is resized here without anyone remembering.
      object.geometry.computeBoundingBox()
      const size = object.geometry.boundingBox!.getSize(new Vector3())
      machines[machine] = {
        position: object.getWorldPosition(new Vector3()),
        quaternion: object.getWorldQuaternion(new Quaternion()),
        w: size.x,
        h: size.y,
      }
      object.visible = false
      return
    }
    if (SCREENS.test(name)) {
      const painter = painters[name] ?? SCREEN_PAINTERS[name]
      if (!painter) {
        object.material = screenMaterial()
        return
      }
      const { canvas, context } = screenCanvas(painter)
      const texture = new CanvasTexture(canvas)
      // glTF UVs, the same convention as the baked atlases.
      texture.flipY = false
      texture.colorSpace = SRGBColorSpace
      texture.anisotropy = 8
      const material = new MeshBasicMaterial({ map: texture, toneMapped: false, side: DoubleSide })
      object.material = material
      live.push({ name, material, texture, context, painter, last: -1 })
      return
    }
    if (/HitBox$/.test(name)) {
      object.material = hitboxMaterial
      object.visible = false
      hitboxes.push(object)
      return
    }
    const sign = name.match(SIGN)
    if (sign) {
      const part = sign[2]
      const colour = part === 'Black' || part === 'Tip' ? PALETTE.black : part === 'White' ? PALETTE.white : SIGN_COLOURS[part]
      const material = new MeshBasicMaterial({ color: colour, toneMapped: false })
      object.material = material
      // The coloured board is what lifts under the pointer; the black backing and the white letters stay.
      if (SIGN_COLOURS[part]) signs.set(sign[1], { material, base: material.color.clone() })
      return
    }
    if (DYNAMIC.test(name)) {
      object.material = new MeshMatcapMaterial({
        matcap: name === 'vespaBody' ? matcapRed : /^vespa(Seat|Wheel[FB])$|^heroFrame$/.test(name) ? matcapDark : matcap,
      })
      if (/^fan/.test(name)) fans.push(object)
      if (/^vault/.test(name)) vault.push(object)
      return
    }
    object.material = new MeshMatcapMaterial({ matcap })
  })

  // dish + stand spin together around the stand
  const dish = root.getObjectByName('dish')
  const stand = root.getObjectByName('dishStand')
  let dishPivot: Group | null = null
  if (dish && stand) {
    dishPivot = new Group()
    dishPivot.position.copy(stand.position)
    root.add(dishPivot)
    for (const part of [dish, stand]) {
      part.position.sub(dishPivot.position)
      dishPivot.add(part)
    }
  }

  return { root, hitboxes, flicker, baked, fans, vault, dishPivot, machines, live, signs, traffic }
}

function hitboxFor(object: Object3D): Mesh | undefined {
  let cursor: Object3D | null = object
  while (cursor) {
    if (cursor instanceof Mesh && /HitBox$/.test(cursor.name)) return cursor
    cursor = cursor.parent
  }
  return undefined
}

/**
 * Which hotspot the pointer is actually on — as opposed to merely near.
 *
 * A hitbox is a box, and it is deliberately larger than the machine it stands
 * for: a near miss still opens the arcade, which is what a target wants to be
 * on a street seen at a shallow angle. That generosity is right for the click
 * and wrong for the cursor, which was turning into a hand over a hand's width
 * of empty pavement on every side of every machine.
 *
 * So the two questions are separated. The box still catches the click. The
 * cursor asks a narrower one: is there solid, visible geometry under the
 * pointer, and does that surface lie inside this box? Air inside the box is
 * street and answers no; the cabinet inside the box answers yes.
 *
 * Both are read off one ray. `intersections` is already sorted near to far, so
 * a wall standing in front of a machine is found before the box behind it and
 * fails the containment test on its own — no extra occlusion check needed.
 */
const HOVER_PAD = 0.05
function hotspotUnder(event: ThreeEvent<PointerEvent>): Mesh | null {
  let box: Mesh | null = null
  let surface: Vector3 | null = null
  for (const hit of event.intersections) {
    if (/HitBox$/.test(hit.object.name)) {
      if (!box && hit.object instanceof Mesh) box = hit.object
    } else if (!surface && hit.object.visible) {
      surface = hit.point
    }
    if (box && surface) break
  }
  if (!box || !surface) return null
  const geometry = box.geometry
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const bounds = geometry.boundingBox!
  box.updateWorldMatrix(true, false)
  const local = box.worldToLocal(surface.clone())
  const within =
    local.x >= bounds.min.x - HOVER_PAD && local.x <= bounds.max.x + HOVER_PAD &&
    local.y >= bounds.min.y - HOVER_PAD && local.y <= bounds.max.y + HOVER_PAD &&
    local.z >= bounds.min.z - HOVER_PAD && local.z <= bounds.max.z + HOVER_PAD
  return within ? box : null
}

/**
 * A painter's canvas, at the painter's own resolution times its device scale.
 *
 * The context comes back pre-scaled, so a painter goes on drawing in the
 * coordinate space its layout was written in and lands on a sheet with as many
 * texels as `scale` asks for. Setting the transform once here rather than per
 * frame is deliberate: save/restore inside a painter preserves it, and a
 * per-frame setTransform would be a fifth thing every painter had to remember.
 */
function screenCanvas(painter: Painter): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const scale = painter.scale ?? 1
  const canvas = document.createElement('canvas')
  canvas.width = painter.w * scale
  canvas.height = painter.h * scale
  const context = canvas.getContext('2d')!
  context.setTransform(scale, 0, 0, scale, 0, 0)
  return { canvas, context }
}

/** The seven atlases. flipY off and sRGB: the glTF UV convention, same as the site. */
function useAtlases(): Record<string, Texture> {
  const keys = Object.values(BAKED)
  const urls = keys.map((key) => SCENE[key].path)
  const loaded = useLoader(TextureLoader, urls)
  // Asked of the context rather than typed: 16 is the common ceiling and the
  // one WebGL is allowed to refuse.
  const maxAnisotropy = useThree((state) => state.gl.capabilities.getMaxAnisotropy())
  return useMemo(() => {
    const out: Record<string, Texture> = {}
    loaded.forEach((texture, index) => {
      texture.flipY = false
      texture.colorSpace = SRGBColorSpace
      // The atlases are seen at a grazing angle almost everywhere — a floor
      // running away from the camera, a wall the walk slides along — which is
      // the one case trilinear filtering handles worst. Sixteen taps is what
      // the extra texel density is for; without it a 4K sheet blurs to the
      // same mush as a 2K one on exactly the surfaces you are looking at.
      texture.anisotropy = Math.min(16, maxAnisotropy)
      texture.needsUpdate = true
      // What this texture is, so the sheet swap can recognise the set already
      // on the meshes and not re-fetch eight images to change nothing.
      texture.userData.url = urls[index]
      out[keys[index]] = texture
    })
    return out
    // keys is derived from a module constant
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])
}

/**
 * A machine's screen from across the street: its attract loop, painted into a
 * canvas at the painter's own rate. Once the walk lands, the DOM interface
 * pinned to this plane takes over and this is what is underneath it.
 */
function AttractScreen({
  frame,
  painter,
  wake,
  hovered,
  register,
  onEnter,
}: {
  frame: MachineFrame
  painter: Painter
  /** The hitbox whose hover brightens this screen. */
  wake: string
  hovered: RefObject<string | null>
  register: (entry: MachineEntry | null) => void
  onEnter: () => void
}) {
  const texture = useMemo(() => {
    const next = new CanvasTexture(screenCanvas(painter).canvas)
    next.colorSpace = SRGBColorSpace
    next.anisotropy = 8
    return next
  }, [painter])
  const material = useMemo(() => new MeshBasicMaterial({ map: texture, toneMapped: false }), [texture])
  const clock = useRef(0)
  const last = useRef(-1)

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const t = (clock.current += dt)
    if (last.current < 0 || t - last.current >= 1 / painter.fps) {
      const context = (texture.image as HTMLCanvasElement).getContext('2d')
      if (context) {
        painter.paint(context, painter.w, painter.h, t)
        texture.needsUpdate = true
        last.current = t
      }
    }
    const goal = hovered.current === wake ? 1.5 : 1
    material.color.setScalar(damp(material.color.r, goal, 9, dt * 1000))
  })

  useEffect(
    () => () => {
      texture.dispose()
      material.dispose()
    },
    [texture, material],
  )

  return (
    <mesh
      ref={(mesh) => register(mesh ? { mesh, w: frame.w, h: frame.h } : null)}
      position={frame.position}
      quaternion={frame.quaternion}
      material={material}
      onClick={(event) => {
        event.stopPropagation()
        onEnter()
      }}
      onPointerOver={(event) => {
        event.stopPropagation()
        hovered.current = wake
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        if (hovered.current === wake) hovered.current = null
        document.body.style.cursor = ''
      }}
    >
      <planeGeometry args={[frame.w, frame.h]} />
    </mesh>
  )
}

function TowerModel({
  onEnter,
  onView,
  project,
  machines,
  view,
  hint,
  billboard,
}: {
  onEnter: (machine: Machine) => void
  onView: (view: ScreenView) => void
  project: Project
  machines: RefObject<Machines>
  view: ScreenView
  hint: string
  billboard: Billboard
}) {
  const { scene } = useGLTF(TOWER, DRACO)
  const atlases = useAtlases()
  // The billboard's painter carries the visitor's language, so it is made here
  // rather than in the static table beside the other screens.
  const painters = useMemo(() => ({ heroScreen: makeBillboard(billboard) }), [billboard])
  const dressed = useMemo(() => dress(scene as Group, atlases, painters), [scene, atlases, painters])
  /** The hotspot under the pointer, if any. Read in the frame loop, never rendered. */
  const hovered = useRef<string | null>(null)
  const clock = useRef(0)
  const arcadeAttract = useMemo(() => makeArcadeAttract(), [])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const t = (clock.current += dt)
    for (const fan of dressed.fans) fan.rotation.z -= dt * 6
    for (const part of dressed.vault) part.rotation.x += dt * 0.6
    if (dressed.dishPivot) dressed.dishPivot.rotation.y += dt * 0.35

    // The screens that paint themselves, each at its own rate.
    for (const screen of dressed.live) {
      const { fps } = screen.painter
      if (screen.last >= 0 && (fps === 0 || t - screen.last < 1 / fps)) continue
      screen.painter.paint(screen.context, screen.painter.w, screen.painter.h, t)
      screen.texture.needsUpdate = true
      screen.last = t
    }

    // Hover wakes what it is over. The screen behind a hotspot is driven
    // brighter and a board on the sign post lifts toward white, so the street
    // answers the pointer before anything is pressed.
    const over = hovered.current
    for (const screen of dressed.live) {
      const goal = over && WAKES[over] === screen.name ? 1.55 : 1
      screen.material.color.setScalar(damp(screen.material.color.r, goal, 9, dt * 1000))
    }
    dressed.signs.forEach((sign, key) => {
      const goal = over === `${key}HitBox` ? 0.45 : 0
      const lift = damp((sign.material.userData.lift as number | undefined) ?? 0, goal, 9, dt * 1000)
      sign.material.userData.lift = lift
      sign.material.color.copy(sign.base).lerp(WHITE, lift)
    })

    // The failing tubes. Three sines at unrelated rates give a pattern that
    // does not repeat on any interval an eye can learn, and the threshold keeps
    // it off most of the time — a tube that strobes steadily is a disco, a tube
    // that drops out twice a minute is a tube that needs replacing. The damp is
    // fast but not instant, because a real one takes a moment to catch.
    for (const tube of dressed.flicker) {
      const at = t * 2.1 + tube.phase
      const stutter = Math.sin(at * 7.3) * Math.sin(at * 3.1) * Math.sin(at * 1.7)
      const goal = stutter > 0.62 ? 0.22 : 1
      const now = damp((tube.material.userData.burn as number | undefined) ?? 1, goal, 24, dt * 1000)
      tube.material.userData.burn = now
      tube.material.color.copy(tube.base).multiplyScalar(now)
    }

    // The traffic light runs its cycle: red, green, amber, and round again.
    const phase = t % 12
    const lit = phase < 6 ? 'red' : phase < 10.5 ? 'green' : 'amber'
    for (const lamp of ['red', 'amber', 'green'] as const) {
      dressed.traffic[lamp]?.color.set(lamp === lit ? TRAFFIC_ON[lamp] : TRAFFIC_OFF)
    }
  })

  const { camera } = useThree()
  /**
   * Click to zoom. The first click on a lot frames it; a second click on the
   * same lot, or any click on the garage monitor, walks into the screen with
   * that lot's view. So the street is a place to look around first and a
   * menu second.
   */
  const activate = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    const hit = hitboxFor(event.object)
    // the three machines walk straight in: the reception monitor, the cabinet, the cash machine
    if (hit && hit.name === 'garageScreenHitBox') {
      onView('work')
      onEnter('monitor')
      return
    }
    // Either cabinet opens the arcade. The second one is set dressing in the
    // scene and a target on the pavement: a visitor who walks up to the one on
    // the right and clicks it has asked to play, and answering "not that one"
    // is the kind of correctness nobody thanks you for.
    if (hit && (hit.name === 'arcadeHitBox' || hit.name === 'arcadeBHitBox')) {
      onEnter('arcade')
      return
    }
    if (hit && hit.name === 'atmOutHitBox') {
      onEnter('atm')
      return
    }
    // the billboard says "open the garage", so it does what it says
    if (hit && hit.name === 'heroHitBox') {
      onView('home')
      onEnter('monitor')
      return
    }
    // the road and pavement are "nothing": zoom back out
    if (event.object.name === 'groundJoined') {
      zoomHome()
      return
    }
    // which lot: a sign board names it, anything else is located by where it was hit
    const signed = hit && hit.name.match(/^(garage|bank|milano|farmacia|bar)HitBox$/)
    const lot = signed ? LOTS.find((l) => l.key === signed[1])! : lotAtPoint(event.point, dressed.root)
    if (zoom.parked === lot.key) {
      onView(lot.view)
      onEnter('monitor')
      return
    }
    onView(lot.view)
    zoomTo(lotBox(lot, dressed.root), lot.key, camera as PerspectiveCamera)
  }

  return (
    <>
      <primitive
        object={dressed.root}
        dispose={null}
        onClick={activate}
        /*
         * Move, not over. Every hotspot is one box, so entering it fires
         * `over` exactly once and nothing again however far the pointer then
         * travels inside it — which is the whole region the hand was wrong in.
         * Re-asking on move is what lets the answer change within a single box.
         */
        onPointerMove={(event: ThreeEvent<PointerEvent>) => {
          const box = hotspotUnder(event)
          if (box) event.stopPropagation()
          const name = box ? box.name : null
          if (hovered.current === name) return
          hovered.current = name
          document.body.style.cursor = name ? 'pointer' : ''
        }}
        onPointerOut={() => {
          hovered.current = null
          document.body.style.cursor = ''
        }}
      />
      {dressed.machines.monitor ? (
        <MonitorScreen
          project={project}
          register={(entry) => {
            machines.current.monitor = entry
          }}
          view={view}
          hint={hint}
          position={dressed.machines.monitor.position}
          quaternion={dressed.machines.monitor.quaternion}
          onEnter={() => {
            onView('work')
            onEnter('monitor')
          }}
        />
      ) : null}
      {dressed.machines.arcade ? (
        <AttractScreen
          frame={dressed.machines.arcade}
          painter={arcadeAttract}
          wake="arcadeHitBox"
          hovered={hovered}
          register={(entry) => {
            machines.current.arcade = entry
          }}
          onEnter={() => onEnter('arcade')}
        />
      ) : null}
      {dressed.machines.atm ? (
        <AttractScreen
          frame={dressed.machines.atm}
          painter={SCREEN_PAINTERS.atmOutScreen}
          wake="atmOutHitBox"
          hovered={hovered}
          register={(entry) => {
            machines.current.atm = entry
          }}
          onEnter={() => onEnter('atm')}
        />
      ) : null}
    </>
  )
}

/**
 * Stars on the upper hemisphere and a mirror floor: the two things that make
 * the void read as a night. The mirror is a second render of the whole street
 * every frame, so a phone goes without it: the road is dark there instead of
 * reflective, and the frame rate is the thing that gets kept.
 */
function Night({ reflective }: { reflective: boolean }) {
  const stars = useMemo(() => {
    const n = 1400
    const position = new Float32Array(n * 3)
    const color = new Float32Array(n * 3)
    const tints = ['#ffffff', '#bfe9ff', PALETTE.blue, PALETTE.pink].map((hex) => new Color(hex))
    for (let i = 0; i < n; i++) {
      // well outside the camera's orbit (it stands ~100 m from the origin), or stars fly past the lens
      const r = 200 + Math.random() * 80
      const th = Math.random() * Math.PI * 2
      const ph = Math.acos(0.05 + Math.random() * 0.95)
      position.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th)], i * 3)
      const c = tints[Math.random() < 0.7 ? 0 : 1 + Math.floor(Math.random() * 3)]
      color.set([c.r, c.g, c.b], i * 3)
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(position, 3))
    geometry.setAttribute('color', new BufferAttribute(color, 3))
    const points = new Points(geometry, new PointsMaterial({ size: 0.7, vertexColors: true, transparent: true, opacity: 0.85 }))
    return points
  }, [])
  const mirror = useMemo(() => {
    if (!reflective) return null
    const reflector = new Reflector(new CircleGeometry(70, 64), {
      clipBias: 0.003,
      textureWidth: 768,
      textureHeight: 768,
      // darker than the standalone site: here the reflection is a floor, not a second tower
      color: 0x121417,
    })
    reflector.rotation.x = -Math.PI / 2
    reflector.position.y = -0.05
    return reflector
  }, [reflective])
  const floor = useMemo(() => {
    if (reflective) return null
    const plane = new Mesh(new CircleGeometry(70, 64), new MeshBasicMaterial({ color: '#0a0c11' }))
    plane.rotation.x = -Math.PI / 2
    plane.position.y = -0.05
    return plane
  }, [reflective])
  /**
   * The sky. A drum around the whole scene, outside the star shell and inside
   * the far plane, painted with one vertical gradient: the void overhead, a
   * band of city glow at the horizon, and the void again below the road. It
   * is the difference between a model floating in nothing and a street at
   * night, and it costs one 2x256 texture and a cylinder.
   */
  const sky = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 256
    const context = canvas.getContext('2d')!
    const gradient = context.createLinearGradient(0, 0, 0, 256)
    gradient.addColorStop(0, ROOM_VOID)
    gradient.addColorStop(0.55, '#070a18')
    gradient.addColorStop(0.72, '#101a3c')
    gradient.addColorStop(0.8, '#0a1028')
    gradient.addColorStop(1, ROOM_VOID)
    context.fillStyle = gradient
    context.fillRect(0, 0, 2, 256)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    const drum = new Mesh(
      new CylinderGeometry(300, 300, 260, 48, 1, true),
      new MeshBasicMaterial({ map: texture, side: BackSide, fog: false, depthWrite: false }),
    )
    // the horizon band lands a little above the cube, where it meets the night
    drum.position.y = 74
    return drum
  }, [])
  useEffect(() => () => {
    stars.geometry.dispose()
    ;(stars.material as PointsMaterial).dispose()
    mirror?.dispose()
    floor?.geometry.dispose()
    ;(floor?.material as MeshBasicMaterial | undefined)?.dispose()
    sky.geometry.dispose()
    ;(sky.material as MeshBasicMaterial).map?.dispose()
    ;(sky.material as MeshBasicMaterial).dispose()
  }, [stars, mirror, floor, sky])
  return (
    <>
      <primitive object={sky} />
      <primitive object={stars} />
      {mirror ? <primitive object={mirror} /> : null}
      {floor ? <primitive object={floor} /> : null}
    </>
  )
}

/**
 * Selective bloom, Jesse-style: everything not on the bloom layer is painted
 * black into a bloom composer, the glow is added over the normal frame.
 *
 * Priority 1 takes rendering away from R3F. That still works under
 * frameloop="never": advance() runs the subscribers in order and skips its own
 * gl.render when any subscriber has a priority above zero.
 */
function Bloom({ mirror, divisor }: { mirror: RefObject<Object3D | null>; divisor: number }) {
  const { gl, scene, camera, size } = useThree()
  const layer = useMemo(() => {
    const layers = new Layers()
    layers.set(BLOOM_LAYER)
    return layers
  }, [])
  const dark = useMemo(() => new MeshBasicMaterial({ color: 'black' }), [])
  const saved = useMemo(() => new Map<Mesh, Mesh['material']>(), [])

  const passes = useMemo(() => {
    const renderPass = new RenderPass(scene, camera)
    const bloomPass = new UnrealBloomPass(new Vector2(size.width / divisor, size.height / divisor), 0.85, 0.55, 0.05)
    const bloomComposer = new EffectComposer(gl)
    bloomComposer.renderToScreen = false
    bloomComposer.addPass(renderPass)
    bloomComposer.addPass(bloomPass)
    // A ShaderMaterial, not a shader object: ShaderPass clones a plain object's
    // uniforms, and a render-target texture cannot be cloned, so the bloom
    // sampler would silently come through as null.
    const mixPass = new ShaderPass(
      new ShaderMaterial({
        uniforms: { baseTexture: { value: null }, bloomTexture: { value: bloomComposer.renderTarget2.texture } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader:
          'uniform sampler2D baseTexture; uniform sampler2D bloomTexture; varying vec2 vUv; void main(){ gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv); }',
      }),
      'baseTexture',
    )
    mixPass.needsSwap = true
    const finalComposer = new EffectComposer(gl)
    finalComposer.addPass(renderPass)
    finalComposer.addPass(mixPass)
    finalComposer.addPass(new OutputPass())
    return { bloomComposer, finalComposer, bloomPass }
  }, [gl, scene, camera]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ratio = gl.getPixelRatio()
    passes.bloomComposer.setPixelRatio(ratio)
    passes.finalComposer.setPixelRatio(ratio)
    passes.bloomComposer.setSize(size.width, size.height)
    passes.finalComposer.setSize(size.width, size.height)
    // A third of the frame on a phone, half on a desk: bloom is a blur, and a
    // blur does not need the pixels it is spreading.
    passes.bloomPass.resolution.set(size.width / divisor, size.height / divisor)
  }, [passes, size, gl, divisor])

  useEffect(() => () => {
    passes.bloomComposer.dispose()
    passes.finalComposer.dispose()
  }, [passes])

  // Development-only handle for probing the scene from devtools (render counts, pass timings).
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    ;(window as unknown as { __tower?: unknown }).__tower = { gl, scene, camera, passes, zoom, zoomHome, cinema }
  }, [gl, scene, camera, passes])

  useFrame(() => {
    const floor = mirror.current
    if (floor) floor.visible = false
    scene.traverse((object) => {
      if (object instanceof Mesh && !layer.test(object.layers)) {
        saved.set(object, object.material)
        object.material = dark
      }
    })
    passes.bloomComposer.render()
    saved.forEach((material, object) => {
      object.material = material
    })
    saved.clear()
    if (floor) floor.visible = true
    passes.finalComposer.render()
  }, 1)

  return null
}

function SceneReady() {
  useEffect(() => setSceneProgress(1), [])
  return null
}

/** The tower, still driven by the application's GSAP ticker. */
export function TowerScene({
  project,
  view,
  hint,
  billboard,
  machine,
  onEnter,
  onView,
}: {
  project: Project
  view: ScreenView
  hint: string
  billboard: Billboard
  machine: Machine
  onEnter: (machine: Machine) => void
  onView: (view: ScreenView) => void
}) {
  /** The three live screens, registered as they mount; the rig and the projection follow `machine`. */
  const machines = useRef<Machines>({ monitor: null, arcade: null, atm: null })
  const mirror = useRef<Object3D>(null)
  const controls = useRef<OrbitControlsImpl>(null)
  const { size, camera } = useThree()
  const compact = size.width < 760

  // Re-fit the wide shot to the frame, at mount and on every resize, and glide
  // to it unless the visitor is somewhere on purpose: parked on a lot, or
  // inside a machine.
  useEffect(() => {
    setHome(homeFor(size.width / Math.max(size.height, 1), (camera as PerspectiveCamera).fov ?? 38))
    if (!zoom.parked && cinema().progress === 0) zoomHome()
  }, [size.width, size.height, camera])

  return (
    <>
      <CameraRig machines={machines} machine={machine} controls={controls} />
      <PanelProjection machines={machines} machine={machine} />
      {/*
        Free orbit. Drag turns the street through a full 360°, the wheel or a
        pinch zooms, a right-drag / two-finger drag pans along the road. The rig
        disables it for the walk into the monitor and hands it back on exit.
      */}
      <OrbitControls
        ref={controls}
        target={[HOME_LOOK.x, HOME_LOOK.y, HOME_LOOK.z]}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.55}
        zoomSpeed={0.7}
        panSpeed={0.6}
        screenSpacePanning={false}
        minDistance={5}
        maxDistance={150}
        minPolarAngle={0.2}
        maxPolarAngle={1.5}
      />
      <color attach="background" args={[ROOM_VOID]} />
      <group ref={mirror as RefObject<Group>}>
        <Night reflective={!compact} />
      </group>
      <Bloom mirror={mirror} divisor={compact ? 3 : 2} />
      <Suspense fallback={null}>
        <SceneReady />
        <TowerModel
          project={project}
          machines={machines}
          view={view}
          hint={hint}
          billboard={billboard}
          onEnter={onEnter}
          onView={onView}
        />
      </Suspense>
    </>
  )
}

useGLTF.preload(TOWER, DRACO)
