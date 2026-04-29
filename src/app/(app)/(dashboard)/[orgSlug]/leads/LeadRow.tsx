'use client'

import { useRouter } from 'next/navigation'

interface Props {
  orgSlug:  string
  id:       string
  children: React.ReactNode
}

export default function LeadRow({ orgSlug, id, children }: Props) {
  const router = useRouter()
  return (
    <tr
      onClick={() => router.push(`/${orgSlug}/leads/${id}`)}
      className="cursor-pointer hover:bg-pvx-surface/50 transition-colors"
    >
      {children}
    </tr>
  )
}
