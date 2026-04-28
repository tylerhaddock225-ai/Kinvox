"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, UserCircle, CalendarCheck, Ticket, LayoutDashboard, Settings, Shield, LifeBuoy, LogOut, Sparkles } from "lucide-react";
import Logo from "./Logo";
import { logout } from "@/app/(app)/(auth)/actions";

// Leads and Signals now live under the [orgSlug] route segment; their
// hrefs are built at render time once we know the current slug. The
// plain-root labels stay here so the nav is still declared up top.
const LEADS_LABEL   = { label: "Leads",   icon: Users    };
const SIGNALS_LABEL = { label: "Signals", icon: Sparkles };

interface SidebarProps {
  canViewLeads?: boolean;
  orgName?: string | null;
  orgSlug?: string | null;
  isHqAdmin?: boolean;
  pendingSignalCount?: number;
}

// Top-level paths that are NOT org slugs — don't treat them as "current slug".
const RESERVED_TOP = new Set([
  "leads", "signals", "tickets", "customers", "appointments", "settings", "support",
  "login", "signup", "forgot-password", "reset-password",
  "onboarding", "admin", "hq", "api",
]);

export default function Sidebar({
  canViewLeads = true,
  orgName = null,
  orgSlug = null,
  isHqAdmin = false,
  pendingSignalCount = 0,
}: SidebarProps) {
  const pathname = usePathname();

  // The "current slug" is whatever non-reserved segment is first in the URL.
  // That makes the Dashboard link follow the user across impersonation too —
  // an admin on /other-merchant sees a Dashboard link back to /other-merchant,
  // and the active highlight still matches on exact pathname.
  const firstSeg = pathname === "/" ? "" : pathname.split("/")[1] ?? "";
  const currentSlug = firstSeg && !RESERVED_TOP.has(firstSeg) ? firstSeg : null;
  const dashboardSlug = currentSlug ?? orgSlug;
  const dashboardHref = dashboardSlug ? `/${dashboardSlug}` : "/";
  const hqSupportHref = dashboardSlug ? `/${dashboardSlug}/hq-support` : "/support";
  const settingsHref  = dashboardSlug ? `/${dashboardSlug}/settings/team` : "/settings/team";
  const leadsHref     = dashboardSlug ? `/${dashboardSlug}/leads`   : "/leads";
  const signalsHref   = dashboardSlug ? `/${dashboardSlug}/signals` : "/signals";
  const onHqSupport = dashboardSlug
    ? pathname === hqSupportHref || pathname.startsWith(`${hqSupportHref}/`)
    : pathname.startsWith("/support");

  // Customers / Appointments / Tickets still live at the top level —
  // only Leads, Signals, and Settings moved under [orgSlug] in this sprint.
  const staticNav = [
    { href: dashboardHref,   label: "Dashboard",    icon: LayoutDashboard },
    { href: "/customers",    label: "Customers",    icon: UserCircle },
    { href: "/appointments", label: "Appointments", icon: CalendarCheck },
    { href: "/tickets",      label: "Tickets",      icon: Ticket },
  ];

  // Signals slots immediately under Leads. When the viewer can't see
  // Leads we still gate Signals on the same permission since the queue
  // is a read-on-leads concept.
  const leadsNav   = { href: leadsHref,   ...LEADS_LABEL };
  const signalsNav = { href: signalsHref, ...SIGNALS_LABEL };
  const navItems = canViewLeads
    ? [staticNav[0], leadsNav, signalsNav, ...staticNav.slice(1)]
    : staticNav;

  function linkClass(href: string) {
    // Dashboard link is active only on exact slug match (or "/" when no slug),
    // not on every subpath — sub-routes match their own static hrefs instead.
    const active = href === dashboardHref
      ? pathname === dashboardHref
      : pathname.startsWith(href);
    return `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors border-l-2 ${
      active
        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500"
        : "text-gray-400 hover:bg-white/5 hover:text-gray-100 border-transparent"
    }`;
  }

  return (
    <aside className="flex flex-col w-64 min-h-screen bg-pvx-surface text-gray-100 border-r border-pvx-border shrink-0">

      {/* Brand */}
      <div className="px-5 pt-5 pb-3 border-b border-pvx-border flex flex-col items-center text-center">
        <div className="group flex flex-row items-center gap-4 cursor-default select-none">
          <div className="shrink-0 rounded-xl shadow-lg shadow-emerald-500/20 transition-all duration-300 group-hover:shadow-emerald-500/40 group-hover:brightness-110">
            <Logo size={40} />
          </div>
          <span
            className="leading-none antialiased transition-colors duration-300"
            style={{
              fontFamily: "'Nunito', sans-serif",
              fontSize: "2.3rem",
              fontWeight: 800,
              letterSpacing: "0em",
              WebkitTextStroke: "0.1px white",
              color: "white",
              paintOrder: "stroke fill",
            }}
          >
            Kinvox
          </span>
        </div>
        {orgName && (
          <p className="text-sm font-semibold text-violet-100 mt-4 uppercase tracking-wider truncate max-w-full">
            {orgName}
          </p>
        )}
      </div>

      {/* HQ return — only rendered for platform admins */}
      {isHqAdmin && (
        <div className="px-3 pt-3">
          <Link
            href="/hq"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 hover:text-emerald-200 hover:border-emerald-400 transition-colors"
          >
            <Shield className="w-3.5 h-3.5 shrink-0" />
            Return to HQ
          </Link>
        </div>
      )}

      {/* Main navigation */}
      <nav className="flex-1 px-3 pt-3 pb-4 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const badge = href === signalsHref && pendingSignalCount > 0
            ? pendingSignalCount
            : 0
          return (
            <Link key={href} href={href} className={linkClass(href)}>
              <Icon className="w-4 h-4 shrink-0" />
              <span className="flex-1">{label}</span>
              {badge > 0 && (
                <span
                  aria-label={`${badge} pending`}
                  className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-semibold bg-violet-500/20 text-violet-200 border border-violet-500/40 tabular-nums"
                >
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Settings section */}
      <div className="px-3 pb-4 border-t border-pvx-border pt-3 space-y-2">
        <Link href={settingsHref} className={linkClass(settingsHref)}>
          <Settings className="w-4 h-4 shrink-0" />
          Organization Settings
        </Link>
        <Link
          href={hqSupportHref}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
            onHqSupport
              ? "border-violet-400 bg-violet-500/15 text-violet-100"
              : "border-violet-500/40 text-violet-300 hover:border-violet-400 hover:bg-violet-500/10 hover:text-violet-200"
          }`}
        >
          <LifeBuoy className="w-4 h-4 shrink-0" />
          Contact HQ Support
        </Link>
      </div>

      {/* Sign out */}
      <div className="px-3 pb-3 border-t border-pvx-border pt-3">
        <form action={logout}>
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-200 hover:bg-white/5 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            Sign out
          </button>
        </form>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-pvx-border text-xs text-gray-600">
        Kinvox © {new Date().getFullYear()}
      </div>
    </aside>
  );
}
