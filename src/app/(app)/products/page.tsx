import Link from "next/link";
import { Plus, Package, Search } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/states";
import { isLowStock, isOutOfStock, parseCatalogQuery, queryCatalog, type CatalogQuery } from "@/domain/catalog";
import { formatINR } from "@/domain/money";
import { requireSession } from "@/server/app/session";
import { listCatalog } from "@/server/app/catalog";
import { ProductImage } from "@/components/ui/product-image";
import { signedUrls, type ImageClient } from "@/server/app/images";

export const metadata = { title: "Products & Stock" };
export const dynamic = "force-dynamic";

type Params = { q?: string; status?: string; kind?: string; sort?: string; dir?: string; page?: string };

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
  const photos = s.client ? await signedUrls(s.client as unknown as ImageClient, s.tenantId, rows.map((r) => r.imagePath)) : new Map<string, string>();
  const canCreate = s.permissions.has("product.create");
  const canEdit = s.permissions.has("product.edit") || s.permissions.has("product.price_edit") || s.permissions.has("inventory.adjust");
  const filtered = query.status !== "all" || query.kind !== "all" || q !== "";
  
  const sortLink = (key: CatalogQuery["sort"], label: string) => (
    <Link href={href(q, query, { sort: key, dir: query.sort === key && query.dir === "asc" ? "desc" : "asc", page: 1 })} aria-label={`Sort by ${label}`} className="font-semibold text-slate-700 hover:text-slate-900">
      {label}
      {query.sort === key ? (query.dir === "asc" ? " ↑" : " ↓") : ""}
    </Link>
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Products &amp; Stock</h1>
          <p className="text-xs text-slate-500">
            {s.branchName} · {all.length} item{all.length === 1 ? "" : "s"}
            {lowCount > 0 ? <span className="ml-2 font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">{lowCount} low stock</span> : null}
          </p>
        </div>
        {canCreate ? (
          <Link href="/products/new" className="inline-flex items-center gap-1.5 rounded-xl bg-[#00bba7] hover:bg-[#009688] px-4 py-2.5 text-xs font-bold text-white shadow-xs transition-colors">
            <Plus aria-hidden size={16} />
            <span>Add Product</span>
          </Link>
        ) : null}
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: "all", label: "All" },
            { id: "clothing", label: "Clothing" },
            { id: "jewellery", label: "Jewellery" },
          ].map((kind) => {
            const active = query.kind === kind.id;
            return (
              <Link
                key={kind.id}
                href={href(q, query, { kind: kind.id as CatalogQuery["kind"], page: 1 })}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  active ? "bg-teal-50 text-[#00bba7] border border-teal-200 shadow-2xs" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {kind.label}
              </Link>
            );
          })}
        </div>

        <form method="get" role="search" className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-56">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Search products by name, barcode or tag..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#00bba7]"
            />
          </div>
          <select name="status" defaultValue={query.status} className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none">
            <option value="all">All Status</option>
            <option value="in_stock">In Stock</option>
            <option value="low">Low Stock</option>
            <option value="out">Out of Stock</option>
          </select>
          <button type="submit" className="bg-[#00bba7] hover:bg-[#009688] text-white px-4 py-2 rounded-xl text-xs font-bold transition-colors">
            Search
          </button>
          {filtered ? (
            <Link href="/products" className="text-xs text-teal-600 font-semibold hover:underline px-2">
              Clear
            </Link>
          ) : null}
        </form>
      </div>

      {/* Table & Empty State */}
      {total === 0 ? (
        <EmptyState
          icon={<Package aria-hidden size={32} />}
          title={filtered ? "No product matches" : "No products yet"}
          description={filtered ? "Try searching another term or clear the filters." : canCreate ? "Add your first product to start billing." : "No products added yet."}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-2xs">
            <table className="w-full text-left border-collapse">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs font-bold text-slate-500">
                <tr>
                  <th className="w-14 p-3.5"><span className="sr-only">Image</span></th>
                  <th className="p-3.5">{sortLink("name", "Name")}</th>
                  <th className="p-3.5">Category</th>
                  <th className="p-3.5">SKU / Barcode</th>
                  <th className="p-3.5 text-right">{sortLink("price", "Price")}</th>
                  <th className="p-3.5 text-right">{sortLink("stock", "Stock")}</th>
                  <th className="p-3.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-700">
                {rows.map((r) => {
                  const low = isLowStock(r);
                  const out = isOutOfStock(r);
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3.5">
                        <ProductImage name={r.name} size={40} className="w-10 h-10 rounded-xl" />
                      </td>
                      <td className="p-3.5 font-bold text-slate-900">
                        {canEdit ? <Link className="hover:text-[#00bba7] transition-colors" href={`/products/${r.id}`}>{r.name}</Link> : r.name}
                        {r.detail ? <span className="block text-[11px] font-normal text-slate-400">{r.detail}</span> : null}
                      </td>
                      <td className="p-3.5 text-slate-500 capitalize">{r.kind.toLowerCase()}</td>
                      <td className="p-3.5 font-mono text-slate-500">{r.barcode || "—"}</td>
                      <td className="p-3.5 text-right font-bold text-slate-900">
                        {formatINR(r.pricePaise)}
                      </td>
                      <td className="p-3.5 text-right font-semibold">
                        {r.stock === null ? "1 pc" : `${r.stock} in stock`}
                      </td>
                      <td className="p-3.5">
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                          out ? "bg-red-50 text-red-600 border-red-200" : low ? "bg-amber-50 text-amber-600 border-amber-200" : "bg-emerald-50 text-emerald-600 border-emerald-200"
                        }`}>
                          {out ? "Out of stock" : low ? "Low stock" : "Active"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-500">
            <p>
              Showing {(page - 1) * query.pageSize + 1}–{Math.min(page * query.pageSize, total)} of {total}
            </p>
            <div className="flex items-center gap-2">
              {page > 1 ? <Link className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50" href={href(q, query, { page: page - 1 })}>← Previous</Link> : <span className="px-3 py-1.5 text-slate-300">← Previous</span>}
              <span>Page {page} of {pages}</span>
              {page < pages ? <Link className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50" href={href(q, query, { page: page + 1 })}>Next →</Link> : <span className="px-3 py-1.5 text-slate-300">Next →</span>}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}

