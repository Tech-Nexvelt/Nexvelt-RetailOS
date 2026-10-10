import * as React from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";

type Tone = "error" | "success" | "warning" | "info";

const tones: Record<Tone, { box: string; icon: React.ReactNode }> = {
  error: {
    box: "bg-danger-bg text-danger border-danger/30",
    icon: <AlertCircle aria-hidden size={20} />,
  },
  success: {
    box: "bg-success-bg text-success border-success/30",
    icon: <CheckCircle2 aria-hidden size={20} />,
  },
  warning: {
    box: "bg-warning-bg text-warning border-warning/30",
    icon: <TriangleAlert aria-hidden size={20} />,
  },
  info: { box: "bg-app text-ink border-line", icon: <Info aria-hidden size={20} /> },
};

interface BannerProps {
  tone: Tone;
  title?: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/** Inline status message. Icon + text, never colour alone. Errors are announced assertively. */
export function Banner({ tone, title, children, action, className }: BannerProps) {
  const t = tones[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-ctl border p-3", t.box, className)}
    >
      <span className="mt-0.5 shrink-0">{t.icon}</span>
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-sm">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
