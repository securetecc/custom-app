"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/app/theme-toggle";
import {
  LayoutDashboard,
  Users,
  Clock,
  FileText,
  LifeBuoy,
  PenLine,
  ChartNoAxesCombined,
  CreditCard,
  BookLock,
  Star,
  ChartLine,
  Settings,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, adminOnly: false },
  { href: "/clients", label: "Clients", icon: Users, adminOnly: false },
  { href: "/time-entries", label: "Time Entries", icon: Clock, adminOnly: false },
  { href: "/invoices", label: "Invoices", icon: FileText, adminOnly: false },
  { href: "/tickets", label: "Tickets", icon: LifeBuoy, adminOnly: false },
  { href: "/reports", label: "Reports", icon: ChartNoAxesCombined, adminOnly: true },
  { href: "/signature", label: "Signature", icon: PenLine, adminOnly: false },
  // Business-side sections: what SecureTECC spends, how it's reviewed and how
  // the site performs. Admin-only because none of it is a technician's
  // concern -- unlike Clients or Time Entries, which are the daily job.
  { href: "/subscriptions", label: "Subscriptions", icon: CreditCard, adminOnly: true, soon: true },
  { href: "/reviews", label: "Reviews", icon: Star, adminOnly: true, soon: true },
  { href: "/analytics", label: "Analytics", icon: ChartLine, adminOnly: true, soon: true },
  { href: "/documentation", label: "Docs", icon: BookLock, adminOnly: true, soon: true },
  { href: "/settings", label: "Settings", icon: Settings, adminOnly: true },
];

export function AppSidebar({ role }: { role: "admin" | "technician" }) {
  const pathname = usePathname();

  return (
    <aside
      className="hidden w-60 shrink-0 flex-col border-r md:flex"
      style={{ backgroundColor: "var(--sidebar)", borderColor: "var(--sidebar-border)" }}
    >
      <div
        className="relative flex items-center px-5 py-5"
        style={{ borderBottom: "1px solid var(--sidebar-border)" }}
      >
        {/* Same asset as /login and /support, so the logo is identical
            everywhere the brand appears rather than a text approximation. */}
        <Image
          src="/securetecc-logo.png"
          alt="SecureTECC"
          width={1080}
          height={264}
          priority
          className="h-auto w-full max-w-[168px]"
        />
      </div>
      <nav className="flex-1 space-y-1 px-3 pt-4">
        <p className="label-hud px-3 pb-2 opacity-60">Operations</p>
        {NAV_ITEMS.filter((item) => !item.adminOnly || role === "admin").map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center gap-3 rounded-md border px-3 py-2 text-sm font-medium tracking-wide transition-colors",
                active
                  // The active item is the one thing on screen allowed to
                  // glow: a bar on the leading edge, a tinted fill and a soft
                  // halo. Everything else stays quiet so this reads instantly.
                  ? "border-[rgba(6,225,220,0.4)] bg-[rgba(6,225,220,0.12)] text-[#06E1DC] shadow-[0_0_16px_rgba(6,225,220,0.28)] before:absolute before:inset-y-1 before:left-[-1px] before:w-[2px] before:rounded-full before:bg-[#06E1DC] before:shadow-[0_0_10px_#06E1DC]"
                  : "border-transparent text-sidebar-foreground/70 hover:border-[rgba(6,225,220,0.18)] hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {/* Sets expectations before the click rather than after it: the
                  page still opens and explains itself, but nobody arrives
                  expecting working data. Muted rather than accent-coloured --
                  it's a caveat, and the accent is what marks the ACTIVE item,
                  so a bright pill would compete with that. */}
              {item.soon && (
                <span className="shrink-0 rounded-full border border-current/25 px-1.5 py-px text-[10px] font-medium uppercase tracking-[0.12em] opacity-60">
                  Soon
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer rather than the header: the theme is set once and then left
          alone, so it belongs below the navigation people use all day. */}
      <div className="px-3 pb-4 pt-2">
        <p className="label-hud px-1 pb-2 opacity-60">Appearance</p>
        <ThemeToggle />
      </div>
    </aside>
  );
}
