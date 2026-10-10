import Link from "next/link";
import { redirect } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { ProductNew } from "@/components/products/product-new";
import { requireSession } from "@/server/app/session";

export const metadata = { title: "New product" };

export default async function NewProductPage() {
  const s = await requireSession("/products");
  if (!s.permissions.has("product.create")) redirect("/products");
  return (
    <div className="flex flex-col gap-4">
      <Link href="/products" className="text-sm text-primary-strong underline">← All products</Link>
      <h1 className="text-2xl font-bold tracking-tight">New product</h1>
      {s.mode === "demo" ? (
        <Banner tone="warning" title="Demo mode">Saving products needs the real database. The form is shown for review; saving will explain this.</Banner>
      ) : null}
      <ProductNew />
    </div>
  );
}
