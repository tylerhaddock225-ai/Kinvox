// Minimal layout for anonymous landing pages (e.g. /l/[slug]). Mobile
// first — no sidebar, no chrome — so the form stays the focal point
// across every viewport. Kept deliberately thin so individual landing
// pages can opt into their own full-bleed hero styling.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-pvx-bg text-gray-100">
      {children}
    </div>
  )
}
