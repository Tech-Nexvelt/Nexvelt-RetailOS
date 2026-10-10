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
import { BILLING_ERRORS } from "@/domain/errors";
import type { BillingBackend } from "./backend";

/**
 * The production billing backend. It holds NO business rules: pricing, tax, discount authority,
 * stock, payment reconciliation, idempotency and invoice numbering all happen inside PostgreSQL
 * (migrations 0007 to 0009), in the same transaction as the writes. This class only forwards the
 * request as the signed-in user and translates the database's stable error codes.
 */
export interface RpcError {
  message: string;
  code?: string;
  details?: string | null;
}
export interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError | null }>;
}

const KNOWN = new Set<string>(Object.keys(BILLING_ERRORS));

export function mapRpcError(error: RpcError): {
  code: BillingErrorCode;
  itemId?: string;
  quote?: Quote;
} {
  let detail: { itemId?: string; quote?: Quote } = {};
  if (error.details) {
    try {
      detail = JSON.parse(error.details);
    } catch {
      detail = {};
    }
  }
  const out = (code: BillingErrorCode) => ({
    code,
    ...(typeof detail.itemId === "string" ? { itemId: detail.itemId } : {}),
    ...(detail.quote && typeof detail.quote === "object" ? { quote: detail.quote } : {}),
  });
  if (KNOWN.has(error.message)) return out(error.message as BillingErrorCode);
  // Lock timeout, deadlock, serialisation failure: safe to retry with the same idempotency key.
  if (error.code === "55P03" || error.code === "40P01" || error.code === "40001")
    return { code: "CONCURRENT_UPDATE" };
  if (error.code === "42501" || /permission denied|row-level security/i.test(error.message))
    return { code: "FORBIDDEN" };
  if (/fetch failed|failed to fetch|network|ECONN|timeout/i.test(error.message))
    return { code: "NETWORK" };
  // Anything else is unexpected. The raw database message is never sent to the browser.
  return { code: "INTERNAL" };
}

const fail = (e: RpcError): { ok: false } & ReturnType<typeof mapRpcError> => ({
  ok: false,
  ...mapRpcError(e),
});

export class SupabaseBillingBackend implements BillingBackend {
  constructor(
    private readonly client: RpcClient,
    private readonly target: { branchId: string; counterId: string },
  ) {}

  private async call<T>(fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
    let res;
    try {
      res = await this.client.rpc(fn, { p_branch: this.target.branchId, ...args });
    } catch {
      return { ok: false, code: "NETWORK" };
    }
    if (res.error) return fail(res.error);
    return { ok: true, data: res.data as T };
  }

  getSession() {
    return this.call<SessionState>("pos_get_session", { p_counter: this.target.counterId });
  }

  startDay(openingFloatPaise: number) {
    return this.call<SessionState>("pos_start_day", {
      p_counter: this.target.counterId,
      p_opening_float_paise: openingFloatPaise,
    });
  }

  quote(cart: CartLineInput[]) {
    return this.call<Quote>("pos_quote_cart", { p_lines: cart });
  }

  async scan(code: string, cart: CartLineInput[]): Promise<ActionResult<Quote>> {
    // Exact match only; the database never resolves a partial code.
    const found = await this.call<{ itemId: string }>("resolve_barcode", { p_code: code });
    if (!found.ok) return found;
    return this.add(found.data.itemId, cart);
  }

  addItem(itemId: string, cart: CartLineInput[]) {
    return this.add(itemId, cart);
  }

  private async add(itemId: string, cart: CartLineInput[]): Promise<ActionResult<Quote>> {
    const existing = cart.find((l) => l.itemId === itemId);
    const next = existing
      ? cart.map((l) => (l.itemId === itemId ? { ...l, quantity: l.quantity + 1 } : l))
      : [...cart, { itemId, quantity: 1 }];
    const priced = await this.quote(next);
    if (!priced.ok) return priced;
    // Only a problem with the item being added blocks the add; other lines keep their own issues.
    const issue = priced.data.issues.find((i) => i.itemId === itemId);
    if (issue) {
      // A second unit of a one-of-a-kind piece is reported by the database as invalid quantity.
      const code = issue.code === "VALIDATION_ERROR" && existing ? "ALREADY_IN_CART" : issue.code;
      return { ok: false, code, itemId };
    }
    return priced;
  }

  search(query: string) {
    return this.call<SearchResult[]>("catalog_search", { p_query: query });
  }

  checkout(input: CheckoutInput): Promise<ActionResult<InvoiceSummary>> {
    return this.call<InvoiceSummary>("pos_checkout", {
      p_counter: this.target.counterId,
      p_idempotency_key: input.idempotencyKey,
      p_lines: input.lines,
      p_payments: input.payments,
      p_expected_total_paise: input.expectedTotalPaise,
      p_customer: input.customer ?? null,
    });
  }
}
