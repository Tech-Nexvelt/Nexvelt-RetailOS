"use client";

import React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { ReportsDashboard } from "@/components/reports/reports-dashboard";

export default function ReportsPage() {
  return (
    <AppShell>
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-gray-900">Reports</h1>
        <ReportsDashboard />
      </div>
    </AppShell>
  );
}
