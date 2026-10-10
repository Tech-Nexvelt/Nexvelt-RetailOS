"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { Role } from "@/domain/navigation";
import { switchDemoRole } from "@/server/billing/actions";

const LABELS: Record<Role, string> = { owner: "Owner", manager: "Manager", cashier: "Cashier" };

/** Demo-only: lets reviewers see what each role gets. Replaced by real sign-in in Phase 2. */
export function DemoRoleSwitcher({ role }: { role: Role }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      View as
      <select
        className="min-h-9 rounded-ctl border border-line bg-surface px-2 text-ink"
        value={role}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            await switchDemoRole(e.target.value);
            router.refresh();
          })
        }
      >
        {(Object.keys(LABELS) as Role[]).map((r) => (
          <option key={r} value={r}>
            {LABELS[r]}
          </option>
        ))}
      </select>
    </label>
  );
}
