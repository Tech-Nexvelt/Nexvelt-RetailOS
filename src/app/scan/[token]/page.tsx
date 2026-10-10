import { redirect } from "next/navigation";
import { PhoneScanner } from "@/components/scanner/phone-scanner";
import { getAppSession } from "@/server/app/session";
import { inspectPairingAction } from "@/server/scanner/actions";

export const metadata = { title: "Phone scanner", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Opened by scanning the QR on the billing computer. The user must be signed in (the proxy already sends signed-out visitors to
 * /login and brings them back here). The token is checked against THIS user's tenant, branch and permission before anything is shown.
 */
export default async function ScanPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await getAppSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/scan/${token}`)}`);
  const check = await inspectPairingAction(token);
  return <PhoneScanner token={token} sid={check.ok ? check.sid : null} problem={check.ok ? null : check.code} who={session.email ?? "your account"} business={session.tenantName} />;
}
