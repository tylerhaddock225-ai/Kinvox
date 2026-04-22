import { Eye, LogOut } from 'lucide-react'
import { stopImpersonation } from '@/app/(app)/actions/impersonation'

interface Props {
  orgName: string
}

export default function ImpersonationBanner({ orgName }: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-violet-500/40 bg-gradient-to-r from-violet-700 via-violet-600 to-violet-700 px-6 py-2 text-sm text-white shadow-lg shadow-violet-950/40"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Eye className="w-4 h-4 shrink-0 text-violet-200" />
        <span className="truncate">
          Viewing as <strong className="font-semibold">{orgName}</strong>
        </span>
      </div>
      <form action={stopImpersonation}>
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-md border border-violet-300/40 bg-violet-800/60 px-3 py-1 text-xs font-medium text-violet-50 hover:bg-violet-800 transition-colors shrink-0"
        >
          <LogOut className="w-3.5 h-3.5" />
          Exit to HQ
        </button>
      </form>
    </div>
  )
}
