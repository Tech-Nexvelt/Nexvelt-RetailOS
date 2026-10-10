export function applyNext(
  client: import("pg").Client,
  opts: { root: string; target: string; approvedManifest: string; log?: (m: string) => void },
): Promise<{ ok: true; applied: string; objects: number } | { ok: false; reason: string }>;
