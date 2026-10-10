"use client";

import React from "react";
import { RetailProvider, useRetail } from "@/context/retail-context";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { CheckoutModal } from "@/components/billing/checkout-modal";
import { ReceiptModal } from "@/components/billing/receipt-modal";
import { DemoOverlays } from "@/components/states/demo-overlays";
import { ShoppingBag, ScanLine, Package, Receipt, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

function AppShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isMobilePOSView, cart, setIsCheckoutOpen } = useRetail();

  const cartCount = cart.reduce((acc, item) => acc + item.quantity, 0);

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col font-sans antialiased text-slate-900 selection:bg-[#00D9D9] selection:text-slate-950">
      {/* Top Interactive Demo Switcher Toolbar */}
      <DemoOverlays />

      {/* Main Workspace View Container */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Dark Sidebar Navigation (Desktop) */}
        {!isMobilePOSView && <Sidebar />}

        {/* Main Workspace Frame */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {/* Header Bar */}
          <Header />

          {/* Main Content View */}
          <main className="flex-1 p-4 md:p-6 pb-24 md:pb-6">{children}</main>

          {/* Bottom Mobile Tab Bar (When in mobile view or phone viewport) */}
          {(isMobilePOSView || false) && (
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-2 flex items-center justify-around z-40 shadow-lg md:hidden">
              <Link
                href="/billing"
                className={`flex flex-col items-center gap-0.5 text-xs font-semibold ${
                  pathname === "/billing" ? "text-[#00B8B8]" : "text-gray-500"
                }`}
              >
                <ScanLine size={20} />
                <span>Billing</span>
              </Link>
              <Link
                href="/products"
                className={`flex flex-col items-center gap-0.5 text-xs font-semibold ${
                  pathname === "/products" ? "text-[#00B8B8]" : "text-gray-500"
                }`}
              >
                <Package size={20} />
                <span>Products</span>
              </Link>
              <button
                onClick={() => setIsCheckoutOpen(true)}
                className="relative bg-[#00D9D9] text-slate-950 p-3 rounded-full font-bold flex items-center justify-center shadow-md -mt-5 border-4 border-[#F8FAFC]"
              >
                <ShoppingBag size={22} />
                {cartCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-slate-950 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center border-2 border-white">
                    {cartCount}
                  </span>
                )}
              </button>
              <Link
                href="/sales"
                className={`flex flex-col items-center gap-0.5 text-xs font-semibold ${
                  pathname === "/sales" ? "text-[#00B8B8]" : "text-gray-500"
                }`}
              >
                <Receipt size={20} />
                <span>Sales</span>
              </Link>
              <Link
                href="/settings"
                className={`flex flex-col items-center gap-0.5 text-xs font-semibold ${
                  pathname === "/settings" ? "text-[#00B8B8]" : "text-gray-500"
                }`}
              >
                <Settings size={20} />
                <span>Settings</span>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Global Modals */}
      <CheckoutModal />
      <ReceiptModal />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <RetailProvider>
      <AppShellContent>{children}</AppShellContent>
    </RetailProvider>
  );
}
