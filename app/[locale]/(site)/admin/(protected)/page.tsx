import { listSubmissions } from '@/lib/db/queries'

/**
 * Submissions, newest first.
 *
 * This is an Operate surface, not an Experience one: it inherits the site's
 * tokens so it does not look like a different product, but it makes no attempt
 * to be expressive. Scanability wins.
 */
export default async function AdminPage() {
  let rows
  try {
    rows = await listSubmissions()
  } catch {
    return (
      <main className="px-[var(--gutter)] py-16">
        <h1 className="font-display text-2xl font-medium">Submissions</h1>
        <p className="mt-4 max-w-[50ch] text-alert">
          The database is not reachable. Check DATABASE_URL.
        </p>
      </main>
    )
  }

  return (
    <main className="px-[var(--gutter)] py-16">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="font-display text-2xl font-medium tracking-[-0.02em]">Submissions</h1>
        <span className="tabular text-[11px] tracking-[0.1em] text-ink-muted uppercase">
          {rows.length} total
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="mt-8 text-ink-muted">Nothing yet.</p>
      ) : (
        <ul className="mt-8 divide-y divide-rule border-t border-rule">
          {rows.map((row) => (
            <li key={row.id} className="grid gap-2 py-5 sm:grid-cols-[13rem_1fr]">
              <div className="tabular text-[11px] leading-relaxed tracking-[0.06em] text-ink-muted">
                <div>{row.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</div>
                <div className="uppercase">{row.locale}</div>
                <div className={row.notifiedAt ? 'text-confirm' : 'text-alert'}>
                  {row.notifiedAt ? 'emailed' : 'not emailed'}
                </div>
              </div>
              <div>
                <p className="font-display font-medium">
                  {row.name}{' '}
                  <a
                    href={`mailto:${row.email}`}
                    className="font-normal text-mark underline underline-offset-4"
                  >
                    {row.email}
                  </a>
                </p>
                <p className="mt-2 max-w-[70ch] whitespace-pre-wrap text-ink-muted">
                  {row.message}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
