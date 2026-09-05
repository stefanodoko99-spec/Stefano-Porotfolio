import { CanvasTexture, LinearFilter, MathUtils, MeshBasicMaterial, NearestFilter, SRGBColorSpace } from 'three'

import { CONTENT, LABELS } from '../content'

/**
 * The twelve screens on the shop, each a canvas painted here and shown on a
 * plane the model carries by name. Some hold pages (the big screen's about
 * pages, the vending machine's project posters, the arcade's credits); some
 * are buttons while the camera is close (the three small screens under the
 * big one); the rest just play — a ticker, a synthwave horizon, falling
 * katakana, a clock, static. Animated screens redraw at their own pace, not
 * every frame.
 */
export type ScreenName =
  | 'bigScreen'
  | 'tickerScreen'
  | 'smallScreen1'
  | 'smallScreen2'
  | 'smallScreen3'
  | 'smallScreen4'
  | 'tallScreen'
  | 'smallScreen5'
  | 'tvScreen'
  | 'littleTvScreen'
  | 'arcadeScreen'
  | 'vendScreen'
  | 'monHScreenL'
  | 'monHScreenR'
  | 'monVScreenL'
  | 'monVScreenR'
  | 'monCScreenL0'
  | 'monCScreenL1'
  | 'monCScreenL2'
  | 'monCScreenR0'
  | 'monCScreenR1'
  | 'monCScreenR2'

export type AboutPage = 'intro' | 'skills' | 'process'

export type Screens = {
  material: (name: string) => MeshBasicMaterial | null
  update: (t: number) => void
  setAboutPage: (page: AboutPage) => void
  setProject: (index: number) => void
  setCreditsPage: (index: number) => void
  setButtons: (on: boolean) => void
  setHover: (name: string | null) => void
  readonly project: number
  readonly creditsPage: number
  readonly aboutPage: AboutPage
}

const FONT = "'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif"
const PIXEL = "'Consolas', 'Courier New', monospace"
const KANA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン'

class Screen {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  texture: CanvasTexture
  material: MeshBasicMaterial
  last = -1
  constructor(public w: number, public h: number, pixel = false) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = w
    this.canvas.height = h
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D
    this.texture = new CanvasTexture(this.canvas)
    this.texture.colorSpace = SRGBColorSpace
    this.texture.flipY = false
    this.texture.generateMipmaps = false
    this.texture.minFilter = LinearFilter
    this.texture.magFilter = pixel ? NearestFilter : LinearFilter
    this.material = new MeshBasicMaterial({ map: this.texture, toneMapped: false })
  }
  /** redraw at most `fps` times a second; returns whether it is time */
  due(t: number, fps: number): boolean {
    if (t - this.last < 1 / fps) return false
    this.last = t
    return true
  }
  done(): void {
    this.texture.needsUpdate = true
  }
}

/** Break text into lines no wider than maxWidth; a single word wider than that is broken mid-word. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  const flush = () => {
    if (line) lines.push(line)
    line = ''
  }
  for (const word of text.split(' ')) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width <= maxWidth) {
      line = test
      continue
    }
    flush()
    if (ctx.measureText(word).width <= maxWidth) {
      line = word
      continue
    }
    for (const ch of graphemes(word)) {
      if (ctx.measureText(line + ch).width > maxWidth) flush()
      line += ch
    }
  }
  flush()
  return lines
}

/** the user-perceived characters of a word, so a break never lands inside an emoji or a combining mark */
function graphemes(word: string): string[] {
  if ('Segmenter' in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word)].map((s) => s.segment)
  }
  return [...word]
}

/** roundRect with a plain rectangle behind it for browsers that lack it */
function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
  ctx.fill()
}

function sunburst(ctx: CanvasRenderingContext2D, w: number, h: number, a: string, b: string, rays = 18, spin = 0): void {
  ctx.save()
  ctx.fillStyle = a
  ctx.fillRect(0, 0, w, h)
  ctx.translate(w / 2, h / 2)
  ctx.rotate(spin)
  ctx.fillStyle = b
  const r = Math.hypot(w, h)
  for (let i = 0; i < rays; i++) {
    const a0 = (i / rays) * Math.PI * 2
    const a1 = a0 + Math.PI / rays
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.arc(0, 0, r, a0, a1)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, ink: string, text: string, font: string): void {
  ctx.save()
  ctx.fillStyle = fill
  rrect(ctx, x, y, w, h, h / 2)
  ctx.fillStyle = ink
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + w / 2, y + h / 2 + 1)
  ctx.restore()
}

function scanlines(ctx: CanvasRenderingContext2D, w: number, h: number, alpha = 0.12): void {
  ctx.fillStyle = `rgba(0,0,0,${alpha})`
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 2)
}

export function createScreens(): Screens {
  const S: Record<ScreenName, Screen> = {
    bigScreen: new Screen(1024, 624),
    tickerScreen: new Screen(384, 72, true),
    smallScreen1: new Screen(384, 320),
    smallScreen2: new Screen(384, 320),
    smallScreen3: new Screen(384, 320),
    smallScreen4: new Screen(192, 160, true),
    tallScreen: new Screen(192, 280, true),
    smallScreen5: new Screen(384, 320),
    tvScreen: new Screen(384, 176, true),
    littleTvScreen: new Screen(96, 46, true),
    arcadeScreen: new Screen(256, 204, true),
    vendScreen: new Screen(512, 768),
    // the terrace's two flanking "gaming monitor" towers — a horizontal
    // benchmark-style readout on the bottom monitor of each, a scrolling
    // chat feed on the vertical one above it
    monHScreenL: new Screen(384, 192, true),
    monHScreenR: new Screen(384, 192, true),
    monVScreenL: new Screen(216, 488, true),
    monVScreenR: new Screen(216, 488, true),
    // the curved triple-monitor surrounds: a test-pattern sweep, one canvas
    // per fanned segment
    monCScreenL0: new Screen(160, 192, true),
    monCScreenL1: new Screen(160, 192, true),
    monCScreenL2: new Screen(160, 192, true),
    monCScreenR0: new Screen(160, 192, true),
    monCScreenR1: new Screen(160, 192, true),
    monCScreenR2: new Screen(160, 192, true),
  }
  const state = { aboutPage: 'intro' as AboutPage, project: 0, creditsPage: 0, buttons: false, hover: null as string | null }

  // ---- the big screen: about pages
  function drawBig(): void {
    const s = S.bigScreen
    const { ctx, w, h } = s
    sunburst(ctx, w, h, '#33e2ff', '#5cf0ff', 22)
    ctx.fillStyle = 'rgba(30, 10, 80, 0.86)'
    rrect(ctx, 60, 56, w - 120, h - 112, 28)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    if (state.aboutPage === 'intro') {
      ctx.fillStyle = '#ff9a2a'
      ctx.font = `800 64px ${FONT}`
      ctx.fillText(CONTENT.name, 110, 150)
      ctx.fillStyle = '#5cf0ff'
      ctx.font = `700 26px ${FONT}`
      ctx.fillText(CONTENT.about.headline.toUpperCase(), 112, 196)
      ctx.fillStyle = '#f4f2ff'
      ctx.font = `400 28px ${FONT}`
      let y = 260
      for (const p of CONTENT.about.intro) {
        for (const line of wrap(ctx, p, w - 240)) {
          ctx.fillText(line, 112, y)
          y += 38
        }
        y += 18
      }
      ctx.fillStyle = 'rgba(244,242,255,0.7)'
      ctx.font = `600 20px ${FONT}`
      ctx.fillText(CONTENT.roles.join('  ·  '), 112, h - 96)
    } else if (state.aboutPage === 'skills') {
      ctx.fillStyle = '#ff9a2a'
      ctx.font = `800 52px ${FONT}`
      ctx.fillText('Capabilities', 110, 140)
      const cols = CONTENT.about.skills
      const cw = (w - 220) / cols.length
      cols.forEach((col, i) => {
        const x = 110 + i * cw
        ctx.fillStyle = '#5cf0ff'
        ctx.font = `700 22px ${FONT}`
        ctx.textAlign = 'left'
        ctx.fillText(col.group.toUpperCase(), x, 200)
        col.items.forEach((item, j) => {
          pill(ctx, x, 222 + j * 50, Math.min(cw - 30, 250), 40, 'rgba(92,240,255,0.16)', '#f4f2ff', item, `600 20px ${FONT}`)
        })
      })
    } else {
      // how the work runs: his intro line, then five passes, in order, each with its own line
      ctx.fillStyle = '#ff9a2a'
      ctx.font = `800 40px ${FONT}`
      ctx.fillText('How the work runs', 110, 116)
      ctx.fillStyle = '#5cf0ff'
      ctx.font = `600 17px ${FONT}`
      ctx.fillText(CONTENT.about.processIntro, 110, 144)
      CONTENT.about.process.forEach((row, i) => {
        const y = 190 + i * 76
        ctx.textAlign = 'left'
        ctx.fillStyle = '#5cf0ff'
        ctx.font = `700 17px ${FONT}`
        ctx.fillText(row.step, 110, y)
        ctx.fillStyle = '#f4f2ff'
        ctx.font = `700 25px ${FONT}`
        ctx.fillText(row.label, 146, y + 1)
        ctx.fillStyle = 'rgba(244,242,255,0.8)'
        ctx.font = `400 17px ${FONT}`
        wrap(ctx, row.body, w - 400).slice(0, 3).forEach((line, k) => ctx.fillText(line, 290, y - 10 + k * 21))
        ctx.fillStyle = 'rgba(92,240,255,0.22)'
        ctx.fillRect(110, y + 54, w - 220, 1)
      })
    }
    s.done()
  }

  // ---- the three small screens: art at rest, buttons up close
  const ART = [
    { a: '#ff2f9c', b: '#7a3cff', sun: '#ffd23a' },
    { a: '#28e7ff', b: '#1b3ab0', sun: '#f4f2ff' },
    { a: '#ff8c2a', b: '#a6202c', sun: '#ffe3a8' },
  ]
  // smallScreen3 is the leftmost on the shelf, smallScreen1 the rightmost: read left to right
  const BUTTONS: { name: ScreenName; label: string; page: AboutPage | 'back' }[] = [
    { name: 'smallScreen1', label: 'back', page: 'back' },
    { name: 'smallScreen2', label: 'process', page: 'process' },
    { name: 'smallScreen3', label: 'skills', page: 'skills' },
  ]
  function drawSmall(i: number): void {
    const s = S[BUTTONS[i].name]
    const { ctx, w, h } = s
    if (state.buttons) {
      const hot = state.hover === `hit_small${i + 1}`
      const active = BUTTONS[i].page === state.aboutPage
      sunburst(ctx, w, h, hot || active ? '#ff9a2a' : '#1a1050', hot || active ? '#ffb457' : '#251a66', 14)
      ctx.fillStyle = hot || active ? '#1a1050' : '#5cf0ff'
      ctx.font = `800 54px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(BUTTONS[i].label, w / 2, h / 2)
      ctx.font = `600 18px ${FONT}`
      ctx.fillStyle = hot || active ? 'rgba(26,16,80,0.7)' : 'rgba(92,240,255,0.6)'
      ctx.fillText(BUTTONS[i].page === 'back' ? '← leave the counter' : 'click to read', w / 2, h / 2 + 52)
    } else {
      const art = ART[i]
      const g = ctx.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, art.b)
      g.addColorStop(1, art.a)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = art.sun
      ctx.beginPath()
      ctx.arc(w * (0.3 + i * 0.2), h * 0.42, 62, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(20,10,60,0.85)'
      for (let k = 0; k < 4; k++) {
        ctx.beginPath()
        ctx.moveTo(-40 + k * 120, h)
        ctx.lineTo(20 + k * 120, h * (0.55 + (k % 2) * 0.12))
        ctx.lineTo(90 + k * 120, h)
        ctx.closePath()
        ctx.fill()
      }
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.font = `700 20px ${FONT}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(['beach', 'night', 'spille'][i].toUpperCase(), 20, h - 22)
    }
    scanlines(ctx, w, h, 0.08)
    s.done()
  }

  // ---- the vending machine: one project poster at a time
  function drawVend(): void {
    const s = S.vendScreen
    const { ctx, w, h } = s
    const p = CONTENT.projects[state.project]
    if (!p) {
      sunburst(ctx, w, h, '#2a1a66', '#3a2a80', 20)
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.font = `700 26px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('sold out', w / 2, h / 2)
      s.done()
      return
    }
    sunburst(ctx, w, h, p.colours[0], shade(p.colours[0], 0.82), 20)
    // the mark on a disc of the site's own dark ground, and its words on a panel of the same,
    // so the ink reads on the sunburst whatever the site's accent colour is
    const ground = p.colours[1]
    ctx.fillStyle = ground
    ctx.beginPath()
    ctx.arc(w / 2, h * 0.28, 128, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#f4f2ff'
    ctx.font = `900 116px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(p.mark, w / 2, h * 0.28 + 6)
    // measure the words first, then paint the panel, then the words
    ctx.textBaseline = 'alphabetic'
    ctx.font = `900 38px ${FONT}`
    const titleLines = wrap(ctx, p.title, w - 110)
    ctx.font = `500 19px ${FONT}`
    const lines = wrap(ctx, p.blurb, w - 120).slice(0, 6)
    const tagFont = `600 15px ${FONT}`
    ctx.font = tagFont
    const rows: { tag: string; width: number }[][] = [[]]
    for (const tag of p.tags) {
      const width = Math.ceil(ctx.measureText(tag).width) + 24
      const row = rows[rows.length - 1]
      const used = row.reduce((sum, t) => sum + t.width + 8, 0)
      if (row.length && used + width > w - 100) rows.push([{ tag, width }])
      else row.push({ tag, width })
    }
    const shownRows = rows.slice(0, 3)
    const titleTop = h * 0.47
    const blurbTop = titleTop + (titleLines.length - 1) * 44 + 34
    const tagsTop = blurbTop + lines.length * 25 + 12
    const panelBottom = tagsTop + shownRows.length * 36 + 4
    ctx.fillStyle = ground
    ctx.globalAlpha = 0.82
    rrect(ctx, 34, titleTop - 44, w - 68, panelBottom - (titleTop - 44), 20)
    ctx.globalAlpha = 1
    ctx.fillStyle = '#ffffff'
    ctx.font = `900 38px ${FONT}`
    ctx.textAlign = 'center'
    titleLines.forEach((line, k) => ctx.fillText(line, w / 2, titleTop + k * 44))
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.font = `500 19px ${FONT}`
    lines.forEach((line, k) => ctx.fillText(line, w / 2, blurbTop + k * 25))
    let tagsY = tagsTop
    for (const row of shownRows) {
      const total = row.reduce((sum, t) => sum + t.width + 8, -8)
      let x = w / 2 - total / 2
      for (const t of row) {
        pill(ctx, x, tagsY, t.width, 28, 'rgba(255,255,255,0.16)', '#fff', t.tag, tagFont)
        x += t.width + 8
      }
      tagsY += 36
    }
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    ctx.font = `700 18px ${FONT}`
    ctx.textAlign = 'center'
    // where the click goes, by name
    const host = p.url ? p.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : ''
    ctx.fillText(p.url ? `▶  OPEN ${host.toUpperCase()}` : `${state.project + 1} / ${CONTENT.projects.length}`, w / 2, h - 34)
    ctx.textAlign = 'left'
    ctx.font = `800 22px ${FONT}`
    ctx.fillText(`${state.project + 1}/${CONTENT.projects.length}`, 24, 40)
    // a vertical word down the side, the way the machine's posters have one
    ctx.save()
    ctx.translate(w - 40, 70)
    ctx.fillStyle = p.colours[1]
    ctx.font = `900 46px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const [k, ch] of [...LABELS.kanji].entries()) ctx.fillText(ch, 0, k * 52)
    ctx.restore()
    s.done()
  }

  // ---- the arcade: credits pages in pixels
  function drawArcade(): void {
    const s = S.arcadeScreen
    const { ctx, w, h } = s
    ctx.fillStyle = '#1a0a4a'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = 'rgba(122,60,255,0.6)'
    ctx.lineWidth = 1
    for (let x = 0; x <= w; x += 16) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
    }
    for (let y = 0; y <= h; y += 16) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }
    ctx.font = `700 9px ${PIXEL}`
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#ff4a5a'
    ctx.textAlign = 'left'
    ctx.fillText('SCORE', 14, 18)
    ctx.textAlign = 'center'
    ctx.fillText('HIGH SCORE', w / 2, 18)
    ctx.textAlign = 'right'
    ctx.fillText('LEVEL', w - 14, 18)
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'left'
    ctx.fillText('0000', 14, 30)
    ctx.textAlign = 'center'
    ctx.fillText('0000', w / 2, 30)
    ctx.textAlign = 'right'
    ctx.fillText(String(state.creditsPage + 1).padStart(4, '0'), w - 14, 30)
    const page = CONTENT.credits[state.creditsPage] ?? { title: 'Insert coin', lines: [] }
    const g = ctx.createLinearGradient(0, 70, 0, 100)
    g.addColorStop(0, '#ffd23a')
    g.addColorStop(0.5, '#ff8c2a')
    g.addColorStop(1, '#ff2f9c')
    ctx.fillStyle = g
    ctx.font = `900 26px ${PIXEL}`
    ctx.textAlign = 'center'
    ctx.fillText(page.title.toUpperCase(), w / 2, 92)
    ctx.fillStyle = '#ffffff'
    ctx.font = `700 9px ${PIXEL}`
    page.lines.forEach((line, k) => ctx.fillText(line.toUpperCase(), w / 2, 122 + k * 16))
    ctx.fillStyle = '#5cf0ff'
    ctx.fillText('CLICK TO CONTINUE', w / 2, h - 16)
    s.done()
  }

  // ---- the animated ones
  // the ticker's text never changes, so its parts are measured once, on the first draw
  const TICKER_FONT = `700 30px ${PIXEL}`
  let tickerParts: { text: string; width: number; down: boolean }[] | null = null
  let tickerDot = 0
  let tickerWidth = 0
  function drawTicker(t: number): void {
    const s = S.tickerScreen
    const { ctx, w, h } = s
    ctx.fillStyle = '#050509'
    ctx.fillRect(0, 0, w, h)
    ctx.font = TICKER_FONT
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    if (!tickerParts) {
      tickerParts = CONTENT.ticker.map((item) => {
        const text = `   ${item}   `
        return { text, width: ctx.measureText(text).width, down: item.includes('▼') }
      })
      tickerDot = ctx.measureText('•').width
      tickerWidth = tickerParts.reduce((sum, p) => sum + p.width + tickerDot, 0) + 60
    }
    const x = -((t * 60) % tickerWidth)
    for (let k = 0; k < 2; k++) {
      let cursor = x + k * tickerWidth
      for (const part of tickerParts) {
        ctx.fillStyle = part.down ? '#ff4a5a' : '#5cff8a'
        ctx.fillText(part.text, cursor, h / 2)
        cursor += part.width
        ctx.fillStyle = '#5cf0ff'
        ctx.fillText('•', cursor, h / 2)
        cursor += tickerDot
      }
    }
    // the dot-matrix
    ctx.fillStyle = 'rgba(5,5,9,0.55)'
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1)
    for (let x2 = 0; x2 < w; x2 += 3) ctx.fillRect(x2, 0, 1, h)
    s.done()
  }

  function drawTv(t: number): void {
    const s = S.tvScreen
    const { ctx, w, h } = s
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, '#12063a')
    g.addColorStop(0.6, '#5a1aa0')
    g.addColorStop(1, '#ff2f9c')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    // the sun with its stripes
    const cx = w / 2
    const cy = h * 0.55
    const r = 52
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.clip()
    const sg = ctx.createLinearGradient(0, cy - r, 0, cy + r)
    sg.addColorStop(0, '#ffd23a')
    sg.addColorStop(1, '#ff2f9c')
    ctx.fillStyle = sg
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
    ctx.fillStyle = '#12063a'
    for (let k = 0; k < 6; k++) ctx.fillRect(cx - r, cy + 4 + k * 9 + ((t * 8) % 9), r * 2, 2 + k)
    ctx.restore()
    // the horizon and the grid rolling toward the viewer
    ctx.fillStyle = '#12063a'
    ctx.fillRect(0, cy + 6, w, h)
    ctx.strokeStyle = '#3cf5ff'
    ctx.lineWidth = 1
    for (let k = -8; k <= 8; k++) {
      ctx.beginPath()
      ctx.moveTo(cx + k * 12, cy + 6)
      ctx.lineTo(cx + k * 110, h)
      ctx.stroke()
    }
    for (let k = 0; k < 8; k++) {
      const p = ((k + (t * 0.6) % 1) / 8) ** 2
      const y = cy + 6 + p * (h - cy - 6)
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }
    // mountains
    ctx.fillStyle = '#1a0a4a'
    ctx.beginPath()
    ctx.moveTo(0, cy + 6)
    for (let x = 0; x <= w; x += 24) ctx.lineTo(x, cy + 6 - Math.abs(Math.sin(x * 0.05 + 1)) * 34 - (x > w / 2 - 70 && x < w / 2 + 70 ? 0 : 8))
    ctx.lineTo(w, cy + 6)
    ctx.closePath()
    ctx.fill()
    scanlines(ctx, w, h, 0.18)
    s.done()
  }

  const rain = Array.from({ length: 12 }, (_, i) => ({ x: i * 16, y: Math.random() * 280, speed: 40 + Math.random() * 60 }))
  function drawRain(t: number, dt: number): void {
    const s = S.tallScreen
    const { ctx, w, h } = s
    ctx.fillStyle = 'rgba(2, 8, 14, 0.28)'
    ctx.fillRect(0, 0, w, h)
    ctx.font = `700 14px ${PIXEL}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    for (const drop of rain) {
      drop.y += drop.speed * dt
      if (drop.y > h + 20) {
        drop.y = -Math.random() * 120
        drop.speed = 40 + Math.random() * 60
      }
      ctx.fillStyle = '#c8fbff'
      ctx.fillText(KANA[Math.floor((t * 9 + drop.x) % KANA.length)], drop.x + 2, drop.y)
      ctx.fillStyle = '#3cf5ff'
      ctx.fillText(KANA[Math.floor((t * 5 + drop.x * 3) % KANA.length)], drop.x + 2, drop.y - 16)
    }
    s.done()
  }

  function drawBars(t: number): void {
    const s = S.smallScreen4
    const { ctx, w, h } = s
    const cols = ['#ff2f9c', '#ff8c2a', '#ffd23a', '#41ff8f', '#28e7ff', '#7a3cff']
    const bw = w / cols.length
    cols.forEach((c, k) => {
      ctx.fillStyle = c
      ctx.fillRect(k * bw, 0, bw + 1, h)
    })
    const band = ((t * 40) % (h + 40)) - 20
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.fillRect(0, band, w, 6)
    ctx.fillStyle = '#050509'
    ctx.fillRect(0, h - 30, w, 30)
    ctx.fillStyle = '#5cff8a'
    ctx.font = `700 11px ${PIXEL}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(`CH 04  ${LABELS.shop}`, 8, h - 15)
    ctx.fillStyle = Math.floor(t * 2) % 2 ? '#ff4a5a' : '#050509'
    ctx.beginPath()
    ctx.arc(w - 14, h - 15, 4, 0, Math.PI * 2)
    ctx.fill()
    s.done()
  }

  function drawClock(): void {
    const s = S.smallScreen5
    const { ctx, w, h } = s
    ctx.fillStyle = '#07070d'
    ctx.fillRect(0, 0, w, h)
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const ss = String(now.getSeconds()).padStart(2, '0')
    ctx.fillStyle = '#3cf5ff'
    ctx.font = `700 92px ${PIXEL}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${hh}:${mm}`, w / 2, h / 2 - 16)
    ctx.fillStyle = '#ff2f9c'
    ctx.font = `700 30px ${PIXEL}`
    ctx.fillText(ss, w / 2, h / 2 + 62)
    ctx.fillStyle = 'rgba(60,245,255,0.55)'
    ctx.font = `700 16px ${PIXEL}`
    ctx.fillText(now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase(), w / 2, 30)
    scanlines(ctx, w, h, 0.15)
    s.done()
  }

  function drawMonH(s: Screen, t: number): void {
    const { ctx, w, h } = s
    ctx.fillStyle = '#05070d'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = 'rgba(60,245,255,0.35)'
    ctx.lineWidth = 1
    for (let x = 0; x <= w; x += 16) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.strokeStyle = '#5cff8a'
    ctx.lineWidth = 3
    for (let x = 0; x <= w; x += 4) {
      const y = h * 0.68 + Math.sin(x * 0.05 + t * 3) * h * 0.12 + Math.sin(x * 0.13 + t * 5) * h * 0.05
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.fillStyle = '#f4f2ff'
    ctx.font = `700 ${Math.round(h * 0.16)}px ${PIXEL}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    const fps = 120 + Math.floor(Math.sin(t * 0.7) * 8)
    ctx.fillText(`${fps} FPS`, w * 0.04, h * 0.06)
    ctx.fillStyle = 'rgba(92,240,255,0.75)'
    ctx.font = `600 ${Math.round(h * 0.09)}px ${PIXEL}`
    ctx.fillText('1MS · 144HZ', w * 0.04, h * 0.3)
    s.done()
  }

  const CHAT = ['viewer99: hype', 'gg_stef: nice save', 'anon: lol', 'p1xel: clip that', 'devfan: let’s go', 'guest42: first time here']
  function drawMonV(s: Screen, t: number, phase: number): void {
    const { ctx, w, h } = s
    ctx.fillStyle = '#0a0716'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(255,138,42,0.9)'
    ctx.font = `700 ${Math.round(w * 0.11)}px ${PIXEL}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText('LIVE CHAT', w * 0.06, h * 0.05)
    const lineH = h * 0.055
    const total = CHAT.length * lineH * 2
    const scrollY = ((t + phase) * h * 0.05) % total
    ctx.font = `600 ${Math.round(lineH * 0.6)}px ${PIXEL}`
    for (let i = 0; i < CHAT.length * 2; i++) {
      const y = h - (scrollY - i * lineH)
      if (y < lineH || y > h + lineH) continue
      ctx.fillStyle = i % 2 ? 'rgba(92,240,255,0.85)' : 'rgba(244,242,255,0.85)'
      ctx.fillText(CHAT[i % CHAT.length], w * 0.06, y)
    }
    s.done()
  }

  const BAR_COLORS = ['#ff2f9c', '#ff8c2a', '#ffd23a', '#41ff8f', '#28e7ff', '#7a3cff']
  function drawMonC(s: Screen, t: number, phase: number): void {
    const { ctx, w, h } = s
    const bw = w / BAR_COLORS.length
    BAR_COLORS.forEach((c, k) => {
      ctx.fillStyle = c
      ctx.fillRect(k * bw, 0, bw + 1, h)
    })
    const sweepY = ((t + phase) * h * 0.3) % (h * 1.4) - h * 0.2
    const grad = ctx.createLinearGradient(0, sweepY - 30, 0, sweepY + 30)
    grad.addColorStop(0, 'rgba(255,255,255,0)')
    grad.addColorStop(0.5, 'rgba(255,255,255,0.4)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, sweepY - 30, w, 60)
    ctx.fillStyle = '#050509'
    ctx.fillRect(0, h - 24, w, 24)
    ctx.fillStyle = '#5cf0ff'
    ctx.font = `700 ${Math.round((h - 24) * 0.5)}px ${PIXEL}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('TEST PATTERN', w / 2, h - 12)
    s.done()
  }

  const staticImage = S.littleTvScreen.ctx.createImageData(S.littleTvScreen.w, S.littleTvScreen.h)
  function drawStatic(): void {
    const s = S.littleTvScreen
    const { ctx } = s
    const img = staticImage
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 200 + 30
      img.data[i] = v * 0.8
      img.data[i + 1] = v
      img.data[i + 2] = v
      img.data[i + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    s.done()
  }

  function shade(hex: string, k: number): string {
    const n = parseInt(hex.slice(1), 16)
    const r = Math.round(((n >> 16) & 255) * k)
    const g = Math.round(((n >> 8) & 255) * k)
    const b = Math.round((n & 255) * k)
    return `rgb(${r},${g},${b})`
  }

  const redrawSmalls = () => {
    for (let i = 0; i < 3; i++) drawSmall(i)
  }
  drawBig()
  redrawSmalls()
  drawVend()
  drawArcade()
  drawClock()
  drawMonH(S.monHScreenL, 0)
  drawMonH(S.monHScreenR, 0)
  drawMonV(S.monVScreenL, 0, 0)
  drawMonV(S.monVScreenR, 0, 3)
  const MON_C: ScreenName[] = ['monCScreenL0', 'monCScreenL1', 'monCScreenL2', 'monCScreenR0', 'monCScreenR1', 'monCScreenR2']
  MON_C.forEach((name, i) => drawMonC(S[name], 0, i * 0.6))
  let rainAt = 0

  return {
    material(name) {
      return (S as Record<string, Screen>)[name]?.material ?? null
    },
    update(t) {
      if (S.tickerScreen.due(t, 30)) drawTicker(t)
      if (S.tvScreen.due(t, 20)) drawTv(t)
      if (S.tallScreen.due(t, 15)) {
        drawRain(t, Math.min(0.25, t - rainAt))
        rainAt = t
      }
      if (S.smallScreen4.due(t, 12)) drawBars(t)
      if (S.smallScreen5.due(t, 1)) drawClock()
      if (S.monHScreenL.due(t, 12)) drawMonH(S.monHScreenL, t)
      if (S.monHScreenR.due(t, 12)) drawMonH(S.monHScreenR, t)
      if (S.monVScreenL.due(t, 12)) drawMonV(S.monVScreenL, t, 0)
      if (S.monVScreenR.due(t, 12)) drawMonV(S.monVScreenR, t, 3)
      MON_C.forEach((name, i) => {
        if (S[name].due(t, 10)) drawMonC(S[name], t, i * 0.6)
      })
      if (S.littleTvScreen.due(t, 12)) drawStatic()
    },
    setAboutPage(page) {
      state.aboutPage = page
      drawBig()
      redrawSmalls()
    },
    setProject(index) {
      const n = CONTENT.projects.length
      if (n) state.project = MathUtils.euclideanModulo(index, n)
      drawVend()
    },
    setCreditsPage(index) {
      const n = CONTENT.credits.length
      if (n) state.creditsPage = MathUtils.euclideanModulo(index, n)
      drawArcade()
    },
    setButtons(on) {
      if (state.buttons === on) return
      state.buttons = on
      redrawSmalls()
    },
    setHover(name) {
      if (state.hover === name) return
      const before = state.hover
      state.hover = name
      if (!state.buttons) return
      for (let i = 0; i < 3; i++) {
        const id = `hit_small${i + 1}`
        if (id === before || id === name) drawSmall(i)
      }
    },
    get project() {
      return state.project
    },
    get creditsPage() {
      return state.creditsPage
    },
    get aboutPage() {
      return state.aboutPage
    },
  }
}
