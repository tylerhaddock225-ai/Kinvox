'use client'

import type { ComponentProps, ReactNode } from 'react'

interface Props extends ComponentProps<'button'> {
  message: string
  children: ReactNode
}

/**
 * Form-submit button that requires a native confirm() before firing.
 * Safe to use inside a <form action={serverAction}>.
 */
export default function ConfirmButton({ message, children, onClick, ...rest }: Props) {
  return (
    <button
      type="submit"
      {...rest}
      onClick={(e) => {
        if (!window.confirm(message)) {
          e.preventDefault()
          return
        }
        onClick?.(e)
      }}
    >
      {children}
    </button>
  )
}
