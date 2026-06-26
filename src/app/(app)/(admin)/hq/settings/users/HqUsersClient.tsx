'use client'

import { useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, X, Send } from 'lucide-react'
import { inviteHqUser, resendHqInvite } from './actions'

// HQ Users tab. The platform parallel of the tenant TeamTabs Members + Pending
// Invitations panels. Two differences from the tenant flow drive the wiring:
//   - inviteHqUser takes a typed object (not (prevState, FormData)), so the
//     invite modal uses a manual submit handler + useTransition rather than
//     useActionState.
//   - resendHqInvite takes the invitation id string directly.
// After a successful mutation we router.refresh() to re-pull the server lists.

export type HqUserRow = {
  id:                string
  full_name:         string | null
  email:             string | null
  system_role:       string
  system_role_label: string
  role_name:         string | null
}

export type HqInviteRow = {
  id:                string
  email:             string
  full_name:         string | null
  system_role_label: string
  role_name:         string | null
  expires_at:        string
}

export type RoleOption       = { id: string; name: string }
export type SystemRoleOption = { value: string; label: string }

const INPUT = 'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500'
const LABEL = 'block text-xs font-medium text-gray-400 mb-1'
const BTN   = 'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const BTN_PRIMARY   = `${BTN} bg-violet-600 text-white hover:bg-violet-500`
const BTN_SECONDARY = `${BTN} text-gray-400 hover:text-white`

function formatInviteDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Invite modal ─────────────────────────────────────────────────────────────

function InviteHqUserModal({
  roleOptions,
  systemRoleOptions,
}: {
  roleOptions:       RoleOption[]
  systemRoleOptions: SystemRoleOption[]
}) {
  const router    = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef   = useRef<HTMLFormElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    const input = {
      email:       String(fd.get('email') ?? ''),
      full_name:   String(fd.get('full_name') ?? ''),
      system_role: String(fd.get('system_role') ?? ''),
      role_id:     String(fd.get('role_id') ?? '') || null,
    }
    startTransition(async () => {
      const res = await inviteHqUser(input)
      if (res?.status === 'error') {
        setError(res.error)
        return
      }
      dialogRef.current?.close()
      formRef.current?.reset()
      router.refresh()
    })
  }

  return (
    <>
      <button
        className={BTN_PRIMARY}
        onClick={() => { setError(null); dialogRef.current?.showModal() }}
      >
        <UserPlus className="w-4 h-4" />
        Invite HQ User
      </button>

      <dialog
        ref={dialogRef}
        className="m-auto w-full max-w-md rounded-xl border border-pvx-border bg-pvx-surface p-6 text-white shadow-2xl backdrop:bg-black/70"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold">Invite HQ User</h2>
          <button type="button" onClick={() => dialogRef.current?.close()} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={LABEL} htmlFor="hq-invite-email">Email <span className="text-red-400">*</span></label>
            <input id="hq-invite-email" name="email" type="email" required placeholder="jane@kinvoxtech.com" className={INPUT} />
          </div>
          <div>
            <label className={LABEL} htmlFor="hq-invite-name">Full Name</label>
            <input id="hq-invite-name" name="full_name" type="text" placeholder="Jane Smith" className={INPUT} />
          </div>
          <div>
            <label className={LABEL} htmlFor="hq-invite-system-role">Platform Role <span className="text-red-400">*</span></label>
            <select id="hq-invite-system-role" name="system_role" required defaultValue="platform_support" className={INPUT}>
              {systemRoleOptions.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL} htmlFor="hq-invite-role">HQ Role</label>
            <select id="hq-invite-role" name="role_id" defaultValue="" className={INPUT}>
              <option value="">No role</option>
              {roleOptions.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={() => dialogRef.current?.close()} className={BTN_SECONDARY}>
              Cancel
            </button>
            <button type="submit" disabled={pending} className={BTN_PRIMARY}>
              {pending ? 'Sending…' : 'Send Invite'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}

// ── Resend button ────────────────────────────────────────────────────────────

function ResendHqInviteButton({ inviteId }: { inviteId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(async () => { await resendHqInvite(inviteId); router.refresh() })}
      className="inline-flex items-center gap-1.5 rounded-lg border border-pvx-border px-3 py-1.5 text-xs font-medium text-gray-300 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Send className="w-3.5 h-3.5" />
      {pending ? 'Sending…' : 'Resend'}
    </button>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function HqUsersClient({
  users,
  invites,
  roleOptions,
  systemRoleOptions,
}: {
  users:             HqUserRow[]
  invites:           HqInviteRow[]
  roleOptions:       RoleOption[]
  systemRoleOptions: SystemRoleOption[]
}) {
  return (
    <div className="space-y-8">
      {/* HQ users */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">
            HQ Users <span className="text-xs text-gray-500 font-normal">({users.length})</span>
          </h3>
          <InviteHqUserModal roleOptions={roleOptions} systemRoleOptions={systemRoleOptions} />
        </div>

        <div className="rounded-xl border border-pvx-border bg-pvx-surface overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-pvx-border text-xs text-gray-500">
                <th className="px-5 py-3 text-left font-medium">Name</th>
                <th className="px-5 py-3 text-left font-medium">Email</th>
                <th className="px-5 py-3 text-left font-medium">Platform Role</th>
                <th className="px-5 py-3 text-left font-medium">HQ Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pvx-border">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-gray-500 text-sm">
                    No HQ users yet.
                  </td>
                </tr>
              ) : (
                users.map(u => (
                  <tr key={u.id} className="hover:bg-violet-400/[0.07] transition-colors">
                    <td className="px-5 py-3 text-gray-200 font-medium">{u.full_name ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-400">{u.email ?? '—'}</td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-purple-500/10 text-purple-400 border-purple-500/20">
                        {u.system_role_label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-400">{u.role_name ?? 'No role'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pending invitations */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-white">
          Pending Invitations <span className="text-xs text-gray-500 font-normal">({invites.length})</span>
        </h3>

        {invites.length === 0 ? (
          <div className="rounded-xl border border-dashed border-pvx-border bg-pvx-surface p-10 text-center text-gray-500 text-sm">
            No outstanding invitations.
          </div>
        ) : (
          <div className="rounded-xl border border-pvx-border bg-pvx-surface overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-pvx-border text-xs text-gray-500">
                  <th className="px-5 py-3 text-left font-medium">Email</th>
                  <th className="px-5 py-3 text-left font-medium">Platform Role</th>
                  <th className="px-5 py-3 text-left font-medium">HQ Role</th>
                  <th className="px-5 py-3 text-left font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium sr-only">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-pvx-border">
                {invites.map(inv => {
                  const expired = new Date(inv.expires_at).getTime() < Date.now()
                  return (
                    <tr key={inv.id} className="hover:bg-violet-400/[0.07] transition-colors">
                      <td className="px-5 py-3">
                        <div className="text-gray-200 font-medium">{inv.email}</div>
                        {inv.full_name && <div className="text-xs text-gray-500">{inv.full_name}</div>}
                      </td>
                      <td className="px-5 py-3 text-gray-400">{inv.system_role_label}</td>
                      <td className="px-5 py-3 text-gray-400">{inv.role_name ?? 'No role'}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                            expired
                              ? 'bg-red-500/10 text-red-400 border-red-500/20'
                              : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          }`}>
                            {expired ? 'Expired' : 'Pending'}
                          </span>
                          <span className="text-xs text-gray-500">expires {formatInviteDate(inv.expires_at)}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <ResendHqInviteButton inviteId={inv.id} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
