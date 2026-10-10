import type {
  ActionResult,
  BillingErrorCode,
  CartIssue,
  CartLineInput,
  CheckoutInput,
  InvoiceSummary,
  ItemKind,
  PaymentInput,
  Quote,
  QuotedLine,
  SearchResult,
  SessionState,
} from "@/domain/billing";
import { looksLikeBarcode, normalizeCode } from "@/domain/barcode";
import { isPaise, isWithinPercent, type Paise } from "@/domain/money";
import { NO_DISCOUNT_AUTHORITY, type ActorPolicy } from "@/domain/policy";

/**
 * DEMO BACKEND. This class implements the billing rules (exact barcode lookup, server-side
 * totals, atomic checkout, idempotency, stock/duplicate-sale protection) against in-memory data so
 * the billing workspace can be exercised and tested end to end. It is NOT the production data
 * layer: the production implementation is the PostgreSQL `pos_checkout` RPC specified in
 * TRD §12.2, which is not built yet (needs a running Supabase/Postgres; Phase 2/6).
 *
 * Every public method is synchronous with no awaits between check and mutate, so each is atomic
 * within the single Node process.
 */

export type UniqueStatus = "IN_STOCK" | "SOLD" | "ON_HOLD";

export interface CatalogRecord {
  id: string;
  kind: ItemKind;
  /** Primary barcode / tag code. Looked up by exact match only. */
  code: string;
  name: string;
  detail: string;
  unitPricePaise: Paise;
  branchId: string;
  active: boolean;
  /** Clothing variants have a quantity; unique jewellery items have a status. */
  stock?: number;
  status?: UniqueStatus;
  /** Text used by name search. Must NOT contain barcodes or tag codes. */
  searchText: string;
}

export interface EngineOptions {
  branchId: string;
  items: CatalogRecord[];
  now?: () => Date;
}

const MAX_QTY = 999;
const PAYMENT_METHODS: readonly string[] = ["CASH", "UPI", "CARD"];

function isUnique(item: CatalogRecord): boolean {
  return item.kind !== "CLOTHING";
}

function availabilityError(item: CatalogRecord, branchId: string): BillingErrorCode | null {
  if (item.branchId !== branchId) return "ITEM_NOT_IN_BRANCH";
  if (!item.active) return "ITEM_INACTIVE";
  if (isUnique(item)) {
    if (item.status === "SOLD") return "ITEM_ALREADY_SOLD";
    if (item.status === "ON_HOLD") return "ITEM_ON_HOLD";
  } else if ((item.stock ?? 0) <= 0) {
    return "INSUFFICIENT_STOCK";
  }
  return null;
}

function validQty(q: unknown): q is number {
  return typeof q === "number" && Number.isInteger(q) && q >= 1 && q <= MAX_QTY;
}

export class BillingEngine {
  private readonly branchId: string;
  private readonly byId = new Map<string, CatalogRecord>();
  private readonly byCode = new Map<string, CatalogRecord>();
  private readonly now: () => Date;
  private session: SessionState = { open: false, openingFloatPaise: 0, openedAt: null };
  private invoiceCounter = 0;
  private readonly idempotency = new Map<string, { hash: string; response: InvoiceSummary }>();
  readonly invoices: InvoiceSummary[] = [];

  constructor(opts: EngineOptions) {
    this.branchId = opts.branchId;
    this.now = opts.now ?? (() => new Date());
    for (const item of opts.items) {
      this.byId.set(item.id, { ...item });
      this.byCode.set(normalizeCode(item.code), this.byId.get(item.id) as CatalogRecord);
    }
  }

  // ---- session -----------------------------------------------------------------------------

  getSession(): SessionState {
    return { ...this.session };
  }

  openSession(openingFloatPaise: Paise): ActionResult<SessionState> {
    if (!Number.isSafeInteger(openingFloatPaise) || openingFloatPaise < 0) {
      return { ok: false, code: "VALIDATION_ERROR" };
    }
    if (this.session.open) return { ok: true, data: this.getSession() };
    this.session = { open: true, openingFloatPaise, openedAt: this.now().toISOString() };
    return { ok: true, data: this.getSession() };
  }

  // ---- lookup ------------------------------------------------------------------------------

  /** Exact match on the normalised code. Never partial. */
  private findByCode(raw: string): CatalogRecord | undefined {
    const code = normalizeCode(raw);
    if (!looksLikeBarcode(code)) return undefined;
    return this.byCode.get(code);
  }

  search(query: string): SearchResult[] {
    const tokens = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    if (tokens.length === 0 || tokens.join("").length < 2) return [];
    const out: SearchResult[] = [];
    for (const item of this.byId.values()) {
      if (item.branchId !== this.branchId || !item.active) continue;
      const haystack = item.searchText.toLowerCase();
      if (!tokens.every((t) => haystack.includes(t))) continue;
      out.push({
        itemId: item.id,
        kind: item.kind,
        name: item.name,
        detail: item.detail,
        unitPricePaise: item.unitPricePaise,
        available: availabilityError(item, this.branchId) === null,
      });
      if (out.length >= 20) break;
    }
    return out;
  }

  // ---- cart --------------------------------------------------------------------------------

  private cleanCart(cart: CartLineInput[]): CartLineInput[] | null {
    const seen = new Set<string>();
    const out: CartLineInput[] = [];
    for (const line of cart) {
      if (!validQty(line.quantity) || seen.has(line.itemId)) return null;
      const discount = line.discountPaise ?? 0;
      if (!isPaise(discount)) return null;
      seen.add(line.itemId);
      const clean: CartLineInput = { itemId: line.itemId, quantity: line.quantity };
      if (discount > 0) {
        clean.discountPaise = discount;
        clean.discountReason = (line.discountReason ?? "").trim().slice(0, 200);
      }
      out.push(clean);
    }
    return out;
  }

  quote(cartInput: CartLineInput[], policy: ActorPolicy = NO_DISCOUNT_AUTHORITY): Quote {
    const cart = this.cleanCart(cartInput);
    if (!cart) {
      // A malformed cart is an error, never silently an empty or zero-value cart.
      return {
        lines: [],
        itemCount: 0,
        discountTotalPaise: 0,
        grandTotalPaise: 0,
        taxConfigured: false,
        issues: [{ itemId: "", code: "VALIDATION_ERROR" }],
      };
    }
    const lines: QuotedLine[] = [];
    const issues: CartIssue[] = [];
    let total = 0;
    let totalDiscount = 0;
    for (const line of cart) {
      const item = this.byId.get(line.itemId);
      if (!item) {
        issues.push({ itemId: line.itemId, code: "ITEM_NOT_FOUND" });
        continue;
      }
      const unavailable = availabilityError(item, this.branchId);
      if (unavailable) issues.push({ itemId: item.id, code: unavailable });
      else if (!isUnique(item) && line.quantity > (item.stock ?? 0)) {
        issues.push({ itemId: item.id, code: "INSUFFICIENT_STOCK" });
      } else if (isUnique(item) && line.quantity !== 1) {
        issues.push({ itemId: item.id, code: "VALIDATION_ERROR" });
      }
      const gross = item.unitPricePaise * line.quantity;
      const discount = Math.min(line.discountPaise ?? 0, gross);
      if ((line.discountPaise ?? 0) > gross) {
        issues.push({ itemId: item.id, code: "DISCOUNT_NOT_ALLOWED" });
      } else if (discount > 0) {
        if (!isWithinPercent(discount, gross, policy.maxDiscountBps)) {
          issues.push({ itemId: item.id, code: "DISCOUNT_NOT_ALLOWED" });
        } else if (!line.discountReason) {
          issues.push({ itemId: item.id, code: "DISCOUNT_REASON_REQUIRED" });
        }
      }
      const lineTotal = gross - discount;
      total += lineTotal;
      totalDiscount += discount;
      lines.push({
        itemId: item.id,
        kind: item.kind,
        name: item.name,
        detail: item.detail,
        code: item.code,
        quantity: line.quantity,
        unitPricePaise: item.unitPricePaise,
        grossPaise: gross,
        discountPaise: discount,
        discountReason: discount > 0 ? line.discountReason : undefined,
        lineTotalPaise: lineTotal,
        unique: isUnique(item),
        maxQuantity: isUnique(item) ? 1 : (item.stock ?? 0),
      });
    }
    return {
      lines,
      itemCount: lines.reduce((n, l) => n + l.quantity, 0),
      discountTotalPaise: totalDiscount,
      grandTotalPaise: total,
      // Tax rates are unconfirmed (OQ-10); the demo never invents them.
      taxConfigured: false,
      issues,
    };
  }

  /** Add one unit of an item to the cart, applying every availability rule. */
  private addInternal(
    item: CatalogRecord,
    cartInput: CartLineInput[],
    policy: ActorPolicy,
  ): ActionResult<Quote> {
    const cart = this.cleanCart(cartInput);
    if (!cart) return { ok: false, code: "VALIDATION_ERROR" };
    const err = availabilityError(item, this.branchId);
    if (err) return { ok: false, code: err, itemId: item.id };
    const existing = cart.find((l) => l.itemId === item.id);
    if (existing && isUnique(item)) return { ok: false, code: "ALREADY_IN_CART", itemId: item.id };
    const nextQty = (existing?.quantity ?? 0) + 1;
    if (!isUnique(item) && nextQty > (item.stock ?? 0)) {
      return { ok: false, code: "INSUFFICIENT_STOCK", itemId: item.id };
    }
    if (nextQty > MAX_QTY) return { ok: false, code: "VALIDATION_ERROR" };
    const next = existing
      ? cart.map((l) => (l.itemId === item.id ? { ...l, quantity: nextQty } : l))
      : [...cart, { itemId: item.id, quantity: 1 }];
    return { ok: true, data: this.quote(next, policy) };
  }

  scan(
    code: string,
    cart: CartLineInput[],
    policy: ActorPolicy = NO_DISCOUNT_AUTHORITY,
  ): ActionResult<Quote> {
    const item = this.findByCode(code);
    if (!item) return { ok: false, code: "BARCODE_NOT_FOUND" };
    return this.addInternal(item, cart, policy);
  }

  addItem(
    itemId: string,
    cart: CartLineInput[],
    policy: ActorPolicy = NO_DISCOUNT_AUTHORITY,
  ): ActionResult<Quote> {
    const item = this.byId.get(itemId);
    if (!item) return { ok: false, code: "BARCODE_NOT_FOUND" };
    return this.addInternal(item, cart, policy);
  }

  // ---- checkout ----------------------------------------------------------------------------

  private hashRequest(input: CheckoutInput): string {
    const lines = [...input.lines].sort((a, b) => a.itemId.localeCompare(b.itemId));
    return JSON.stringify({
      lines,
      payments: input.payments,
      total: input.expectedTotalPaise,
      customer: input.customer ?? null,
    });
  }

  private validatePayments(
    payments: PaymentInput[],
    total: Paise,
  ): { code: BillingErrorCode } | { change: Paise; paid: Paise } {
    if (payments.length === 0) return { code: "PAYMENT_MISMATCH" };
    let applied = 0;
    let change = 0;
    for (const p of payments) {
      if (!PAYMENT_METHODS.includes(p.method)) return { code: "VALIDATION_ERROR" };
      if (!Number.isSafeInteger(p.amountPaise) || p.amountPaise <= 0) {
        return { code: "VALIDATION_ERROR" };
      }
      applied += p.amountPaise;
      if (p.method === "CASH") {
        const tendered = p.tenderedPaise ?? p.amountPaise;
        if (!Number.isSafeInteger(tendered) || tendered < p.amountPaise) {
          return { code: "CASH_TENDER_TOO_LOW" };
        }
        change += tendered - p.amountPaise;
      } else if (p.confirmedReceived !== true) {
        // A non-cash payment is never assumed to have succeeded (FR-PAY-04).
        return { code: "PAYMENT_NOT_CONFIRMED" };
      }
    }
    if (applied !== total) return { code: "PAYMENT_MISMATCH" };
    return { change, paid: applied };
  }

  checkout(
    input: CheckoutInput,
    policy: ActorPolicy = NO_DISCOUNT_AUTHORITY,
  ): ActionResult<InvoiceSummary> {
    // 1. Idempotency: a repeated request returns the original bill and changes nothing.
    const hash = this.hashRequest(input);
    const prior = this.idempotency.get(input.idempotencyKey);
    if (prior) {
      if (prior.hash !== hash) return { ok: false, code: "IDEMPOTENCY_KEY_REUSED" };
      return { ok: true, data: { ...prior.response, replayed: true } };
    }

    // 2. Preconditions.
    if (!this.session.open) return { ok: false, code: "SESSION_NOT_OPEN" };
    if (input.lines.length === 0) return { ok: false, code: "CART_EMPTY" };
    const cart = this.cleanCart(input.lines);
    if (!cart) return { ok: false, code: "VALIDATION_ERROR" };

    // 3. Re-price on the server, re-check every item, and compare with what the cashier saw.
    const quote = this.quote(cart, policy);
    const issue = quote.issues[0];
    if (issue) return { ok: false, code: issue.code, itemId: issue.itemId, quote };
    if (quote.grandTotalPaise !== input.expectedTotalPaise) {
      return { ok: false, code: "PRICE_STALE", quote };
    }

    // A bill must have a positive total: no free or negative invoices, whatever the discounts.
    if (quote.grandTotalPaise <= 0) return { ok: false, code: "TOTAL_NOT_PAYABLE", quote };

    // 4. Payments must match the server total exactly.
    const pay = this.validatePayments(input.payments, quote.grandTotalPaise);
    if ("code" in pay) return { ok: false, code: pay.code };

    // 5. Commit: everything below happens together (no await, no early exit).
    for (const line of quote.lines) {
      const item = this.byId.get(line.itemId) as CatalogRecord;
      if (isUnique(item)) item.status = "SOLD";
      else item.stock = (item.stock ?? 0) - line.quantity;
    }
    this.invoiceCounter += 1;
    const invoice: InvoiceSummary = {
      invoiceId: `inv_${this.invoiceCounter}`,
      invoiceNumber: `DEMO-${String(this.invoiceCounter).padStart(6, "0")}`,
      issuedAt: this.now().toISOString(),
      lines: quote.lines.map((l) => ({
        name: l.name,
        detail: l.detail,
        quantity: l.quantity,
        unitPricePaise: l.unitPricePaise,
        discountPaise: l.discountPaise,
        lineTotalPaise: l.lineTotalPaise,
      })),
      grandTotalPaise: quote.grandTotalPaise,
      paidPaise: pay.paid,
      changePaise: pay.change,
      payments: input.payments.map((p) => ({ method: p.method, amountPaise: p.amountPaise })),
      taxConfigured: false,
      replayed: false,
    };
    this.invoices.push(invoice);
    this.idempotency.set(input.idempotencyKey, { hash, response: invoice });
    return { ok: true, data: invoice };
  }

  /** Read-only copy of the demo catalogue, for the demo product list. */
  listCatalog(): CatalogRecord[] {
    return [...this.byId.values()].filter((i) => i.branchId === this.branchId).map((i) => ({ ...i }));
  }

  // ---- test/inspection helpers -------------------------------------------------------------

  stockOf(itemId: string): { stock?: number; status?: UniqueStatus } {
    const item = this.byId.get(itemId);
    return item ? { stock: item.stock, status: item.status } : {};
  }
}
