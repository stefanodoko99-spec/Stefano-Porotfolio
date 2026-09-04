import { CONTENT, LABELS } from '../content'
import type { Mode } from '../interaction'

/**
 * What sits over the canvas. The reference has nothing at all: every control
 * is a thing in the world. This keeps that, and adds only what a keyboard or a
 * screen reader needs — a row of small links for the four signs, a Back
 * control that appears once the camera has gone somewhere, and a hint — all
 * quiet, in the corners.
 */
export type Hud = {
  show: () => void
  setMode: (mode: Mode) => void
  setHint: (text: string) => void
}

export function createHud(callbacks: { onGo: (mode: Mode) => void; onBack: () => void }): Hud {
  const hud = document.getElementById('hud') as HTMLElement
  const name = document.getElementById('hud-name') as HTMLElement
  const back = document.getElementById('hud-back') as HTMLButtonElement
  const hint = document.getElementById('hud-hint') as HTMLElement
  const links = document.getElementById('hud-links') as HTMLElement
  name.textContent = CONTENT.name

  const entries: { label: string; mode?: Mode; href?: string }[] = [
    { label: LABELS.signs.projects, mode: 'projects' },
    { label: LABELS.signs.about, mode: 'about' },
    { label: LABELS.signs.contact, href: CONTENT.contactUrl },
    { label: LABELS.signs.credits, mode: 'credits' },
  ]
  // The nav is rebuilt, not added to. In the Vite build this ran once per page
  // load; mounted in React it runs again on every remount — StrictMode does one
  // in development on purpose — and appending without clearing left the visitor
  // looking at two of every link.
  links.replaceChildren()

  for (const entry of entries) {
    if (entry.href) {
      const a = document.createElement('a')
      a.href = entry.href
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.textContent = entry.label
      links.appendChild(a)
      continue
    }
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = entry.label
    b.dataset.mode = entry.mode
    b.addEventListener('click', () => callbacks.onGo(entry.mode as Mode))
    links.appendChild(b)
  }
  back.addEventListener('click', () => callbacks.onBack())
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Escape' && !back.hidden) callbacks.onBack()
  })

  return {
    show() {
      hud.hidden = false
    },
    setMode(mode) {
      back.hidden = mode === 'default'
      links.querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.mode === mode))
      })
    },
    setHint(text) {
      hint.textContent = text
    },
  }
}
