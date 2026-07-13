'use client'

import { useState, useRef, useEffect, useActionState, useTransition } from 'react'
import { Plus, X, UserPlus, Pencil, Trash2, ShieldCheck, CheckCircle2, Send } from 'lucide-react'
import {
  inviteMember,
  updateMemberRole,
  removeMember,
  resendInvite,
  createRole,
  updateRole,
  deleteRole,
} from './actions'
import {
  updateSupportEmail,
  initializeInboundEmail,
  refreshSupportEmailStatus,
} from '@/app/(app)/(dashboard)/actions/org-settings'
import EmailVerificationPanel from '@/components/settings/EmailVerificationPanel'
import InboundAddressRow from '@/components/settings/InboundAddressRow'
import LeadSupportTab, { type LeadSupportState } from '@/components/settings/lead-support-tab'
import { PERMISSION_KEYS, DEFAULT_PERMISSIONS, type Permissions } from '@/lib/permissions'
import type { CatalogRow } from '@/lib/permissions/grouping'
import GroupedPermissionGrid from '@/components/permissions/GroupedPermissionGrid'
import PermissionPills from '@/components/permissions/PermissionPills'
import type { MemberRow, RoleRow, PendingInviteRow } from './page'

export type OrgSettings = {
  // Pre-constructed full plus-addressed email (server side via
  // constructInboundEmailAddress); null when no tag is set or env is unset.
  inbound_email_address:               string | null
  verified_support_email:              string | null
  verified_support_email_confirmed_at: string | null
}

export type { LeadSupportState }

// ── Shared style tokens ──────────────────────────────────────────────────────

const INPUT  = 'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500'
const LABEL  = 'block text-xs font-medium text-gray-400 mb-1'
const BTN    = 'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const BTN_PRIMARY   = `${BTN} bg-indigo-600 text-white hover:bg-indigo-500`
const BTN_SECONDARY = `${BTN} text-gray-400 hover:text-white`

// ── Permission checkboxes ────────────────────────────────────────────────────

// Workstream L — grouped + searchable grid sourced from permission_catalog.
// Checkbox names/defaults are unchanged (defaults(key) reproduces the prior
// `defaults ? defaults[key] : DEFAULT_PERMISSIONS[key]`), so the submit payload
// is identical; only grouping + search are added. An empty catalog falls back to
// the flat grid inside GroupedPermissionGrid.
function PermissionGrid({ defaults, catalog }: { defaults?: Permissions; catalog: CatalogRow[] }) {
  return (
    <GroupedPermissionGrid
      catalog={catalog}
      flatKeys={PERMISSION_KEYS}
      variant="org"
      defaults={(key) =>
        defaults
          ? Boolean((defaults as Record<string, boolean>)[key])
          : Boolean((DEFAULT_PERMISSIONS as Record<string, boolean>)[key])
      }
    />
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

function MembersPanel({
  members,
  roles,
  callerId,
  ownerId,
}: {
  members: MemberRow[]
  roles: RoleRow[]
  callerId: string
  ownerId: string | null
}) {
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
              <th className="px-5 py-3 text-left font-medium">Custom Role</th>
              <th className="px-5 py-3 text-right font-medium sr-only">Actions</th>
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
              members.map(m => {
                const isProtected = m.id === callerId || m.id === ownerId
                return (
                  <tr key={m.id} className="hover:bg-violet-400/[0.07] transition-colors">
                    <td className="px-5 py-3 text-gray-200 font-medium">
                      {m.full_name ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-400">{m.email ?? '—'}</td>
                    <td className="px-5 py-3">
                      <MemberRoleSelect
                        memberId={m.id}
                        currentRoleId={m.role_id}
                        roles={roles}
                      />
                    </td>
                    <td className="px-5 py-3 text-right">
                      {isProtected ? (
                        <span className="text-xs text-gray-600">—</span>
                      ) : (
                        <form action={removeMember} className="inline">
                          <input type="hidden" name="member_id" value={m.id} />
                          <button
                            type="submit"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                            title="Remove member"
                            onClick={e => {
                              if (!confirm(`Remove ${m.full_name ?? m.email ?? 'this member'} from the organization? They'll lose access immediately.`)) {
                                e.preventDefault()
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Pending invitations panel ────────────────────────────────────────────────

function formatInviteDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function ResendInviteButton({ inviteId }: { inviteId: string }) {
  const [pending, startTransition] = useTransition()
  return (
    <form action={(fd: FormData) => startTransition(() => resendInvite(fd))} className="inline">
      <input type="hidden" name="invite_id" value={inviteId} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-pvx-border px-3 py-1.5 text-xs font-medium text-gray-300 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Send className="w-3.5 h-3.5" />
        {pending ? 'Sending…' : 'Resend'}
      </button>
    </form>
  )
}

function PendingInvitesPanel({
  invites,
  roles,
}: {
  invites: PendingInviteRow[]
  roles: RoleRow[]
}) {
  // Map role_id → name from the roles already loaded for this tab (no extra query).
  const roleName = (id: string | null): string | null =>
    id ? (roles.find(r => r.id === id)?.name ?? null) : null

  if (invites.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-pvx-border bg-pvx-surface p-10 text-center text-gray-500 text-sm">
        No outstanding invitations.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-pvx-border bg-pvx-surface overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-pvx-border text-xs text-gray-500">
            <th className="px-5 py-3 text-left font-medium">Email</th>
            <th className="px-5 py-3 text-left font-medium">Assigned Role</th>
            <th className="px-5 py-3 text-left font-medium">Status</th>
            <th className="px-5 py-3 text-right font-medium sr-only">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-pvx-border">
          {invites.map(inv => {
            const expired = inv.expired
            return (
              <tr key={inv.id} className="hover:bg-violet-400/[0.07] transition-colors">
                <td className="px-5 py-3">
                  <div className="text-gray-200 font-medium">{inv.email}</div>
                  {inv.full_name && (
                    <div className="text-xs text-gray-500">{inv.full_name}</div>
                  )}
                </td>
                <td className="px-5 py-3 text-gray-400">{roleName(inv.role_id) ?? 'No role'}</td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                      expired
                        ? 'bg-red-500/10 text-red-400 border-red-500/20'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    }`}>
                      {expired ? 'Expired' : 'Pending'}
                    </span>
                    <span className="text-xs text-gray-500">
                      expires {formatInviteDate(inv.expires_at)}
                    </span>
                  </div>
                </td>
                <td className="px-5 py-3 text-right">
                  <ResendInviteButton inviteId={inv.id} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Create role modal ────────────────────────────────────────────────────────

function CreateRoleModal({ catalog }: { catalog: CatalogRow[] }) {
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

      {/* Widened + internally-scrolling: header and footer stay pinned while the
          body scrolls, so the action buttons are reachable without scrolling past
          every permission. min-h-0 on the flex children is what lets the body's
          overflow-y-auto actually engage. */}
      <dialog
        ref={dialogRef}
        className="m-auto w-[calc(100%-2rem)] max-w-4xl max-h-[85vh] open:flex open:flex-col overflow-hidden rounded-xl border border-pvx-border bg-pvx-surface text-white shadow-2xl backdrop:bg-black/70"
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <h2 className="text-base font-semibold">Create Role</h2>
          <button type="button" onClick={() => dialogRef.current?.close()} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form ref={formRef} action={action} className="flex flex-col min-h-0 flex-1">
          <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-2 space-y-5">
            <div>
              <label className={LABEL} htmlFor="role-name">Role Name <span className="text-red-400">*</span></label>
              <input id="role-name" name="name" type="text" required placeholder="e.g. Junior Support" className={INPUT} />
            </div>

            <div>
              <p className={LABEL}>Permissions</p>
              <div className="mt-2 p-3 rounded-lg border border-pvx-border bg-black/25">
                <PermissionGrid catalog={catalog} />
              </div>
            </div>

            {state?.status === 'error' && (
              <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {state.error}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-3 px-6 py-4 border-t border-pvx-border shrink-0">
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

function EditRoleModal({ role, onClose, catalog }: { role: RoleRow; onClose: () => void; catalog: CatalogRow[] }) {
  const [state, action, pending] = useActionState(updateRole, null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => { dialogRef.current?.showModal() }, [])
  useEffect(() => {
    if (state?.status === 'success') onClose()
  }, [state, onClose])

  // Same widen + internal-scroll structure as CreateRoleModal (keeps this modal's
  // gray theme). min-h-0 on the flex chain enables the body scroll.
  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-4xl max-h-[85vh] open:flex open:flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900 text-white shadow-2xl backdrop:bg-black/60"
    >
      <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
        <h2 className="text-base font-semibold">Edit Role</h2>
        <button type="button" onClick={() => dialogRef.current?.close()} className="text-gray-400 hover:text-white">
          <X className="w-5 h-5" />
        </button>
      </div>

      <form action={action} className="flex flex-col min-h-0 flex-1">
        <input type="hidden" name="role_id" value={role.id} />

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-2 space-y-5">
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
              <PermissionGrid defaults={role.permissions} catalog={catalog} />
            </div>
          </div>

          {state?.status === 'error' && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {state.error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-700 shrink-0">
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

function RolesPanel({ roles, catalog }: { roles: RoleRow[]; catalog: CatalogRow[] }) {
  const [editingRole, setEditingRole] = useState<RoleRow | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CreateRoleModal catalog={catalog} />
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
                <PermissionPills
                  catalog={catalog}
                  flatKeys={PERMISSION_KEYS}
                  granted={(key) => Boolean((role.permissions as Record<string, boolean>)[key])}
                />
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
          catalog={catalog}
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

// ── Support Settings panel ───────────────────────────────────────────────────

function SupportSettingsPanel({ settings }: { settings: OrgSettings }) {
  const [toast, setToast] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      <EmailVerificationPanel
        title="Customer-facing support email"
        description="Used for support tickets and customer service replies."
        inputName="support_email"
        inputId="support-email"
        email={settings.verified_support_email}
        confirmedAt={settings.verified_support_email_confirmed_at}
        verifyAction={updateSupportEmail}
        refreshAction={refreshSupportEmailStatus}
        onSuccessToast={setToast}
      />

      <InboundAddressRow
        address={settings.inbound_email_address}
        action={initializeInboundEmail}
        tagPrefix="tk"
        heading="Your Kinvox Forwarding Address"
      />

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  )
}

// ── Main export ──────────────────────────────────────────────────────────────

const TABS = [
  { id: 'users',        label: 'User Administration' },
  { id: 'support',      label: 'Support Settings'    },
  { id: 'lead-support', label: 'Lead Settings'       },
] as const

type TabId = typeof TABS[number]['id']

const TAB_IDS: ReadonlySet<TabId> = new Set(TABS.map(t => t.id))

function isTabId(value: string | undefined): value is TabId {
  return value !== undefined && TAB_IDS.has(value as TabId)
}

export default function TeamTabs({
  members,
  roles,
  permissionCatalog,
  callerId,
  ownerId,
  pendingInvites,
  orgSettings,
  leadSupport,
  initialTab,
}: {
  members:           MemberRow[]
  roles:             RoleRow[]
  permissionCatalog: CatalogRow[]
  callerId:          string
  ownerId:        string | null
  pendingInvites: PendingInviteRow[]
  orgSettings:    OrgSettings
  leadSupport:    LeadSupportState
  initialTab?:    string
}) {
  const [activeTab, setActiveTab] = useState<TabId>(
    isTabId(initialTab) ? initialTab : 'users',
  )

  return (
    <div className="space-y-6">
      {/* Tab bar — sticky below the dashboard header (z-30 at top:0).
          top-16 clears the header's ~64px height; bg + backdrop mask
          content scrolling underneath. */}
      <div className="sticky top-16 z-20 flex gap-1 border-b border-pvx-border bg-pvx-bg/80 backdrop-blur">
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
      {activeTab === 'users' && (
        <div className="space-y-8">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">
                Members <span className="text-xs text-gray-500 font-normal">({members.length})</span>
              </h3>
            </div>
            <MembersPanel members={members} roles={roles} callerId={callerId} ownerId={ownerId} />
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">
                Pending Invitations <span className="text-xs text-gray-500 font-normal">({pendingInvites.length})</span>
              </h3>
            </div>
            <PendingInvitesPanel invites={pendingInvites} roles={roles} />
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Roles</h3>
            </div>
            <RolesPanel roles={roles} catalog={permissionCatalog} />
          </section>
        </div>
      )}

      {activeTab === 'support' && (
        <SupportSettingsPanel settings={orgSettings} />
      )}

      {activeTab === 'lead-support' && (
        <LeadSupportTab state={leadSupport} />
      )}
    </div>
  )
}
