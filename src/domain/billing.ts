import type { Paise } from "./money";

export type ItemKind = "CLOTHING" | "IMITATION_JEWELLERY" | "PRECIOUS_JEWELLERY";
export type PaymentMethod = "CASH" | "UPI" | "CARD";

/** What the client sends about its cart: identities and quantities only, never prices. */
export interface CartLineInput {
  itemId: string;
  quantity: number;
  /** Line discount in paise. Refused unless the actor's discount authority covers it. */
  discountPaise?: Paise;
  /** Mandatory whenever discountPaise > 0 (FR-POS-04). */
  discountReason?: string;
}

/** A cart line as priced by the server. */
export interface QuotedLine {
  /** short-lived signed URL of the item's photo, attached by the server after pricing; absent or null when it has none */
  imageUrl?: string | null;
  itemId: string;
  kind: ItemKind;
  name: string;
  /** "M / Blue" for clothing, the tag code for jewellery. */
  detail: string;
  code: string;
  quantity: number;
  unitPricePaise: Paise;
  /** unit price x quantity, before discount. */
  grossPaise: Paise;
  discountPaise: Paise;
  discountReason?: string;
  /** grossPaise - discountPaise. */
  lineTotalPaise: Paise;
  /** Unique physical items (jewellery) cannot have a quantity above 1. */
  unique: boolean;
  maxQuantity: number;
}

export interface CartIssue {
  itemId: string;
  code: BillingErrorCode;
}

export interface Quote {
  lines: QuotedLine[];
  itemCount: number;
  discountTotalPaise: Paise;
  /** Present when the database computes tax (production backend). */
  taxableTotalPaise?: Paise;
  taxTotalPaise?: Paise;
  grandTotalPaise: Paise;
  /** Tax rates are an open client question (OQ-10). Until configured, no tax is computed. */
  taxConfigured: boolean;
  issues: CartIssue[];
}

export interface SearchResult {
  /** short-lived signed URL of the item's photo; absent or null when it has none */
  imageUrl?: string | null;
  itemId: string;
  kind: ItemKind;
  name: string;
  detail: string;
  unitPricePaise: Paise;
  available: boolean;
}

export interface PaymentInput {
  method: PaymentMethod;
  amountPaise: Paise;
  /** Cash only: amount handed over by the customer. */
  tenderedPaise?: Paise;
  /** UPI/card: cashier ticked "payment received" after checking the terminal or app. */
  confirmedReceived?: boolean;
  reference?: string;
}

export interface CheckoutInput {
  /** One key per bill attempt. Retrying the same attempt MUST reuse it. */
  idempotencyKey: string;
  lines: CartLineInput[];
  payments: PaymentInput[];
  /** What the cashier saw. The server recomputes and rejects a mismatch. */
  expectedTotalPaise: Paise;
  customer?: { name?: string; phone?: string };
}

export interface InvoiceLineSnapshot {
  name: string;
  detail: string;
  quantity: number;
  unitPricePaise: Paise;
  discountPaise: Paise;
  lineTotalPaise: Paise;
}

export interface InvoiceSummary {
  invoiceId: string;
  invoiceNumber: string;
  issuedAt: string;
  lines: InvoiceLineSnapshot[];
  grandTotalPaise: Paise;
  paidPaise: Paise;
  changePaise: Paise;
  payments: { method: PaymentMethod; amountPaise: Paise }[];
  taxConfigured: boolean;
  /** Tax included in or added to the total, when the database computed it. */
  taxTotalPaise?: Paise;
  /** True when this response replays an earlier identical request (no second invoice was made). */
  replayed: boolean;
}

export interface SessionState {
  open: boolean;
  openingFloatPaise: Paise;
  openedAt: string | null;
}

export type BillingErrorCode =
  | "BARCODE_NOT_FOUND"
  | "ITEM_ALREADY_SOLD"
  | "ITEM_NOT_IN_BRANCH"
  | "ITEM_ON_HOLD"
  | "ITEM_INACTIVE"
  | "ITEM_NOT_FOUND"
  | "ALREADY_IN_CART"
  | "INSUFFICIENT_STOCK"
  | "PRICE_STALE"
  | "DISCOUNT_NOT_ALLOWED"
  | "DISCOUNT_REASON_REQUIRED"
  | "TOTAL_NOT_PAYABLE"
  | "SESSION_NOT_OPEN"
  | "CART_EMPTY"
  | "PAYMENT_MISMATCH"
  | "PAYMENT_NOT_CONFIRMED"
  | "CASH_TENDER_TOO_LOW"
  | "IDEMPOTENCY_KEY_REUSED"
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "UNAUTHENTICATED"
  | "TAX_NOT_CONFIGURED"
  | "RULE_NOT_CONFIGURED"
  | "CONCURRENT_UPDATE"
  | "NO_BRANCH"
  | "BRANCH_NOT_SELECTED"
  | "NO_COUNTER"
  | "NETWORK"
  | "INTERNAL";

export type ActionResult<T> =
  { ok: true; data: T } | { ok: false; code: BillingErrorCode; itemId?: string; quote?: Quote };
