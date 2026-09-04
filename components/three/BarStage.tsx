'use client'

/**
 * Bar Martiri, mounted into the page.
 *
 * The scene is the Vite project's own three.js, moved here unchanged apart
 * from where it finds its assets and how it stops. It is not React Three
 * Fiber and there is nothing to gain from making it so: it builds its own
 * renderer, composer and loop, and R3F would only wrap that in a second one.
 *
 * So this component's whole job is to be the page it used to have. The Vite
 * build shipped an index.html whose body held these ids, and the scene reaches
 * for them by name — `#app` to hang the canvas on, the loader, the HUD, and a
 * screen-reader section carrying the same words the screens inside the world
 * are painted with. Rendering them here, rather than letting the scene create
 * them, keeps them in React's tree where the rest of the page can see them.
 *
 * `startShop` is loaded on the client only. It pulls in three, a Draco
 * decoder, a composer and 3MB of atlases, none of which can run while the page
 * is being rendered on the server and none of which should be in the bundle a
 * visitor downloads before the first paint.
 */
import { useEffect } from 'react'

export function BarStage() {
  useEffect(() => {
    /*
     * StrictMode mounts, unmounts and mounts again in development, and a
     * guard against the second start is the wrong answer: the first mount's
     * cleanup has already torn the scene down, so skipping leaves a blank
     * page. What has to hold instead is that starting twice is safe — the
     * teardown below stops the loop and drops the context, and the scene's
     * own setup rebuilds rather than appends.
     *
     * The start is async, so an unmount can land before the scene exists.
     * `cancelled` covers that: whichever finishes last does the cleaning up.
     */
    let cancelled = false
    let stop: (() => void) | null = null

    import('./bar/main')
      .then(({ startShop }) => startShop())
      .then((dispose) => {
        if (cancelled) dispose()
        else stop = dispose
      })
      .catch((error: unknown) => {
        // The scene has its own failure copy in the loader; this is for the
        // case where the module itself never arrives.
        console.error('Bar Martiri failed to start', error)
      })

    return () => {
      cancelled = true
      stop?.()
    }
  }, [])

  return (
    <>
      <div id="app" />

      <div id="loader" className="loader" aria-live="polite">
        <p className="loader-count" id="loader-count">
          0
        </p>
        <div className="loader-bar" id="loader-bar" aria-hidden="true" />
        <p className="loader-note" id="loader-note">
          Loading the shop
        </p>
        <button id="loader-start" className="loader-start" type="button" hidden>
          START
        </button>
      </div>

      <div id="hud" className="hud" hidden>
        <p className="hud-name" id="hud-name" />
        <button id="hud-back" className="hud-back" type="button" hidden>
          ← back
        </button>
        <nav className="hud-links" id="hud-links" aria-label="Sections" />
        <p className="hud-hint" id="hud-hint" />
      </div>

      {/* The words the world is painted with, in the document for anything
          that cannot look at a diorama. Filled by the scene on load. */}
      <section className="sr-only" id="sr-content" aria-label="Portfolio text">
        <h1 id="sr-name" />
        <div id="sr-body" />
      </section>
    </>
  )
}
