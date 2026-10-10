import type { BillingErrorCode } from "./billing";

export interface FriendlyError {
  title: string;
  /** What the user can do next. */
  fix: string;
}

/** One map for every billing error: plain language plus the next step (UX plan §7.2). */
export const BILLING_ERRORS: Record<BillingErrorCode, FriendlyError> = {
  BARCODE_NOT_FOUND: {
    title: "No item has this barcode.",
    fix: "Check the tag and scan again, or search by name.",
  },
  ITEM_ALREADY_SOLD: {
    title: "This piece was already sold.",
    fix: "Set it aside and tell the manager.",
  },
  ITEM_NOT_IN_BRANCH: {
    title: "This item belongs to a different branch.",
    fix: "Ask the manager to check where it is.",
  },
  ITEM_ON_HOLD: {
    title: "This item is on hold and can't be sold.",
    fix: "Ask a manager to release it.",
  },
  ITEM_INACTIVE: {
    title: "This item is switched off.",
    fix: "Ask a manager before selling it.",
  },
  ITEM_NOT_FOUND: {
    title: "An item in the cart no longer exists.",
    fix: "Remove it from the cart and scan it again.",
  },
  ALREADY_IN_CART: {
    title: "This item is already in the cart.",
    fix: "Each jewellery piece can be added only once.",
  },
  INSUFFICIENT_STOCK: {
    title: "Not enough stock.",
    fix: "Reduce the quantity, or check the stock count.",
  },
  PRICE_STALE: {
    title: "The price changed.",
    fix: "Check the new total, then complete the bill.",
  },
  DISCOUNT_NOT_ALLOWED: {
    title: "You can't give this discount.",
    fix: "Remove the discount, or ask a manager or the owner to approve it.",
  },
  DISCOUNT_REASON_REQUIRED: {
    title: "A discount needs a reason.",
    fix: "Type why the discount is given, then try again.",
  },
  TOTAL_NOT_PAYABLE: {
    title: "The bill total must be more than ₹0.",
    fix: "Reduce the discount, or remove the free items.",
  },
  SESSION_NOT_OPEN: {
    title: "The day hasn't been started.",
    fix: "Enter the opening cash and press Start.",
  },
  CART_EMPTY: {
    title: "The cart is empty.",
    fix: "Scan or search an item first.",
  },
  PAYMENT_MISMATCH: {
    title: "The payments don't add up to the total.",
    fix: "Change the amounts until nothing is remaining.",
  },
  PAYMENT_NOT_CONFIRMED: {
    title: "UPI/card payment isn't confirmed.",
    fix: "Tick “Payment received” only after you see it on the terminal or app.",
  },
  CASH_TENDER_TOO_LOW: {
    title: "The cash given is less than the cash due.",
    fix: "Enter at least the cash amount due.",
  },
  IDEMPOTENCY_KEY_REUSED: {
    title: "This bill was already submitted with different details.",
    fix: "Start a new bill and try again.",
  },
  VALIDATION_ERROR: {
    title: "Something in the request isn't valid.",
    fix: "Refresh the page and try again.",
  },
  FORBIDDEN: {
    title: "Your role can't do this.",
    fix: "Ask the shop owner or a manager.",
  },
  UNAUTHENTICATED: {
    title: "You are signed out.",
    fix: "Sign in again to continue.",
  },
  TAX_NOT_CONFIGURED: {
    title: "Tax has not been set up for this item.",
    fix: "Ask the owner to finish the tax settings before billing it.",
  },
  RULE_NOT_CONFIGURED: {
    title: "This item's price rule has not been set up.",
    fix: "Ask the owner to set the pricing rule and today's rate, or sell a fixed-price item.",
  },
  CONCURRENT_UPDATE: {
    title: "Someone else was changing the same item.",
    fix: "Wait a moment and press Complete again; nothing was charged twice.",
  },
  NO_BRANCH: {
    title: "You are not assigned to a branch that can bill.",
    fix: "Ask the owner to give you access to a branch.",
  },
  BRANCH_NOT_SELECTED: {
    title: "Choose which branch you are billing for.",
    fix: "Pick a branch, then try again.",
  },
  NO_COUNTER: {
    title: "This branch has no billing counter.",
    fix: "Ask the owner to add a counter in Settings.",
  },
  NETWORK: {
    title: "No connection to the server. Your cart is safe.",
    fix: "Check the internet and try again.",
  },
  INTERNAL: {
    title: "Something went wrong on our side.",
    fix: "Nothing was saved. Try again; if it repeats, call support.",
  },
};

export function describeError(code: BillingErrorCode): string {
  const e = BILLING_ERRORS[code];
  return `${e.title} ${e.fix}`;
}
