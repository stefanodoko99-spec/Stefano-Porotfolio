# stefano-portfolio

A scroll-driven portfolio for Stefano Doko, web designer and developer. Three
languages, a WebGL hero, and a real backend.

The visual direction is recorded in [DESIGN.md](DESIGN.md) and the product
context in [PRODUCT.md](PRODUCT.md). Read those before changing anything
visual: they carry decisions that are expensive to rediscover, including
several that were reversed after being measured.

## Stack

Next.js 16 (App Router) · TypeScript strict · Tailwind v4 · GSAP + ScrollTrigger
· Lenis · React Three Fiber · Drizzle + Neon Postgres · Zod · Resend · Upstash

## Running it

```bash
npm install
cp .env.example .env.local
npm run dev
```

The site renders without any environment variables. The parts that need them
fail gracefully rather than taking the page down:

| Variable | Needed for | Without it |
| --- | --- | --- |
| `DATABASE_URL` | contact form, projects, admin | form returns a server error |
| `RESEND_API_KEY`, `CONTACT_TO_EMAIL`, `CONTACT_FROM_EMAIL` | enquiry email | submission is stored, not emailed |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | rate limiting | in-memory limiter in dev; **the build refuses to start in production** |
| `ADMIN_SESSION_SECRET` | admin session, contact time-trap | contact form and `/admin` reject everything |
| `ADMIN_PASSWORD_HASH` | admin login | `npm run hash-password -- "your password"` |
| `IP_HASH_SALT` | salted visitor hashing | hashes are skipped |

## Deploying

`vercel.json` pins `framework: nextjs`, and it is not decoration. With the
preset left at *Other*, Vercel still runs `npm run build` and still reports the
deployment green, but it publishes `public/` — the default output directory for
a project with no framework — so every asset under `public/` serves correctly
while every page, route handler and `_next/static` asset returns a platform 404.
A deployment that is broken in exactly that way looks healthy from the build log,
so the setting lives in the repository where it can be read.

Settings in `vercel.json` take precedence over the dashboard. If pages still 404
after a deploy, check that **Output Directory** is not separately overridden in
project settings.

The site renders with no environment variables at all, but two are needed before
the contact form works in production:

| Variable | Without it |
| --- | --- |
| `ADMIN_SESSION_SECRET` | the form's time-trap token cannot be signed, so every submission is rejected |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | `/api/contact` throws on the first request: production must never run unmetered |
| `DATABASE_URL` | submissions have nowhere to be stored |

## Scripts

```bash
npm run typecheck    # tsc --noEmit
npm run lint
npm run build
npm run db:generate  # drizzle-kit migrations
npm run db:seed      # reads content/projects.json
npm run hash-password -- "your password"
npx tsx scripts/contrast.ts   # contrast table for both sheets
```

## Routes

`/it`, `/en`, `/al` are the three locales. Albanian is served at `/al` because
visitors recognise it, while the language tag stays `sq` throughout: `al` is a
country code, `sq` is the language. Anything emitting a language reads the map
in `lib/i18n/config.ts` rather than the URL segment.

`/[locale]/admin` lists contact submissions behind a signed cookie.
`/api/contact`, `/api/projects`, `/api/events` are the route handlers.

## What is deliberately missing

**There is no case study.** The two live sites are shown, linked and described,
but nothing claims a client, an outcome, a metric or a date it cannot support.
`npm run db:seed` still refuses to run on invented data.

## Loading

The first screen is a street that has to arrive over the network, so
[components/ui/Loader.tsx](components/ui/Loader.tsx) covers the wait with the
shop being written: lines of `build_shop.py` and `bake_shop.py`, the real
calls and the real mesh names, typed into a terminal as the files land. The
typing is driven by the actual byte progress (files arrived out of files
expected, counted off resource timing, which does not care that R3F loads
through its own manager) with a pace on top so it reads as typing rather than
as a jump; the percentage in the corner is the same number. Readiness is
separate from the count and comes from `SceneReady` inside the scene's Suspense
boundary.

It ends at a door. When the last line is typed and the street has said it is
ready, an **Enter** control fades up (the Enter key does the same) and the
visitor opens the site. Every path reaches it: the street finishes, the street
says it is not coming (reduced motion, which also skips the typing), or a nine
second deadline passes. Until the door is offered the overlay is out of the
accessibility tree and inert; once it is, it is a dialog with one button in it.

## The first screen

The first screen is the street and nothing else. The name, the role and the
way in are painted on the billboard on the bank's roof
([components/three/screens.ts](components/three/screens.ts), `heroScreen`, in
the visitor's language, with the clock in its corner), the sound and sheet
switches sit in the bar, and the contact link is the bar's own. What stays in
the DOM over the street is what the street cannot carry: a visually hidden
heading for the document, and a control for the walk that is drawn only while
it has keyboard focus, in the same register as the skip link.

## Phones

The same street, with three differences. The wide shot is solved from the
frame's aspect: a landscape frame holds the whole
row, a portrait one stands over the garage and the bank, tilted down, and the
rest of the street is a swipe away. The mirror road is a second render of the
whole scene every frame, so below 760px the road is a dark floor instead;
bloom runs at a third of the frame there rather than half, and the pixel ratio
is capped at 1.5. The arcade draws its pad only where the primary pointer is a
thumb. `viewport-fit: cover` is set so the bar's gutters can read the safe-area
insets under a notch.

## The monitor

The workstation is a control, not a picture of one. The panel is a click target
in the 3D scene: pressing it walks the camera up to the desk. The screen is a
two-state machine — at rest it shows an invitation, and the work is behind a
press, the way it would be on a real machine. Walking up to a monitor that is
already showing you everything is a picture of a computer.

    click the monitor  ->  camera walks in  ->  VIEW MY WORK  ->  the two sites

The click moves the *scroll*, not the camera. The camera follows scroll as it
always has, so a click and a wheel can never disagree about where you are
standing and nobody has to fight an animation to get back out. Below the pin
breakpoint there is no walk to take, so the same control jumps to the panel
where it sits in the page.

A click target that exists only inside WebGL cannot be tabbed to, cannot be
announced, and does not exist for anyone not using a mouse. So the same action
exists as a real button over the street, visually hidden until it has focus
(`.cinema-enter`), and every control inside the screen is real DOM.

The first screen and the walk toward the workstation are one pinned section,
[components/sections/Cinema.tsx](components/sections/Cinema.tsx). Scroll drives a
camera in the scene, not a CSS transform: the position travels through
[lib/motion/cinema.ts](lib/motion/cinema.ts) and is read inside the frame loop,
so the scene never re-renders to move. As the panel fills the frame a real DOM
interface crossfades over it, and from there the switcher and both links are
ordinary HTML.

Project data lives in one place, [lib/projects.ts](lib/projects.ts); the
translated copy for each project sits under `work.projects` in the dictionary.
The room loads 4.1MB across five models and an environment map — the 38MB in
`public/models` is mostly unreferenced source files. It loads everywhere except
under reduced motion; the pinned walk toward the monitor is still desktop only,
but the workstation itself is the first thing this site has to say and a phone
gets to see it.

## The machines

Three screens in the street can be walked up to, and one mechanism serves all
three: the GLB exports a plane by name, the scene hides it and puts a live plane
of its own in its frame, the camera walks to whichever is current, and a DOM
interface is pinned to its projected rectangle. `lib/screen.ts` lists them.

| Machine | Plane | What is on it |
| --- | --- | --- |
| the reception monitor in the garage | `garageScreen` | the site: applications on a desktop, one window at a time |
| the cabinet under the Milano arcade | `arcadeScreen` | three games: Snake, Pong, Bricks |
| the cash machine outside the bank | `atmOutScreen` | a PIN, a menu, and one withdrawal: a business card |

The games live in `lib/arcade/`, plain state machines over a 320x240 canvas with
no React and no three in them. That is what lets one implementation run in
three places: inside a window on the desktop (the ARCADE application, which is
how a keyboard or a reduced-motion visitor reaches them), on the panel pinned to
the cabinet, and as the attract loop painted onto the cabinet's own screen
across the street. Arrows or WASD, space to start; a pad is drawn where the
primary pointer is a thumb. Best scores are kept per game in localStorage.

The cash machine accepts any four digits, because a puzzle in front of the
contact details is a wall. Its balance and statement read facts the site already
states; the receipt prints the name, the role and the contact address.

## The street's screens

Every other screen in the street paints itself: the diagnostic cart, the vending
machine, the bank's cash machine and queue counter, the café's menu board, the
pharmacy's cross, the chalk board at the garage door, the beach bar's board.
[components/three/screens.ts](components/three/screens.ts) holds one painter
per plane, each at its own rate (a clock once a minute, a blink twice a second,
a chalk board never), and the scene uploads the canvas as that plane's texture.
Hovering a hotspot drives the screen behind it brighter and lifts its board on
the sign post; the traffic light at the crossing runs red, green, amber in the
frame loop. Walking into a machine plays a CRT coming on, and the walk out is
the same tube switching off.

## The shop (Blender)

The scene is procedural. `bar-martiri/blender/build_shop.py` builds the stall,
the machines, the signpost and every hitbox from code; `bake_shop.py` joins
each group, unwraps it, bakes the lighting to an atlas with Cycles and exports
a Draco GLB with no materials. Names are the contract: the scene assigns
materials by mesh name.

```bash
blender -b -P bar-martiri/blender/build_shop.py
blender -b bar-martiri/blender/shop.blend -P bar-martiri/blender/bake_shop.py -- 48
```

The site serves the results from `public/bar/`, and the Draco decoder it shares
with nothing else lives at `public/draco/`. `bar-martiri/` remains a runnable
Vite project of its own — that is where the scene is developed — and
`components/three/bar/` is the copy the Next app mounts.

## Day and night

The page is printed on one of two sheets and the hour picks: light from 07:00
to 19:00 local, dark either side. The switch in the apparatus row overrides the
clock, and the override is stored against the automatic value it was chosen
against — so it holds for the situation that prompted it and lapses once the
clock moves on. An inline `beforeInteractive` script sets the attribute ahead of
the first paint, so no visitor watches the page turn over on load.

Colours are roles, split across `:root` and `:root[data-theme='light']` in
[app/globals.css](app/globals.css). Anything drawn on a slate reads from the
`--slate-*` roles, which do not change with the sheet.

```bash
npx tsx scripts/contrast.ts   # the contrast table for both sheets
```

## Sound

The sound switch in the first viewport plays `public/audio/room-tone.wav` on a
loop. That file is a placeholder: a generated room tone, the low bed a sound
recordist captures so the silences in a cut match the takes around them. Drop a
real track in its place and change `SRC` in
[components/ui/SoundToggle.tsx](components/ui/SoundToggle.tsx).

It never autoplays, and `preload="none"` keeps it off the wire until someone
asks for it, so the half megabyte is not part of any page load.

## Fonts

Archivo and Martian Mono are vendored in `app/fonts/`. See
[app/fonts/README.md](app/fonts/README.md) for attribution and licensing.

## Bar Martiri, the second portfolio

`bar-martiri/` is a separate site kept in this repository as its own project:
a night diorama of Bar Martiri, the beach bar at Spille, built after
jesse-zhou.com's ramen stall, with the four sections read off screens inside
the scene (the projects in a vending machine, about on the big screen, the
credits on an arcade cabinet, contact through this site's form). It is a Vite
and three.js app with a Blender pipeline of its own. Nothing in it is imported
by the Next.js site, and the root `tsconfig.json` and `eslint.config.mjs`
leave it alone.

```bash
cd bar-martiri
npm install
npm run dev      # http://localhost:5192
npm run build    # bar-martiri/dist
```

Its own [README](bar-martiri/README.md) and [SPEC.md](bar-martiri/SPEC.md)
describe the pipeline and the light. The words it shows live in
`bar-martiri/src/content.ts` and `bar-martiri/src/content/labels.json` and are
the copy already in this site's dictionary; nothing was invented for it.
