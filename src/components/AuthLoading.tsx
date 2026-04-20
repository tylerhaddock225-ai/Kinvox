import Logo from './Logo'

// Shared loading state used by the root Suspense boundary and the
// /pending-invite client gate. Kept in a single place so the spinner
// reads as the same surface wherever the sorting hat is deciding.
export default function AuthLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="flex flex-col items-center gap-4">
        <div className="animate-pulse drop-shadow-[0_0_20px_rgba(16,185,129,0.35)]">
          <Logo size={48} />
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-emerald-400/70">
          {label}
        </div>
      </div>
    </div>
  )
}
