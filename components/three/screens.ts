/**
 * What the small screens in the street are showing.
 *
 * The tower exports nine planes named for what they are: the diagnostic cart,
 * the vending machine, the cash machine and the ticket counter in the bank,
 * the menu boards, the pharmacy's cross, the chalk board at the garage door.
 * Each was dark glass. Now each paints itself into a canvas at its own rate
 * and the scene uploads that as its texture, so the street reads as lit and
 * running from across the road rather than as a model with its screens off.
 *
 * Rates are deliberate. A clock changes once a minute, a blink twice a
 * second, a trace a few times a second, and a chalk board never; nothing here
 * repaints at frame rate. The canvases are small, sized to the plane they land
 * on, because the closest anyone gets to these is a lot's framing shot.
 *
 * No React and no three in here: the painters are plain functions over a 2D
 * context, which is also what lets the arcade attract loop reuse the games
 * exactly as the playable cabinet runs them.
 */
import { GAME_IDS, HEIGHT as GAME_H, PHOSPHOR, WIDTH as GAME_W, createGame, type Input } from '@/lib/arcade'
import type { Billboard } from '@/lib/screen'

export type Painter = {
  w: number
  h: number
  /** Repaints per second. 0 paints once and never again. */
  fps: number
  /**
   * Device pixels per authored pixel.
   *
   * Every painter below draws in a coordinate space chosen for the layout —
   * "the title sits 48 down from the top" — and those numbers were also the
   * canvas's real size, so the resolution of a screen and the readability of
   * the code that draws it were the same decision. They are not the same
   * decision. A screen you can walk up to and stand in front of wants twice
   * the pixels; rewriting a hundred hand-placed coordinates to get them is how
   * a layout picks up bugs.
   *
   * So the canvas is allocated at w*scale by h*scale and the context is left
   * pre-scaled: the painters keep their own coordinates and land on a sheet
   * with four times the texels. The cabinet's own screen deliberately stays at
   * 1 — the games behind it are a 320x240 grid of squares, and the pixels are
   * the point.
   */
  scale?: number
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void
}

const NEON = {
  pink: '#ff2fd5',
  blue: '#01ddff',
  yellow: '#fff668',
  green: '#1eff51',
  warm: '#fff1d6',
  orange: '#ff5100',
  red: '#ff112b',
  white: '#f4f6ff',
  bank: '#ffd500',
} as const

const MONO = 'ui-monospace, "Cascadia Mono", Menlo, monospace'
const SANS = 'system-ui, sans-serif'
const GROUND = '#05060c'

/** Scanlines and a soft vignette: the glass every one of these sits behind. */
function crt(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save()
  ctx.fillStyle = '#000'
  ctx.globalAlpha = 0.07
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1)
  ctx.globalAlpha = 1
  const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.72)
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(0,0,0,0.38)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}

function ground(ctx: CanvasRenderingContext2D, w: number, h: number, colour = GROUND): void {
  ctx.fillStyle = colour
  ctx.fillRect(0, 0, w, h)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.globalAlpha = 1
}

function blink(t: number, period = 1): boolean {
  return t % period < period / 2
}

/** Wall clock, HH:MM. A screen in a street shows the visitor's own time. */
function clock(seconds = false): string {
  const now = new Date()
  const parts = [now.getHours(), now.getMinutes()]
  if (seconds) parts.push(now.getSeconds())
  return parts.map((n) => String(n).padStart(2, '0')).join(':')
}

function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  colour: string,
  options: { weight?: number; family?: string; align?: CanvasTextAlign; spacing?: number } = {},
): void {
  ctx.fillStyle = colour
  ctx.font = `${options.weight ?? 500} ${Math.round(size)}px ${options.family ?? MONO}`
  ctx.textAlign = options.align ?? 'left'
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${options.spacing ?? 0}px`
  ctx.fillText(value, x, y)
}

const IDLE: Input = { up: false, down: false, left: false, right: false, action: false }

/** The site's display face, as next/font published it on the root, or the system's. */
function display(): string {
  const family = getComputedStyle(document.documentElement).getPropertyValue('--font-archivo').trim()
  return family ? `${family}, ${SANS}` : SANS
}

/** The largest size at or under `size` at which `value` fits in `maxWidth`. */
function fit(ctx: CanvasRenderingContext2D, value: string, maxWidth: number, size: number, weight: number, family: string): number {
  let current = size
  ctx.font = `${weight} ${Math.round(current)}px ${family}`
  while (current > 12 && ctx.measureText(value).width > maxWidth) {
    current *= 0.94
    ctx.font = `${weight} ${Math.round(current)}px ${family}`
  }
  return current
}

/**
 * The billboard on the bank's roof: the first screen's name, role and way in.
 *
 * These lines were DOM over the street; they are in the street now, in the
 * visitor's language, on the one surface big enough to carry a name from
 * across the road. The clock runs in the corner and the way in blinks, the
 * way every other lit sign in the street does.
 */
export function makeBillboard(copy: Billboard): Painter {
  return {
    w: 1024,
    h: 460,
    fps: 1,
    scale: 2,
    paint(ctx, w, h, t) {
      ground(ctx, w, h, '#07080d')
      ctx.fillStyle = NEON.blue
      ctx.fillRect(0, 0, w, 6)
      const face = display()
      const name = copy.name.toUpperCase()
      const size = fit(ctx, name, w - 112, 150, 700, face)
      text(ctx, name, 56, 176, size, NEON.white, { family: face, weight: 700, spacing: 2 })
      text(ctx, copy.role.toUpperCase(), 58, 246, fit(ctx, copy.role.toUpperCase(), w - 116, 40, 500, MONO), NEON.blue, { spacing: 6 })
      text(ctx, copy.based, 58, 312, fit(ctx, copy.based, w - 116, 34, 400, SANS), 'rgba(244,246,255,0.78)', { family: SANS, weight: 400 })
      ctx.fillStyle = 'rgba(255,255,255,0.16)'
      ctx.fillRect(56, h - 96, w - 112, 1)
      text(ctx, clock(), 58, h - 44, 36, NEON.warm)
      if (blink(t, 1.6)) {
        const hint = copy.hint.toUpperCase()
        text(ctx, hint, w - 58, h - 44, fit(ctx, hint, w * 0.55, 32, 700, MONO), NEON.yellow, { weight: 700, align: 'right', spacing: 4 })
      }
      crt(ctx, w, h)
    },
  }
}

/**
 * The cabinet's attract loop: the games playing themselves, one after another,
 * with the coin prompt over the top. What a cabinet does all day in an
 * arcade nobody is standing in.
 */
export function makeArcadeAttract(): Painter {
  let index = 0
  let game = createGame(GAME_IDS[index])
  let last = -1
  let since = 0
  let dead = 0
  return {
    w: GAME_W,
    h: GAME_H,
    fps: 15,
    paint(ctx, w, h, t) {
      const dt = last < 0 ? 0 : Math.min(t - last, 0.1)
      last = t
      since += dt
      if (game.over) dead += dt
      if (since > 26 || dead > 2.4) {
        index = (index + 1) % GAME_IDS.length
        game = createGame(GAME_IDS[index])
        since = 0
        dead = 0
      }
      const steps = Math.max(1, Math.ceil(dt / 0.02))
      for (let k = 0; k < steps; k++) game.step(dt / steps, IDLE, true)
      game.draw(ctx, w, h, PHOSPHOR[game.id])
      if (blink(t, 1.2)) {
        ctx.save()
        ctx.fillStyle = 'rgba(4,7,10,0.72)'
        ctx.fillRect(w / 2 - 78, h / 2 - 16, 156, 32)
        text(ctx, 'INSERT COIN', w / 2, h / 2 + 6, 15, PHOSPHOR[game.id].dim, { weight: 700, align: 'center', spacing: 3 })
        ctx.restore()
      }
      crt(ctx, w, h)
    },
  }
}

/** The small screens, by the name of the plane each lands on. */
export const SCREEN_PAINTERS: Record<string, Painter> = {
  // The diagnostic cart beside the lift: an engine trace and its readings.
  garageSmallScreen: {
    w: 512,
    h: 396,
    fps: 8,
    scale: 2,
    paint(ctx, w, h, t) {
      ground(ctx, w, h)
      text(ctx, 'DIAG · OBD-II', 28, 48, 26, NEON.blue, { weight: 700, spacing: 3 })
      text(ctx, blink(t, 1.6) ? '● LIVE' : '○ LIVE', w - 28, 48, 20, NEON.green, { align: 'right' })
      ctx.strokeStyle = NEON.blue
      ctx.lineWidth = 3
      ctx.beginPath()
      for (let x = 0; x <= w; x += 4) {
        const phase = x / 38 - t * 3
        const y = h * 0.42 + Math.sin(phase) * 26 + Math.sin(phase * 2.7) * 9
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      const rows: [string, string][] = [
        ['RPM', String(Math.round(840 + Math.sin(t * 1.3) * 60)).padStart(4, '0')],
        ['TEMP', `${Math.round(91 + Math.sin(t * 0.4) * 1.5)} °C`],
        ['BATT', `${(12.6 + Math.sin(t * 0.9) * 0.1).toFixed(1)} V`],
      ]
      rows.forEach(([label, value], i) => {
        const y = h * 0.66 + i * 40
        text(ctx, label, 28, y, 22, NEON.warm, { spacing: 2 })
        text(ctx, value, w - 28, y, 22, NEON.white, { align: 'right' })
      })
      crt(ctx, w, h)
    },
  },

  // The vending machine's front: a menu of selections and a prompt.
  /**
   * The second cabinet, which nobody is playing.
   *
   * It could have been another attract loop, and two of those side by side is
   * two things asking to be watched — the one on the left is the one you can
   * walk into, and it has to win. So this one shows what a cabinet shows
   * between games instead: the table, the initials, and a row that scrolls up
   * one place every few seconds so the glass is alive without being a second
   * claim on the eye.
   */
  arcadeBScreen: {
    w: 320,
    h: 240,
    fps: 4,
    paint(ctx, w, h, t) {
      ground(ctx, w, h, '#04070a')
      text(ctx, 'HIGH SCORES', w / 2, 30, 20, NEON.yellow, { weight: 700, align: 'center', spacing: 3 })
      ctx.fillStyle = 'rgba(255,246,104,0.30)'
      ctx.fillRect(38, 40, w - 76, 1)
      const board: [string, number][] = [
        ['SDK', 128400], ['LRA', 96750], ['AAA', 71200],
        ['MIL', 54900], ['ZZZ', 33150], ['CPU', 12080],
      ]
      // One row is lit at a time, walking down the table and round again: the
      // cheapest motion that reads as a machine still switched on.
      const lit = Math.floor(t / 2.2) % board.length
      board.forEach(([who, score], i) => {
        const y = 72 + i * 26
        const on = i === lit
        text(ctx, String(i + 1).padStart(2, '0'), 40, y, 17, on ? NEON.white : 'rgba(244,246,255,0.34)')
        text(ctx, who, 82, y, 17, on ? NEON.pink : 'rgba(255,47,213,0.42)', { weight: 700, spacing: 2 })
        text(ctx, score.toLocaleString('en-GB'), w - 40, y, 17, on ? NEON.green : 'rgba(30,255,81,0.40)', { align: 'right' })
      })
      if (blink(t, 1.4)) text(ctx, 'PRESS START', w / 2, h - 24, 16, NEON.blue, { weight: 700, align: 'center', spacing: 4 })
      crt(ctx, w, h)
    },
  },
  vendScreen: {
    w: 320,
    h: 694,
    fps: 2,
    scale: 2,
    paint(ctx, w, h, t) {
      ground(ctx, w, h, '#06070f')
      ctx.fillStyle = NEON.blue
      ctx.fillRect(0, 0, w, 62)
      text(ctx, 'VEND-O-MATIC', w / 2, 42, 24, '#05060c', { weight: 800, align: 'center', spacing: 3 })
      const items: [string, string, string][] = [
        ['A1', 'CAFFÈ', '1.00'],
        ['A2', 'ACQUA', '0.80'],
        ['B1', 'CHIPS', '1.50'],
        ['B2', 'CIOCCOLATO', '1.20'],
        ['C1', 'ENERGY', '2.00'],
        ['C2', 'GUM', '0.60'],
      ]
      items.forEach(([code, name, price], i) => {
        const x = 16 + (i % 2) * 148
        const y = 90 + Math.floor(i / 2) * 160
        ctx.fillStyle = 'rgba(255,255,255,0.06)'
        ctx.fillRect(x, y, 140, 140)
        text(ctx, code, x + 12, y + 34, 24, NEON.yellow, { weight: 700 })
        text(ctx, name, x + 12, y + 78, 18, NEON.white, { family: SANS, weight: 600 })
        text(ctx, `€ ${price}`, x + 12, y + 116, 20, NEON.blue)
      })
      if (blink(t, 1.4)) text(ctx, 'SELECT', w / 2, h - 96, 26, NEON.green, { weight: 700, align: 'center', spacing: 4 })
      text(ctx, clock(), w / 2, h - 40, 22, 'rgba(244,246,255,0.7)', { align: 'center' })
      crt(ctx, w, h)
    },
  },

  // The cash machine inside the bank, waiting.
  atmScreen: {
    w: 384,
    h: 300,
    fps: 2,
    paint(ctx, w, h, t) {
      ground(ctx, w, h)
      ctx.fillStyle = NEON.bank
      ctx.fillRect(0, 0, w, 50)
      text(ctx, 'RAIFFEISEN', 20, 34, 22, '#05060c', { weight: 800, spacing: 3 })
      if (blink(t, 1.6)) text(ctx, 'INSERT CARD', w / 2, h * 0.58, 30, NEON.bank, { weight: 700, align: 'center', spacing: 4 })
      text(ctx, clock(), w / 2, h - 28, 20, 'rgba(244,246,255,0.7)', { align: 'center' })
      crt(ctx, w, h)
    },
  },

  // The queue counter: a number that moves on every few seconds.
  ticketScreen: {
    w: 280,
    h: 200,
    fps: 1,
    paint(ctx, w, h, t) {
      ground(ctx, w, h, '#0b0906')
      text(ctx, 'NOW SERVING', w / 2, 46, 18, NEON.bank, { weight: 700, align: 'center', spacing: 3 })
      const number = 42 + (Math.floor(t / 5) % 58)
      text(ctx, String(number).padStart(3, '0'), w / 2, 138, 84, NEON.red, { weight: 800, align: 'center' })
      text(ctx, `TELLER ${1 + (number % 3)}`, w / 2, 176, 16, 'rgba(244,246,255,0.7)', { align: 'center', spacing: 2 })
      crt(ctx, w, h)
    },
  },

  // The café's menu board, with the tricolore across the top.
  milanoScreen: {
    w: 512,
    h: 326,
    fps: 1,
    paint(ctx, w, h, t) {
      ground(ctx, w, h, '#0a0808')
      ;['#009246', '#f4f6ff', '#ce2b37'].forEach((colour, i) => {
        ctx.fillStyle = colour
        ctx.fillRect((w / 3) * i, 0, w / 3, 10)
      })
      text(ctx, 'CAFFÈ · MENÙ', 28, 56, 26, NEON.white, { weight: 700, spacing: 3 })
      const items: [string, string][] = [
        ['CAFFÈ', '1.20'],
        ['CAPPUCCINO', '1.60'],
        ['SPRITZ', '5.00'],
        ['PANINO', '4.50'],
        ['GELATO', '2.50'],
      ]
      items.forEach(([name, price], i) => {
        const y = 106 + i * 40
        text(ctx, name, 28, y, 22, NEON.warm, { family: SANS, weight: 600 })
        ctx.fillStyle = 'rgba(255,255,255,0.18)'
        ctx.fillRect(28, y + 8, w - 56, 1)
        text(ctx, `€ ${price}`, w - 28, y, 22, NEON.white, { align: 'right' })
      })
      if (blink(t, 2)) {
        ctx.fillStyle = '#009246'
        ctx.fillRect(w - 118, 30, 90, 30)
        text(ctx, 'APERTO', w - 73, 51, 15, '#f4f6ff', { weight: 800, align: 'center', spacing: 2 })
      }
      crt(ctx, w, h)
    },
  },

  // The pharmacy's counter display: cross, time and temperature by turns.
  pharmaScreen: {
    w: 460,
    h: 300,
    fps: 1,
    paint(ctx, w, h, t) {
      ground(ctx, w, h, '#050a07')
      ctx.fillStyle = NEON.green
      ctx.fillRect(52, 120, 96, 30)
      ctx.fillRect(85, 87, 30, 96)
      const showTime = Math.floor(t / 3) % 2 === 0
      text(ctx, showTime ? clock() : '24 °C', 190, 158, 64, NEON.green, { weight: 700 })
      text(ctx, 'FARMACIA', 190, 205, 18, 'rgba(244,246,255,0.7)', { spacing: 4 })
      text(ctx, showTime ? 'ORA' : 'TEMP', w - 40, 60, 16, NEON.green, { align: 'right', spacing: 3 })
      crt(ctx, w, h)
    },
  },

  // The chalk board at the garage door. Chalk does not blink.
  easelFrontGraphic: {
    w: 384,
    h: 500,
    fps: 0,
    scale: 2,
    paint(ctx, w, h) {
      ground(ctx, w, h, '#151516')
      ctx.strokeStyle = '#e8e2c8'
      ctx.lineWidth = 4
      ctx.strokeRect(14, 14, w - 28, h - 28)
      text(ctx, 'OGGI', w / 2, 90, 54, '#e8e2c8', { family: SANS, weight: 700, align: 'center' })
      const lines = ['CAMBIO OLIO  49€', 'GOMME  25€', 'FRENI  check', 'REVISIONE  89€']
      lines.forEach((line, i) => text(ctx, line, w / 2, 170 + i * 62, 28, '#e8e2c8', { family: SANS, align: 'center' }))
      text(ctx, 'APERTO 24h', w / 2, 440, 32, NEON.pink, { family: SANS, weight: 700, align: 'center' })
    },
  },

  // The beach bar's board: what the bar sells, from its own site.
  barScreen: {
    w: 512,
    h: 384,
    fps: 1,
    paint(ctx, w, h, t) {
      ground(ctx, w, h, '#0c0806')
      text(ctx, 'BAR MARTIRI', w / 2, 66, 40, NEON.orange, { family: SANS, weight: 800, align: 'center' })
      text(ctx, 'SPILLE', w / 2, 100, 20, NEON.blue, { align: 'center', spacing: 6 })
      const lines: [string, string][] = [
        ['GELATO ARTIGIANALE', ''],
        ['SPRITZ', ''],
        ['KAFE', ''],
        ['SHEZLONE', '700 ALL'],
      ]
      lines.forEach(([name, price], i) => {
        const y = 160 + i * 46
        text(ctx, name, 36, y, 22, NEON.warm, { family: SANS, weight: 600 })
        if (price) text(ctx, price, w - 36, y, 22, NEON.white, { align: 'right' })
      })
      if (blink(t, 1.8)) text(ctx, 'OPEN', w / 2, h - 30, 24, NEON.green, { weight: 800, align: 'center', spacing: 5 })
      crt(ctx, w, h)
    },
  },

  // The cash machine outside, before anyone walks up to it.
  atmOutScreen: {
    w: 460,
    h: 340,
    fps: 2,
    scale: 2,
    paint(ctx, w, h, t) {
      ground(ctx, w, h, '#0b0b0d')
      ctx.fillStyle = NEON.bank
      ctx.fillRect(0, 0, w, 56)
      text(ctx, 'RAIFFEISEN BANK', 22, 38, 22, '#0b0b0d', { weight: 800, spacing: 3 })
      text(ctx, 'BANKOMAT 24h', w - 22, 38, 16, '#0b0b0d', { align: 'right', spacing: 2 })
      if (blink(t, 1.6)) text(ctx, 'INSERT CARD', w / 2, h * 0.56, 34, NEON.bank, { weight: 700, align: 'center', spacing: 5 })
      text(ctx, 'EN · IT · SQ', w / 2, h * 0.7, 16, 'rgba(244,246,255,0.55)', { align: 'center', spacing: 3 })
      text(ctx, clock(), w / 2, h - 30, 22, 'rgba(244,246,255,0.75)', { align: 'center' })
      crt(ctx, w, h)
    },
  },
}
