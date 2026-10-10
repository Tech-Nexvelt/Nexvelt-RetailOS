import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintableReceipt, ReceiptView } from "@/components/billing/receipt";
import { PrintButton } from "@/components/sales/print-button";
import { requireSession } from "@/server/app/session";
import { loadReceipt } from "@/server/app/sales";

export const metadata = { title: "Bill" };
export const dynamic = "force-dynamic";

export default async function SaleDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession("/sales");
  const receipt = await loadReceipt(s, id);
  if (!receipt) notFound();
  return (
    <div className="flex flex-col gap-4">
      <Link href="/sales" className="text-sm text-primary-strong underline print:hidden">
        ← All sales
      </Link>
      <div className="flex items-center justify-between gap-3 print:hidden">
        <h1 className="text-2xl font-bold tracking-tight">Bill {receipt.invoiceNumber}</h1>
        <PrintButton label="Reprint receipt" />
      </div>
      <p className="text-sm text-muted print:hidden">
        Prices and descriptions are exactly as they were when the item was sold, even if the product has changed
        since.
      </p>
      <div className="max-w-sm rounded-ctl border border-line bg-white p-4 print:hidden">
        <ReceiptView data={receipt} />
      </div>
      <PrintableReceipt data={receipt} />
    </div>
  );
}
