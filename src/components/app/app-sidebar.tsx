"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  Clock,
  FileText,
  LifeBuoy,
  Settings,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, adminOnly: false },
  { href: "/clients", label: "Clients", icon: Users, adminOnly: false },
  { href: "/time-entries", label: "Time Entries", icon: Clock, adminOnly: false },
  { href: "/invoices", label: "Invoices", icon: FileText, adminOnly: false },
  { href: "/tickets", label: "Tickets", icon: LifeBuoy, adminOnly: false },
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
        className="flex items-center px-5 py-5"
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
      <nav className="flex-1 space-y-1 px-3">
        {NAV_ITEMS.filter((item) => !item.adminOnly || role === "admin").map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-[rgba(6,225,220,0.4)] bg-[rgba(6,225,220,0.12)] text-[#06E1DC] shadow-[0_0_12px_rgba(6,225,220,0.25)]"
                  : "border-transparent text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
