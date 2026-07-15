'use client'

import { useState, useRef, useEffect, useActionState } from 'react'
import { Switch } from '@/components/ui/switch'
import { setOrgFeatureFlag } from '@/app/(app)/(admin)/hq/actions/ai-templates'

// Null initial for useActionState, typed to the action's own return shape.
const INITIAL = null as Awaited<ReturnType<typeof setOrgFeatureFlag>>

type ToggleProps = {
  orgId:   string
  flag:    string
  label:   string
  helper:  string
  initial: boolean
}

// One feature_flags key ⇄ one Switch. Submits on change (no separate Save step),
// posting org_id + flag + value to the shared setOrgFeatureFlag action. On a
// save error the switch reverts to the persisted value.
function FeatureToggle({ orgId, flag, label, helper, initial }: ToggleProps) {
  const [checked, setChecked] = useState(initial)
  const [state, formAction, isPending] = useActionState(setOrgFeatureFlag, INITIAL)
  const formRef  = useRef<HTMLFormElement>(null)
  const valueRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (state?.status === 'error') setChecked(initial)
  }, [state, initial])

  function onToggle(next: boolean) {
    setChecked(next)
    if (valueRef.current) valueRef.current.value = String(next)
    formRef.current?.requestSubmit()
  }

  return (
    <form ref={formRef} action={formAction} className="flex items-start justify-between gap-4">
      <input type="hidden" name="org_id" value={orgId} />
      <input type="hidden" name="flag" value={flag} />
      <input type="hidden" name="value" ref={valueRef} defaultValue={String(initial)} />

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-100">{label}</div>
        <div className="mt-0.5 text-xs text-gray-400 leading-relaxed">{helper}</div>
        {state?.status === 'error' && (
          <div className="mt-1 text-xs text-red-400">{state.error}</div>
        )}
        {state?.status === 'success' && (
          <div className="mt-1 text-xs text-emerald-400">Saved</div>
        )}
      </div>

      <Switch
        checked={checked}
        onCheckedChange={onToggle}
        disabled={isPending}
        aria-label={label}
        className="mt-0.5 shrink-0"
      />
    </form>
  )
}

/**
 * HQ per-org AI feature switches. Writes organizations.feature_flags via the
 * generic setOrgFeatureFlag action (allowlisted keys, jsonb merge). AI Support
 * gates Stage-2 Ticket Assist; Review Monitoring is the control for the upcoming
 * review agent (inert until Stage 3, but wired to the same writer for free).
 */
export default function OrgFeatureToggles({
  orgId,
  featureFlags,
}: {
  orgId:        string
  featureFlags: Record<string, unknown>
}) {
  return (
    <div className="space-y-5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        AI Features
      </div>

      <FeatureToggle
        orgId={orgId}
        flag="ai_support_enabled"
        label="AI Support Agent"
        helper="Lets agents draft ticket replies with AI."
        initial={featureFlags.ai_support_enabled === true}
      />

      <FeatureToggle
        orgId={orgId}
        flag="review_monitoring_enabled"
        label="Review Monitoring"
        helper="Control for the upcoming AI review agent. No effect until review monitoring ships."
        initial={featureFlags.review_monitoring_enabled === true}
      />
    </div>
  )
}
