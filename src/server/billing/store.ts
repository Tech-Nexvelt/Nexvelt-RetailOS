import "server-only";
import { backendMode } from "@/lib/backend-mode";
import { BillingEngine } from "./engine";
import { DEMO_BRANCH, demoCatalog } from "./demo-data";

/**
 * The in-memory engine is a DEMO backend. It is available only when BILLING_BACKEND is
 * explicitly set to "demo" AND the process is a development/test one (see src/lib/backend-mode.ts). Anything else (including the variable being unset, as in a fresh
 * production deployment) fails closed: no billing backend, no fallback to fake data.
 * The production backend is the PostgreSQL checkout RPC (TRD §12.2), which is not built yet.
 */
export class BackendNotConfiguredError extends Error {
  constructor() {
    super(
      "No billing backend is configured. Set BILLING_BACKEND=demo for the demo, only in development.",
    );
    this.name = "BackendNotConfiguredError";
  }
}

export function isDemoBackend(): boolean {
  return backendMode() === "demo";
}

/**
 * Process-wide demo engine. Kept on globalThis so Next.js dev hot-reloads don't reset the data.
 * Data is lost when the server restarts. This is intentional for the demo backend.
 */
const g = globalThis as unknown as { __nexveltDemoEngine?: BillingEngine };

export function getEngine(): BillingEngine {
  if (!isDemoBackend()) throw new BackendNotConfiguredError();
  g.__nexveltDemoEngine ??= new BillingEngine({ branchId: DEMO_BRANCH, items: demoCatalog() });
  return g.__nexveltDemoEngine;
}
