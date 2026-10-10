import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EditItem } from "@/components/products/edit-item";
import { getCatalogRow } from "@/server/app/catalog";
import { requireSession } from "@/server/app/session";

export const metadata = { title: "Edit product" };
export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession("/products");
  const can = (p: string) => s.permissions.has(p);
  if (!can("product.edit") && !can("product.price_edit") && !can("inventory.adjust")) redirect("/products");
  const row = await getCatalogRow(s, id);
  if (!row) notFound();
  return (
    <div className="flex flex-col gap-4">
      <Link href="/products" className="text-sm text-primary-strong underline">← All products</Link>
      <h1 className="text-2xl font-bold tracking-tight">Edit product</h1>
      <EditItem row={row} canPrice={can("product.price_edit")} canEdit={can("product.edit")} canAdjust={can("inventory.adjust")} />
    </div>
  );
}
