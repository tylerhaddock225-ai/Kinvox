'use client'

import { useRouter } from 'next/navigation'

interface Props {
  id:       string
  children: React.ReactNode
}

export default function LeadRow({ id, children }: Props) {
  const router = useRouter()
  return (
    <tr
      onClick={() => router.push(`/leads/${id}`)}
      className="cursor-pointer hover:bg-pvx-surface/50 transition-colors"
    >
      {children}
    </tr>
  )
}
