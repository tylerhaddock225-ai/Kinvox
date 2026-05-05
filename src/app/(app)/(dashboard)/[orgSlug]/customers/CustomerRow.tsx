'use client'

import { useRouter } from 'next/navigation'

interface Props {
  id:       string
  orgSlug:  string
  children: React.ReactNode
}

export default function CustomerRow({ id, orgSlug, children }: Props) {
  const router = useRouter()
  return (
    <tr
      onClick={() => router.push(`/${orgSlug}/customers/${id}`)}
      className="cursor-pointer hover:bg-pvx-surface/50 transition-colors"
    >
      {children}
    </tr>
  )
}
