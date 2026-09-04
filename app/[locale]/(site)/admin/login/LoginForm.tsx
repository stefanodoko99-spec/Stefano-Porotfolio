'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function LoginForm({ locale }: { locale: string }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)

    const password = String(new FormData(event.currentTarget).get('password') ?? '')

    try {
      const res = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (res.ok) {
        router.replace(`/${locale}/admin`)
        router.refresh()
        return
      }

      // The endpoint does not distinguish a wrong password from a malformed
      // request, and neither does this message.
      setError(res.status === 429 ? 'Too many attempts. Wait, then try again.' : 'Incorrect.')
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8">
      <label
        className="tabular block text-[10px] tracking-[0.14em] text-ink-muted uppercase"
        htmlFor="password"
      >
        Password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        required
        autoComplete="current-password"
        autoFocus
        className="w-full border-0 border-b border-rule bg-transparent px-0 py-2.5 font-display text-lg text-ink outline-none transition-colors duration-[var(--f4)] focus:border-mark"
      />

      {error ? (
        <p role="alert" className="mt-3 text-sm text-alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-7 border border-mark px-6 py-2.5 font-display font-medium text-ink transition-colors duration-[var(--f4)] hover:bg-mark hover:text-mark-ink disabled:opacity-60"
      >
        {busy ? 'Checking' : 'Sign in'}
      </button>
    </form>
  )
}
