import Link from "next/link";
import { Plus, Package } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/states";
import { formatINR } from "@/domain/money";
import { requireSession } from "@/server/app/session";
import { listCatalog } from "@/server/app/catalog";

export const metadata = { title: "Products & Stock" };
export const dynamic = "force-dynamic";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requireSession("/products");
  const { q = "" } = await searchParams;
  let rows;
  try {
    rows = await listCatalog(s, q);
  } catch {
    return (
      <Banner tone="error" title="Products could not be loaded.">
        Check the internet connection and refresh the page.
      </Banner>
    );
  }
  const canCreate = s.permissions.has("product.create");
  const canEdit = s.permissions.has("product.edit") || s.permissions.has("product.price_edit") || s.permissions.has("inventory.adjust");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Products &amp; Stock</h1>
          <p className="text-muted">{s.branchName}</p>
        </div>
        {canCreate ? (
          <Link href="/products/new" className="inline-flex min-h-12 items-center gap-2 rounded-ctl bg-primary px-5 text-lg font-semibold hover:bg-primary-strong">
            <Plus aria-hidden size={18} /> New product
          </Link>
        ) : null}
      </div>
      <form method="get" role="search" className="flex gap-2">
        <input name="q" defaultValue={q} placeholder="Search by name, size, tag or barcode" aria-label="Search products"
          className="min-h-11 w-full max-w-md rounded-ctl border border-line bg-surface px-3" />
        <button type="submit" className="min-h-11 rounded-ctl bg-primary px-4 font-semibold hover:bg-primary-strong">Search</button>
      </form>
      {rows.length === 0 ? (
        <EmptyState icon={<Package aria-hidden size={32} />} title={q ? "No product matches that search" : "No products yet"}
          description={q ? "Try a shorter word." : canCreate ? "Add your first product. Choose clothing or jewellery on the next screen." : "The owner has not added products yet."} />
      ) : (
        <div className="overflow-x-auto rounded-ctl border border-line bg-surface">
          <table className="w-full text-left">
            <thead className="border-b border-line bg-app text-sm text-muted">
              <tr><th className="p-3">Product</th><th className="p-3">Size / tag</th><th className="p-3">Barcode</th><th className="p-3 text-right">Price</th><th className="p-3 text-right">Stock</th><th className="p-3">Status</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-b-0">
                  <td className="p-3 font-medium">{canEdit ? <Link className="text-primary-strong underline" href={`/products/${r.id}`}>{r.name}</Link> : r.name}</td>
                  <td className="p-3">{r.detail}</td>
                  <td className="p-3 font-mono text-sm">{r.barcode || "—"}</td>
                  <td className="p-3 text-right">{formatINR(r.pricePaise)}</td>
                  <td className="p-3 text-right">{r.stock === null ? (r.kind === "JEWELLERY" ? "1 piece" : "—") : r.stock}</td>
                  <td className="p-3"><span className={r.status === "In stock" ? "text-success" : "text-muted"}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
