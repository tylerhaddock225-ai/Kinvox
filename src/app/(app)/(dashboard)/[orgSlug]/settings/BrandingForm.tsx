'use client'

import { useActionState, useState } from 'react'
import { ImageIcon, CheckCircle2, AlertCircle, Upload } from 'lucide-react'
import { uploadOrgLogo, type UploadLogoState } from '@/app/(app)/(dashboard)/actions/organizations'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const ACCEPTED_MIME = 'image/png,image/jpeg'
const MAX_BYTES     = 2 * 1024 * 1024

export default function BrandingForm({ initialLogoUrl }: { initialLogoUrl: string | null }) {
  const [state, action, pending] = useActionState<UploadLogoState, FormData>(uploadOrgLogo, null)

  const [localPreview, setLocalPreview] = useState<string | null>(null)
  const [clientError, setClientError]   = useState<string | null>(null)

  // Prefer the URL just returned by the server (cache-busted) over the
  // initial DB value so the user sees their fresh logo immediately.
  const savedLogoUrl =
    state?.status === 'success' ? state.logo_url : initialLogoUrl

  // Live preview wins over any persisted URL while a file is selected.
  const previewUrl = localPreview ?? savedLogoUrl

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setClientError(null)
    const file = e.target.files?.[0]
    if (!file) {
      setLocalPreview(null)
      return
    }
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setClientError('Logo must be a PNG or JPG image')
      setLocalPreview(null)
      e.target.value = ''
      return
    }
    if (file.size > MAX_BYTES) {
      setClientError('Logo must be 2MB or smaller')
      setLocalPreview(null)
      e.target.value = ''
      return
    }
    const url = URL.createObjectURL(file)
    setLocalPreview(url)
  }

  return (
    <section className="rounded-xl border border-pvx-border bg-gray-900 p-5">
      <div className="flex items-center gap-2">
        <ImageIcon className="w-4 h-4 text-violet-300" />
        <h2 className="text-sm font-semibold text-white">Organization Branding</h2>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Upload your organization's logo. PNG or JPG, up to 2&nbsp;MB.
      </p>

      {state?.status === 'success' && !clientError && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
          <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>Logo uploaded.</span>
        </div>
      )}
      {(state?.status === 'error' || clientError) && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{clientError ?? (state?.status === 'error' ? state.error : null)}</span>
        </div>
      )}

      <form action={action} className="mt-5 space-y-5">
        <div className="flex items-center gap-5">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-pvx-border bg-pvx-surface">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Organization logo"
                className="h-full w-full object-contain"
              />
            ) : (
              <ImageIcon className="h-6 w-6 text-gray-600" />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <Label
              htmlFor="logo"
              className="text-[11px] font-medium uppercase tracking-wider text-gray-400"
            >
              Logo File
            </Label>
            <Input
              id="logo"
              name="logo"
              type="file"
              accept={ACCEPTED_MIME}
              required
              onChange={onFileChange}
              className="h-9 cursor-pointer text-gray-100"
            />
            <p className="text-[10px] text-gray-500">PNG or JPG · max 2 MB</p>
          </div>
        </div>

        <div className="pt-1">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-white transition-colors"
          >
            <Upload className="h-3.5 w-3.5" />
            {pending ? 'Uploading…' : 'Upload Logo'}
          </button>
        </div>
      </form>
    </section>
  )
}
