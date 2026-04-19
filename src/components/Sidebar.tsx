"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, UserCircle, CalendarCheck, Ticket, LayoutDashboard, Settings } from "lucide-react";
import Logo from "./Logo";

const staticNav = [
  { href: "/",             label: "Dashboard",   icon: LayoutDashboard },
  { href: "/customers",    label: "Customers",   icon: UserCircle },
  { href: "/appointments", label: "Appointments", icon: CalendarCheck },
  { href: "/tickets",      label: "Tickets",      icon: Ticket },
];

const leadsNav = { href: "/leads", label: "Leads", icon: Users };

interface SidebarProps {
  canViewLeads?: boolean;
  orgName?: string | null;
}

export default function Sidebar({ canViewLeads = true, orgName = null }: SidebarProps) {
  const pathname = usePathname();

  const navItems = canViewLeads
    ? [staticNav[0], leadsNav, ...staticNav.slice(1)]
    : staticNav;

  function linkClass(href: string) {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors border-l-2 ${
      active
        ? "bg-emerald-500/15 text-emerald-400 border-emerald-400"
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

      {/* Main navigation */}
      <nav className="flex-1 px-3 pt-3 pb-4 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={linkClass(href)}>
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      {/* Settings section */}
      <div className="px-3 pb-4 border-t border-pvx-border pt-3 space-y-1">
        <Link href="/settings/team" className={linkClass("/settings/team")}>
          <Settings className="w-4 h-4 shrink-0" />
          Settings
        </Link>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-pvx-border text-xs text-gray-600">
        Kinvox © {new Date().getFullYear()}
      </div>
    </aside>
  );
}
