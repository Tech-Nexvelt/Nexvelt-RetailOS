import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ActionResult, CartLineInput, Quote, QuotedLine, SearchResult, SessionState } from "@/domain/billing";
import { BillingWorkspace, type BillingApi } from "./billing-workspace";

const OPEN: SessionState = { open: true, openingFloatPaise: 100000, openedAt: "2026-10-10T09:00:00.000Z" };
const ok = <T,>(data: T): ActionResult<T> => ({ ok: true, data });
const L = (itemId: string, name: string, imageUrl?: string | null): QuotedLine => ({ itemId, kind: "CLOTHING", name, detail: "M", code: itemId, quantity: 1, unitPricePaise: 10000, grossPaise: 10000, discountPaise: 0, lineTotalPaise: 10000, unique: false, maxQuantity: 9, ...(imageUrl !== undefined ? { imageUrl } : {}) });
const quote = (lines: QuotedLine[]): Quote => ({ lines, itemCount: lines.length, discountTotalPaise: 0, grandTotalPaise: 10000 * lines.length, taxConfigured: false, issues: [] });
const business = { name: "NR", branch: "Main", gstin: null } as never;

function api(lines: QuotedLine[], results: SearchResult[] = []): BillingApi {
  return {
    getSession: vi.fn(async () => ok(OPEN)),
    startDay: vi.fn(async () => ok(OPEN)),
    scanBarcode: vi.fn(async (_c: string, _cart: CartLineInput[]) => ok(quote(lines))),
    searchItems: vi.fn(async () => ok(results)),
    addItem: vi.fn(async () => ok(quote(lines))),
    quoteCart: vi.fn(async () => ok(quote(lines))),
    completeCheckout: vi.fn(async () => ({ ok: false, code: "NETWORK" }) as never),
  };
}

describe("photos in the billing screen", () => {
  it("a cart line shows its real photo when it has one; lines without one render no photo element at all (never a broken image)", async () => {
    const a = api([L("v1", "Blue Shirt", "https://signed.example/blue.jpg?t=1"), L("v2", "Red Shirt", null), L("v3", "Old Shirt")]);
    render(<BillingWorkspace api={a} business={business} canDiscount={false} />);
    await userEvent.type(await screen.findByLabelText("Scan barcode or search product"), "X{Enter}");
    await waitFor(() => expect(screen.getByText("Blue Shirt")).toBeTruthy());
    const photo = document.querySelector('img[alt="Blue Shirt"]') as HTMLImageElement;
    expect(photo.getAttribute("src")).toBe("https://signed.example/blue.jpg?t=1");
    expect([photo.getAttribute("width"), photo.getAttribute("loading")]).toEqual(["48", "lazy"]);
    // no photo (null) and no field at all (older server): the screen still shows the item, and never a photo <img> for it
    expect(screen.getByText("Red Shirt")).toBeTruthy();
    expect(screen.getByText("Old Shirt")).toBeTruthy();
    expect(document.querySelector('img[src][alt="Red Shirt"]')).toBeNull();
    expect(document.querySelector('img[src][alt="Old Shirt"]')).toBeNull();
    expect(document.querySelectorAll('img[src^="https://signed.example"]').length).toBe(1);
  });
  it("search results show photos too", async () => {
    const results: SearchResult[] = [
      { itemId: "v1", kind: "CLOTHING", name: "Blue Shirt", detail: "M", unitPricePaise: 10000, available: true, imageUrl: "https://signed.example/blue.jpg?t=1" },
      { itemId: "v2", kind: "CLOTHING", name: "Red Shirt", detail: "L", unitPricePaise: 10000, available: true, imageUrl: null },
    ];
    render(<BillingWorkspace api={api([], results)} business={business} canDiscount={false} />);
    await userEvent.type(await screen.findByLabelText("Scan barcode or search product"), "shirt");
    const list = await screen.findByLabelText("Matching products");
    expect(list.querySelector('img[alt="Blue Shirt"]')?.getAttribute("src")).toContain("blue.jpg");
    expect(list.querySelector('img[src][alt="Red Shirt"]')).toBeNull(); // no photo: no photo element, no broken icon
    expect(list.textContent).toContain("Red Shirt");
  });
  it("totals and quantities are not affected by photos", async () => {
    render(<BillingWorkspace api={api([L("v1", "Blue Shirt", "https://signed.example/b.jpg"), L("v2", "Red Shirt", null)])} business={business} canDiscount={false} />);
    await userEvent.type(await screen.findByLabelText("Scan barcode or search product"), "X{Enter}");
    await waitFor(() => expect(document.body.textContent).toContain("₹200.00"));
  });
});
