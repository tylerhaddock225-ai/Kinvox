'use client'

import { useActionState } from 'react'
import { Unplug, AlertCircle } from 'lucide-react'
import {
  disconnectSocialPlatform,
  type DisconnectSocialState,
} from '@/app/(app)/(dashboard)/actions/social'
import { Button } from '@/components/ui/button'

type Props = { platform: 'reddit' | 'x' | 'facebook' | 'threads' }

// Small client wrapper around the disconnect action so we can surface a
// pending state and a precise error message without a full page reload.
// Success is reflected by revalidatePath in the action.
export default function DisconnectButton({ platform }: Props) {
  const [state, action, pending] = useActionState<DisconnectSocialState, FormData>(
    disconnectSocialPlatform,
    null,
  )

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="platform" value={platform} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        <Unplug className="mr-1.5" />
        {pending ? 'Disconnecting…' : 'Disconnect'}
      </Button>
      {state?.status === 'error' && (
        <span className="inline-flex items-center gap-1 text-[11px] text-rose-300">
          <AlertCircle className="w-3 h-3" />
          {state.error}
        </span>
      )}
    </form>
  )
}
