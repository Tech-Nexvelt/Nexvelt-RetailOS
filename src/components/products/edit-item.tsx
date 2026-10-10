"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ADJUST_REASONS, type CatalogRow } from "@/domain/catalog";
import { formatINR, parseRupees } from "@/domain/money";
import { adjustStockAction, updateItemAction } from "@/server/app/catalog-actions";

export function EditItem({ row, canPrice, canEdit, canAdjust }: { row: CatalogRow; canPrice: boolean; canEdit: boolean; canAdjust: boolean }) {
  const router = useRouter();
  const [price, setPrice] = useState((row.pricePaise / 100).toFixed(2));
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState<string>("COUNT_CORRECTION");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const key = useRef(crypto.randomUUID());

  const run = async (work: () => Promise<{ ok: boolean; message?: string }>) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await work();
      setMsg({ tone: r.ok ? "success" : "error", text: r.message ?? (r.ok ? "Saved." : "Could not save.") });
      if (r.ok) router.refresh();
    } catch {
      setMsg({ tone: "error", text: "No connection to the server. Nothing was saved. Try again." });
    } finally {
      setBusy(false);
    }
  };

  const savePrice = () => {
    const p = parseRupees(price);
    if (p === null) return setMsg({ tone: "error", text: "Enter the price as a rupee amount, for example 1299 or 49.50." });
    return run(() => updateItemAction({ kind: row.kind, id: row.id, pricePaise: p }));
  };
  const toggle = () => run(() => updateItemAction({ kind: row.kind, id: row.id, isActive: !row.active }));
  const adjust = () => {
    const d = Number(delta);
    if (!Number.isInteger(d) || d === 0) return setMsg({ tone: "error", text: "Enter how many to add (for example 5) or remove (for example -2)." });
    return run(async () => {
      const r = await adjustStockAction({ idempotencyKey: key.current, variantId: row.id, delta: d, reason, note: note.trim() || undefined });
      if (r.ok) { key.current = crypto.randomUUID(); setDelta(""); setNote(""); }
      return r;
    });
  };

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <div className="rounded-ctl border border-line bg-surface p-4">
        <p className="text-lg font-semibold">{row.name}</p>
        <p className="text-muted">{row.detail} · barcode <span className="font-mono">{row.barcode || "—"}</span></p>
        <p className="mt-1">Selling price {formatINR(row.pricePaise)} · {row.status}{row.stock !== null ? ` · ${row.stock} in stock` : ""}</p>
      </div>
      <div aria-live="polite">{msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}</div>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Price</h2>
        {canPrice ? (
          <div className="flex gap-2">
            <Field label="Selling price ₹" htmlFor="price"><Input id="price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} disabled={busy} /></Field>
            <Button className="self-end" variant="primary" onClick={savePrice} disabled={busy}>Save price</Button>
          </div>
        ) : (
          <p className="text-sm text-muted">Only the owner can change prices.</p>
        )}
      </section>

      {canEdit ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">Availability</h2>
          <p className="text-sm text-muted">{row.active ? "Switch off to stop selling it. Past bills are not affected." : "This item is switched off and cannot be sold."}</p>
          <Button className="self-start" onClick={toggle} disabled={busy}>{row.active ? "Switch off" : "Switch on"}</Button>
        </section>
      ) : null}

      {canAdjust && row.kind === "VARIANT" ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">Adjust stock</h2>
          <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
            <Field label="Add / remove" htmlFor="delta" hint="e.g. 5 or -2"><Input id="delta" inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} disabled={busy} /></Field>
            <div className="flex flex-col gap-1">
              <label htmlFor="reason" className="text-sm font-medium">Reason</label>
              <select id="reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} className="min-h-11 rounded-ctl border border-line bg-surface px-3">
                {ADJUST_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <Field label="Note (optional)" htmlFor="note"><Input id="note" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} /></Field>
          <Button className="self-start" variant="primary" onClick={adjust} disabled={busy}>Update stock</Button>
        </section>
      ) : null}
    </div>
  );
}
