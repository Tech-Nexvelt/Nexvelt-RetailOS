"use client";

import React from "react";
import { Search, Scan, Bell, RefreshCw, Plus } from "lucide-react";
import { useRetail } from "@/context/retail-context";

export function Header({
  title = "Billing / POS",
  subtitle = "Scan products, add to cart and complete the sale",
}: {
  title?: string;
  subtitle?: string;
}) {
  const { searchQuery, setSearchQuery, setIsScanModalOpen, clearCart } = useRetail();

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3.5 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-20 shadow-xs">
      {/* Page Title & Subtitle */}
      <div>
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">{title}</h1>
        <p className="text-xs text-gray-500 font-normal">{subtitle}</p>
      </div>

      {/* Main Search & Barcode Bar */}
      <div className="flex-1 max-w-xl min-w-[300px]">
        <div className="relative flex items-center">
          <Search size={18} className="absolute left-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search products, scan barcode, or type name..."
            className="w-full pl-10 pr-28 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:bg-white focus:border-[#00D9D9] focus:ring-2 focus:ring-[#00D9D9]/20 transition focus:outline-none"
          />
          <button
            onClick={() => setIsScanModalOpen(true)}
            className="absolute right-1.5 px-3 py-1.5 bg-[#00D9D9] hover:bg-[#00B8B8] text-slate-950 text-xs font-bold rounded-lg flex items-center gap-1.5 transition shadow-xs cursor-pointer"
          >
            <Scan size={14} />
            <span>Scan</span>
            <span className="bg-slate-950/15 px-1 py-0.2 rounded text-[10px]">F4</span>
          </button>
        </div>
      </div>

      {/* Header Actions */}
      <div className="flex items-center gap-2.5">
        <button
          className="w-9 h-9 rounded-xl border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition relative"
          title="Notifications"
        >
          <Bell size={18} />
          <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#00D9D9]" />
        </button>

        <button
          className="w-9 h-9 rounded-xl border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition"
          title="Sync & Refresh Data"
        >
          <RefreshCw size={17} />
        </button>

        <button
          onClick={clearCart}
          className="bg-[#00D9D9] hover:bg-[#00B8B8] text-slate-950 text-sm font-bold px-4 py-2 rounded-xl flex items-center gap-1.5 transition shadow-sm cursor-pointer"
        >
          <Plus size={18} />
          <span>New Sale</span>
        </button>
      </div>
    </header>
  );
}
