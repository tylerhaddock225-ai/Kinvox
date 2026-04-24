'use client'

import { useState } from 'react'
import {
  Radar,
  Plus,
  Save,
  Trash2,
  CheckCircle2,
  AlertCircle,
  MapPin,
  Tag,
} from 'lucide-react'
import {
  createSignalConfig,
  updateSignalConfig,
  deleteSignalConfig,
} from '@/app/(app)/(admin)/admin-hq/actions/signal-configs'
import ConfirmButton from '@/components/admin/ConfirmButton'
import type { SignalConfig, Vertical } from '@/lib/types/database.types'

type Props = {
  orgId:    string
  configs:  SignalConfig[]
  verticals: Vertical[]
  flash?: {
    saved?: boolean
    error?: string | null
  }
}

export default function OrgSignalConfigs({ orgId, configs, verticals, flash }: Props) {
  const [showNew, setShowNew] = useState(false)

  return (
    <div className="space-y-5">
      {flash?.saved ? (
        <div className="flex items-start gap-2 rounded-md border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
          <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>Signal config saved.</span>
        </div>
      ) : null}
      {flash?.error ? (
        <div className="flex items-start gap-2 rounded-md border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{flash.error}</span>
        </div>
      ) : null}

      {verticals.length === 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>No active verticals in the registry. Seed <span className="font-mono">public.verticals</span> before creating configs.</span>
        </div>
      ) : null}

      {/* Header row */}
      <div className="flex items-center justify-between gap-4 rounded-lg border border-pvx-border bg-pvx-surface/40 p-4">
        <div className="flex items-center gap-2">
          <Radar className="w-4 h-4 text-violet-300" />
          <div>
            <div className="text-sm font-semibold text-white">Geofence Configs</div>
            <div className="text-[11px] text-gray-500">
              {configs.length} total · {configs.filter(c => c.is_active).length} active
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowNew(s => !s)}
          disabled={verticals.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md border border-violet-700/60 bg-violet-950/40 px-3 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-900/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" />
          {showNew ? 'Cancel' : 'New config'}
        </button>
      </div>

      {/* New-config form */}
      {showNew && verticals.length > 0 && (
        <form
          action={createSignalConfig}
          className="rounded-lg border border-violet-700/40 bg-gray-900 p-4 space-y-4"
        >
          <input type="hidden" name="org_id" value={orgId} />
          <ConfigFields verticals={verticals} />
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowNew(false)}
              className="inline-flex items-center rounded-md border border-pvx-border bg-pvx-surface px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 hover:bg-violet-500 px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              Create config
            </button>
          </div>
        </form>
      )}

      {/* Existing configs */}
      {configs.length === 0 ? (
        <div className="rounded-lg border border-pvx-border bg-gray-900 px-4 py-8 text-center text-xs text-gray-500">
          No signal configs yet. Create one to start routing signals to this org.
        </div>
      ) : (
        <div className="space-y-3">
          {configs.map((c) => (
            <ConfigRow key={c.id} orgId={orgId} config={c} verticals={verticals} />
          ))}
        </div>
      )}
    </div>
  )
}

function ConfigRow({
  orgId,
  config,
  verticals,
}: {
  orgId:     string
  config:    SignalConfig
  verticals: Vertical[]
}) {
  const verticalLabel = verticals.find(v => v.id === config.vertical)?.label ?? config.vertical

  return (
    <div className="rounded-lg border border-pvx-border bg-gray-900 p-4 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-100 truncate">{verticalLabel}</span>
            {config.is_active ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-800/60 bg-emerald-950/30 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-200">
                Active
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md border border-pvx-border bg-pvx-surface px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-400">
                Paused
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-gray-500 font-mono">
            id {config.id.slice(0, 8)}…
          </div>
        </div>
      </header>

      <form action={updateSignalConfig} className="space-y-4">
        <input type="hidden" name="org_id"    value={orgId} />
        <input type="hidden" name="config_id" value={config.id} />
        <ConfigFields verticals={verticals} config={config} />
        <div className="flex items-center justify-end pt-1">
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 hover:bg-violet-500 px-3 py-1.5 text-xs font-medium text-white transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            Save changes
          </button>
        </div>
      </form>

      <form
        action={deleteSignalConfig}
        className="flex items-center justify-end border-t border-pvx-border pt-3"
      >
        <input type="hidden" name="org_id"    value={orgId} />
        <input type="hidden" name="config_id" value={config.id} />
        <ConfirmButton
          message="Delete this signal config? Pending-signal rows that referenced it are preserved; their attribution FK will be set to NULL."
          className="inline-flex items-center gap-1.5 rounded-md border border-rose-700/60 bg-rose-900/30 px-2.5 py-1 text-[11px] font-medium text-rose-100 hover:bg-rose-900/50 transition-colors"
        >
          <Trash2 className="w-3 h-3" />
          Delete config
        </ConfirmButton>
      </form>
    </div>
  )
}

function ConfigFields({
  verticals,
  config,
}: {
  verticals: Vertical[]
  config?:   SignalConfig
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label className="block sm:col-span-2">
        <span className="block text-[11px] font-medium uppercase tracking-wider text-gray-400 mb-1.5">
          Vertical
        </span>
        <select
          name="vertical"
          defaultValue={config?.vertical ?? ''}
          required
          className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
        >
          <option value="" disabled>Select a vertical…</option>
          {verticals.map(v => (
            <option key={v.id} value={v.id}>{v.label}</option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-gray-400 mb-1.5">
          <MapPin className="w-3 h-3" />
          Center Latitude
        </span>
        <input
          name="center_lat"
          type="number"
          step="any"
          defaultValue={config?.center_lat ?? ''}
          placeholder="e.g. 40.7128"
          className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 tabular-nums focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
        />
      </label>

      <label className="block">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-gray-400 mb-1.5">
          <MapPin className="w-3 h-3" />
          Center Longitude
        </span>
        <input
          name="center_long"
          type="number"
          step="any"
          defaultValue={config?.center_long ?? ''}
          placeholder="e.g. -74.0060"
          className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 tabular-nums focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
        />
      </label>

      <label className="block">
        <span className="block text-[11px] font-medium uppercase tracking-wider text-gray-400 mb-1.5">
          Radius (miles)
        </span>
        <input
          name="radius_miles"
          type="number"
          min={1}
          step={1}
          defaultValue={config?.radius_miles ?? 50}
          placeholder="50"
          className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 tabular-nums focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
        />
      </label>

      <label className="block">
        <span className="block text-[11px] font-medium uppercase tracking-wider text-gray-400 mb-1.5">
          Active
        </span>
        <div className="flex items-center h-[38px]">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              name="is_active"
              defaultChecked={config?.is_active ?? true}
              className="peer sr-only"
            />
            <div className="w-10 h-5 rounded-full bg-pvx-surface border border-pvx-border peer-checked:bg-violet-600 peer-checked:border-violet-500 transition-colors" />
            <div className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-gray-400 peer-checked:bg-white peer-checked:translate-x-5 transition-transform" />
          </label>
        </div>
      </label>

      <label className="block sm:col-span-2">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-gray-400 mb-1.5">
          <Tag className="w-3 h-3" />
          Keywords (comma-separated)
        </span>
        <input
          name="keywords"
          type="text"
          defaultValue={(config?.keywords ?? []).join(', ')}
          placeholder="storm damage, roof leak, hail"
          className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
        />
        <span className="mt-1.5 block text-[11px] text-gray-500">
          Matched case-insensitively against signal text by the capture endpoint.
        </span>
      </label>
    </div>
  )
}
