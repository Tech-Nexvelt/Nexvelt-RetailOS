"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, Printer, ScanLine, Trash2 } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/states";
import type {
  ActionResult,
  BillingErrorCode,
  CartLineInput,
  InvoiceSummary,
  PaymentInput,
  PaymentMethod,
  Quote,
  QuotedLine,
  SearchResult,
  SessionState,
} from "@/domain/billing";
import { BILLING_ERRORS } from "@/domain/errors";
import { formatINR, parseRupees, type Paise } from "@/domain/money";
import type { AckStatus } from "@/lib/scanner/protocol";
import { PhoneScannerPanel, type ScannerApi } from "./phone-scanner-panel";
import { PrintableReceipt, ReceiptView, receiptFromInvoice, type Business } from "./receipt";

/** The server actions this screen calls. Injected so the screen can be tested without a server. */
export interface BillingApi {
  getSession(): Promise<ActionResult<SessionState>>;
  startDay(openingFloatPaise: number): Promise<ActionResult<SessionState>>;
  scanBarcode(code: string, cart: CartLineInput[]): Promise<ActionResult<Quote>>;
  searchItems(query: string): Promise<ActionResult<SearchResult[]>>;
  addItem(itemId: string, cart: CartLineInput[]): Promise<ActionResult<Quote>>;
  quoteCart(cart: CartLineInput[]): Promise<ActionResult<Quote>>;
  completeCheckout(input: {
    idempotencyKey: string;
    lines: CartLineInput[];
    payments: PaymentInput[];
    expectedTotalPaise: Paise;
    customer?: { name?: string; phone?: string };
  }): Promise<ActionResult<InvoiceSummary>>;
}

interface Props {
  api: BillingApi;
  /** Phone scanner server calls. When absent the Phone scanner panel is not shown. */
  scanner?: ScannerApi;
  business: Business;
  /** Whether this person may give discounts at all. The server decides again on every request. */
  canDiscount: boolean;
  demo?: boolean;
  newKey?: () => string;
}

type Phase = "idle" | "submitting" | "uncertain" | "done";
type Say = { tone: "error" | "success" | "warning" | "info"; text: string } | null;
interface PayRow { id: number; method: PaymentMethod; amount: string; given: string; confirmed: boolean; reference: string }

const MAX_ROWS = 6;
const say = (code: BillingErrorCode): Say => ({ tone: "error", text: `${BILLING_ERRORS[code].title} ${BILLING_ERRORS[code].fix}` });
const toInput = (l: QuotedLine): CartLineInput => ({
  itemId: l.itemId,
  quantity: l.quantity,
  ...(l.discountPaise > 0 ? { discountPaise: l.discountPaise, discountReason: l.discountReason ?? "" } : {}),
});

export function BillingWorkspace({ api, scanner, business, canDiscount, demo, newKey = () => crypto.randomUUID() }: Props) {
  const scanRef = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [float, setFloat] = useState("");
  const [lines, setLines] = useState<QuotedLine[]>([]);
  const [totals, setTotals] = useState({ total: 0, discount: 0, tax: 0, taxConfigured: false });
  const [scan, setScan] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [message, setMessage] = useState<Say>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [invoice, setInvoice] = useState<InvoiceSummary | null>(null);
  const [rows, setRows] = useState<PayRow[]>([{ id: 1, method: "CASH", amount: "", given: "", confirmed: false, reference: "" }]);
  const [split, setSplit] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discountFor, setDiscountFor] = useState<string | null>(null);
  const [discAmount, setDiscAmount] = useState("");
  const [discReason, setDiscReason] = useState("");
  const [online, setOnline] = useState(true);
  const key = useRef(newKey());
  const lastRequest = useRef<Parameters<BillingApi["completeCheckout"]>[0] | null>(null);
  const searchSeq = useRef(0);
  const rowSeq = useRef(1);

  const cartInput = useMemo(() => lines.map(toInput), [lines]);
  const locked = phase === "submitting" || phase === "uncertain" || phase === "done";

  // ---- phone scanner: barcodes from a paired phone enter the SAME scanBarcode + cart path, one at a time --------------------
  const lockedRef = useRef(locked);
  const cartRef = useRef<CartLineInput[]>([]);
  const scanQueue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);
  useEffect(() => {
    cartRef.current = cartInput;
  }, [cartInput]);

  // ---- session, focus, connectivity ----------------------------------------------------------
  useEffect(() => {
    api.getSession().then((r) => r.ok && setSession(r.data));
  }, [api]);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    // Initial value must come from the browser, which is unavailable during server render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  useEffect(() => {
    if (!locked) scanRef.current?.focus();
  }, [locked, lines.length]);

  const complete = useRef<() => void>(() => {});

  useEffect(() => {
    // A keyboard-wedge scanner types into whatever has focus: send stray typing to the scan box.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2" || (e.key === "/" && !isEditable(document.activeElement))) {
        e.preventDefault();
        scanRef.current?.focus();
        return;
      }
      if (e.key === "F9" || (e.key === "Enter" && e.ctrlKey)) {
        e.preventDefault();
        complete.current();
        return;
      }
      if (e.key === "Escape") {
        setResults([]);
        return;
      }
      if (!locked && !isEditable(document.activeElement) && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        scanRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [locked]);

  // ---- cart ----------------------------------------------------------------------------------
  const applyQuote = useCallback((q: Quote) => {
    setLines(q.lines);
    setTotals({ total: q.grandTotalPaise, discount: q.discountTotalPaise, tax: q.taxTotalPaise ?? 0, taxConfigured: q.taxConfigured });
    const first = q.issues[0];
    if (first) setMessage(say(first.code));
  }, []);

  const run = useCallback(async <T,>(work: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> => {
    setBusy(true);
    try {
      return await work();
    } catch {
      return { ok: false, code: "NETWORK" };
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * A barcode that arrived from the paired phone. Jobs run strictly one after another and each starts from the cart the previous job
   * produced, so two quick scans never overwrite each other. While a checkout is running (or the bill is finished) nothing is added.
   * A phone scan never completes a bill, records a payment or changes stock: it only quotes the cart, exactly like typing the code.
   */
  const remoteScan = useCallback(
    (code: string): Promise<AckStatus> => {
      const job = scanQueue.current.then(async (): Promise<AckStatus> => {
        if (lockedRef.current) return "paused";
        const r = await run(() => api.scanBarcode(code, cartRef.current));
        if (r.ok) {
          cartRef.current = r.data.lines.map(toInput); // the next queued scan starts from this cart, not a stale render
          applyQuote(r.data);
          return "added";
        }
        setMessage({ tone: "warning", text: `Phone scan ${code}: ${BILLING_ERRORS[r.code].title} ${BILLING_ERRORS[r.code].fix}` });
        if (r.code === "BARCODE_NOT_FOUND") return "unknown";
        if (r.code === "NETWORK") return "error";
        return "unavailable";
      });
      scanQueue.current = job.catch(() => undefined);
      return job;
    },
    [api, applyQuote, run],
  );

  const onScan = async () => {
    const value = scan.trim();
    if (phase === "done" && value === "") return newBill();
    if (value === "" || locked) return;
    setMessage(null);
    setResults([]);
    const r = await run(() => api.scanBarcode(value, cartInput));
    if (r.ok) {
      applyQuote(r.data);
      setScan("");
      return;
    }
    if (r.code === "BARCODE_NOT_FOUND") {
      // Never guess. Offer name matches only; the cashier must pick one.
      const s = await run(() => api.searchItems(value));
      if (s.ok && s.data.length > 0) {
        setResults(s.data);
        setMessage({ tone: "info", text: "No item has this exact barcode. Name matches are shown; pick one." });
        return;
      }
    }
    setMessage(say(r.code));
  };

  const onType = (v: string) => {
    setScan(v);
    const seq = ++searchSeq.current;
    if (v.trim().length < 2) {
      setResults([]);
      return;
    }
    window.setTimeout(async () => {
      if (seq !== searchSeq.current) return; // the box changed (or a scan was submitted) meanwhile
      const s = await api.searchItems(v.trim()).catch(() => null);
      if (seq === searchSeq.current && s?.ok) setResults(s.data);
    }, 250);
  };

  const pick = async (id: string) => {
    if (locked) return;
    setResults([]);
    setScan("");
    searchSeq.current++;
    const r = await run(() => api.addItem(id, cartInput));
    if (r.ok) {
      applyQuote(r.data);
      setMessage(null);
    } else setMessage(say(r.code));
    scanRef.current?.focus();
  };

  const requote = async (next: CartLineInput[]) => {
    if (next.length === 0) {
      setLines([]);
      setTotals({ total: 0, discount: 0, tax: 0, taxConfigured: totals.taxConfigured });
      return;
    }
    const r = await run(() => api.quoteCart(next));
    if (r.ok) {
      applyQuote(r.data);
      if (r.data.issues.length === 0) setMessage(null);
    } else setMessage(say(r.code));
  };

  const setQty = (l: QuotedLine, qty: number) => {
    if (locked) return;
    if (qty < 1) return remove(l);
    if (qty > l.maxQuantity) {
      setMessage(say("INSUFFICIENT_STOCK"));
      return;
    }
    return requote(cartInput.map((c) => (c.itemId === l.itemId ? { ...c, quantity: qty } : c)));
  };
  const remove = (l: QuotedLine) => !locked && requote(cartInput.filter((c) => c.itemId !== l.itemId));

  const applyDiscount = (l: QuotedLine) => {
    const paise = discAmount.trim() === "" ? 0 : parseRupees(discAmount);
    if (paise === null) return setMessage({ tone: "error", text: "Type the discount as a rupee amount, for example 100 or 49.50." });
    if (paise > 0 && discReason.trim() === "") return setMessage(say("DISCOUNT_REASON_REQUIRED"));
    setDiscountFor(null);
    requote(cartInput.map((c) => (c.itemId === l.itemId ? { itemId: c.itemId, quantity: c.quantity, ...(paise > 0 ? { discountPaise: paise, discountReason: discReason.trim() } : {}) } : c)));
  };

  // ---- payment -------------------------------------------------------------------------------
  const total = totals.total;
  const parsed = rows.map((r) => ({ r, amount: split ? (parseRupees(r.amount) ?? NaN) : total }));
  const applied = parsed.reduce((n, p) => n + (Number.isFinite(p.amount) ? p.amount : 0), 0);
  const remaining = total - applied;

  const paymentProblem = (): string | null => {
    if (lines.length === 0) return "Add an item first.";
    if (total <= 0) return "The bill total must be more than ₹0.";
    for (const { r, amount } of parsed) {
      if (!Number.isFinite(amount) || amount <= 0) return "Enter an amount for every payment line.";
      if (r.method === "CASH") {
        const given = r.given.trim() === "" ? amount : (parseRupees(r.given) ?? NaN);
        if (!Number.isFinite(given) || given < amount) return "Cash received is less than the cash due.";
      } else if (!r.confirmed) return "Tick “payment received” once you have seen the UPI/card payment succeed.";
    }
    if (remaining !== 0) return remaining > 0 ? `${formatINR(remaining)} is still unpaid.` : `Payments are ${formatINR(-remaining)} too high.`;
    return null;
  };

  const changeDue = parsed.reduce((n, { r, amount }) => {
    if (r.method !== "CASH") return n;
    const given = r.given.trim() === "" ? amount : (parseRupees(r.given) ?? 0);
    return n + Math.max(0, given - amount);
  }, 0);

  const buildPayments = (): PaymentInput[] =>
    parsed.map(({ r, amount }) =>
      r.method === "CASH"
        ? { method: "CASH", amountPaise: amount, tenderedPaise: r.given.trim() === "" ? amount : (parseRupees(r.given) ?? amount) }
        : { method: r.method, amountPaise: amount, confirmedReceived: r.confirmed, ...(r.reference.trim() ? { reference: r.reference.trim() } : {}) },
    );

  const submit = async (request: NonNullable<typeof lastRequest.current>) => {
    setPhase("submitting");
    setMessage(null);
    const r = await run(() => api.completeCheckout(request));
    if (r.ok) {
      setInvoice(r.data);
      setPhase("done");
      return;
    }
    if (r.code === "NETWORK") {
      // We cannot know whether the server saved it. Keep the SAME key so retrying can never double-bill.
      setPhase("uncertain");
      return;
    }
    setPhase("idle");
    if (r.code === "PRICE_STALE" && "quote" in r && r.quote) applyQuote(r.quote);
    setMessage(say(r.code));
  };

  const doComplete = () => {
    if (phase !== "idle" || busy) return;
    if (!online) return setMessage(say("NETWORK"));
    if (!session?.open) return setMessage(say("SESSION_NOT_OPEN"));
    const problem = paymentProblem();
    if (problem) return setMessage({ tone: "error", text: problem });
    const request = {
      idempotencyKey: key.current,
      lines: cartInput,
      payments: buildPayments(),
      expectedTotalPaise: total,
      ...(customerName.trim() || customerPhone.trim() ? { customer: { ...(customerName.trim() ? { name: customerName.trim() } : {}), ...(customerPhone.trim() ? { phone: customerPhone.trim() } : {}) } } : {}),
    };
    lastRequest.current = request;
    void submit(request);
  };
  useEffect(() => {
    complete.current = doComplete;
  });

  const newBill = () => {
    key.current = newKey();
    lastRequest.current = null;
    setLines([]);
    setTotals({ total: 0, discount: 0, tax: 0, taxConfigured: totals.taxConfigured });
    setInvoice(null);
    setPhase("idle");
    setMessage(null);
    setResults([]);
    setScan("");
    rowSeq.current = 1;
    setRows([{ id: 1, method: "CASH", amount: "", given: "", confirmed: false, reference: "" }]);
    setSplit(false);
    setCustomerName("");
    setCustomerPhone("");
    requestAnimationFrame(() => scanRef.current?.focus());
  };

  const startDay = async () => {
    const paise = float.trim() === "" ? 0 : parseRupees(float);
    if (paise === null) return setMessage({ tone: "error", text: "Type the opening cash as a rupee amount, for example 2000." });
    const r = await run(() => api.startDay(paise));
    if (r.ok) {
      setSession(r.data);
      setMessage(null);
      // The focused "Start day" button disappears with its panel, which would drop focus to <body>.
      requestAnimationFrame(() => scanRef.current?.focus());
    } else setMessage(say(r.code));
  };

  const patchRow = (id: number, patch: Partial<PayRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  // ---- render --------------------------------------------------------------------------------
  const receipt = invoice ? receiptFromInvoice(invoice, business) : null;
  const problem = lines.length > 0 ? paymentProblem() : null;
  const canComplete = phase === "idle" && !busy && problem === null && !!session?.open && online;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
      <section aria-label="Bill" className="flex min-w-0 flex-col gap-3 print:hidden">
        {!online ? <Banner tone="warning" title="No internet connection.">Your cart is safe. Completing a bill needs a connection.</Banner> : null}
        {session && !session.open ? (
          <div className="rounded-ctl border border-line bg-surface p-4">
            <p className="font-semibold">Start the day</p>
            <p className="text-sm text-muted">Enter the cash in the drawer. You can scan items now, but a bill can only be completed once the day is started.</p>
            <div className="mt-2 flex gap-2">
              <Input aria-label="Opening cash in rupees" inputMode="decimal" placeholder="Opening cash, e.g. 2000" value={float} onChange={(e) => setFloat(e.target.value)} />
              <Button variant="primary" onClick={startDay} disabled={busy}>Start day</Button>
            </div>
          </div>
        ) : null}

        <div className="relative">
          <ScanLine aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={22} />
          <Input
            ref={scanRef}
            aria-label="Scan barcode or search product"
            placeholder="Scan barcode or type a product name…"
            className="min-h-14 pl-11 text-lg"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={scan}
            disabled={locked}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onScan();
              }
            }}
          />
        </div>

        <div aria-live="polite">{message ? <Banner tone={message.tone}>{message.text}</Banner> : null}</div>

        {scanner ? <PhoneScannerPanel api={scanner} onScan={remoteScan} accepting={!locked} /> : null}

        {results.length > 0 ? (
          <ul aria-label="Matching products" className="max-h-72 overflow-auto rounded-ctl border border-line bg-surface">
            {results.map((r) => (
              <li key={r.itemId} className="border-b border-line last:border-b-0">
                <button type="button" disabled={!r.available || locked} onClick={() => pick(r.itemId)} className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-app disabled:opacity-50">
                  <span>
                    <span className="font-medium">{r.name}</span> <span className="text-muted">{r.detail}</span>
                    {!r.available ? <span className="ml-2 text-sm text-danger">Not available</span> : null}
                  </span>
                  <span className="font-semibold">{formatINR(r.unitPricePaise)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {phase === "done" && invoice ? (
          <div className="rounded-ctl border border-success/40 bg-success-bg p-4" role="status">
            <p className="text-lg font-bold text-success">Bill saved: {invoice.invoiceNumber}</p>
            <p>Total {formatINR(invoice.grandTotalPaise)}{invoice.changePaise > 0 ? <> · <strong>Give change {formatINR(invoice.changePaise)}</strong></> : null}</p>
            {invoice.replayed ? <p className="text-sm">This bill was already saved; no second bill was created.</p> : null}
            {!invoice.taxConfigured ? <p className="mt-1 text-sm">No tax was applied. This is not a GST tax invoice.</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" size="lg" onClick={() => window.print()}><Printer aria-hidden size={18} /> Print receipt</Button>
              <Button size="lg" onClick={newBill}>New bill <Kbd>Enter</Kbd></Button>
            </div>
          </div>
        ) : (
          <CartTable
            lines={lines}
            locked={locked}
            canDiscount={canDiscount}
            discountFor={discountFor}
            setDiscountFor={(id) => { setDiscountFor(id); setDiscAmount(""); setDiscReason(""); }}
            discAmount={discAmount} setDiscAmount={setDiscAmount}
            discReason={discReason} setDiscReason={setDiscReason}
            applyDiscount={applyDiscount}
            setQty={setQty}
            remove={remove}
          />
        )}
        {demo ? <p className="text-sm text-muted">Demo data: items such as NR00000001, IJ0000123, GJ0000045.</p> : null}
      </section>

      <aside aria-label="Payment" className="flex flex-col gap-3 print:hidden lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-ctl border border-line bg-surface p-4">
          <p className="text-sm text-muted">Total payable</p>
          <p className={`text-4xl font-bold tracking-tight ${busy ? "opacity-60" : ""}`} data-testid="total">{formatINR(total)}</p>
          {lines.length > 0 ? (
            <p className="text-sm text-muted">
              {lines.reduce((n, l) => n + l.quantity, 0)} item(s)
              {totals.discount > 0 ? ` · discount ${formatINR(totals.discount)}` : ""}
              {totals.taxConfigured && totals.tax > 0 ? ` · tax ${formatINR(totals.tax)}` : ""}
              {!totals.taxConfigured ? " · no tax applied" : ""}
            </p>
          ) : null}
        </div>

        {phase !== "done" ? (
          <div className="rounded-ctl border border-line bg-surface p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-semibold">Payment</p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={split} disabled={locked} onChange={(e) => { setSplit(e.target.checked); if (!e.target.checked) setRows((rs) => rs.slice(0, 1)); }} />
                Split payment
              </label>
            </div>
            {rows.map((r, idx) => (
              <PaymentRow key={r.id} idx={idx} row={r} split={split} total={total} locked={locked} patch={(p) => patchRow(r.id, p)}
                onRemove={split && rows.length > 1 ? () => setRows((rs) => rs.filter((x) => x.id !== r.id)) : undefined} />
            ))}
            {split ? (
              <div className="mt-2 flex items-center justify-between text-sm">
                <Button size="md" disabled={locked || rows.length >= MAX_ROWS} onClick={() => setRows((rs) => [...rs, { id: ++rowSeq.current, method: "UPI", amount: "", given: "", confirmed: false, reference: "" }])}>
                  <Plus aria-hidden size={16} /> Add payment
                </Button>
                <span className={remaining === 0 ? "text-success" : "text-danger"} data-testid="remaining">
                  {remaining === 0 ? "Fully paid" : remaining > 0 ? `${formatINR(remaining)} remaining` : `${formatINR(-remaining)} too much`}
                </span>
              </div>
            ) : null}
            {changeDue > 0 ? <p className="mt-2 text-lg font-bold" data-testid="change">Change to give: {formatINR(changeDue)}</p> : null}
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted">Customer details (optional)</summary>
              <div className="mt-2 grid gap-2">
                <Input aria-label="Customer name" placeholder="Name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} disabled={locked} />
                <Input aria-label="Customer phone" placeholder="Phone" inputMode="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} disabled={locked} />
              </div>
            </details>

            {phase === "uncertain" ? (
              <Banner tone="warning" title="We could not confirm the bill was saved." className="mt-3"
                action={<Button onClick={() => lastRequest.current && void submit(lastRequest.current)}>Check again</Button>}>
                Pressing “Check again” will not create a second bill.
              </Banner>
            ) : null}

            <Button variant="primary" size="xl" className="mt-3 w-full" onClick={doComplete} disabled={!canComplete}>
              {phase === "submitting" ? "Saving…" : "Complete bill"}
            </Button>
            {lines.length > 0 && problem && phase === "idle" ? <p className="mt-2 text-sm text-muted">{problem}</p> : null}
            <p className="mt-2 text-xs text-muted">UPI and card are recorded as you confirm them. They are not checked with the bank. <Kbd>F9</Kbd> completes · <Kbd>F2</Kbd> scan box</p>
          </div>
        ) : null}
      </aside>

      {receipt ? (
        <>
          <PrintableReceipt data={receipt} />
          <div className="hidden" aria-hidden>{/* keeps the printable copy the only receipt on paper */}</div>
        </>
      ) : null}
    </div>
  );
}

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}

function CartTable(p: {
  lines: QuotedLine[]; locked: boolean; canDiscount: boolean;
  discountFor: string | null; setDiscountFor: (id: string | null) => void;
  discAmount: string; setDiscAmount: (v: string) => void; discReason: string; setDiscReason: (v: string) => void;
  applyDiscount: (l: QuotedLine) => void; setQty: (l: QuotedLine, q: number) => void; remove: (l: QuotedLine) => void;
}) {
  if (p.lines.length === 0) {
    return (
      <div className="rounded-ctl border border-dashed border-line bg-surface px-6 py-12 text-center text-muted">
        <p className="text-lg font-semibold text-ink">Scan an item to begin</p>
        <p>Point the scanner at a tag, or type a name above.</p>
      </div>
    );
  }
  return (
    <ul aria-label="Items in this bill" className="rounded-ctl border border-line bg-surface">
      {p.lines.map((l) => (
        <li key={l.itemId} className="border-b border-line p-3 last:border-b-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{l.name}</p>
              <p className="text-sm text-muted">{l.detail} · {formatINR(l.unitPricePaise)}{l.discountPaise > 0 ? ` · discount ${formatINR(l.discountPaise)}` : ""}</p>
            </div>
            <p className="font-semibold" data-testid="line-total">{formatINR(l.lineTotalPaise)}</p>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {l.unique ? (
              <span className="text-sm text-muted">1 piece</span>
            ) : (
              <div className="flex items-center gap-1" role="group" aria-label={`Quantity of ${l.name} ${l.detail}`}>
                <Button size="md" aria-label="Decrease quantity" disabled={p.locked} onClick={() => p.setQty(l, l.quantity - 1)}><Minus aria-hidden size={16} /></Button>
                <span className="w-10 text-center font-semibold" data-testid="qty">{l.quantity}</span>
                <Button size="md" aria-label="Increase quantity" disabled={p.locked || l.quantity >= l.maxQuantity} onClick={() => p.setQty(l, l.quantity + 1)}><Plus aria-hidden size={16} /></Button>
              </div>
            )}
            {p.canDiscount ? (
              <Button size="md" variant="ghost" disabled={p.locked} onClick={() => p.setDiscountFor(p.discountFor === l.itemId ? null : l.itemId)}>Discount</Button>
            ) : null}
            <Button size="md" variant="ghost" aria-label={`Remove ${l.name}`} disabled={p.locked} onClick={() => p.remove(l)}><Trash2 aria-hidden size={16} /> Remove</Button>
          </div>
          {p.canDiscount && p.discountFor === l.itemId ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-[8rem_1fr_auto]">
              <Input aria-label="Discount amount in rupees" placeholder="₹ amount" inputMode="decimal" value={p.discAmount} onChange={(e) => p.setDiscAmount(e.target.value)} />
              <Input aria-label="Reason for the discount" placeholder="Reason (required)" value={p.discReason} onChange={(e) => p.setDiscReason(e.target.value)} />
              <Button variant="primary" onClick={() => p.applyDiscount(l)}>Apply</Button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function PaymentRow({ idx, row, split, total, locked, patch, onRemove }: {
  idx: number; row: PayRow; split: boolean; total: Paise; locked: boolean; patch: (p: Partial<PayRow>) => void; onRemove?: () => void;
}) {
  const methods: PaymentMethod[] = ["CASH", "UPI", "CARD"];
  const label = (m: PaymentMethod) => (m === "CASH" ? "Cash" : m === "UPI" ? "UPI" : "Card");
  return (
    <div className="mb-3 rounded-ctl bg-app p-2">
      <div role="radiogroup" aria-label={`Payment method ${idx + 1}`} className="grid grid-cols-3 gap-2">
        {methods.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={row.method === m} disabled={locked}
            onClick={() => patch({ method: m, confirmed: false })}
            className={`min-h-11 rounded-ctl border text-base font-semibold ${row.method === m ? "border-primary-strong bg-primary" : "border-line bg-surface"}`}>
            {label(m)}
          </button>
        ))}
      </div>
      {split ? (
        <Input className="mt-2" aria-label={`Amount for payment ${idx + 1} in rupees`} inputMode="decimal" placeholder="Amount ₹" value={row.amount} disabled={locked} onChange={(e) => patch({ amount: e.target.value })} />
      ) : null}
      {row.method === "CASH" ? (
        <Input className="mt-2" aria-label={`Cash received ${idx + 1} in rupees`} inputMode="decimal" placeholder={split ? "Cash received ₹ (optional)" : `Customer gives ₹ (blank = ${formatINR(total)})`} value={row.given} disabled={locked} onChange={(e) => patch({ given: e.target.value })} />
      ) : (
        <div className="mt-2 grid gap-2">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={row.confirmed} disabled={locked} onChange={(e) => patch({ confirmed: e.target.checked })} />
            <span>Payment received. I have seen it succeed on the {row.method === "UPI" ? "UPI app" : "card machine"}.</span>
          </label>
          <Input aria-label={`${label(row.method)} reference ${idx + 1} (optional)`} placeholder="Reference (optional)" value={row.reference} disabled={locked} onChange={(e) => patch({ reference: e.target.value })} />
        </div>
      )}
      {onRemove ? <Button className="mt-2" variant="ghost" size="md" onClick={onRemove} disabled={locked}>Remove this payment</Button> : null}
    </div>
  );
}

export { ReceiptView };
