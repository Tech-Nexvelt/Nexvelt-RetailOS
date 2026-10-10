"use server";

import { randomUUID } from "node:crypto";
import { RateLimiter } from "@/lib/scanner/gate";
import { isUsableSecret } from "@/lib/scanner/crypto";
import type { ScannerError } from "@/lib/scanner/protocol";
import { getAppSession } from "@/server/app/session";
import { claimPairing, createPairing, inspectPairing, verifyIncoming, type Caller, type Deps } from "./service";

/**
 * Server actions for the phone scanner. All identity comes from the verified server session (getAppSession), never from the
 * request. The pairing secret SCANNER_PAIRING_SECRET is server-only and the feature fails CLOSED without it.
 * Rate limits are per server instance (in memory): they bound bursts; they are not a global quota. Documented in the verification doc.
 */
const createLimit = new RateLimiter(10, 60_000); // new QR codes per user per minute
const claimLimit = new RateLimiter(8, 60_000); // claim attempts per user per minute
const verifyLimit = new RateLimiter(400, 60_000); // incoming messages per pairing per minute (heartbeats + scans)

async function context(): Promise<{ caller: Caller; deps: Deps } | ScannerError> {
  const secret = process.env.SCANNER_PAIRING_SECRET;
  if (!isUsableSecret(secret)) return "NOT_CONFIGURED";
  const s = await getAppSession();
  if (!s) return "NOT_SIGNED_IN";
  return {
    caller: { userId: s.userId, tenantId: s.tenantId, branchId: s.branchId, canSell: s.permissions.has("sale.create") },
    deps: { secret, now: Date.now, newId: randomUUID },
  };
}

export async function createPairingAction(): Promise<{ ok: true; token: string; sid: string; pairBy: number; until: number } | { ok: false; code: ScannerError }> {
  const c = await context();
  if (typeof c === "string") return { ok: false, code: c };
  if (!createLimit.take(c.caller.userId, Date.now())) return { ok: false, code: "RATE_LIMITED" };
  return createPairing(c.caller, c.deps);
}

export async function inspectPairingAction(token: string): Promise<{ ok: true; sid: string } | { ok: false; code: ScannerError }> {
  const c = await context();
  if (typeof c === "string") return { ok: false, code: c };
  return inspectPairing(token, c.caller, c.deps);
}

export async function claimPairingAction(token: string): Promise<{ ok: true; sid: string; did: string; scanKey: string; until: number; userId: string } | { ok: false; code: ScannerError }> {
  const c = await context();
  if (typeof c === "string") return { ok: false, code: c };
  if (!claimLimit.take(c.caller.userId, Date.now())) return { ok: false, code: "RATE_LIMITED" };
  const r = await claimPairing(token, c.caller, c.deps);
  return r.ok ? { ...r, userId: c.caller.userId } : r;
}

export async function verifyIncomingAction(token: string, message: unknown): Promise<{ ok: true } | { ok: false; code: ScannerError }> {
  const c = await context();
  if (typeof c === "string") return { ok: false, code: c };
  if (!verifyLimit.take(token.slice(0, 40), Date.now())) return { ok: false, code: "RATE_LIMITED" };
  const r = await verifyIncoming(token, message, c.caller, c.deps);
  return r.ok ? { ok: true } : r;
}
