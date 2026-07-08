import type { NextConfig } from "next";

// ── Security headers (SEC-M2) ────────────────────────────────────────────────
// Content-Security-Policy — GLOBAL scope is ENFORCING (SEC-CSP-A).
// The header key on the global rule is now "Content-Security-Policy" (not
// -Report-Only), so CSP_GLOBAL violations are BLOCKED by the browser. The
// SEC-M2 report-only monitoring window was clean, so enforcing the global
// policy is non-breaking ('unsafe-inline' remains in script-src/style-src, so
// Next's inline bootstrap and inline styles are unaffected). No report-sink
// route exists; an enforcing policy needs none (there is also no server-side
// violation collection).
//
// Frame-policy carve-out: the public lead-magnet landing page /l/[slug] is
// intended to be embedded in customer sites via an iframe (see
// organizations.allowed_embed_domains, documented as the per-org "iframe
// frame-ancestors allowlist"). It therefore must NOT receive the global
// X-Frame-Options: SAMEORIGIN or frame-ancestors 'self' — those would block the
// embed. MECHANISM: the GLOBAL rule uses a negative-lookahead source
// '/((?!l/).*)' that matches every path EXCEPT those under /l. This is required
// because Next's headers() cannot UNSET a header from a later matching rule (a
// /l-specific rule that merely omits X-Frame-Options would NOT strip a
// SAMEORIGIN set by a broader matching rule, and two matching CSP rules would
// emit duplicate headers). The dedicated /l rule sets frame-ancestors *
// (report-only, so it logs nothing-blocking either way) and omits
// X-Frame-Options entirely.
//
// /l STAYS REPORT-ONLY (Piece B — future, blocked): the /l rule below keeps the
// "Content-Security-Policy-Report-Only" key with `frame-ancestors *`. Flipping
// /l to enforcing REQUIRES first replacing `frame-ancestors *` with a
// per-request, per-org allowlist derived from
// organizations.allowed_embed_domains. That is a hard PREREQUISITE: proxy.ts
// has no anon read path for that column today (organizations SELECT is
// RLS-gated TO authenticated), so Piece B needs a new anon-granted SECURITY
// DEFINER RPC (e.g. resolve_embed_domains_by_slug) plus proxy.ts wiring to set
// the per-org frame-ancestors. X-Frame-Options cannot express an allowlist,
// which is why /l omits it rather than relaxing it.

// Shared CSP directives — identical for both scopes except frame-ancestors.
const CSP_BASE =
  "default-src 'self'; base-uri 'self'; object-src 'none'; " +
  "script-src 'self' 'unsafe-inline'; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "img-src 'self' data: blob: https://*.supabase.co; " +
  "font-src 'self' https://fonts.gstatic.com; " +
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co; " +
  "frame-src 'none'; form-action 'self'";

const CSP_GLOBAL = `${CSP_BASE}; frame-ancestors 'self'`;
const CSP_LEAD_MAGNET = `${CSP_BASE}; frame-ancestors *`;

// Non-framing security headers applied to every scope.
const COMMON_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "kinvoxtech.com" },
      { protocol: "https", hostname: "www.kinvoxtech.com" },
      { protocol: "https", hostname: "app.kinvoxtech.com" },
      { protocol: "https", hostname: "sandbox.kinvoxtech.com" },
    ],
  },
  experimental: {
    serverActions: {
      allowedOrigins: [
        "kinvoxtech.com",
        "www.kinvoxtech.com",
        "app.kinvoxtech.com",
        "sandbox.kinvoxtech.com",
        "localhost:3000",
        "app.localhost:3000",
      ],
    },
  },
  async headers() {
    return [
      {
        // GLOBAL — every path EXCEPT the /l lead-magnet landing (negative
        // lookahead), so the frame-locking headers never touch /l at all.
        source: "/((?!l/).*)",
        headers: [
          { key: "Content-Security-Policy", value: CSP_GLOBAL },
          ...COMMON_SECURITY_HEADERS,
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        // /l/[slug] lead-magnet landing — embeddable on customer sites.
        // No X-Frame-Options; frame-ancestors * (report-only). Replace with a
        // per-org allowlist from organizations.allowed_embed_domains when CSP
        // goes enforcing.
        source: "/l/:slug*",
        headers: [
          { key: "Content-Security-Policy-Report-Only", value: CSP_LEAD_MAGNET },
          ...COMMON_SECURITY_HEADERS,
        ],
      },
    ];
  },
};

export default nextConfig;
