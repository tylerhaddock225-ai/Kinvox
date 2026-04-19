import { redirect } from 'next/navigation'

// Self-serve signup is disabled — accounts are provisioned by an admin.
// Anyone landing on /signup is bounced to the login page.
export default function SignupDisabledPage() {
  redirect('/login')
}
