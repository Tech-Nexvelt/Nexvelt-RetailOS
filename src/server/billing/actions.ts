"use server";

import { cookies } from "next/headers";
import { backendMode } from "@/lib/backend-mode";
import { z } from "zod";
import type {
  ActionResult,
  BillingErrorCode,
  CartLineInput,
  CheckoutInput,
  InvoiceSummary,
  Quote,
  SearchResult,
  SessionState,
} from "@/domain/billing";
import { policyFor } from "@/domain/policy";
import { quoteWithPhotos, resultsWithPhotos, type PhotoClient } from "../app/cart-photos";
import { getAppSession } from "../app/session";
import { createUserClient } from "@/lib/supabase/server";
import { canInBranch, loadContext, pickBillingTarget, type QueryClient } from "../auth/context";
import { getCurrentRole, isRole, requirePermission, ROLE_COOKIE } from "../session";
import type { BillingBackend } from "./backend";
import { DemoBillingBackend } from "./demo-backend";
import { SupabaseBillingBackend, type RpcClient } from "./supabase-backend";
import { BackendNotConfiguredError, getEngine } from "./store";

const money = z.number().int().min(0).max(100_000_000_00);
// .strict(): unknown keys (for example a client-supplied price) are rejected, not ignored.
const cartLine = z
  .object({
    itemId: z.string().min(1).max(64),
    quantity: z.number().int().min(1).max(999),
    discountPaise: money.optional(),
    discountReason: z.string().max(200).optional(),
  })
  .strict();
const cart = z.array(cartLine).max(200);

const checkoutSchema = z
  .object({
    idempotencyKey: z.uuid(),
    lines: cart,
    expectedTotalPaise: money,
    payments: z
      .array(
        z
          .object({
            method: z.enum(["CASH", "UPI", "CARD"]),
            amountPaise: money,
            tenderedPaise: money.optional(),
            confirmedReceived: z.boolean().optional(),
            reference: z.string().max(64).optional(),
          })
          .strict(),
      )
      .max(6),
    customer: z
      .object({ name: z.string().max(120).optional(), phone: z.string().max(20).optional() })
      .strict()
      .optional(),
  })
  .strict();

const fail = (code: BillingErrorCode) => ({ ok: false, code }) as const;
const INVALID = fail("VALIDATION_ERROR");
const BRANCH_COOKIE = "nv_branch";

type Resolved = { ok: true; backend: BillingBackend } | { ok: false; code: BillingErrorCode };

/**
 * Choose the backend for this request. The choice is explicit and never falls back:
 *  - BILLING_BACKEND=demo     -> the in-memory demo engine (development; fictitious data)
 *  - BILLING_BACKEND=supabase -> PostgreSQL via the signed-in user's own session
 *  - anything else            -> refuse (fail closed)
 * Authorisation: the demo path checks the demo role; the real path verifies the session with Supabase
 * and the user's memberships. In both cases the first gate is repeated by the engine / database.
 */
async function resolveBackend(): Promise<Resolved> {
  const mode = backendMode();

  if (mode === "demo") {
    if (!(await requirePermission("sale.create"))) return fail("FORBIDDEN");
    try {
      return {
        ok: true,
        backend: new DemoBillingBackend(getEngine(), policyFor(await getCurrentRole())),
      };
    } catch (e) {
      if (e instanceof BackendNotConfiguredError) return fail("INTERNAL");
      throw e;
    }
  }

  if (mode === "supabase") {
    const client = await createUserClient();
    if (!client) return fail("INTERNAL");
    const ctx = await loadContext(client as unknown as QueryClient);
    if (!ctx) return fail("UNAUTHENTICATED");
    const preferred = (await cookies()).get(BRANCH_COOKIE)?.value;
    const target = pickBillingTarget(ctx, preferred);
    if (!target.ok) {
      return fail(
        target.reason === "NO_BRANCH"
          ? "NO_BRANCH"
          : target.reason === "NO_COUNTER"
            ? "NO_COUNTER"
            : "BRANCH_NOT_SELECTED",
      );
    }
    if (!canInBranch(ctx, target.branchId, "sale.create")) return fail("FORBIDDEN");
    return {
      ok: true,
      backend: new SupabaseBillingBackend(client as unknown as RpcClient, {
        branchId: target.branchId,
        counterId: target.counterId,
      }),
    };
  }

  return fail("INTERNAL");
}

async function withBackend<T>(
  run: (b: BillingBackend) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  const r = await resolveBackend();
  if (!r.ok) return r;
  return run(r.backend);
}

export async function getSession(): Promise<ActionResult<SessionState>> {
  return withBackend((b) => b.getSession());
}

export async function startDay(openingFloatPaise: number): Promise<ActionResult<SessionState>> {
  const parsed = money.safeParse(openingFloatPaise);
  if (!parsed.success) return INVALID;
  return withBackend((b) => b.startDay(parsed.data));
}

/**
 * Photos are cosmetic: after the database has priced the cart, attach each line's signed photo URL using the signed-in user's own
 * session. In demo mode, or on any problem, the result is returned unchanged (placeholders). Billing never waits on or fails because of a photo.
 */
async function photoContext(): Promise<{ client: PhotoClient; tenantId: string } | null> {
  try {
    const s = await getAppSession();
    return s && s.mode === "supabase" && s.client ? { client: s.client as unknown as PhotoClient, tenantId: s.tenantId } : null;
  } catch {
    return null;
  }
}
async function withQuotePhotos(r: ActionResult<Quote>): Promise<ActionResult<Quote>> {
  if (!r.ok) return r;
  const p = await photoContext();
  return p ? { ok: true, data: await quoteWithPhotos(p.client, p.tenantId, r.data) } : r;
}

export async function scanBarcode(
  code: string,
  currentCart: CartLineInput[],
): Promise<ActionResult<Quote>> {
  const c = cart.safeParse(currentCart);
  if (!c.success || typeof code !== "string" || code.length > 128) return INVALID;
  return withQuotePhotos(await withBackend((b) => b.scan(code, c.data)));
}

export async function searchItems(query: string): Promise<ActionResult<SearchResult[]>> {
  if (typeof query !== "string" || query.length > 80) return INVALID;
  const r = await withBackend((b) => b.search(query));
  if (!r.ok) return r;
  const p = await photoContext();
  return p ? { ok: true, data: await resultsWithPhotos(p.client, p.tenantId, r.data) } : r;
}

export async function addItem(
  itemId: string,
  currentCart: CartLineInput[],
): Promise<ActionResult<Quote>> {
  const c = cart.safeParse(currentCart);
  if (!c.success || typeof itemId !== "string" || itemId.length > 64) return INVALID;
  return withQuotePhotos(await withBackend((b) => b.addItem(itemId, c.data)));
}

export async function quoteCart(currentCart: CartLineInput[]): Promise<ActionResult<Quote>> {
  const c = cart.safeParse(currentCart);
  if (!c.success) return INVALID;
  return withQuotePhotos(await withBackend((b) => b.quote(c.data)));
}

export async function completeCheckout(
  input: CheckoutInput,
): Promise<ActionResult<InvoiceSummary>> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  return withBackend((b) => b.checkout(parsed.data));
}

/** DEMO ONLY: switch the demo identity so role-based screens can be reviewed. */
export async function switchDemoRole(role: string): Promise<void> {
  if (backendMode() !== "demo" || !isRole(role)) return;
  (await cookies()).set(ROLE_COOKIE, role, { path: "/", sameSite: "lax", httpOnly: true });
}
