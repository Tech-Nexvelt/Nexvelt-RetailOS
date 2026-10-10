"use client";

import React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { ProductTable } from "@/components/products/product-table";

export default function ProductsPage() {
  return (
    <AppShell>
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-gray-900">Products & Stock</h1>
        <ProductTable />
      </div>
    </AppShell>
  );
}
