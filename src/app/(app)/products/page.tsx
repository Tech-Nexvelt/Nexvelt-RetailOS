import Link from "next/link";
import { Plus, Package } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/states";
import { isLowStock, isOutOfStock, parseCatalogQuery, queryCatalog, type CatalogQuery } from "@/domain/catalog";
import { formatINR } from "@/domain/money";
import { requireSession } from "@/server/app/session";
import { listCatalog } from "@/server/app/catalog";
import { ProductThumb } from "@/components/products/product-thumb";
import { signedUrls, type ImageClient } from "@/server/app/images";

export const metadata = { title: "Products & Stock" };
export const dynamic = "force-dynamic";

type Params = { q?: string; status?: string; kind?: string; sort?: string; dir?: string; page?: string };

/** A link that keeps every current filter and changes only what is given. */
function href(q: string, query: CatalogQuery, over: Partial<CatalogQuery>) {
  const n = { ...query, ...over };
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (n.status !== "all") p.set("status", n.status);
  if (n.kind !== "all") p.set("kind", n.kind);
  if (n.sort !== "name" || n.dir !== "asc") {
    p.set("sort", n.sort);
    p.set("dir", n.dir);
  }
  if (n.page > 1) p.set("page", String(n.page));
  const s = p.toString();
  return s ? `/products?${s}` : "/products";
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const s = await requireSession("/products");
  const params = await searchParams;
  const q = (params.q ?? "").slice(0, 60);
  const query = parseCatalogQuery(params);
  let all;
  try {
    all = await listCatalog(s, q);
  } catch {
    return (
      <Banner tone="error" title="Products could not be loaded.">
        Check the internet connection and refresh the page.
      </Banner>
    );
  }
  const { rows, total, page, pages } = queryCatalog(all, query);
  const lowCount = all.filter(isLowStock).length;
  // one batch of short-lived signed URLs for the photos on THIS page only (placeholders when there is no photo or no database)
  const photos = s.client ? await signedUrls(s.client as unknown as ImageClient, s.tenantId, rows.map((r) => r.imagePath)) : new Map<string, string>();
  const canCreate = s.permissions.has("product.create");
  const canEdit = s.permissions.has("product.edit") || s.permissions.has("product.price_edit") || s.permissions.has("inventory.adjust");
  const filtered = query.status !== "all" || query.kind !== "all" || q !== "";
  const sortLink = (key: CatalogQuery["sort"], label: string) => (
    <Link href={href(q, query, { sort: key, dir: query.sort === key && query.dir === "asc" ? "desc" : "asc", page: 1 })} aria-label={`Sort by ${label}`} className="underline-offset-2 hover:underline">
      {label}
      {query.sort === key ? (query.dir === "asc" ? " ↑" : " ↓") : ""}
    </Link>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Products &amp; Stock</h1>
          <p className="text-muted">
            {s.branchName} · {all.length} item{all.length === 1 ? "" : "s"}
            {lowCount > 0 ? <span className="ml-2 font-medium text-warning">{lowCount} low on stock</span> : null}
          </p>
        </div>
        {canCreate ? (
          <Link href="/products/new" className="inline-flex min-h-12 items-center gap-2 rounded-ctl bg-primary px-5 text-lg font-semibold hover:bg-primary-strong">
            <Plus aria-hidden size={18} /> New product
          </Link>
        ) : null}
      </div>

      <form method="get" role="search" className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-56 flex-1 flex-col text-sm">
          Search
          <input name="q" defaultValue={q} placeholder="Name, size, tag or barcode" className="min-h-11 rounded-ctl border border-line bg-surface px-3" />
        </label>
        <label className="flex flex-col text-sm">
          Show
          <select name="status" defaultValue={query.status} className="min-h-11 rounded-ctl border border-line bg-surface px-3">
            <option value="all">Everything</option>
            <option value="in_stock">In stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
            <option value="off">Switched off</option>
          </select>
        </label>
        <label className="flex flex-col text-sm">
          Type
          <select name="kind" defaultValue={query.kind} className="min-h-11 rounded-ctl border border-line bg-surface px-3">
            <option value="all">Clothing and jewellery</option>
            <option value="clothing">Clothing</option>
            <option value="jewellery">Jewellery</option>
          </select>
        </label>
        <input type="hidden" name="sort" value={query.sort} />
        <input type="hidden" name="dir" value={query.dir} />
        <button type="submit" className="min-h-11 rounded-ctl bg-primary px-4 font-semibold hover:bg-primary-strong">Apply</button>
        {filtered ? (
          <Link href="/products" className="min-h-11 content-center text-sm text-primary-strong underline">
            Clear
          </Link>
        ) : null}
      </form>

      {total === 0 ? (
        <EmptyState
          icon={<Package aria-hidden size={32} />}
          title={filtered ? "No product matches" : "No products yet"}
          description={filtered ? "Try a shorter word or clear the filters." : canCreate ? "Add your first product. Choose clothing or jewellery on the next screen." : "The owner has not added products yet."}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-ctl border border-line bg-surface">
            <table className="w-full text-left">
              <thead className="border-b border-line bg-app text-sm text-muted">
                <tr>
                  <th className="w-16 p-3"><span className="sr-only">Photo</span></th>
                  <th className="p-3">{sortLink("name", "Product")}</th>
                  <th className="p-3">Size / tag</th>
                  <th className="p-3">Barcode</th>
                  <th className="p-3 text-right">{sortLink("price", "Price")}</th>
                  <th className="p-3 text-right">{sortLink("stock", "Stock")}</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const low = isLowStock(r);
                  const out = isOutOfStock(r);
                  return (
                    <tr key={r.id} className="border-b border-line last:border-b-0">
                      <td className="p-3"><ProductThumb url={r.imagePath ? (photos.get(r.imagePath) ?? null) : null} name={r.name} size={44} /></td>
                      <td className="p-3 font-medium">{canEdit ? <Link className="text-primary-strong underline" href={`/products/${r.id}`}>{r.name}</Link> : r.name}</td>
                      <td className="p-3">{r.detail}</td>
                      <td className="p-3 font-mono text-sm">{r.barcode || "—"}</td>
                      <td className="p-3 text-right">
                        {formatINR(r.pricePaise)}
                        {r.mrpPaise !== null && r.mrpPaise > r.pricePaise ? <span className="block text-xs text-muted line-through">MRP {formatINR(r.mrpPaise)}</span> : null}
                      </td>
                      <td className="p-3 text-right">
                        {r.stock === null ? (r.kind === "JEWELLERY" ? "1 piece" : "—") : r.stock}
                        {low ? <span className="block text-xs font-medium text-warning">Low (alert at {r.reorderLevel})</span> : null}
                      </td>
                      <td className="p-3">
                        <span className={r.status === "In stock" && !low ? "text-success" : low ? "text-warning" : out ? "text-danger" : "text-muted"}>{low ? "Low stock" : r.status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="text-muted">
              Showing {(page - 1) * query.pageSize + 1}–{Math.min(page * query.pageSize, total)} of {total}
            </p>
            <div className="flex items-center gap-2">
              {page > 1 ? <Link className="min-h-10 rounded-ctl border border-line bg-surface px-3 py-2" href={href(q, query, { page: page - 1 })}>← Previous</Link> : <span className="px-3 py-2 text-muted">← Previous</span>}
              <span>
                Page {page} of {pages}
              </span>
              {page < pages ? <Link className="min-h-10 rounded-ctl border border-line bg-surface px-3 py-2" href={href(q, query, { page: page + 1 })}>Next →</Link> : <span className="px-3 py-2 text-muted">Next →</span>}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
