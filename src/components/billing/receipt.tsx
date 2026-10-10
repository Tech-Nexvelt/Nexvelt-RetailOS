import type { InvoiceSummary, PaymentMethod } from "@/domain/billing";
import { formatINR, type Paise } from "@/domain/money";

/**
 * A receipt for the browser's own print dialog (any normal printer; no PDF service). The same data
 * shape is used straight after a sale and when reprinting from Sales, so both look identical.
 *
 * Honesty rules:
 *  - If no tax was applied, the receipt says so and says it is NOT a GST tax invoice.
 *  - The shop name, GSTIN and address are printed only if the shop has entered them. Nothing is invented.
 *  - A voided bill is clearly marked and a reprint is marked DUPLICATE.
 */
export interface ReceiptLine {
  name: string;
  detail: string;
  quantity: number;
  unitPricePaise: Paise;
  discountPaise: Paise;
  lineTotalPaise: Paise;
}
export interface ReceiptData {
  businessName: string;
  branchName: string;
  gstin?: string | null;
  invoiceNumber: string;
  issuedAt: string;
  lines: ReceiptLine[];
  grandTotalPaise: Paise;
  taxTotalPaise: Paise;
  taxConfigured: boolean;
  payments: { method: PaymentMethod; amountPaise: Paise }[];
  changePaise: Paise;
  status?: "ISSUED" | "VOIDED";
  /** True when printing again from Sales history. */
  duplicate?: boolean;
}

export interface Business {
  name: string;
  branch: string;
  gstin?: string | null;
}

export function receiptFromInvoice(inv: InvoiceSummary, biz: Business, duplicate = false): ReceiptData {
  return {
    businessName: biz.name,
    branchName: biz.branch,
    gstin: biz.gstin,
    invoiceNumber: inv.invoiceNumber,
    issuedAt: inv.issuedAt,
    lines: inv.lines,
    grandTotalPaise: inv.grandTotalPaise,
    taxTotalPaise: inv.taxConfigured ? (inv.taxTotalPaise ?? 0) : 0,
    taxConfigured: inv.taxConfigured,
    payments: inv.payments,
    changePaise: inv.changePaise,
    duplicate,
  };
}

const METHOD_LABEL: Record<PaymentMethod, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card" };

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

export function receiptTotals(d: ReceiptData) {
  const subtotal = d.lines.reduce((n, l) => n + l.unitPricePaise * l.quantity, 0);
  const discount = d.lines.reduce((n, l) => n + l.discountPaise, 0);
  const added = d.grandTotalPaise - (subtotal - discount);
  return {
    subtotal,
    discount,
    // tax charged on top (> 0), or tax that is already inside the prices (shown as "included")
    taxAdded: added > 0 ? added : 0,
    taxIncluded: added <= 0 && d.taxTotalPaise > 0 ? d.taxTotalPaise : 0,
  };
}

export function ReceiptView({ data }: { data: ReceiptData }) {
  const t = receiptTotals(data);
  return (
    <article aria-label={`Receipt ${data.invoiceNumber}`} className="font-mono text-[12px] leading-snug text-black">
      <header className="text-center">
        <p className="text-sm font-bold">{data.businessName}</p>
        {data.branchName ? <p>{data.branchName}</p> : null}
        {data.gstin ? <p>GSTIN: {data.gstin}</p> : null}
        <p className="mt-1 font-bold">{data.taxConfigured ? "BILL" : "BILL (NO TAX APPLIED)"}</p>
        {data.status === "VOIDED" ? <p className="font-bold">*** VOIDED ***</p> : null}
        {data.duplicate ? <p className="font-bold">DUPLICATE COPY</p> : null}
      </header>

      <p className="mt-2 flex justify-between">
        <span>No: {data.invoiceNumber}</span>
        <span>{formatDateTime(data.issuedAt)}</span>
      </p>
      <hr className="my-1 border-dashed border-black" />

      <ul>
        {data.lines.map((l, i) => (
          <li key={i} className="mb-1">
            <p className="font-bold">{l.name}</p>
            <p className="flex justify-between">
              <span>
                {l.detail} · {l.quantity} × {formatINR(l.unitPricePaise)}
              </span>
              <span>{formatINR(l.unitPricePaise * l.quantity)}</span>
            </p>
            {l.discountPaise > 0 ? (
              <p className="flex justify-between">
                <span>Discount</span>
                <span>−{formatINR(l.discountPaise)}</span>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <hr className="my-1 border-dashed border-black" />

      <dl>
        <Row label="Subtotal" value={formatINR(t.subtotal)} />
        {t.discount > 0 ? <Row label="Discount" value={`−${formatINR(t.discount)}`} /> : null}
        {t.taxAdded > 0 ? <Row label="Tax" value={formatINR(t.taxAdded)} /> : null}
        {t.taxIncluded > 0 ? <Row label="Tax (included in prices)" value={formatINR(t.taxIncluded)} /> : null}
        <Row label="TOTAL" value={formatINR(data.grandTotalPaise)} strong />
      </dl>
      <hr className="my-1 border-dashed border-black" />

      <dl>
        {data.payments.map((p, i) => (
          <Row key={i} label={`Paid by ${METHOD_LABEL[p.method]}`} value={formatINR(p.amountPaise)} />
        ))}
        {data.changePaise > 0 ? <Row label="Change given" value={formatINR(data.changePaise)} /> : null}
      </dl>

      {!data.taxConfigured ? (
        <p className="mt-2 text-center">No tax has been applied to this bill. It is not a GST tax invoice.</p>
      ) : null}
      <p className="mt-2 text-center">Thank you!</p>
    </article>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "text-sm font-bold" : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** Hidden on screen, the only thing visible when printing (see .receipt-root in globals.css). */
export function PrintableReceipt({ data }: { data: ReceiptData }) {
  return (
    <div className="receipt-root" data-testid="printable-receipt">
      <ReceiptView data={data} />
    </div>
  );
}
