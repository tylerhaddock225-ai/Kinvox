import Link from 'next/link'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.kinvoxtech.com'

export const metadata = {
  title: 'Kinvox — Sales & Support, built for Oklahoma City',
  description:
    'The all-in-one Sales and Support workspace for Oklahoma City businesses. Leads, appointments, tickets — one place.',
}

export default function LandingPage() {
  return (
    <>
      <section className="max-w-5xl mx-auto px-6 pt-24 pb-16 text-center">
        <p className="inline-block rounded-full border border-gray-700 px-3 py-1 text-xs text-gray-300 mb-6">
          Now accepting Oklahoma City businesses
        </p>
        <h1 className="text-5xl sm:text-6xl font-semibold tracking-tight leading-tight">
          Run sales and support <br className="hidden sm:block" />
          from one clean workspace.
        </h1>
        <p className="mt-6 text-lg text-gray-400 max-w-2xl mx-auto">
          Kinvox pulls your leads, appointments, and tickets into a single dashboard —
          designed for small businesses that don&rsquo;t have time to wire five tools together.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link
            href="/apply"
            className="rounded-lg bg-white text-gray-900 hover:bg-gray-200 px-6 py-3 font-medium"
          >
            Apply for access
          </Link>
          <a
            href={`${APP_URL}/login`}
            className="rounded-lg border border-gray-700 hover:border-gray-500 px-6 py-3 font-medium"
          >
            Existing customer? Sign in
          </a>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-16 grid gap-8 sm:grid-cols-3">
        {[
          { title: 'Leads', body: 'Capture, assign, and triage every inbound lead with a shared pipeline.' },
          { title: 'Appointments', body: 'Keep the calendar in lock-step with your CRM — no double-booked techs.' },
          { title: 'Support', body: 'Customer tickets with SLA awareness and a direct line to Kinvox HQ.' },
        ].map((f) => (
          <div key={f.title} className="rounded-xl border border-gray-800 p-6">
            <h3 className="font-semibold text-lg">{f.title}</h3>
            <p className="mt-2 text-sm text-gray-400">{f.body}</p>
          </div>
        ))}
      </section>
    </>
  )
}
