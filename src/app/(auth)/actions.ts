'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function login(formData: FormData) {
  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  })

  if (error) return { error: error.message }

  revalidatePath('/', 'layout')
  redirect('/')
}

function validatePassword(password: string): string | null {
  if (password.length < 8)            return 'Password must be at least 8 characters.'
  if (!/[A-Z]/.test(password))        return 'Password must contain at least 1 uppercase letter.'
  if (!/[a-z]/.test(password))        return 'Password must contain at least 1 lowercase letter.'
  if (!/[0-9]/.test(password))        return 'Password must contain at least 1 number.'
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least 1 symbol (e.g. !@#$).'
  return null
}

export async function signup(formData: FormData) {
  const password        = formData.get('password') as string
  const confirmPassword = formData.get('confirm_password') as string

  if (password !== confirmPassword) return { error: 'Passwords do not match.' }

  const complexityError = validatePassword(password)
  if (complexityError) return { error: complexityError }

  const supabase = await createClient()

  const { error } = await supabase.auth.signUp({
    email: formData.get('email') as string,
    password,
    options: {
      data: { full_name: formData.get('full_name') as string },
    },
  })

  if (error) return { error: error.message }

  revalidatePath('/', 'layout')
  redirect('/onboarding')
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
