import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EditItem } from "@/components/products/edit-item";
import { getCatalogRow, listMovements } from "@/server/app/catalog";
import { requireSession } from "@/server/app/session";

export const metadata = { title: "Edit product" };
export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  OPENING: "Opening stock",
  ADJUSTMENT_IN: "Added",
  ADJUSTMENT_OUT: "Removed",
  SALE: "Sold",
  SALE_VOID: "Bill cancelled",
  RETURN: "Returned",
};

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession("/products");
  const can = (p: string) => s.permissions.has(p);
  if (!can("product.edit") && !can("product.price_edit") && !can("inventory.adjust")) redirect("/products");
  const row = await getCatalogRow(s, id);
  if (!row) notFound();
  // read-only ledger view; the database decides whether this person may see it (inventory.view)
  const movements = row.kind === "VARIANT" ? await listMovements(s, row.id) : null;
  const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  return (
    <div className="flex flex-col gap-4">
      <Link href="/products" className="text-sm text-primary-strong underline">← All products</Link>
      <h1 className="text-2xl font-bold tracking-tight">Edit product</h1>
      <EditItem row={row} canPrice={can("product.price_edit")} canEdit={can("product.edit")} canAdjust={can("inventory.adjust")} />
      {row.kind === "VARIANT" && movements !== null ? (
        <section aria-label="Stock history" className="flex max-w-3xl flex-col gap-2">
          <h2 className="font-semibold">Stock history</h2>
          {movements.length === 0 ? (
            <p className="text-sm text-muted">No stock movements yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-ctl border border-line bg-surface">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-app text-muted">
                  <tr>
                    <th className="p-2">When</th>
                    <th className="p-2">What</th>
                    <th className="p-2 text-right">Change</th>
                    <th className="p-2 text-right">Stock after</th>
                    <th className="p-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m, i) => (
                    <tr key={`${m.at}-${i}`} className="border-b border-line last:border-b-0">
                      <td className="p-2">{when(m.at)}</td>
                      <td className="p-2">{TYPE_LABEL[m.type] ?? m.type}</td>
                      <td className={`p-2 text-right font-medium ${m.delta < 0 ? "text-danger" : "text-success"}`}>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                      <td className="p-2 text-right">{m.balanceAfter}</td>
                      <td className="p-2">{m.note ? `${m.reason.replace(/_/g, " ").toLowerCase()} · ${m.note}` : m.reason.replace(/_/g, " ").toLowerCase()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted">Stock history is a permanent record. It cannot be edited or deleted.</p>
        </section>
      ) : null}
    </div>
  );
}
