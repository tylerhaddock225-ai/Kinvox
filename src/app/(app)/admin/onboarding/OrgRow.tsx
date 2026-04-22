'use client'

import { useState } from 'react'
import { setSubscriptionStatus, inviteOrgOwner } from './actions'

type Status = 'unpaid' | 'trialing' | 'active' | 'past_due' | 'canceled'

interface OrgRowProps {
  id: string
  name: string
  slug: string
  plan: string
  subscription_status: Status
  owner_email: string | null
  stripe_customer_id: string | null
  created_at: string
}

const STATUS_STYLES: Record<Status, string> = {
  unpaid:   'bg-gray-500/10 text-gray-400 border-gray-500/20',
  trialing: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  active:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  past_due: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  canceled: 'bg-red-500/10 text-red-400 border-red-500/20',
}

export default function OrgRow(props: OrgRowProps) {
  const [status, setStatus]     = useState<Status>(props.subscription_status)
  const [toggling, setToggling] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  async function handleToggle() {
    setToggling(true)
    setFeedback(null)
    const next = status === 'active' ? 'unpaid' : 'active'
    const result = await setSubscriptionStatus(props.id, next)
    if (result?.error) {
      setFeedback(`Error: ${result.error}`)
    } else {
      setStatus(next)
      setFeedback(next === 'active' ? 'Marked active ✓' : 'Reverted to unpaid')
    }
    setToggling(false)
  }

  async function handleInvite() {
    if (!props.owner_email) return setFeedback('No owner email found.')
    setInviting(true)
    setFeedback(null)
    const result = await inviteOrgOwner(props.id, props.owner_email)
    setFeedback(result?.error ? `Error: ${result.error}` : `Invite sent to ${props.owner_email} ✓`)
    setInviting(false)
  }

  return (
    <tr className="border-b border-gray-800 hover:bg-gray-800/40 transition-colors">
      <td className="px-4 py-3">
        <div className="font-medium text-white text-sm">{props.name}</div>
        <div className="text-xs text-gray-500 font-mono">{props.slug}</div>
      </td>
      <td className="px-4 py-3 text-sm text-gray-400 capitalize">{props.plan}</td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${STATUS_STYLES[status]}`}>
          {status}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-gray-500 font-mono">
        {props.owner_email ?? <span className="text-gray-600">—</span>}
      </td>
      <td className="px-4 py-3 text-xs text-gray-500 font-mono">
        {props.stripe_customer_id ?? <span className="text-gray-600">—</span>}
      </td>
      <td className="px-4 py-3 text-xs text-gray-500">
        {new Date(props.created_at).toLocaleDateString()}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleToggle}
            disabled={toggling}
            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 ${
              status === 'active'
                ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {toggling ? '…' : status === 'active' ? 'Revoke' : 'Mark Active'}
          </button>

          {status === 'active' && (
            <button
              onClick={handleInvite}
              disabled={inviting || !props.owner_email}
              className="text-xs px-3 py-1.5 rounded-lg font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
            >
              {inviting ? 'Sending…' : 'Send Invite'}
            </button>
          )}

          {feedback && (
            <span className={`text-xs ${feedback.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
              {feedback}
            </span>
          )}
        </div>
      </td>
    </tr>
  )
}
