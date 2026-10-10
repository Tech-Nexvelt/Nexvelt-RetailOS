"use client";

import React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { SettingsForm } from "@/components/settings/settings-form";

export default function SettingsPage() {
  return (
    <AppShell>
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <SettingsForm />
      </div>
    </AppShell>
  );
}
