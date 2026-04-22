'use client'

import { useState, useRef, useEffect, useActionState, useTransition } from 'react'
import { Plus, X, UserPlus, Pencil, Trash2, ShieldCheck, CheckCircle2, Clock, Mail, Copy, Sparkles } from 'lucide-react'
import {
  inviteMember,
  updateMemberRole,
  createRole,
  updateRole,
  deleteRole,
} from './actions'
import { updateSupportEmail, initializeInboundEmail } from '@/app/(app)/(dashboard)/actions/org-settings'
import { PERMISSION_KEYS, DEFAULT_PERMISSIONS, type Permissions } from '@/lib/permissions'
import type { MemberRow, RoleRow } from './page'

export type OrgSettings = {
  inbound_email_address:               string | null
  verified_support_email:              string | null
  verified_support_email_confirmed_at: string | null
}

// ── Shared style tokens ──────────────────────────────────────────────────────

const INPUT  = 'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500'
const LABEL  = 'block text-xs font-medium text-gray-400 mb-1'
const BTN    = 'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const BTN_PRIMARY   = `${BTN} bg-indigo-600 text-white hover:bg-indigo-500`
const BTN_SECONDARY = `${BTN} text-gray-400 hover:text-white`

// ── Permission checkboxes ────────────────────────────────────────────────────

function PermissionGrid({ defaults }: { defaults?: Permissions }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {PERMISSION_KEYS.map(({ key, label }) => (
        <label key={key} className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            name={key}
            defaultChecked={defaults ? defaults[key] : DEFAULT_PERMISSIONS[key]}
            className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-gray-900"
          />
          <span className="text-sm text-gray-300">{label}</span>
        </label>
      ))}
    </div>
  )
}

// ── Invite member modal ──────────────────────────────────────────────────────

function InviteModal({ roles }: { roles: RoleRow[] }) {
  const [state, action, pending] = useActionState(inviteMember, null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef   = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state?.status === 'success') {
      dialogRef.current?.close()
      formRef.current?.reset()
    }
  }, [state])

  return (
    <>
      <button className={BTN_PRIMARY} onClick={() => dialogRef.current?.showModal()}>
        <UserPlus className="w-4 h-4" />
        Invite Member
      </button>

      <dialog
        ref={dialogRef}
        className="m-auto w-full max-w-md rounded-xl border border-pvx-border bg-pvx-surface p-6 text-white shadow-2xl backdrop:bg-black/70"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold">Invite Team Member</h2>
          <button type="button" onClick={() => dialogRef.current?.close()} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form ref={formRef} action={action} className="space-y-4">
          <div>
            <label className={LABEL} htmlFor="invite-email">Email <span className="text-red-400">*</span></label>
            <input id="invite-email" name="email" type="email" required placeholder="jane@example.com" className={INPUT} />
          </div>
          <div>
            <label className={LABEL} htmlFor="invite-name">Full Name</label>
            <input id="invite-name" name="full_name" type="text" placeholder="Jane Smith" className={INPUT} />
          </div>
          <div>
            <label className={LABEL} htmlFor="invite-role">Role</label>
            <select id="invite-role" name="role_id" className={INPUT}>
              <option value="">No custom role</option>
              {roles.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>

          {state?.status === 'error' && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {state.error}
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

// ── Member role select (auto-submits on change) ──────────────────────────────

function MemberRoleSelect({
  memberId,
  currentRoleId,
  roles,
}: {
  memberId: string
  currentRoleId: string | null
  roles: RoleRow[]
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [_isPending, startTransition] = useTransition()

  return (
    <form ref={formRef} action={updateMemberRole}>
      <input type="hidden" name="member_id" value={memberId} />
      <select
        name="role_id"
        defaultValue={currentRoleId ?? ''}
        onChange={() => startTransition(() => formRef.current?.requestSubmit())}
        className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <option value="">No role</option>
        {roles.map(r => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </select>
    </form>
  )
}

// ── Members panel ────────────────────────────────────────────────────────────

function MembersPanel({ members, roles }: { members: MemberRow[]; roles: RoleRow[] }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <InviteModal roles={roles} />
      </div>

      <div className="rounded-xl border border-pvx-border bg-pvx-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-pvx-border text-xs text-gray-500">
              <th className="px-5 py-3 text-left font-medium">Name</th>
              <th className="px-5 py-3 text-left font-medium">Email</th>
              <th className="px-5 py-3 text-left font-medium">System Role</th>
              <th className="px-5 py-3 text-left font-medium">Custom Role</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-pvx-border">
            {members.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-gray-500 text-sm">
                  No team members yet.
                </td>
              </tr>
            ) : (
              members.map(m => (
                <tr key={m.id} className="hover:bg-violet-400/[0.07] transition-colors">
                  <td className="px-5 py-3 text-gray-200 font-medium">
                    {m.full_name ?? '—'}
                  </td>
                  <td className="px-5 py-3 text-gray-400">{m.email ?? '—'}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${
                      m.system_role === 'admin'
                        ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                        : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                    }`}>
                      {m.system_role}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <MemberRoleSelect
                      memberId={m.id}
                      currentRoleId={m.role_id}
                      roles={roles}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Create role modal ────────────────────────────────────────────────────────

function CreateRoleModal() {
  const [state, action, pending] = useActionState(createRole, null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef   = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state?.status === 'success') {
      dialogRef.current?.close()
      formRef.current?.reset()
    }
  }, [state])

  return (
    <>
      <button className={BTN_PRIMARY} onClick={() => dialogRef.current?.showModal()}>
        <Plus className="w-4 h-4" />
        New Role
      </button>

      <dialog
        ref={dialogRef}
        className="m-auto w-full max-w-md rounded-xl border border-pvx-border bg-pvx-surface p-6 text-white shadow-2xl backdrop:bg-black/70"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold">Create Role</h2>
          <button type="button" onClick={() => dialogRef.current?.close()} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form ref={formRef} action={action} className="space-y-5">
          <div>
            <label className={LABEL} htmlFor="role-name">Role Name <span className="text-red-400">*</span></label>
            <input id="role-name" name="name" type="text" required placeholder="e.g. Junior Support" className={INPUT} />
          </div>

          <div>
            <p className={LABEL}>Permissions</p>
            <div className="mt-2 p-3 rounded-lg border border-pvx-border bg-black/25">
              <PermissionGrid />
            </div>
          </div>

          {state?.status === 'error' && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {state.error}
            </p>
          )}

          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => dialogRef.current?.close()} className={BTN_SECONDARY}>
              Cancel
            </button>
            <button type="submit" disabled={pending} className={BTN_PRIMARY}>
              {pending ? 'Creating…' : 'Create Role'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}

// ── Edit role modal ──────────────────────────────────────────────────────────

function EditRoleModal({ role, onClose }: { role: RoleRow; onClose: () => void }) {
  const [state, action, pending] = useActionState(updateRole, null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => { dialogRef.current?.showModal() }, [])
  useEffect(() => {
    if (state?.status === 'success') onClose()
  }, [state, onClose])

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="m-auto w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 p-6 text-white shadow-2xl backdrop:bg-black/60"
    >
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base font-semibold">Edit Role</h2>
        <button type="button" onClick={() => dialogRef.current?.close()} className="text-gray-400 hover:text-white">
          <X className="w-5 h-5" />
        </button>
      </div>

      <form action={action} className="space-y-5">
        <input type="hidden" name="role_id" value={role.id} />

        <div>
          <label className={LABEL} htmlFor="edit-role-name">Role Name <span className="text-red-400">*</span></label>
          <input
            id="edit-role-name"
            name="name"
            type="text"
            required
            defaultValue={role.name}
            className={INPUT}
          />
        </div>

        <div>
          <p className={LABEL}>Permissions</p>
          <div className="mt-2 p-3 rounded-lg border border-gray-700 bg-gray-800/50">
            <PermissionGrid defaults={role.permissions} />
          </div>
        </div>

        {state?.status === 'error' && (
          <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
            {state.error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => dialogRef.current?.close()} className={BTN_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={BTN_PRIMARY}>
            {pending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </dialog>
  )
}

// ── Roles panel ──────────────────────────────────────────────────────────────

function RolesPanel({ roles }: { roles: RoleRow[] }) {
  const [editingRole, setEditingRole] = useState<RoleRow | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CreateRoleModal />
      </div>

      {roles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-pvx-border bg-pvx-surface p-10 text-center text-gray-500 text-sm">
          No custom roles yet. Create one to assign granular permissions to your team.
        </div>
      ) : (
        <div className="space-y-3">
          {roles.map(role => (
            <div
              key={role.id}
              className="rounded-xl border border-pvx-border bg-pvx-surface px-5 py-4 flex items-start justify-between gap-4"
            >
              <div className="space-y-2 min-w-0">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span className="text-sm font-semibold text-white">{role.name}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PERMISSION_KEYS.map(({ key, label }) => (
                    <span
                      key={key}
                      className={`text-xs px-2 py-0.5 rounded-full border ${
                        role.permissions[key]
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-gray-700/50 text-gray-500 border-gray-700 line-through'
                      }`}
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setEditingRole(role)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                  title="Edit role"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <form action={deleteRole}>
                  <input type="hidden" name="role_id" value={role.id} />
                  <button
                    type="submit"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                    title="Delete role"
                    onClick={e => {
                      if (!confirm(`Delete "${role.name}"? Members assigned this role will lose it.`)) {
                        e.preventDefault()
                      }
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingRole && (
        <EditRoleModal
          key={editingRole.id}
          role={editingRole}
          onClose={() => setEditingRole(null)}
        />
      )}
    </div>
  )
}

// ── Toast (auto-dismissing inline notice) ────────────────────────────────────

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4500)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-100 shadow-2xl">
      <CheckCircle2 className="w-4 h-4 text-emerald-300" />
      <span>{message}</span>
    </div>
  )
}

// ── Inbound forwarding address row ───────────────────────────────────────────

function InboundAddressRow({ address }: { address: string | null }) {
  const [state, action, pending] = useActionState(initializeInboundEmail, null)
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable — silently ignore
    }
  }

  if (!address) {
    return (
      <div className="space-y-2">
        <form action={action} className="flex gap-2">
          <input
            readOnly
            value="— not assigned yet —"
            className={INPUT + ' cursor-default opacity-60'}
          />
          <button type="submit" disabled={pending} className={BTN_PRIMARY + ' shrink-0'}>
            <Sparkles className="w-4 h-4" />
            {pending ? 'Generating…' : 'Generate Address'}
          </button>
        </form>
        {state?.status === 'error' && (
          <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
            {state.error}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex gap-2 items-stretch">
      <input
        readOnly
        value={address}
        className={INPUT + ' cursor-default font-mono text-xs'}
      />
      <button
        type="button"
        onClick={copy}
        title="Copy to clipboard"
        className={BTN_SECONDARY + ' shrink-0 border border-pvx-border hover:bg-white/5'}
      >
        {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

// ── Support Settings panel ───────────────────────────────────────────────────

function SupportSettingsPanel({ settings }: { settings: OrgSettings }) {
  const [state, action, pending] = useActionState(updateSupportEmail, null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (state?.status === 'success' && state.message) setToast(state.message)
  }, [state])

  const isConfirmed = !!settings.verified_support_email_confirmed_at
  const hasEmail    = !!settings.verified_support_email

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-pvx-border bg-pvx-surface p-5 space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-white">Customer-facing support email</h3>
          <p className="text-xs text-gray-500 mt-1">
            Outbound replies are sent from this address. Customers must see a domain you own to trust the email.
          </p>
        </div>

        <form action={action} className="space-y-4">
          <div>
            <label className={LABEL} htmlFor="support-email">Public Support Email</label>
            <div className="flex gap-2">
              <input
                id="support-email"
                name="support_email"
                type="email"
                required
                defaultValue={settings.verified_support_email ?? ''}
                placeholder="support@yourcompany.com"
                className={INPUT}
              />
              <button type="submit" disabled={pending} className={BTN_PRIMARY + ' shrink-0'}>
                <Mail className="w-4 h-4" />
                {pending ? 'Sending…' : 'Verify Email'}
              </button>
            </div>
            {hasEmail && (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="text-gray-400">Status:</span>
                {isConfirmed ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
                    <CheckCircle2 className="w-3 h-3" />
                    Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-yellow-300">
                    <Clock className="w-3 h-3" />
                    Pending Verification
                  </span>
                )}
              </div>
            )}
          </div>

          {state?.status === 'error' && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {state.error}
            </p>
          )}
        </form>

        <div className="border-t border-pvx-border pt-5">
          <label className={LABEL}>Your Kinvox Forwarding Address</label>
          <InboundAddressRow address={settings.inbound_email_address} />
          <p className="text-xs text-gray-500 mt-1">
            Forward inbound mail to this address; replies thread back into the matching ticket via the <code className="text-gray-400">[tk_…]</code> tag.
          </p>
        </div>
      </div>

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  )
}

// ── Main export ──────────────────────────────────────────────────────────────

const TABS = [
  { id: 'users',   label: 'User Administration' },
  { id: 'support', label: 'Support Settings' },
] as const

type TabId = typeof TABS[number]['id']

export default function TeamTabs({
  members,
  roles,
  orgSettings,
}: {
  members:     MemberRow[]
  roles:       RoleRow[]
  orgSettings: OrgSettings
}) {
  const [activeTab, setActiveTab] = useState<TabId>('users')

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-pvx-border">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-violet-500 text-white'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'users' ? (
        <div className="space-y-8">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">
                Members <span className="text-xs text-gray-500 font-normal">({members.length})</span>
              </h3>
            </div>
            <MembersPanel members={members} roles={roles} />
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Roles</h3>
            </div>
            <RolesPanel roles={roles} />
          </section>
        </div>
      ) : (
        <SupportSettingsPanel settings={orgSettings} />
      )}
    </div>
  )
}
