import { notFound } from 'next/navigation'

import { BarStage } from '@/components/three/BarStage'
import { isLocale } from '@/lib/i18n/config'

/**
 * The front door: Bar Martiri.
 *
 * The scene is the page. It carries its own name plate, its own navigation
 * and its own loading screen, and it fills the viewport — which is why it sits
 * outside the `(site)` group and gets none of the site's chrome. Two headers
 * and two loaders over one diorama was the alternative.
 *
 * The written portfolio did not go anywhere. Work, the manifesto, the process
 * and the contact form are at `/[locale]/info`, with the chrome and the three
 * languages intact, and the contact sign inside the world opens it.
 */
export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params
  if (!isLocale(locale)) notFound()

  return <BarStage />
}
