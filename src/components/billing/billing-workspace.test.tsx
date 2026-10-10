import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ActionResult, Quote, SessionState } from "@/domain/billing";
import { BillingWorkspace, type BillingApi } from "./billing-workspace";

/**
 * Regression tests for "the first barcode scan right after Start day".
 * Found in a real-browser pass: Start day removes its own panel, which unmounts the focused button, so
 * focus fell back to <body> and the layout shifted. These tests pin the behaviour a cashier relies on:
 * after starting the day the scan box has focus, and a keyboard-wedge scanner (real key events) works
 * even when focus is on the page body or while Start day is still in flight.
 */
const SHIRT: Quote = {
  lines: [
    {
      itemId: "v1", kind: "CLOTHING", name: "Cotton Shirt", detail: "M / Blue", code: "NR00000001", quantity: 1,
      unitPricePaise: 129900, grossPaise: 129900, discountPaise: 0, lineTotalPaise: 129900, unique: false, maxQuantity: 5,
    },
  ],
  itemCount: 1, discountTotalPaise: 0, grandTotalPaise: 129900, taxConfigured: false, issues: [],
};
const CLOSED: SessionState = { open: false, openingFloatPaise: 0, openedAt: null };
const OPEN: SessionState = { open: true, openingFloatPaise: 200000, openedAt: "2026-10-10T09:00:00.000Z" };
const ok = <T,>(data: T): ActionResult<T> => ({ ok: true, data });

function makeApi(over: Partial<BillingApi> = {}): BillingApi {
  return {
    getSession: vi.fn(async () => ok(CLOSED)),
    startDay: vi.fn(async () => ok(OPEN)),
    scanBarcode: vi.fn(async () => ok(SHIRT)),
    searchItems: vi.fn(async () => ok([])),
    addItem: vi.fn(async () => ok(SHIRT)),
    quoteCart: vi.fn(async () => ok(SHIRT)),
    completeCheckout: vi.fn(),
    ...over,
  } as BillingApi;
}

const scanBox = () => screen.getByLabelText("Scan barcode or search product");
async function renderAndWaitForStartPanel(api: BillingApi) {
  render(<BillingWorkspace api={api} business={{ name: "Shop", branch: "Main" }} canDiscount={false} newKey={() => "key-1"} />);
  await screen.findByText("Start the day");
}

describe("billing screen: Start day then scan", () => {
  it("puts focus in the scan box once the day has started (the focused button disappears with its panel)", async () => {
    const api = makeApi();
    await renderAndWaitForStartPanel(api);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Start day" }));
    await waitFor(() => expect(screen.queryByText("Start the day")).not.toBeInTheDocument());
    await waitFor(() => expect(scanBox()).toHaveFocus());
  });

  it("a keyboard-wedge scan (real key events) works when focus is on the page body right after Start day", async () => {
    const api = makeApi();
    await renderAndWaitForStartPanel(api);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Start day" }));
    await waitFor(() => expect(screen.queryByText("Start the day")).not.toBeInTheDocument());
    (document.activeElement as HTMLElement | null)?.blur(); // e.g. the cashier clicked empty space
    expect(document.body).toHaveFocus();
    await user.keyboard("NR00000001{Enter}");
    await waitFor(() => expect(api.scanBarcode).toHaveBeenCalledWith("NR00000001", []));
    expect(await screen.findByText("Cotton Shirt")).toBeInTheDocument();
  });

  it("a scan submitted while Start day is still in flight is not lost", async () => {
    let release: (v: ActionResult<SessionState>) => void = () => {};
    const api = makeApi({ startDay: vi.fn(() => new Promise<ActionResult<SessionState>>((r) => (release = r))) });
    await renderAndWaitForStartPanel(api);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Start day" }));
    await user.type(scanBox(), "NR00000001{Enter}"); // Start day has not answered yet
    await act(async () => release(ok(OPEN)));
    await waitFor(() => expect(api.scanBarcode).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Cotton Shirt")).toBeInTheDocument();
    expect(scanBox()).toHaveValue("");
  });

  it("a rejected Start day keeps the panel and does not steal focus into a locked state", async () => {
    const api = makeApi({ startDay: vi.fn(async () => ({ ok: false, code: "FORBIDDEN" }) as ActionResult<SessionState>) });
    await renderAndWaitForStartPanel(api);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Start day" }));
    expect(await screen.findByText("Start the day")).toBeInTheDocument();
    expect(scanBox()).not.toBeDisabled();
  });
});
