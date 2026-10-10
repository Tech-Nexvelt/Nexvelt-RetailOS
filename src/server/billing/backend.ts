import type {
  ActionResult,
  CartLineInput,
  CheckoutInput,
  InvoiceSummary,
  Quote,
  SearchResult,
  SessionState,
} from "@/domain/billing";

/**
 * What the billing server actions need from a backend. Two implementations exist:
 *  - the explicit, in-memory DEMO engine (development only, fictitious data), and
 *  - the SupabaseBillingBackend, which calls the PostgreSQL functions and is the real one.
 * There is no automatic fallback from one to the other.
 */
export interface BillingBackend {
  getSession(): Promise<ActionResult<SessionState>>;
  startDay(openingFloatPaise: number): Promise<ActionResult<SessionState>>;
  scan(code: string, cart: CartLineInput[]): Promise<ActionResult<Quote>>;
  search(query: string): Promise<ActionResult<SearchResult[]>>;
  addItem(itemId: string, cart: CartLineInput[]): Promise<ActionResult<Quote>>;
  quote(cart: CartLineInput[]): Promise<ActionResult<Quote>>;
  checkout(input: CheckoutInput): Promise<ActionResult<InvoiceSummary>>;
}
