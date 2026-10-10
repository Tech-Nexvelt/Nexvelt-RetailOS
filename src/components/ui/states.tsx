import * as React from "react";
import { Lock, PackageOpen, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-ctl bg-line", className)} />;
}

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="text-muted">{icon ?? <PackageOpen aria-hidden size={32} />}</span>
      <p className="text-lg font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
}: {
  title?: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-lg font-semibold text-danger">{title}</p>
      <p className="max-w-sm text-muted">{description}</p>
      {onRetry ? (
        <Button onClick={onRetry} className="mt-2">
          <RefreshCw aria-hidden size={16} /> Try again
        </Button>
      ) : null}
    </div>
  );
}

export function PermissionDenied({ what }: { what: string }) {
  return (
    <EmptyState
      icon={<Lock aria-hidden size={32} />}
      title="Your role can't open this"
      description={`${what} is available to managers and owners. Ask the shop owner if you need access.`}
    />
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-app px-1.5 py-0.5 font-mono text-xs text-ink">
      {children}
    </kbd>
  );
}
