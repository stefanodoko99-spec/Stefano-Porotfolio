import { PerspectiveCamera, Raycaster, Vector2, Vector3, type Object3D } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

/**
 * How the shop is looked at, after the reference's Camera and Controller.
 *
 * One orbit, no pan, kept between two distances and two tilts so the floor's
 * edge and the underside never show. Five places the camera can be: the
 * default view, the vending machine (projects), the big screen (about), the
 * arcade (credits) and a high view from the far side (the name tag). Each
 * has its own limits; a flight of 1.5 s with a quadratic ease moves between
 * them, and the controls get the camera back with the new limits when it
 * lands. Hovering a live click target lights it and changes the cursor; a
 * click that did not drag is handed to the page, which decides what it means
 * in the current mode.
 *
 * A click is one primary-button pointer that went down and came up within
 * 8 px and 700 ms while no other pointer was down, so a pinch, a drag and a
 * right-click are not clicks.
 */
export type Mode = 'default' | 'projects' | 'about' | 'credits' | 'name'

export type View = {
  position: Vector3
  target: Vector3
  distance: [number, number]
  polar: [number, number]
  azimuth: [number, number] | null
  /** a different framing for screens taller than they are wide */
  portrait?: { position: Vector3; target: Vector3 }
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z)
export const VIEWS: Record<Mode, View> = {
  default: { position: v(-11.1, -1, -7.6), target: v(0, 0, -1), distance: [7, 16], polar: [0.63, 1.73], azimuth: null },
  projects: { position: v(1.15, -1.05, 5.25), target: v(1.15, -1.05, 3.06), distance: [1.6, 3.2], polar: [1.26, 1.67], azimuth: [-0.31, 0.31] },
  about: {
    position: v(0.68, 3.35, 3.15),
    target: v(0.68, 3.35, 0.52),
    distance: [1.2, 3.0],
    polar: [0.94, 2.04],
    azimuth: [-0.63, 0.63],
    // upright, the big screen fills the width, so the camera stands back and aims between
    // the big screen and the row of small ones under it, which sit further left
    portrait: { position: v(-0.2, 2.95, 5.3), target: v(-0.2, 2.95, 0.52) },
  },
  credits: { position: v(-0.58, -1.12, 4.5), target: v(-0.58, -1.18, 2.85), distance: [1.0, 2.4], polar: [0.94, 2.04], azimuth: [-0.63, 0.63] },
  name: { position: v(-10.2, 6.3, 3.8), target: v(0, 0, -1), distance: [7, 16], polar: [0.63, 1.73], azimuth: null },
}
export const INTRO_FROM = v(15.9, 6.8, -11.4)

export type Interaction = {
  controls: OrbitControls
  mode: Mode
  hovered: string | null
  flying: boolean
  flyTo: (mode: Mode, duration?: number) => void
  intro: () => void
  /** after the viewport changed shape: re-aim a parked close-up for the new aspect */
  refit: () => void
  setLive: (names: string[]) => void
  update: (dt: number) => void
}

/** quadratic in/out, the reference's power1.inOut */
function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

export function createInteraction(
  camera: PerspectiveCamera,
  dom: HTMLElement,
  hitboxes: Map<string, Object3D>,
  callbacks: { onHover: (name: string | null) => void; onClick: (name: string | null) => void; onArrive: (mode: Mode) => void },
  options: { reducedMotion: boolean },
): Interaction {
  const controls = new OrbitControls(camera, dom)
  controls.enableDamping = true
  controls.dampingFactor = 0.05
  controls.rotateSpeed = 1.2
  controls.zoomSpeed = 0.8
  controls.enablePan = false
  controls.target.copy(VIEWS.default.target)
  camera.position.copy(INTRO_FROM)
  camera.lookAt(controls.target)

  const raycaster = new Raycaster()
  const pointer = new Vector2()
  let pointerDirty = false
  let rect = dom.getBoundingClientRect()
  let downAt: { id: number; x: number; y: number; time: number } | null = null
  /** pointers currently down, by id, with their kind (mouse, touch, pen) */
  const activePointers = new Map<number, string>()
  let live: Object3D[] = []

  const state: Interaction = {
    controls,
    mode: 'default',
    hovered: null,
    flying: false,
    flyTo,
    intro,
    refit,
    setLive,
    update,
  }

  let flight: { from: Vector3; fromTarget: Vector3; to: Vector3; toTarget: Vector3; t: number; duration: number } | null = null

  function applyLimits(view: View): void {
    // the landing distance may exceed the view's range on narrow screens; the range must include it
    // or the controls would snap the camera in on their first update
    const landed = camera.position.distanceTo(controls.target)
    controls.minDistance = Math.min(view.distance[0], landed)
    controls.maxDistance = Math.max(view.distance[1], landed)
    controls.minPolarAngle = view.polar[0]
    controls.maxPolarAngle = view.polar[1]
    controls.minAzimuthAngle = view.azimuth ? view.azimuth[0] : -Infinity
    controls.maxAzimuthAngle = view.azimuth ? view.azimuth[1] : Infinity
  }

  /** where the camera should stand for a view at the current aspect */
  function framing(view: View): { position: Vector3; target: Vector3 } {
    if (camera.aspect < 1 && view.portrait) return { position: view.portrait.position.clone(), target: view.portrait.target.clone() }
    // screens not much wider than tall see less of the width, so the close views stand a little further back
    const k = camera.aspect < 1 ? 1.45 : camera.aspect < 1.4 ? 1.15 : 1
    return { position: view.target.clone().add(view.position.clone().sub(view.target).multiplyScalar(k)), target: view.target.clone() }
  }

  /** the aspect the current framing was computed for */
  let framedAspect = camera.aspect

  function flyTo(mode: Mode, duration = 1.5): void {
    const to = framing(VIEWS[mode])
    framedAspect = camera.aspect
    flight = {
      from: camera.position.clone(),
      fromTarget: controls.target.clone(),
      to: to.position,
      toTarget: to.target,
      t: 0,
      duration: options.reducedMotion ? 0.001 : duration,
    }
    controls.enabled = false
    state.flying = true
    state.mode = mode
    setHover(null)
  }

  function intro(): void {
    camera.position.copy(INTRO_FROM)
    controls.target.copy(VIEWS.default.target)
    flyTo('default', 2.6)
  }

  function refit(): void {
    rect = dom.getBoundingClientRect()
    if (flight) {
      // mid-flight: aim the flight at the framing for the new shape instead of landing on the old one
      const to = framing(VIEWS[state.mode])
      flight.to = to.position
      flight.toTarget = to.target
      framedAspect = camera.aspect
      return
    }
    // parked in the default view the visitor may have orbited; that is left alone, and so is a
    // close-up whose framing would not change (a resize that barely moved the aspect)
    if (state.mode === 'default') return
    if (Math.abs(camera.aspect - framedAspect) < 0.08 && camera.aspect < 1 === framedAspect < 1) return
    flyTo(state.mode, 0.6)
  }

  function setLive(names: string[]): void {
    live = names.map((n) => hitboxes.get(n)).filter((o): o is Object3D => !!o)
    pointerDirty = true
  }

  function pick(): string | null {
    if (!live.length) return null
    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObjects(live, false)
    return hits.length ? hits[0].object.name : null
  }

  function setHover(name: string | null): void {
    if (name === state.hovered) return
    state.hovered = name
    dom.style.cursor = name ? 'pointer' : ''
    callbacks.onHover(name)
  }

  const onMove = (event: PointerEvent) => {
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    pointerDirty = true
  }
  const onDown = (event: PointerEvent) => {
    // the primary pointer of a kind going down starts a new gesture of that kind: anything
    // left over from an interrupted gesture of the same kind is forgotten, other kinds are kept
    if (event.isPrimary) {
      for (const [id, type] of activePointers) if (type === event.pointerType) activePointers.delete(id)
    }
    activePointers.set(event.pointerId, event.pointerType)
    // a press that starts during a flight is not the start of a click, even if it ends after landing
    if (event.button !== 0 || activePointers.size > 1 || state.flying) {
      downAt = null
      return
    }
    downAt = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now() }
  }
  const onUp = (event: PointerEvent) => {
    const lone = activePointers.size <= 1
    activePointers.delete(event.pointerId)
    if (!downAt || downAt.id !== event.pointerId) return
    const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y)
    const quick = performance.now() - downAt.time < 700
    downAt = null
    if (!lone || moved > 8 || !quick || state.flying) return
    onMove(event)
    callbacks.onClick(pick())
  }
  const onCancel = (event: PointerEvent) => {
    activePointers.delete(event.pointerId)
    if (downAt && downAt.id === event.pointerId) downAt = null
  }
  const onLeave = () => setHover(null)
  dom.addEventListener('pointermove', onMove)
  dom.addEventListener('pointerdown', onDown)
  dom.addEventListener('pointerup', onUp)
  dom.addEventListener('pointercancel', onCancel)
  dom.addEventListener('pointerleave', onLeave)

  function update(dt: number): void {
    if (flight) {
      flight.t = Math.min(1, flight.t + dt / flight.duration)
      const k = ease(flight.t)
      camera.position.lerpVectors(flight.from, flight.to, k)
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, k)
      camera.lookAt(controls.target)
      if (flight.t >= 1) {
        flight = null
        applyLimits(VIEWS[state.mode])
        controls.enabled = true
        controls.update()
        state.flying = false
        pointerDirty = true
        callbacks.onArrive(state.mode)
      }
      return
    }
    if (pointerDirty) {
      pointerDirty = false
      setHover(pick())
    }
    controls.update()
  }

  return state
}
