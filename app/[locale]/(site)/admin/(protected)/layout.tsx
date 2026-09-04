import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { locale } from 'next/root-params'

import { SESSION_COOKIE, readSession } from '@/lib/auth'
import { DEFAULT_LOCALE } from '@/lib/i18n/config'

/**
 * The gate for everything under /admin.
 *
 * The check lives here rather than in proxy.ts on purpose. Proxy runs on the
 * edge runtime, where node:crypto is unavailable, and Next's own guidance is
 * that proxy is for optimistic checks rather than authorisation. This layout
 * runs on the Node runtime and verifies the signature properly.
 *
 * The locale comes from next/root-params rather than a params prop: inside a
 * route group the generated LayoutProps types params as unknown, and the root
 * parameter is available to any server component without prop drilling anyway.
 *
 * Never prerendered or cached. Reading cookies already opts this subtree into
 * dynamic rendering; the export makes it explicit so a later refactor cannot
 * quietly cache a page full of private submissions.
 */
export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies()

  if (!(await readSession(store.get(SESSION_COOKIE)?.value))) {
    redirect(`/${(await locale()) ?? DEFAULT_LOCALE}/admin/login`)
  }

  return <>{children}</>
}
