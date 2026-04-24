// Shared schema for tenant-defined lead-magnet questions.
//
// Name/Email/Phone are NOT represented here — they're the locked fields
// rendered by the public form template and saved directly onto the lead
// row (first_name/last_name/email/phone). Anything tenants add through
// the Lead Support → Lead Questionnaire UI ends up in this array, and
// the answers land in leads.metadata.custom_answers keyed by `id`.

export const MAX_QUESTIONS   = 10
export const MAX_LABEL_CHARS = 120

export const LOCKED_FIELDS = ['Name', 'Email', 'Phone'] as const

export type LeadQuestion = {
  id:       string   // stable key; assigned on creation, kept for answer lookup
  label:    string
  required: boolean
}

export type LeadAnswer = {
  question_id: string
  label:       string
  answer:      string
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

/**
 * Parses untrusted input (from a form submission, a DB read, whatever)
 * into a well-formed LeadQuestion[]. Drops garbage silently — the caller
 * decides whether to reject the payload or accept the cleaned version.
 * Returns a NEW array; safe to write straight back to JSONB.
 */
export function normalizeLeadQuestions(input: unknown): LeadQuestion[] {
  if (!Array.isArray(input)) return []
  const out: LeadQuestion[] = []
  const seenIds = new Set<string>()

  for (const raw of input) {
    if (!isRecord(raw)) continue
    const label = typeof raw.label === 'string' ? raw.label.trim() : ''
    if (!label) continue
    if (label.length > MAX_LABEL_CHARS) continue

    // Reject duplicate IDs — keeps answer-lookup unambiguous. Collisions
    // keep the first occurrence; downstream writes will reassign.
    const id = typeof raw.id === 'string' && raw.id.trim()
      ? raw.id.trim()
      : generateQuestionId()
    if (seenIds.has(id)) continue
    seenIds.add(id)

    out.push({
      id,
      label,
      required: raw.required === true,
    })

    if (out.length >= MAX_QUESTIONS) break
  }

  return out
}

export function generateQuestionId(): string {
  // Prefixed for easy grep-ability in lead metadata dumps.
  return `q_${crypto.randomUUID()}`
}
