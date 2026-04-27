'use client'

import { useActionState, useState } from 'react'
import { Save, MapPin, Tag, AlertCircle, CheckCircle2, Crosshair } from 'lucide-react'
import { saveHuntingProfile, type SaveHuntingProfileState } from '@/app/(app)/(dashboard)/actions/signals'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'

type Props = {
  orgVertical:    string | null
  initialAddress: string | null
  initialRadius:  number
  initialKeywords: string[]
}

const RADIUS_MIN = 5
const RADIUS_MAX = 500

// Per-vertical hunting profile form. Edits the tenant's primary
// signal_configs row (oldest active for the org). Slider is controlled
// so the displayed value stays in sync with what posts; keywords are
// comma-separated and the server splits/dedupes/length-caps before save.
export default function HuntingProfileForm({
  orgVertical,
  initialAddress,
  initialRadius,
  initialKeywords,
}: Props) {
  const [state, action, pending] = useActionState<SaveHuntingProfileState, FormData>(
    saveHuntingProfile,
    null,
  )

  const [radius, setRadius] = useState<number>(
    Number.isFinite(initialRadius) ? initialRadius : 25,
  )

  return (
    <section className="rounded-xl border border-pvx-border bg-gray-900 p-5 space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Crosshair className="w-4 h-4 text-violet-300" />
          <h2 className="text-sm font-semibold text-white">Hunting Profile</h2>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Where Kinvox listens for high-intent posts. Saved against your
          {' '}{orgVertical ? <span className="font-mono text-gray-400">{orgVertical}</span> : 'organization'}{' '}
          signal config — distinct from the org-level geofence on the main Settings page.
        </p>
      </div>

      <form action={action} className="space-y-5">
        {/* Office Address */}
        <label className="block">
          <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-gray-400 mb-1.5">
            <MapPin className="w-3 h-3" />
            Office Address
          </span>
          <input
            name="office_address"
            type="text"
            defaultValue={initialAddress ?? ''}
            placeholder="123 Main St, Norman, OK 73069"
            maxLength={500}
            className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
          />
          <p className="mt-1 text-[11px] text-gray-500">
            Free-text address shown alongside the hunting radius. Optional.
          </p>
        </label>

        {/* Search Radius */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-gray-400">
              <Crosshair className="w-3 h-3" />
              Search Radius
            </span>
            <span className="text-xs font-mono tabular-nums text-violet-200">
              {radius} mi
            </span>
          </div>
          <Slider
            min={RADIUS_MIN}
            max={RADIUS_MAX}
            value={[radius]}
            onValueChange={(v) => {
              const next = Array.isArray(v) ? v[0] : v
              if (typeof next === 'number') setRadius(Math.round(next))
            }}
            className="mt-2"
          />
          <input type="hidden" name="radius_miles" value={radius} />
          <div className="mt-1 flex justify-between text-[10px] text-gray-600 font-mono">
            <span>{RADIUS_MIN} mi</span>
            <span>{RADIUS_MAX} mi</span>
          </div>
        </div>

        {/* Keywords */}
        <label className="block">
          <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-gray-400 mb-1.5">
            <Tag className="w-3 h-3" />
            Keywords
          </span>
          <textarea
            name="keywords"
            rows={3}
            defaultValue={initialKeywords.join(', ')}
            placeholder="storm shelter, safe room, tornado bunker"
            className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
          />
          <p className="mt-1 text-[11px] text-gray-500">
            Comma- or newline-separated. Up to 25 keywords, 60 characters each. Duplicates and blanks are ignored on save.
          </p>
        </label>

        {/* Status banners */}
        {state?.status === 'error' && (
          <div className="flex items-start gap-2 rounded-md border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{state.error}</span>
          </div>
        )}
        {state?.status === 'success' && (
          <div className="flex items-start gap-2 rounded-md border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>Hunting profile saved.</span>
          </div>
        )}

        <div className="pt-1 flex items-center justify-end">
          <Button type="submit" disabled={pending} size="sm">
            <Save className="mr-1.5" />
            {pending ? 'Saving…' : 'Save Hunting Profile'}
          </Button>
        </div>
      </form>
    </section>
  )
}
