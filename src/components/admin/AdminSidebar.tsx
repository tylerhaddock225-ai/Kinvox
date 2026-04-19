"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Ticket, Sparkles, CreditCard, ArrowLeft } from "lucide-react";

type SystemRole = "platform_owner" | "platform_support";

interface AdminSidebarProps {
  systemRole: SystemRole;
}

const baseNav = [
  { href: "/admin-hq/organizations", label: "Organizations", icon: Building2 },
  { href: "/admin-hq/tickets",       label: "Tickets",       icon: Ticket },
  { href: "/admin-hq/ai-templates",  label: "AI Templates",  icon: Sparkles },
];

const ownerOnlyNav = [
  { href: "/admin-hq/billing", label: "Billing", icon: CreditCard },
];

export default function AdminSidebar({ systemRole }: AdminSidebarProps) {
  const pathname = usePathname();

  const navItems =
    systemRole === "platform_owner" ? [...baseNav, ...ownerOnlyNav] : baseNav;

  function linkClass(href: string) {
    const active = pathname === href || pathname.startsWith(href + "/");
    return `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors border-l-2 ${
      active
        ? "bg-slate-700/60 text-slate-50 border-indigo-400"
        : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100 border-transparent"
    }`;
  }

  return (
    <aside className="flex flex-col w-64 min-h-screen bg-slate-950 text-slate-100 border-r border-slate-800 shrink-0">
      <div className="px-5 pt-6 pb-4 border-b border-slate-800">
        <div className="text-[10px] font-bold tracking-[0.2em] text-indigo-400 uppercase">
          Kinvox HQ
        </div>
        <div className="mt-1 text-lg font-semibold text-slate-100">Command Center</div>
        <div className="mt-3 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-800/80 border border-slate-700 text-[10px] font-medium text-slate-300 uppercase tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
          {systemRole === "platform_owner" ? "Platform Owner" : "Platform Support"}
        </div>
      </div>

      <nav className="flex-1 px-3 pt-4 pb-4 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={linkClass(href)}>
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="px-3 pb-4 border-t border-slate-800 pt-3">
        <Link
          href="/"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800/60 hover:text-slate-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          Back to merchant app
        </Link>
      </div>

      <div className="px-6 py-4 border-t border-slate-800 text-xs text-slate-600">
        Kinvox HQ © {new Date().getFullYear()}
      </div>
    </aside>
  );
}
