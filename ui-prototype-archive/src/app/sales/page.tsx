"use client";

import React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { SalesTable } from "@/components/sales/sales-table";

export default function SalesPage() {
  return (
    <AppShell>
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-gray-900">Sales</h1>
        <SalesTable />
      </div>
    </AppShell>
  );
}
