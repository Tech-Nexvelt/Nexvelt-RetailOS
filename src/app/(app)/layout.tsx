import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { appMode, getAppSession } from "@/server/app/session";

// Every page in this group is for signed-in people only, and nothing renders before the check.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (appMode() === "demo_forbidden") redirect("/login?error=demo");
  if (appMode() === "unconfigured") redirect("/login?error=config");
  const session = await getAppSession();
  if (!session) redirect("/login");
  return <AppShell session={session}>{children}</AppShell>;
}
