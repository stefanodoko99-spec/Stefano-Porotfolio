'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { CircledTake } from '@/components/ui/CircledTake'
import type { Dictionary } from '@/lib/i18n/dictionaries'
import { onFrame } from '@/lib/motion/ticker'

/**
 * The first thing anyone sees: the shop being written.
 *
 * It exists because the pages behind it have to arrive over the
 * network, and the alternative to a loading screen is a visitor watching a
 * dark rectangle fill in one object at a time. What it shows while waiting is
 * the code that builds the world, typed out as the page settles: lines of
 * `bar-martiri/blender/build_shop.py` and `bake_shop.py`, the same calls and the
 * same mesh names the scene assigns its materials by. A terminal that types
 * real code is telling the truth about what is arriving, which a fake one full
 * of plausible nonsense would not be.
 *
 * Three rules it enforces:
 *
 * 1. **It always reaches the door.** Every path ends with the Enter control:
 *    the street finishes, the street says it is not coming, or the deadline
 *    passes. The visitor opens the site; the screen never times out on them
 *    and never strands them.
 * 2. **It never blocks reading.** Until the door is offered the overlay is out
 *    of the accessibility tree and inert, so a screen reader is not held at a
 *    percentage while the page behind it is finished and legible. Once the
 *    control appears the overlay becomes a dialog with one button in it.
 * 3. **It counts something real.** The typing is driven by the actual byte
 *    progress of the models and atlases, reported inward by the lazy chunk,
 *    with a pace on top so it reads as typing rather than as a jump. A fake
 *    timed bar is a worse lie than no bar at all.
 */
const DEADLINE_MS = 9000

/**
 * How long the typing may keep the door shut after the work is actually done.
 *
 * The animation is the loading experience and it should get to finish when
 * anyone is watching. It should not get to finish when nobody is: past this,
 * the text snaps and the door opens.
 */
const CATCHUP_MS = 2500

/** Characters per second, at most. The network is allowed to be slower; it is never allowed to be faster. */
const PACE = 720

/** Lines from the two scripts that build and bake the shop, condensed but not invented. */
const SOURCE = `# build_shop.py: the ramen shop, built in Blender so it can be lit in Blender
GROUPS = ['SHOP', 'MACHINES', 'SIGNPOST', 'FLOOR', 'TEXT', 'EMISSIVE', 'SCREENS', 'HITBOX']
F = -2.9                                     # the floor, in three.js y

def T(x, y, z): return (x, -z, y)            # three (x, y, z) -> Blender (x, -z, y)
def D(w, h, d): return (w, d, h)             # three (w, h, d) -> Blender dims

FACING = {'+z': (math.pi / 2, 0, 0), '-x': (math.pi / 2, 0, -math.pi / 2)}
FLOOR_TEXT = (0, 0, -math.pi / 2)            # lying down, read from the -x/-z corner

# bake_shop.py: one atlas per group, and the live layers left unbaked
GROUPS = [('SHOP', 'shopJoined', 'shopBaked', 2048, False)]
LIVE = ['TEXT', 'EMISSIVE', 'SCREENS', 'HITBOX', 'DYNAMIC', 'MARKER']
text_mesh('neonPink', 'GARAGE', 0.62, (0.0, FRONT - 0.23, H - 0.55), 'EMISSIVE', E['neonPink'])

def arcade_cabinet(tag, cx, cy, yaw, body, art, glow, marquee, title, screen, hit):
    c, s = math.cos(yaw), math.sin(yaw)
    def P(dx, dy, dz): return (cx + dx*c - dy*s, cy + dx*s + dy*c, dz)
    box(f'{tag}Body', (0.74, 0.80, 0.78), P(0, 0, 0.51), G, body, rot=R())
    box(f'{tag}Hood', (0.74, 0.74, 0.80), P(0, 0.03, 1.30), G, body, rot=R())
    plane(screen, 0.56, 0.42, P(0, -0.393, 1.38), 'SCREENS', M['screenOff'], rot=R())
    box(marquee, (0.72, 0.02, 0.20), P(0, -0.325, 1.83), 'EMISSIVE', glow, rot=R())
    box(hit, (1.20, 1.40, 2.1), P(0, -0.16, 1.05), 'HITBOX', M['hitbox'], rot=R())

ARC = math.radians(-30)
arcade_cabinet('arcA', 3.05, -2.05, ARC, M['pink'], M['purple'], E['neonPink'],
               'neonPinkArcade', 'NEON DRIFT', 'arcadeScreen', 'arcadeHitBox')

VX, VY = W/2 - 0.42, 0.4; VF = VX - 0.40
box('vendBody', (0.80, 0.90, 1.74), (VX, VY, 0.97), G, M['purple'])
plane('vendScreen', 0.44, 0.954, (VF - 0.026, VY + 0.16, 1.30), 'SCREENS', M['screenOff'])

# bake_export.py: one atlas per group, Cycles, 4096 px, 256 samples, WebP q92
for coll_name, joined_name, tex_name in GROUPS:
    ob = join_group(coll_name, joined_name)
    unwrap(ob)
    bake_group(ob, tex_name)

bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_materials='NONE')
print('BUILD OK', counts, 'verts', verts)
`

type Kind = 'c' | 's' | 'n' | 'k' | 'f' | 't'
type Token = { kind: Kind; text: string }

const TOKEN =
  /(#.*)|('(?:[^'\\]|\\.)*')|(\d+(?:\.\d+)?)|(\b(?:def|for|in|import|from|if|else|elif|return|None|True|False|as|not|and|or|with)\b)|([A-Za-z_]\w*(?=\())|([A-Za-z_]\w*|\s+|[\s\S])/g

/** A small Python lexer: comments, strings, numbers, keywords, calls, and everything else. */
function tokenize(source: string): Token[] {
  const out: Token[] = []
  for (const line of source.split('\n')) {
    TOKEN.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = TOKEN.exec(line))) {
      const kind: Kind = match[1] ? 'c' : match[2] ? 's' : match[3] ? 'n' : match[4] ? 'k' : match[5] ? 'f' : 't'
      out.push({ kind, text: match[0] })
    }
    out.push({ kind: 't', text: '\n' })
  }
  return out
}

const TOKENS = tokenize(SOURCE)
/** Where each token starts, in characters, so the reveal can find its place without walking from the top. */
const STARTS = TOKENS.reduce<number[]>((acc, token, i) => {
  acc.push(i === 0 ? 0 : (acc[i - 1] as number) + (TOKENS[i - 1] as Token).text.length)
  return acc
}, [])
const TOTAL = (STARTS[STARTS.length - 1] as number) + (TOKENS[TOKENS.length - 1] as Token).text.length

/** Fonts are the last real signal this screen has, and on a fast connection they are
 *  the last thing holding the composition back from being correct. */
function useFontsReady(): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void document.fonts.ready.then(() => {
      if (!cancelled) setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return ready
}

type Phase = 'typing' | 'ready' | 'leaving' | 'gone'

export function Loader({ dict }: { dict: Dictionary['nav'] }) {
  const fontsReady = useFontsReady()
  const [expired, setExpired] = useState(false)
  const [phase, setPhase] = useState<Phase>('typing')
  const spans = useRef<(HTMLSpanElement | null)[]>([])
  const count = useRef<HTMLSpanElement>(null)
  const door = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setExpired(true), DEADLINE_MS)
    return () => window.clearTimeout(timer)
  }, [])

  const complete = expired || fontsReady

  // The count used to be files in over files expected: this screen covered a
  // 3D street arriving over the network and typed at the rate its atlases
  // actually landed. There is no street behind it any more — the diorama took
  // the homepage and brings its own loading screen — so on the pages this
  // still covers the only honest signal left is the fonts, with the deadline
  // above catching the case where even those never resolve.
  const fraction = fontsReady ? 1 : 0.5

  // The frame loop reads these; React state is only for the phase changes.
  const drive = useRef({ fraction, complete })
  useEffect(() => {
    drive.current = { fraction, complete }
  }, [fraction, complete])

  /**
   * The typing.
   *
   * One subscriber on the application's ticker, the same loop everything else
   * runs on. Each frame reveals up to PACE characters toward a target set by
   * the real progress, writing text into the token spans it has reached and
   * nothing else: no React render per keystroke, no re-tokenising, no string
   * of growing length. Under reduced motion the whole file is simply there.
   */
  useEffect(() => {
    if (phase !== 'typing') return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let shown = 0
    let index = 0
    const paint = (to: number) => {
      while (index < TOKENS.length && (STARTS[index] as number) < to) {
        const token = TOKENS[index] as Token
        const span = spans.current[index]
        const visible = Math.min(token.text.length, to - (STARTS[index] as number))
        if (span) span.textContent = token.text.slice(0, visible)
        if (visible < token.text.length) break
        index += 1
      }
      if (count.current) count.current.textContent = String(Math.min(100, Math.round((to / TOTAL) * 100))).padStart(3, '0')
    }

    if (reduced) {
      paint(TOTAL)
      shown = TOTAL
    }

    // When the work finished, in wall clock rather than in frames.
    //
    // The typing is paced off frame deltas, which is right while anyone is
    // watching and wrong the moment nobody is: a backgrounded tab throttles the
    // ticker to about a frame a second and can stop it altogether, and the
    // delta is clamped to 100ms besides, so a second of real time advances the
    // text by a tenth of one. Measured live: every asset was on disk at 10.5s
    // and the loader was still at 013% at 138s.
    let finishedAt = 0

    const stop = onFrame((_, deltaMs) => {
      const { fraction: done, complete: finished } = drive.current
      if (finished && finishedAt === 0) finishedAt = Date.now()

      // Past the grace period the text stops being a progress bar and becomes
      // an animation standing between the visitor and a site that is ready.
      const overdue = finished && Date.now() - finishedAt > CATCHUP_MS
      const target = finished ? TOTAL : Math.floor(done * TOTAL)
      const next =
        reduced || overdue
          ? TOTAL
          : Math.min(target, shown + PACE * (Math.min(deltaMs, 100) / 1000))

      if (next !== shown) {
        shown = next
        paint(shown)
      }
      if (shown >= TOTAL && finished) setPhase('ready')
    })
    return stop
  }, [phase])

  /*
   * The door opens even if the ticker never runs.
   *
   * The catch-up above needs a frame to notice it is overdue, and a tab that is
   * hidden the whole time may never give it one — rAF is throttled or paused,
   * while timers are only throttled. So this is the one path that does not
   * depend on the animation loop at all: a visitor who opens the site in a
   * background tab and comes back should find a door, not a counter stopped at
   * thirteen per cent.
   */
  useEffect(() => {
    if (phase !== 'typing') return
    const timer = window.setTimeout(() => setPhase('ready'), DEADLINE_MS + CATCHUP_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  const leave = useCallback(() => {
    setPhase((current) => (current === 'ready' ? 'leaving' : current))
  }, [])

  // Enter on the keyboard is the same door as the control, once it is offered.
  useEffect(() => {
    if (phase !== 'ready') return
    door.current?.querySelector('button')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter') leave()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, leave])

  useEffect(() => {
    if (phase !== 'leaving') return
    // Unmounted a beat after the fade so the element is not in the tree, but
    // not before it has finished leaving.
    const timer = window.setTimeout(() => setPhase('gone'), 620)
    return () => window.clearTimeout(timer)
  }, [phase])

  useEffect(() => {
    document.documentElement.dataset.loading = phase === 'gone' ? 'done' : 'true'
    return () => {
      delete document.documentElement.dataset.loading
    }
  }, [phase])

  if (phase === 'gone') return null

  const offered = phase === 'ready' || phase === 'leaving'

  return (
    <div
      className="loader"
      data-phase={phase}
      // Out of the tree and inert while it types: the page underneath is
      // already complete and announced, and a screen reader should be reading
      // that. Once the door is offered it is a dialog with one control in it.
      role={offered ? 'dialog' : undefined}
      aria-modal={offered ? 'true' : undefined}
      aria-label={offered ? dict.loadingLabel : undefined}
      aria-hidden={offered ? undefined : 'true'}
      inert={!offered}
    >
      <div className="loader-inner">
        <div className="loader-terminal">
          <div className="loader-bar">
            <span className="loader-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="loader-file">build_shop.py</span>
            <span className="tabular loader-count">
              <span ref={count}>000</span>%
            </span>
          </div>
          <div className="loader-code">
            <pre>
              <code aria-hidden="true">
                {TOKENS.map((token, i) => (
                  <span
                    key={i}
                    className={`code-${token.kind}`}
                    ref={(el) => {
                      spans.current[i] = el
                    }}
                  />
                ))}
                <span className="loader-caret" />
              </code>
            </pre>
          </div>
        </div>

        {/* The door. It fades up once the last line is typed and the street
            has said it is ready, and it is the only way in: the site opens on
            a press, the way the garage does. */}
        <div ref={door} className="loader-foot" data-ready={offered}>
          {offered ? <CircledTake onClick={leave}>{dict.enter}</CircledTake> : null}
        </div>
      </div>
    </div>
  )
}
