/**
 * The loading screen: black, a count in thin type, then START. Pressing it is
 * what starts the scene, the way the reference does it, so the first frame the
 * visitor sees is the camera already sweeping in.
 */
export type Loader = {
  step: (fraction: number) => void
  ready: () => Promise<void>
  fail: (message: string) => void
}

export function createLoader(): Loader {
  const root = document.getElementById('loader') as HTMLElement
  const count = document.getElementById('loader-count') as HTMLElement
  const bar = document.getElementById('loader-bar') as HTMLElement
  const start = document.getElementById('loader-start') as HTMLButtonElement
  const note = document.getElementById('loader-note') as HTMLElement

  // the count only ever goes up, whatever order the downloads land in
  let shown = 0
  return {
    step(fraction) {
      const pct = Math.max(shown, Math.round(Math.min(1, fraction) * 100))
      shown = pct
      count.textContent = `${pct}`
      bar.style.setProperty('--p', `${pct}%`)
    },
    ready() {
      count.hidden = true
      bar.hidden = true
      note.hidden = true
      start.hidden = false
      start.focus({ preventScroll: true })
      return new Promise<void>((resolve) => {
        const go = () => {
          root.dataset.gone = 'true'
          window.removeEventListener('keydown', onKey)
          setTimeout(() => root.remove(), 900)
          resolve()
        }
        const onKey = (event: KeyboardEvent) => {
          if (event.code === 'Enter' || event.code === 'Space') {
            event.preventDefault()
            go()
          }
        }
        start.addEventListener('click', go, { once: true })
        window.addEventListener('keydown', onKey)
      })
    },
    fail(message) {
      count.hidden = true
      bar.hidden = true
      note.hidden = false
      note.textContent = message
    },
  }
}
