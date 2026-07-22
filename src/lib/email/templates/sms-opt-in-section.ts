// Shared "prefer text messages?" opt-in section for confirmation emails
// (SMS Stage 2a). Both the lead-magnet confirmation and the Path C ticket
// confirmation append this when an opt-in link was minted for the recipient's
// row. Kept in one place so the consent copy stays identical across rails.
//
// The URL is app-minted (crypto-random single-purpose token) and safe to embed
// verbatim; it contains only [a-z0-9/] path segments, so no HTML escaping is
// needed, but we escape defensively anyway in case the base URL ever changes.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export type SmsOptInSection = { html: string; text: string }

/**
 * Render the HTML + text opt-in blurb for a minted opt-in URL. Returns empty
 * strings when url is null/blank so callers can unconditionally concatenate.
 */
export function renderSmsOptInEmailSection(url: string | null | undefined): SmsOptInSection {
  if (!url || !url.trim()) return { html: '', text: '' }
  const safe = escapeHtml(url)
  const html =
    `<p style="margin-top:20px;padding-top:16px;border-top:1px solid #e5e5e5;">` +
    `<strong>Prefer text messages?</strong> ` +
    `<a href="${safe}" style="color:#7c3aed;">Tap here</a> and we&#39;ll send updates by SMS too.` +
    `</p>`
  const text = `\n\nPrefer text messages? Tap here and we'll send updates by SMS too:\n${url}`
  return { html, text }
}
