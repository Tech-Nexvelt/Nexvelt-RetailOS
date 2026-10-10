import { redirect } from "next/navigation";
import { landingFor } from "@/domain/navigation";
import { appMode, getAppSession } from "@/server/app/session";

/** Everyone lands where their role belongs: the owner on the dashboard, a cashier straight on Billing. */
export default async function Home() {
  if (appMode() === "demo_forbidden") redirect("/login?error=demo");
  if (appMode() === "unconfigured") redirect("/login?error=config");
  const s = await getAppSession();
  if (!s) redirect("/login");
  redirect(landingFor(s.permissions));
}
