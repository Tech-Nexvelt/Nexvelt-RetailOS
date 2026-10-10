"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import {
  inviteCashierAction,
  saveBusinessAction,
  setSalesAccessAction,
  setTaxModeAction,
  type SettingsState,
} from "@/server/app/settings-actions";

type Act = (prev: SettingsState, form: FormData) => Promise<SettingsState>;

function Result({ state }: { state: SettingsState }) {
  return <div aria-live="polite">{state.message ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}</div>;
}

export function BusinessForm({ tradeName, legalName, gstin }: { tradeName: string; legalName: string; gstin: string }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveBusinessAction as Act, {});
  return (
    <form action={action} className="flex max-w-xl flex-col gap-3">
      <Field label="Shop name (printed on receipts)" htmlFor="tradeName"><Input id="tradeName" name="tradeName" defaultValue={tradeName} required disabled={pending} /></Field>
      <Field label="Legal name" htmlFor="legalName"><Input id="legalName" name="legalName" defaultValue={legalName} required disabled={pending} /></Field>
      <Field label="GSTIN (optional)" htmlFor="gstin" hint="Leave blank until NR Collections has confirmed it. It is printed on receipts only if you enter it.">
        <Input id="gstin" name="gstin" defaultValue={gstin} maxLength={15} disabled={pending} />
      </Field>
      <Result state={state} />
      <Button type="submit" variant="primary" className="self-start" disabled={pending}>{pending ? "Saving…" : "Save details"}</Button>
    </form>
  );
}

export function TaxModeForm({ enforced }: { enforced: boolean | null }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(setTaxModeAction as Act, {});
  const [mode, setMode] = useState<"none" | "blocked">(enforced === false ? "none" : "blocked");
  return (
    <form action={action} className="flex max-w-xl flex-col gap-3">
      <Banner tone="warning" title="Tax has not been set up.">
        The tax rates and invoice rules for NR Collections have not been confirmed, so this software does not guess them.
        Until they are, you can bill <strong>without tax</strong>. Those bills say &ldquo;not a GST tax invoice&rdquo;. Do not use them as one.
      </Banner>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Tax mode</legend>
        <label className="flex items-start gap-2 rounded-ctl border border-line bg-surface p-3">
          <input type="radio" name="mode" value="blocked" checked={mode === "blocked"} onChange={() => setMode("blocked")} className="mt-1" />
          <span><strong>Block billing until tax is set up</strong><br /><span className="text-sm text-muted">Safest. Nobody can complete a bill.</span></span>
        </label>
        <label className="flex items-start gap-2 rounded-ctl border border-line bg-surface p-3">
          <input type="radio" name="mode" value="none" checked={mode === "none"} onChange={() => setMode("none")} className="mt-1" />
          <span><strong>Bill without tax for now</strong><br /><span className="text-sm text-muted">Bills carry no tax and are marked as not a GST tax invoice.</span></span>
        </label>
      </fieldset>
      {mode === "none" ? (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="understand" className="mt-1" />
          <span>I understand these bills are not GST tax invoices and the tax setup still needs to be confirmed.</span>
        </label>
      ) : null}
      <Result state={state} />
      <Button type="submit" variant="primary" className="self-start" disabled={pending}>{pending ? "Saving…" : "Save tax mode"}</Button>
      <p className="text-sm text-muted">Current: {enforced === null ? "unknown" : enforced ? "billing is blocked until tax is set up" : "billing without tax"}.</p>
    </form>
  );
}

export function InviteForm() {
  const [state, action, pending] = useActionState<SettingsState, FormData>(inviteCashierAction as Act, {});
  return (
    <form action={action} className="grid max-w-xl gap-3 sm:grid-cols-2">
      <Field label="Name" htmlFor="fullName"><Input id="fullName" name="fullName" required disabled={pending} /></Field>
      <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="off" required disabled={pending} /></Field>
      <div className="sm:col-span-2"><Result state={state} /></div>
      <Button type="submit" variant="primary" className="self-start" disabled={pending}>{pending ? "Sending…" : "Invite cashier"}</Button>
      <p className="text-sm text-muted sm:col-span-2">They get an email to choose a password. A cashier can bill; they cannot change prices, stock, settings or people.</p>
    </form>
  );
}

export function SalesAccessToggle({ userId, enabled }: { userId: string; enabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} disabled={pending}
          onChange={(e) => start(async () => {
            const r = await setSalesAccessAction(userId, e.target.checked);
            setError(r.ok ? null : (r.message ?? "Could not save."));
            router.refresh();
          })} />
        Can see today&apos;s bills
      </label>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
