"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * A product photo, or a consistent placeholder when there is none or it cannot be loaded. Never shows a broken-image icon.
 * Fixed dimensions (no layout shift), lazy loading, and the URL changes whenever the photo changes, so no stale cache.
 */
export function ProductThumb({ url, name, size = 48, className }: { url: string | null; name: string; size?: number; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const style = { width: size, height: size };
  if (!url || failedUrl === url) {
    return (
      <div role="img" aria-label={`No photo for ${name}`} style={style} className={cn("grid shrink-0 place-items-center rounded-ctl border border-line bg-app text-muted", className)}>
        <ImageOff aria-hidden size={Math.max(16, Math.round(size / 2.5))} />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed storage URLs: the optimiser would cache by an expiring URL
  return <img src={url} alt={name} width={size} height={size} style={style} loading="lazy" decoding="async" onError={() => setFailedUrl(url)} className={cn("shrink-0 rounded-ctl border border-line object-cover", className)} />;
}
