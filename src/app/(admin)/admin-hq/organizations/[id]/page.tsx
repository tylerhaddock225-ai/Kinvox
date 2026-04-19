import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function AdminOrgDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug, vertical, status, plan, created_at, owner_id')
    .eq('id', id)
    .single<{
      id: string
      name: string
      slug: string | null
      vertical: string | null
      status: string | null
      plan: string | null
      created_at: string
      owner_id: string
    }>()

  if (!org) notFound()

  const fields: Array<[string, string]> = [
    ['Slug',       org.slug ?? '—'],
    ['Vertical',   org.vertical ?? '—'],
    ['Status',     org.status ?? '—'],
    ['Plan',       org.plan ?? '—'],
    ['Created',    new Date(org.created_at).toLocaleDateString()],
    ['Owner ID',   org.owner_id],
  ]

  return (
    <div className="space-y-6">
      <Link
        href="/admin-hq/organizations"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        All organizations
      </Link>

      <header>
        <div className="text-[10px] font-bold tracking-[0.2em] text-violet-300 uppercase">
          Managing Organization
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-white">{org.name}</h1>
      </header>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 rounded-xl border border-pvx-border bg-gray-900 p-5">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] font-medium uppercase tracking-wider text-gray-500">{label}</dt>
            <dd className="mt-1 text-sm text-gray-200 font-mono break-all">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="text-xs text-gray-500">
        Use <span className="text-violet-300 font-medium">Launch Impersonation</span> in the sidebar
        to view this organization as a merchant.
      </p>
    </div>
  )
}
