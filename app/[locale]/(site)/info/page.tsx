import { notFound } from 'next/navigation'

import { Contact } from '@/components/sections/Contact'
import { Manifesto } from '@/components/sections/Manifesto'
import { Process } from '@/components/sections/Process'
import { Work } from '@/components/sections/Work'
import { isLocale } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/dictionaries'

/** Project data is revalidated hourly once the work section lands. */
export const revalidate = 3600

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params
  if (!isLocale(locale)) notFound()

  const dict = getDictionary(locale)

  return (
    <>
      {/*
        The workshop scene used to open this page. The front door is the Bar
        Martiri diorama now, and a second 3D scene here would be a second
        seven-megabyte download to say the same thing the words below already
        say — and it is what kept the loading screen waiting for atlases no
        page fetches any more.
      */}
      <Work dict={dict.work} label={dict.nav.items.work} />
      <Manifesto dict={dict.manifesto} about={dict.about} label={dict.nav.items.manifesto} />
      <Process dict={dict.process} label={dict.nav.items.process} />
      <Contact dict={dict.contact} locale={locale} label={dict.nav.items.contact} />
    </>
  )
}
