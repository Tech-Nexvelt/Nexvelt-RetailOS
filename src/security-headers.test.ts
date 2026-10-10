import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("security headers (next.config.ts)", () => {
  it("sets the baseline headers on every path and does not advertise the framework", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*");
    expect(all).toBeTruthy();
    const h = Object.fromEntries(all!.headers.map((x) => [x.key, x.value]));
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toMatch(/microphone=\(\)/);
    expect(h["Strict-Transport-Security"]).toMatch(/^max-age=\d{7,}$/);
    // includeSubDomains / preload are deliberately not set: they affect other hosts and are hard to undo
    expect(h["Strict-Transport-Security"]).not.toMatch(/includeSubDomains|preload/i);
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
