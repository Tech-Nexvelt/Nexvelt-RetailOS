"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Boxes, Calculator, Receipt, Settings } from "lucide-react";
import type { NavItem } from "@/domain/navigation";
import { cn } from "@/lib/cn";

const ICONS: Record<NavItem["key"], React.ReactNode> = {
  billing: <Calculator aria-hidden size={20} />,
  products: <Boxes aria-hidden size={20} />,
  sales: <Receipt aria-hidden size={20} />,
  reports: <BarChart3 aria-hidden size={20} />,
  settings: <Settings aria-hidden size={20} />,
};

/** Left rail on desktop/tablet, bottom tab bar on phones. Filtered by permissions. */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="w-full">
      <ul className="flex w-full justify-around gap-1 md:flex-col md:justify-start md:gap-1.5">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.key} className="flex-1 md:flex-none">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl px-3 text-xs transition-all duration-150",
                  "md:min-h-11 md:flex-row md:justify-start md:gap-3 md:px-4 md:py-3 md:text-sm md:font-medium",
                  active
                    ? "bg-[#00bba7] text-white font-semibold shadow-sm"
                    : "text-slate-400 hover:bg-slate-800/70 hover:text-white",
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

