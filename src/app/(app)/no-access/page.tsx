import { EmptyState } from "@/components/ui/states";
import { Lock } from "lucide-react";

export const metadata = { title: "No access" };

export default function NoAccess() {
  return (
    <EmptyState
      icon={<Lock aria-hidden size={32} />}
      title="You don't have access to anything yet"
      description="Your account is signed in but has no role in this shop. Ask the owner to give you access, then sign in again."
    />
  );
}
