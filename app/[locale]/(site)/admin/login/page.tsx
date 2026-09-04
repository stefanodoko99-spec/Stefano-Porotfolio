import { locale } from 'next/root-params'

import { DEFAULT_LOCALE } from '@/lib/i18n/config'

import { LoginForm } from './LoginForm'

/**
 * Outside the (protected) route group on purpose. A login page inside its own
 * gate redirects to itself forever.
 */
export const dynamic = 'force-dynamic'

export default async function AdminLoginPage() {
  const current = (await locale()) ?? DEFAULT_LOCALE

  return (
    <main className="flex min-h-svh items-center px-[var(--gutter)] py-16">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-2xl font-medium tracking-[-0.02em]">Admin</h1>
        <LoginForm locale={current} />
      </div>
    </main>
  )
}
