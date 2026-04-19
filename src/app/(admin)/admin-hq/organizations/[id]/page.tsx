import Link from 'next/link'
import { ArrowLeft, ShieldAlert, Archive, RotateCcw } from 'lucide-react'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  updateOrganization,
  setOrgStatus,
  archiveOrganization,
  restoreOrganization,
} from '@/app/(admin)/admin-hq/actions/organizations'
import ConfirmButton from '@/components/admin/ConfirmButton'

export const dynamic = 'force-dynamic'

const VERTICALS = [
  'General',
  'Dental',
  'Home Preparedness',
  'Payment Facilitation',
  'Healthcare',
  'Retail',
  'Professional Services',
  'Other',
]

const PLANS: Array<{ value: 'free' | 'pro' | 'enterprise'; label: string }> = [
  { value: 'free',       label: 'Free' },
  { value: 'pro',        label: 'Pro' },
  { value: 'enterprise', label: 'Enterprise' },
]

export default async function AdminOrgDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug, vertical, status, plan, deleted_at, created_at, owner_id')
    .eq('id', id)
    .single<{
      id:         string
      name:       string
      slug:       string | null
      vertical:   string | null
      status:     string | null
      plan:       string | null
      deleted_at: string | null
      created_at: string
      owner_id:   string
    }>()

  if (!org) notFound()

  const isArchived = !!org.deleted_at
  const status     = (org.status ?? 'active').toLowerCase()
  const isActive   = status === 'active'

  return (
    <div className="space-y-8 max-w-3xl">
      <Link
        href="/admin-hq/organizations"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        All organizations
      </Link>

      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-bold tracking-[0.2em] text-violet-300 uppercase">
            Managing Organization
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-white">{org.name}</h1>
          <p className="mt-1 text-xs text-gray-500 font-mono">{org.slug ?? '—'} · {org.id}</p>
        </div>
        {isArchived && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-700/60 bg-amber-950/40 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-amber-300">
            <Archive className="w-3 h-3" />
            Archived
          </span>
        )}
      </header>

      {/* Status toggle */}
      <section className="rounded-xl border border-pvx-border bg-gray-900 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-gray-400">Status</div>
            <div className="mt-1">
              {isArchived ? (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-pvx-border bg-pvx-surface px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
                  Archived
                </span>
              ) : (
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                  <span className={`text-sm font-medium ${isActive ? 'text-emerald-300' : 'text-gray-400'}`}>
                    {status}
                  </span>
                </div>
              )}
            </div>
            {isArchived && (
              <p className="mt-2 text-[11px] text-gray-500">
                Toggle disabled while archived. Restore the organization below to re-enable.
              </p>
            )}
          </div>
          <form action={setOrgStatus}>
            <input type="hidden" name="id"     value={org.id} />
            <input type="hidden" name="status" value={isActive ? 'inactive' : 'active'} />
            <button
              type="submit"
              disabled={isArchived}
              aria-disabled={isArchived}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                isArchived
                  ? 'border-pvx-border bg-pvx-surface text-gray-600 cursor-not-allowed opacity-60'
                  : isActive
                    ? 'border-amber-700/60 bg-amber-950/40 text-amber-200 hover:bg-amber-900/40'
                    : 'border-emerald-700/60 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/40'
              }`}
            >
              {isActive ? 'Deactivate' : 'Activate'}
            </button>
          </form>
        </div>
      </section>

      {/* Edit form */}
      <section className="rounded-xl border border-pvx-border bg-gray-900 p-5">
        <h2 className="text-sm font-semibold text-white">Details</h2>
        <p className="mt-1 text-xs text-gray-500">Updates apply platform-wide and are visible to the merchant.</p>

        <form action={updateOrganization} className="mt-5 space-y-4">
          <input type="hidden" name="id" value={org.id} />

          <Field label="Merchant Name">
            <input
              name="name"
              defaultValue={org.name}
              required
              className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
            />
          </Field>

          <Field label="Vertical">
            <select
              name="vertical"
              defaultValue={org.vertical ?? 'General'}
              className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
            >
              {VERTICALS.map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </Field>

          <Field label="Subscription Plan">
            <select
              name="plan"
              defaultValue={(org.plan ?? 'free').toLowerCase()}
              className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
            >
              {PLANS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>

          <div className="pt-2">
            <button
              type="submit"
              className="inline-flex items-center rounded-md bg-violet-600 hover:bg-violet-500 px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              Save changes
            </button>
          </div>
        </form>
      </section>

      {/* Danger zone */}
      <section className="rounded-xl border border-rose-900/60 bg-rose-950/20 p-5">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-rose-400" />
          <h2 className="text-sm font-semibold text-rose-200">Danger Zone</h2>
        </div>

        {!isArchived ? (
          <>
            <p className="mt-2 text-xs text-rose-300/70">
              Archiving hides this organization from the merchant app and blocks new logins.
              The row is preserved and can be restored.
            </p>
            <form action={archiveOrganization} className="mt-4">
              <input type="hidden" name="id" value={org.id} />
              <ConfirmButton
                message={`Archive "${org.name}"? Merchant members will lose access until restored.`}
                className="inline-flex items-center gap-1.5 rounded-md border border-rose-700/60 bg-rose-900/30 px-3 py-1.5 text-xs font-medium text-rose-100 hover:bg-rose-900/50 transition-colors"
              >
                <Archive className="w-3.5 h-3.5" />
                Archive organization
              </ConfirmButton>
            </form>
          </>
        ) : (
          <>
            <p className="mt-2 text-xs text-rose-300/70">
              This organization is currently archived. Restoring re-enables merchant access.
            </p>
            <form action={restoreOrganization} className="mt-4">
              <input type="hidden" name="id" value={org.id} />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-md border border-emerald-700/60 bg-emerald-950/40 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-900/40 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Restore organization
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium uppercase tracking-wider text-gray-400 mb-1.5">
        {label}
      </span>
      {children}
    </label>
  )
}
