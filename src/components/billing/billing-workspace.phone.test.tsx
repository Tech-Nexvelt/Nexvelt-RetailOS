import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ActionResult, CartLineInput, Quote, QuotedLine, SessionState } from "@/domain/billing";
import type { AckStatus } from "@/lib/scanner/protocol";
import { BillingWorkspace, type BillingApi } from "./billing-workspace";

/**
 * The phone panel is replaced by a stub that hands us its onScan/accepting props, so these tests exercise the REAL
 * BillingWorkspace scan path (scanBarcode + cart) exactly as a paired phone would drive it.
 */
let phone: { onScan: (code: string) => Promise<AckStatus>; accepting: boolean } | null = null;
vi.mock("./phone-scanner-panel", () => ({
  PhoneScannerPanel: (p: { onScan: (c: string) => Promise<AckStatus>; accepting: boolean }) => {
    phone = { onScan: p.onScan, accepting: p.accepting };
    return <div data-testid="phone-panel" />;
  },
}));

const OPEN: SessionState = { open: true, openingFloatPaise: 100000, openedAt: "2026-10-10T09:00:00.000Z" };
const ok = <T,>(data: T): ActionResult<T> => ({ ok: true, data });
const ITEMS: Record<string, { id: string; name: string; price: number }> = {
  A: { id: "vA", name: "Shirt A", price: 10000 },
  B: { id: "vB", name: "Shirt B", price: 25000 },
};
const quoteFor = (cart: CartLineInput[]): Quote => {
  const lines: QuotedLine[] = cart.map((c) => {
    const it = Object.values(ITEMS).find((i) => i.id === c.itemId)!;
    return { itemId: c.itemId, kind: "CLOTHING", name: it.name, detail: "M", code: it.id, quantity: c.quantity, unitPricePaise: it.price, grossPaise: it.price * c.quantity, discountPaise: 0, lineTotalPaise: it.price * c.quantity, unique: false, maxQuantity: 50 };
  });
  return { lines, itemCount: lines.length, discountTotalPaise: 0, grandTotalPaise: lines.reduce((n, l) => n + l.lineTotalPaise, 0), taxConfigured: false, issues: [] };
};

function api(over: Partial<BillingApi> = {}): { api: BillingApi; seen: CartLineInput[][] } {
  const seen: CartLineInput[][] = [];
  return {
    seen,
    api: {
      getSession: vi.fn(async () => ok(OPEN)),
      startDay: vi.fn(async () => ok(OPEN)),
      scanBarcode: vi.fn(async (code: string, cart: CartLineInput[]) => {
        seen.push(cart.map((c) => ({ ...c })));
        await new Promise((r) => setTimeout(r, 20)); // a real round trip: the second scan would race the first without the queue
        const it = ITEMS[code];
        if (!it) return { ok: false, code: "BARCODE_NOT_FOUND" } as ActionResult<Quote>;
        const next = cart.some((c) => c.itemId === it.id) ? cart.map((c) => (c.itemId === it.id ? { ...c, quantity: c.quantity + 1 } : c)) : [...cart, { itemId: it.id, quantity: 1 }];
        return ok(quoteFor(next));
      }),
      searchItems: vi.fn(async () => ok([])),
      addItem: vi.fn(async () => ok(quoteFor([]))),
      quoteCart: vi.fn(async (cart: CartLineInput[]) => ok(quoteFor(cart))),
      completeCheckout: vi.fn(async () => ({ ok: false, code: "NETWORK" }) as never),
      ...over,
    },
  };
}
const business = { name: "NR", branch: "Main", gstin: null } as never;

describe("BillingWorkspace + phone scanner", () => {
  it("shows the phone panel only when the scanner API is provided", () => {
    phone = null;
    render(<BillingWorkspace api={api().api} business={business} canDiscount={false} />);
    expect(screen.queryByTestId("phone-panel")).toBeNull();
    render(<BillingWorkspace api={api().api} business={business} canDiscount={false} scanner={{ createPairing: vi.fn(), verifyIncoming: vi.fn() }} />);
    expect(screen.getByTestId("phone-panel")).toBeTruthy();
  });

  it("two scans that arrive at the same instant are BOTH applied, each quoting the cart the previous one produced", async () => {
    const { api: a, seen } = api();
    render(<BillingWorkspace api={a} business={business} canDiscount={false} scanner={{ createPairing: vi.fn(), verifyIncoming: vi.fn() }} />);
    await waitFor(() => expect(phone).not.toBeNull());
    let results: AckStatus[] = [];
    await act(async () => {
      results = await Promise.all([phone!.onScan("A"), phone!.onScan("B"), phone!.onScan("A")]);
    });
    expect(results).toEqual(["added", "added", "added"]);
    expect(seen).toEqual([[], [{ itemId: "vA", quantity: 1 }], [{ itemId: "vA", quantity: 1 }, { itemId: "vB", quantity: 1 }]]);
    await waitFor(() => expect(screen.getByText("Shirt A")).toBeTruthy());
    expect(screen.getByText("Shirt B")).toBeTruthy();
    // total = A x2 (20000) + B (25000) = ₹450.00
    expect(document.body.textContent).toContain("₹450.00");
  });

  it("an unknown barcode is reported 'unknown', shows a warning with the code, and leaves the cart alone", async () => {
    const { api: a } = api();
    render(<BillingWorkspace api={a} business={business} canDiscount={false} scanner={{ createPairing: vi.fn(), verifyIncoming: vi.fn() }} />);
    await waitFor(() => expect(phone).not.toBeNull());
    let r: AckStatus = "added";
    await act(async () => {
      r = await phone!.onScan("ZZZ");
    });
    expect(r).toBe("unknown");
    await waitFor(() => expect(document.body.textContent).toMatch(/Phone scan ZZZ/));
    expect(screen.queryByText("Shirt A")).toBeNull();
  });

  it("a network failure is reported as 'error' and does not throw", async () => {
    const { api: a } = api({ scanBarcode: vi.fn(async () => ({ ok: false, code: "NETWORK" }) as ActionResult<Quote>) });
    render(<BillingWorkspace api={a} business={business} canDiscount={false} scanner={{ createPairing: vi.fn(), verifyIncoming: vi.fn() }} />);
    await waitFor(() => expect(phone).not.toBeNull());
    let r: AckStatus = "added";
    await act(async () => {
      r = await phone!.onScan("A");
    });
    expect(r).toBe("error");
  });

  it("a scan never calls checkout, payment or any stock operation", async () => {
    const { api: a } = api();
    render(<BillingWorkspace api={a} business={business} canDiscount={false} scanner={{ createPairing: vi.fn(), verifyIncoming: vi.fn() }} />);
    await waitFor(() => expect(phone).not.toBeNull());
    await act(async () => {
      await phone!.onScan("A");
    });
    expect(a.completeCheckout).not.toHaveBeenCalled();
    expect(a.startDay).not.toHaveBeenCalled();
    expect(a.scanBarcode).toHaveBeenCalledTimes(1);
  });
});
