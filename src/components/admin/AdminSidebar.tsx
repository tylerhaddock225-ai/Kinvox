"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Ticket, Sparkles, CreditCard, Zap, Eye, LayoutDashboard } from "lucide-react";
import { startImpersonation } from "@/app/actions/impersonation";

type SystemRole = "platform_owner" | "platform_support";

interface AdminSidebarProps {
  systemRole: SystemRole;
}

type NavItem = {
  href:  string;
  label: string;
  icon:  typeof LayoutDashboard;
  /** When true, only highlight on exact pathname match (use for prefix-parents). */
  exact?: boolean;
};

const baseNav: NavItem[] = [
  { href: "/admin-hq",               label: "Dashboard",     icon: LayoutDashboard, exact: true },
  { href: "/admin-hq/organizations", label: "Organizations", icon: Building2 },
  { href: "/admin-hq/tickets",       label: "Tickets",       icon: Ticket },
  { href: "/admin-hq/ai-templates",  label: "AI Templates",  icon: Sparkles },
];

const ownerOnlyNav: NavItem[] = [
  { href: "/admin-hq/billing", label: "Billing", icon: CreditCard },
];

const ORG_DETAIL_RE = /^\/admin-hq\/organizations\/([^/]+)\/?$/;

export default function AdminSidebar({ systemRole }: AdminSidebarProps) {
  const pathname = usePathname();

  const navItems =
    systemRole === "platform_owner" ? [...baseNav, ...ownerOnlyNav] : baseNav;

  const managingOrgId = pathname.match(ORG_DETAIL_RE)?.[1] ?? null;

  function linkClass(href: string, exact: boolean) {
    const active = exact
      ? pathname === href
      : pathname === href || pathname.startsWith(href + "/");
    return `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors border-l-2 ${
      active
        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500"
        : "text-gray-400 hover:bg-white/5 hover:text-gray-100 border-transparent"
    }`;
  }

  return (
    <aside className="flex flex-col w-64 min-h-screen bg-pvx-surface text-gray-100 border-r border-pvx-border shrink-0">
      <div className="px-5 pt-6 pb-4 border-b border-pvx-border">
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-[0.2em] text-violet-300 uppercase">
          <Zap className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400" />
          Kinvox HQ
        </div>
        <div className="mt-1 text-lg font-semibold text-gray-100">Command Center</div>
        <div className="mt-3 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-pvx-bg border border-pvx-border text-[10px] font-medium text-gray-300 uppercase tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          {systemRole === "platform_owner" ? "Platform Owner" : "Platform Support"}
        </div>
      </div>

      <nav className="flex-1 px-3 pt-4 pb-4 space-y-1">
        {navItems.map(({ href, label, icon: Icon, exact }) => (
          <Link key={href} href={href} className={linkClass(href, !!exact)}>
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      {managingOrgId && (
        <div className="px-3 pb-4 border-t border-pvx-border pt-3">
          <form action={startImpersonation}>
            <input type="hidden" name="orgId" value={managingOrgId} />
            <button
              type="submit"
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-violet-200 bg-violet-500/15 border border-violet-500/30 hover:bg-violet-500/25 hover:text-violet-100 transition-colors"
            >
              <Eye className="w-4 h-4 shrink-0" />
              Launch Impersonation
            </button>
          </form>
        </div>
      )}

      <div className="px-6 py-4 border-t border-pvx-border text-xs text-gray-600">
        Kinvox HQ © {new Date().getFullYear()}
      </div>
    </aside>
  );
}
