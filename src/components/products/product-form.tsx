"use client";

import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import type { CatalogResult, ProductKind } from "@/domain/catalog";
import { formatINR, parseRupees } from "@/domain/money";
import type { CreatedClothing, CreatedJewellery } from "@/server/app/catalog-actions";

export interface ProductFormApi {
  createClothing(input: unknown): Promise<CatalogResult<CreatedClothing>>;
  createJewellery(input: unknown): Promise<CatalogResult<CreatedJewellery>>;
}

interface VariantRow { id: number; size: string; colour: string; price: string; stock: string; barcode: string }
const blankVariant = (id: number): VariantRow => ({ id, size: "", colour: "", price: "", stock: "", barcode: "" });

const TYPES: { kind: ProductKind; label: string; hint: string }[] = [
  { kind: "CLOTHING", label: "Clothing", hint: "Sizes and colours, stock per variant" },
  { kind: "IMITATION", label: "Imitation jewellery", hint: "One tagged piece, fixed price" },
  { kind: "PRECIOUS", label: "Gold / silver jewellery", hint: "One tagged piece, fixed tag price" },
];

export function ProductForm({ api, newKey = () => crypto.randomUUID() }: { api: ProductFormApi; newKey?: () => string }) {
  const [kind, setKind] = useState<ProductKind>("CLOTHING");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [styleCode, setStyleCode] = useState("");
  const [rows, setRows] = useState<VariantRow[]>([blankVariant(1)]);
  const [tag, setTag] = useState("");
  const [barcode, setBarcode] = useState("");
  const [price, setPrice] = useState("");
  const [metal, setMetal] = useState("");
  const [purity, setPurity] = useState("");
  const [gross, setGross] = useState("");
  const [net, setNet] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [created, setCreated] = useState<{ label: string; barcode: string }[]>([]);
  const key = useRef(newKey());
  const seq = useRef(1);

  const reset = () => {
    key.current = newKey();
    setName(""); setCategory(""); setStyleCode(""); setRows([blankVariant((seq.current = 1))]);
    setTag(""); setBarcode(""); setPrice(""); setMetal(""); setPurity(""); setGross(""); setNet("");
    setErrors({}); setBanner(null);
  };

  const validate = (): { ok: true } | { ok: false } => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Enter the product name.";
    if (!category.trim()) e.category = "Enter a category, for example Shirts.";
    if (kind === "CLOTHING") {
      rows.forEach((r) => {
        if (parseRupees(r.price) === null) e[`price-${r.id}`] = "Enter the selling price in rupees.";
        if (r.stock.trim() !== "" && !/^\d{1,6}$/.test(r.stock.trim())) e[`stock-${r.id}`] = "Whole number, or leave blank.";
      });
      const seen = new Set<string>();
      rows.forEach((r) => {
        const k = `${r.size.trim().toLowerCase() || "free"}|${r.colour.trim().toLowerCase() || "default"}`;
        if (seen.has(k)) e[`size-${r.id}`] = "This size and colour is already in the list.";
        seen.add(k);
      });
    } else {
      if (parseRupees(price) === null) e.price = "Enter the fixed price in rupees.";
      if (kind === "PRECIOUS") {
        if (!metal.trim()) e.metal = "Enter the metal, for example Gold.";
        if (!purity.trim()) e.purity = "Enter the purity, for example 22K.";
        const g = Number(gross), n = Number(net);
        if (!(g > 0)) e.gross = "Enter the gross weight in grams.";
        if (!(n > 0)) e.net = "Enter the net weight in grams.";
        else if (g > 0 && n > g) e.net = "Net weight cannot be more than gross weight.";
      }
    }
    setErrors(e);
    return Object.keys(e).length ? { ok: false } : { ok: true };
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    setBanner(null);
    if (!validate().ok) return setBanner({ tone: "error", text: "Fix the highlighted fields and try again." });
    setBusy(true);
    try {
      if (kind === "CLOTHING") {
        const r = await api.createClothing({
          idempotencyKey: key.current, name: name.trim(), category: category.trim(), ...(styleCode.trim() ? { styleCode: styleCode.trim() } : {}),
          variants: rows.map((v) => ({
            ...(v.size.trim() ? { size: v.size.trim() } : {}), ...(v.colour.trim() ? { colour: v.colour.trim() } : {}),
            ...(v.barcode.trim() ? { barcode: v.barcode.trim() } : {}),
            pricePaise: parseRupees(v.price) as number, openingStock: v.stock.trim() ? Number(v.stock) : 0,
          })),
        });
        if (!r.ok) return setBanner({ tone: "error", text: r.message });
        setCreated(r.data.variants.map((v) => ({ label: `${name.trim()} · ${v.size} / ${v.colour}`, barcode: v.barcode })));
      } else {
        const r = await api.createJewellery({
          idempotencyKey: key.current, kind, name: name.trim(), category: category.trim(), pricePaise: parseRupees(price) as number,
          ...(tag.trim() ? { tagCode: tag.trim() } : {}), ...(barcode.trim() ? { barcode: barcode.trim() } : {}),
          ...(kind === "PRECIOUS" ? { metal: metal.trim(), purity: purity.trim(), grossWeightG: Number(gross), netWeightG: Number(net) } : {}),
        });
        if (!r.ok) return setBanner({ tone: "error", text: r.message });
        setCreated([{ label: `${name.trim()} · ${r.data.tagCode}`, barcode: r.data.barcode }]);
      }
      setBanner({ tone: "success", text: "Saved. The items below are ready to scan." });
      key.current = newKey();
      setName(""); setCategory(""); setStyleCode(""); setRows([blankVariant((seq.current = 1))]); setTag(""); setBarcode(""); setPrice("");
      setMetal(""); setPurity(""); setGross(""); setNet("");
    } catch {
      setBanner({ tone: "error", text: "No connection to the server. Nothing was saved. Try again." });
    } finally {
      setBusy(false);
    }
  };

  const setRow = (id: number, patch: Partial<VariantRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <form onSubmit={submit} className="flex max-w-3xl flex-col gap-5" noValidate>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">What are you adding?</legend>
        <div role="radiogroup" aria-label="Product type" className="grid gap-2 sm:grid-cols-3">
          {TYPES.map((t) => (
            <button key={t.kind} type="button" role="radio" aria-checked={kind === t.kind} disabled={busy}
              onClick={() => { setKind(t.kind); setErrors({}); }}
              className={`rounded-ctl border p-3 text-left ${kind === t.kind ? "border-primary-strong bg-primary/20" : "border-line bg-surface"}`}>
              <span className="block font-semibold">{t.label}</span>
              <span className="text-sm text-muted">{t.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Product name" htmlFor="name" error={errors.name}>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} disabled={busy} />
        </Field>
        <Field label="Category" htmlFor="category" error={errors.category} hint="For example Shirts, Necklaces, Gold chains">
          <Input id="category" value={category} onChange={(e) => setCategory(e.target.value)} aria-invalid={!!errors.category} disabled={busy} />
        </Field>
      </div>

      {kind === "CLOTHING" ? (
        <>
          <Field label="Style code (optional)" htmlFor="style" hint="Leave blank to use the product name">
            <Input id="style" value={styleCode} onChange={(e) => setStyleCode(e.target.value)} disabled={busy} />
          </Field>
          <div className="flex flex-col gap-3">
            <p className="font-semibold">Sizes and colours</p>
            {rows.map((r, i) => (
              <div key={r.id} className="grid gap-2 rounded-ctl border border-line bg-surface p-3 sm:grid-cols-[1fr_1fr_8rem_6rem]">
                <Field label={i === 0 ? "Size" : `Size (variant ${i + 1})`} htmlFor={`size-${r.id}`} error={errors[`size-${r.id}`]} hint="Blank = one size">
                  <Input id={`size-${r.id}`} value={r.size} onChange={(e) => setRow(r.id, { size: e.target.value })} disabled={busy} />
                </Field>
                <Field label="Colour" htmlFor={`colour-${r.id}`} hint="Blank = no colour">
                  <Input id={`colour-${r.id}`} value={r.colour} onChange={(e) => setRow(r.id, { colour: e.target.value })} disabled={busy} />
                </Field>
                <Field label="Price ₹" htmlFor={`price-${r.id}`} error={errors[`price-${r.id}`]}>
                  <Input id={`price-${r.id}`} inputMode="decimal" value={r.price} onChange={(e) => setRow(r.id, { price: e.target.value })} aria-invalid={!!errors[`price-${r.id}`]} disabled={busy} />
                </Field>
                <Field label="Stock" htmlFor={`stock-${r.id}`} error={errors[`stock-${r.id}`]}>
                  <Input id={`stock-${r.id}`} inputMode="numeric" value={r.stock} onChange={(e) => setRow(r.id, { stock: e.target.value })} disabled={busy} />
                </Field>
                <details className="sm:col-span-4 text-sm">
                  <summary className="cursor-pointer text-muted">Existing barcode (optional)</summary>
                  <Input aria-label={`Barcode for variant ${i + 1}`} className="mt-2 max-w-xs" placeholder="Leave blank to generate one" value={r.barcode} onChange={(e) => setRow(r.id, { barcode: e.target.value })} disabled={busy} />
                </details>
                {rows.length > 1 ? (
                  <Button type="button" variant="ghost" className="sm:col-span-4 justify-self-start" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} disabled={busy}>
                    <Trash2 aria-hidden size={16} /> Remove this variant
                  </Button>
                ) : null}
              </div>
            ))}
            <Button type="button" className="self-start" onClick={() => setRows((rs) => [...rs, blankVariant(++seq.current)])} disabled={busy || rows.length >= 100}>
              <Plus aria-hidden size={16} /> Add another size or colour
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Fixed price ₹" htmlFor="price" error={errors.price}>
              <Input id="price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-invalid={!!errors.price} disabled={busy} />
            </Field>
            <Field label="Tag code (optional)" htmlFor="tag" hint="Blank = we generate one">
              <Input id="tag" value={tag} onChange={(e) => setTag(e.target.value)} disabled={busy} />
            </Field>
            <Field label="Barcode (optional)" htmlFor="barcode" hint="Blank = same as the tag">
              <Input id="barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} disabled={busy} />
            </Field>
          </div>
          {kind === "PRECIOUS" ? (
            <div className="rounded-ctl border border-line bg-surface p-3">
              <p className="mb-2 font-semibold">Metal details</p>
              <p className="mb-3 text-sm text-muted">These are recorded for the stock register. The price is the fixed tag price above; no weight-based price is calculated.</p>
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label="Metal" htmlFor="metal" error={errors.metal}><Input id="metal" value={metal} onChange={(e) => setMetal(e.target.value)} disabled={busy} /></Field>
                <Field label="Purity" htmlFor="purity" error={errors.purity}><Input id="purity" value={purity} onChange={(e) => setPurity(e.target.value)} disabled={busy} /></Field>
                <Field label="Gross weight (g)" htmlFor="gross" error={errors.gross}><Input id="gross" inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} disabled={busy} /></Field>
                <Field label="Net weight (g)" htmlFor="net" error={errors.net}><Input id="net" inputMode="decimal" value={net} onChange={(e) => setNet(e.target.value)} disabled={busy} /></Field>
              </div>
            </div>
          ) : null}
        </>
      )}

      <div aria-live="polite">{banner ? <Banner tone={banner.tone}>{banner.text}</Banner> : null}</div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="lg" disabled={busy}>{busy ? "Saving…" : "Save product"}</Button>
        <Button type="button" size="lg" onClick={reset} disabled={busy}>Clear</Button>
      </div>

      {created.length > 0 ? (
        <section aria-label="Items just created" className="rounded-ctl border border-line bg-surface p-3">
          <p className="font-semibold">Ready to scan</p>
          <p className="text-sm text-muted">Write these barcodes on the tags, or keep the supplier&apos;s barcode if you entered one.</p>
          <table className="mt-2 w-full text-left text-sm">
            <tbody>
              {created.map((c) => (
                <tr key={c.barcode} className="border-t border-line"><td className="py-2">{c.label}</td><td className="py-2 font-mono font-semibold">{c.barcode}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </form>
  );
}

export { formatINR };
