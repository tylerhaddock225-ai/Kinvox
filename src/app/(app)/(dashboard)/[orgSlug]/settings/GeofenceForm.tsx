'use client'

import { useActionState, useState } from 'react'
import { MapPin, CheckCircle2, AlertCircle } from 'lucide-react'
import { saveGeofence, type SaveGeofenceState } from '@/app/(app)/(dashboard)/actions/organizations'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import type { GeofenceRow } from './page'

const MIN_RADIUS = 1
const MAX_RADIUS = 50

export default function GeofenceForm({ initial }: { initial: GeofenceRow }) {
  const [state, action, pending] = useActionState<SaveGeofenceState, FormData>(saveGeofence, null)

  const startingRadius = clampRadius(initial.signal_radius ?? 25)
  const [radius, setRadius] = useState<number>(startingRadius)

  return (
    <section className="rounded-xl border border-pvx-border bg-gray-900 p-5">
      <div className="flex items-center gap-2">
        <MapPin className="w-4 h-4 text-violet-300" />
        <h2 className="text-sm font-semibold text-white">Organization Geofence</h2>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Coordinates + radius used to scope incoming signals to your service area.
      </p>

      {state?.status === 'success' && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
          <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>Geofence saved.</span>
        </div>
      )}
      {state?.status === 'error' && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      <form action={action} className="mt-5 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Latitude">
            <input
              name="latitude"
              type="number"
              step="any"
              min={-90}
              max={90}
              defaultValue={initial.latitude ?? ''}
              placeholder="35.4676"
              className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 font-mono focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
            />
          </Field>
          <Field label="Longitude">
            <input
              name="longitude"
              type="number"
              step="any"
              min={-180}
              max={180}
              defaultValue={initial.longitude ?? ''}
              placeholder="-97.5164"
              className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 font-mono focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
            />
          </Field>
        </div>

        <div className="space-y-3 rounded-md border border-pvx-border bg-pvx-surface px-4 py-4">
          <div className="flex items-baseline justify-between">
            <Label
              htmlFor="signal_radius_slider"
              className="text-[11px] font-medium uppercase tracking-wider text-gray-400"
            >
              Coverage Radius
            </Label>
            <span className="text-sm font-mono text-violet-200">
              {radius} {radius === 1 ? 'mile' : 'miles'}
            </span>
          </div>
          <Slider
            id="signal_radius_slider"
            min={MIN_RADIUS}
            max={MAX_RADIUS}
            step={1}
            value={[radius]}
            onValueChange={(next) => {
              const v = Array.isArray(next) ? next[0] : next
              if (typeof v === 'number') setRadius(clampRadius(v))
            }}
          />
          <div className="flex justify-between text-[10px] uppercase tracking-wider text-gray-500">
            <span>{MIN_RADIUS} mi</span>
            <span>{MAX_RADIUS} mi</span>
          </div>
          <input type="hidden" name="signal_radius" value={radius} readOnly />
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-white transition-colors"
          >
            {pending ? 'Saving…' : 'Save Geofence'}
          </button>
        </div>
      </form>
    </section>
  )
}

function clampRadius(n: number): number {
  if (!Number.isFinite(n)) return 25
  const rounded = Math.round(n)
  if (rounded < MIN_RADIUS) return MIN_RADIUS
  if (rounded > MAX_RADIUS) return MAX_RADIUS
  return rounded
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
