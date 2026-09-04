import { notFound } from 'next/navigation'

import { SmoothScroll } from '@/components/motion/SmoothScroll'
import { SiteFooter } from '@/components/ui/SiteFooter'
import { Grain } from '@/components/ui/Grain'
import { Loader } from '@/components/ui/Loader'
import { SiteHeader } from '@/components/ui/SiteHeader'
import { buildScenes } from '@/lib/sections'
import { isLocale } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/dictionaries'

/**
 * The site's chrome: the bar, the footer, the grain and the smooth scroll.
 *
 * This used to live in the locale layout, which meant every route got it —
 * including the front door. The front door is now the Bar Martiri diorama,
 * and that scene carries its own name plate, its own navigation and its own
 * loading screen; laying the site's versions of all three on top of it gives
 * the visitor two of each. So the chrome moved down here, and the homepage
 * sits outside this group without it.
 */
export default async function SiteLayout(props: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await props.params
  if (!isLocale(locale)) notFound()

  const dict = getDictionary(locale)

  return (
    <>
        <SmoothScroll />
        <Loader dict={dict.nav} />
        <Grain />
        <SiteHeader
          nav={dict.nav}
          hero={dict.hero}
          locale={locale}
          scenes={buildScenes(dict)}
          name={dict.hero.name}
        />

        {/* The bar floats over the first screen rather than pushing it down:
            the room behind it is the point, and a header with its own band at
            the top of a cinematic shot is a letterbox nobody asked for. */}
        <main id="content" tabIndex={-1}>
          {props.children}
        </main>

        <SiteFooter dict={dict} />
    </>
  )
}
