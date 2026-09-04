import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { notFound } from 'next/navigation'
import Script from 'next/script'

import '../globals.css'

import { LANG_TAG, LOCALES, OG_LOCALE, isLocale } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/dictionaries'
import { THEME_BOOT_SCRIPT } from '@/lib/theme'

/**
 * The direction contract. It is emitted into the built markup so it can be
 * audited after a production build, not only read in source. The wrapper is a
 * hidden div because React has no way to render a bare comment node.
 */
const DIRECTION_CONTRACT = `
THESIS: A camera report. The paperwork one hand fills from set to lab to edit suite,
which is this product's mechanism made literal. Refuses the cream-ground display-serif
portfolio and its black-void-with-neon opposite.
OWN-WORLD: Graphite ground, NCR canary as matte ink and as paper field, lab green on one
confirmed state. Archivo condensed at slate scale, Martian Mono for timecode. Hairline
ruling. No radius anywhere.
STORY: A visitor sees one pair of hands carry work from concept to shipped code, and sends
a message.
FIRST VIEWPORT: Black, full-bleed frame held in the gate. Name lower-left at slate scale,
pulling down through the gate. Canary hairline rail at the left edge reading 00:00:00:00.
Ruled billing block at the foot carrying role, languages, and the primary action.
FORM: camera report and edit decision list; candidate 3 of 7; seed cd1df870.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review,
the verdict, and DESIGN.md
`

/**
 * Self-hosted rather than pulled from Google at build time.
 *
 * next/font/google needs to reach fonts.googleapis.com during the build, and
 * that host is not reachable from this machine, so the build failed the moment
 * the cache was cleared. Vendoring the two woff2 files removes an external
 * dependency from the build entirely: it now works offline and in any CI
 * runner, and no request leaves the origin at runtime either.
 *
 * Both are the latin subset, which is the whole alphabet this site needs.
 * Albanian's c-cedilla and e-diaeresis and every Italian accent live in
 * U+0000-00FF, as does the typographic apostrophe's block.
 */
const archivo = localFont({
  src: '../fonts/Archivo-Variable.woff2',
  variable: '--font-archivo',
  display: 'swap',
  weight: '100 900',
  style: 'normal',
  // The width axis is what gives the name its slate register. It has to be
  // declared on the @font-face or the browser will not honour font-stretch,
  // and the display face is just another grotesque.
  declarations: [{ prop: 'font-stretch', value: '62% 125%' }],
  fallback: ['Arial Narrow', 'system-ui', 'sans-serif'],
  // Generates a metric-matched fallback so the swap costs no layout shift.
  adjustFontFallback: 'Arial',
})

const martianMono = localFont({
  src: '../fonts/MartianMono-Variable.woff2',
  variable: '--font-martian',
  display: 'swap',
  weight: '100 800',
  style: 'normal',
  fallback: ['ui-monospace', 'monospace'],
  // Off deliberately: adjusting a monospace face against Arial's metrics
  // would shift the tabular columns it exists to keep aligned.
  adjustFontFallback: false,
})

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }))
}

/**
 * The street runs edge to edge on a phone, so the page has to be allowed
 * under the notch and the home indicator: without `viewport-fit: cover` every
 * `env(safe-area-inset-*)` in the stylesheet is zero and the rules that read
 * them are dead code.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export async function generateMetadata(props: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await props.params
  if (!isLocale(locale)) return {}

  const dict = getDictionary(locale)
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

  return {
    metadataBase: new URL(site),
    title: dict.meta.title,
    description: dict.meta.description,
    alternates: {
      canonical: `/${locale}`,
      // hreflang takes the language tag, never the URL segment. For Albanian
      // those differ on purpose: the path is /al, the language is sq.
      languages: Object.fromEntries(
        LOCALES.map((code) => [LANG_TAG[code], `/${code}`]),
      ),
    },
    openGraph: {
      type: 'website',
      title: dict.meta.title,
      description: dict.meta.description,
      locale: OG_LOCALE[locale],
      alternateLocale: LOCALES.filter((c) => c !== locale).map((c) => OG_LOCALE[c]),
    },
  }
}

export default async function RootLayout(props: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await props.params
  if (!isLocale(locale)) notFound()

  const dict = getDictionary(locale)

  return (
    <html
      lang={LANG_TAG[locale]}
      className={`${archivo.variable} ${martianMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        {/* Decides the sheet before the first paint. Anything later is a page
            that turns over in front of the visitor, which is worse than either
            sheet on its own — so this is beforeInteractive, injected into the
            initial HTML and run ahead of any Next module, rather than a plain
            script tag, which React does not execute on a client navigation.
            suppressHydrationWarning above is for the attribute it writes: the
            server cannot know the hour where the visitor is standing. */}
        <Script id="theme-boot" strategy="beforeInteractive">
          {THEME_BOOT_SCRIPT}
        </Script>

        <div
          hidden
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: `<!--${DIRECTION_CONTRACT}-->` }}
        />

        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:bg-mark focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:tracking-widest focus:text-mark-ink focus:uppercase"
        >
          {dict.nav.skipToContent}
        </a>

        {props.children}

      </body>
    </html>
  )
}
