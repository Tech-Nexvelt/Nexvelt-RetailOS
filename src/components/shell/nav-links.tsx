"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Package, Receipt, ScanLine, Settings } from "lucide-react";
import type { NavItem } from "@/domain/navigation";
import { cn } from "@/lib/cn";

const ICONS: Record<NavItem["key"], React.ReactNode> = {
  billing: <ScanLine aria-hidden size={22} />,
  products: <Package aria-hidden size={22} />,
  sales: <Receipt aria-hidden size={22} />,
  reports: <BarChart3 aria-hidden size={22} />,
  settings: <Settings aria-hidden size={22} />,
};

/** Left rail on desktop/tablet, bottom tab bar on phones. At most five entries, no sub-menus. */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="contents">
      <ul className="flex w-full justify-around gap-1 md:flex-col md:justify-start md:gap-1">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.key} className="flex-1 md:flex-none">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "nv-transition flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-ctl px-2",
                  "text-xs font-medium md:min-h-11 md:flex-row md:justify-start md:gap-3 md:px-3 md:text-base",
                  active
                    ? "bg-primary/20 text-ink shadow-[inset_3px_0_0_var(--nv-primary-strong)]"
                    : "text-muted hover:bg-app hover:text-ink",
                )}
              >
                {ICONS[item.key]}
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
