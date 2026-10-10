"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ScanLine,
  Package,
  Receipt,
  BarChart3,
  Settings,
  ChevronDown,
  Building2,
  User,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useRetail } from "@/context/retail-context";
import { cn } from "@/lib/cn";

export function Sidebar() {
  const pathname = usePathname();
  const { role, setRole, isSidebarCollapsed, setIsSidebarCollapsed } = useRetail();

  const navItems = [
    { key: "billing", label: "Billing", href: "/billing", icon: ScanLine },
    { key: "products", label: "Products & Stock", href: "/products", icon: Package },
    { key: "sales", label: "Sales", href: "/sales", icon: Receipt },
    { key: "reports", label: "Reports", href: "/reports", icon: BarChart3 },
    { key: "settings", label: "Settings", href: "/settings", icon: Settings },
  ];

  return (
    <aside
      className={cn(
        "bg-[#0B132B] text-white flex flex-col justify-between transition-all duration-300 z-30 shrink-0 select-none",
        isSidebarCollapsed ? "w-16" : "w-60",
      )}
    >
      {/* Top Header & Brand */}
      <div>
        <div className="p-4 flex items-center justify-between border-b border-slate-800/80">
          <Link href="/billing" className="flex items-center gap-3 overflow-hidden">
            <img src="/logo.png" alt="NexVelt Logo" className="w-8 h-8 object-contain shrink-0" />
            {!isSidebarCollapsed && (
              <div className="flex flex-col">
                <span className="font-bold text-lg leading-tight tracking-tight text-white flex items-center gap-1">
                  NexVelt
                </span>
                <span className="text-xs font-semibold tracking-wider text-[#00D9D9]">
                  RetailOS
                </span>
              </div>
            )}
          </Link>
          <button
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
            title="Toggle Sidebar"
          >
            {isSidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="p-3 space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href ||
              (item.href !== "/billing" && pathname.startsWith(item.href));

            return (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  "flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150",
                  isActive
                    ? "bg-[#00D9D9] text-slate-950 font-semibold shadow-sm"
                    : "text-slate-300 hover:text-white hover:bg-slate-800/70",
                )}
                title={isSidebarCollapsed ? item.label : undefined}
              >
                <Icon
                  size={20}
                  className={cn("shrink-0", isActive ? "text-slate-950" : "text-slate-300")}
                />
                {!isSidebarCollapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Bottom Branch & User Profile Info */}
      {!isSidebarCollapsed && (
        <div className="p-3 space-y-2 border-t border-slate-800/80">
          {/* Branch Card */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between text-xs cursor-pointer hover:border-slate-700 transition">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center text-slate-300">
                <Building2 size={15} />
              </div>
              <div>
                <div className="font-semibold text-white">NR Collections</div>
                <div className="text-[11px] text-slate-400">Main Branch</div>
              </div>
            </div>
            <ChevronDown size={14} className="text-slate-400" />
          </div>

          {/* User Profile Card */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-slate-700 overflow-hidden flex items-center justify-center text-slate-300 border border-slate-600">
                <User size={18} />
              </div>
              <div>
                <div className="font-semibold text-white capitalize">
                  {role === "cashier" ? "Kishore" : role}
                </div>
                <div className="text-[11px] text-slate-400 capitalize">{role}</div>
              </div>
            </div>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as any)}
              className="bg-slate-800 text-slate-300 text-[11px] rounded px-1.5 py-0.5 border border-slate-700 focus:outline-none cursor-pointer"
            >
              <option value="cashier">Cashier</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </select>
          </div>
        </div>
      )}
    </aside>
  );
}
