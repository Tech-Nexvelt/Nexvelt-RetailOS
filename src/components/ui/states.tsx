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
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center bg-white rounded-2xl border border-slate-200 shadow-2xs">
      <div className="w-16 h-16 rounded-2xl bg-teal-50 text-[#00bba7] flex items-center justify-center border border-teal-100">
        {icon ?? <PackageOpen aria-hidden size={32} />}
      </div>
      <p className="text-base font-bold text-slate-900">{title}</p>
      {description ? <p className="max-w-sm text-xs text-slate-500">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
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
    <div role="alert" className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center bg-white rounded-2xl border border-slate-200 shadow-2xs">
      <div className="w-16 h-16 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center border border-red-100">
        <RefreshCw aria-hidden size={28} />
      </div>
      <p className="text-base font-bold text-slate-900">{title}</p>
      <p className="max-w-sm text-xs text-slate-500">{description}</p>
      {onRetry ? (
        <Button onClick={onRetry} className="mt-1 bg-[#00bba7] hover:bg-[#009688] text-white font-bold rounded-xl text-xs px-4 py-2">
          <RefreshCw aria-hidden size={14} /> Try again
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
