'use client'

import { Switch as SwitchPrimitive } from '@base-ui/react/switch'
import { cn } from '@/lib/utils'

// Base UI Switch wrapper styled to match the dark-mode tokens already in
// use across the HQ surface (gray-900 surfaces, violet accent on active).
// Behaviour mirrors shadcn's Switch — controlled or uncontrolled, supports
// the standard checked / onCheckedChange / disabled props from Base UI.

type RootProps = React.ComponentProps<typeof SwitchPrimitive.Root>

export function Switch({ className, ...props }: RootProps) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        // sizing + base
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors',
        // background: muted when off, violet when on
        'bg-gray-700 data-[checked]:bg-violet-600',
        // focus ring
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900',
        // disabled
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-4 rounded-full bg-white shadow ring-0 transition-transform',
          'translate-x-0.5 data-[checked]:translate-x-[18px]',
        )}
      />
    </SwitchPrimitive.Root>
  )
}
