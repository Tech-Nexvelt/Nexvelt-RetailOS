"use client";

import React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { ProductGrid } from "@/components/billing/product-grid";
import { CartPanel } from "@/components/billing/cart-panel";

export default function BillingPage() {
  return (
    <AppShell>
      <div className="flex flex-col lg:flex-row items-start gap-5">
        {/* Main Product Catalog Section */}
        <ProductGrid />

        {/* Right Cart Section */}
        <CartPanel />
      </div>
    </AppShell>
  );
}
