import { BillingWorkspace } from "@/components/billing/billing-workspace";
import { getBusiness } from "@/server/app/business";
import { createPairingAction, verifyIncomingAction } from "@/server/scanner/actions";
import { requireSession } from "@/server/app/session";
import {
  addItem,
  completeCheckout,
  getSession,
  quoteCart,
  scanBarcode,
  searchItems,
  startDay,
} from "@/server/billing/actions";

export const metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  // Refuses (redirects) anyone who may not sell, before anything is rendered.
  const s = await requireSession("/billing");
  const business = await getBusiness(s);
  const canDiscount = s.permissions.has("discount.apply") || s.permissions.has("discount.override");
  return (
    <BillingWorkspace
      api={{ getSession, startDay, scanBarcode, searchItems, addItem, quoteCart, completeCheckout }}
      scanner={{ createPairing: createPairingAction, verifyIncoming: verifyIncomingAction }}
      business={business}
      canDiscount={canDiscount}
      demo={s.mode === "demo"}
    />
  );
}
