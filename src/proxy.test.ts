// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ claims: null as { sub: string } | null }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getClaims: async () => ({ data: h.claims ? { claims: h.claims } : null }) },
  }),
}));

import { proxy } from "./proxy";

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnopqrstuvwxyz",
  NEXT_PUBLIC_SITE_URL: "https://app.example",
};
const req = (path: string) => new NextRequest(new URL(path, "https://app.example"));
const location = (r: Response) =>
  r.headers.get("location")
    ? new URL(r.headers.get("location") as string).pathname +
      new URL(r.headers.get("location") as string).search
    : null;

beforeEach(() => {
  vi.unstubAllEnvs();
  h.claims = null;
});
afterEach(() => vi.unstubAllEnvs());

describe("proxy (optimistic gate and session refresh)", () => {
  it("sends a signed-out visitor to the login page and remembers where they were going", async () => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    const r = await proxy(req("/reports"));
    expect(location(r)).toBe("/login?next=%2Freports");
  });

  it("lets signed-out visitors reach only the public pages", async () => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    for (const path of ["/login", "/forgot-password", "/auth/confirm", "/auth/set-password"]) {
      expect((await proxy(req(path))).headers.get("location"), path).toBeNull();
    }
    for (const path of [
      "/billing",
      "/dashboard",
      "/settings",
      "/api/anything",
      "/loginx",
      "/auth/other",
    ]) {
      expect((await proxy(req(path))).headers.get("location"), path).toContain("/login");
    }
  });

  it("lets a signed-in visitor through", async () => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    h.claims = { sub: "u1" };
    expect((await proxy(req("/billing"))).headers.get("location")).toBeNull();
  });

  it("fails closed when Supabase is not configured and the demo is not switched on", async () => {
    const r = await proxy(req("/billing"));
    expect(location(r)).toBe("/login?error=config");
    expect((await proxy(req("/login"))).headers.get("location")).toBeNull();
  });

  it("only the explicit demo switch bypasses sign-in", async () => {
    vi.stubEnv("BILLING_BACKEND", "demo");
    expect((await proxy(req("/billing"))).headers.get("location")).toBeNull();
    vi.stubEnv("BILLING_BACKEND", "DEMO");
    expect((await proxy(req("/billing"))).headers.get("location")).toContain("/login");
  });

  it("DEMO IS REFUSED IN PRODUCTION: every request gets 503 with no sign-in bypass, no redirect and no data", async () => {
    vi.stubEnv("BILLING_BACKEND", "demo");
    vi.stubEnv("NODE_ENV", "production");
    for (const path of ["/billing", "/dashboard", "/login", "/products/new", "/sales/abc", "/anything"]) {
      const r = await proxy(req(path));
      expect(r.status, path).toBe(503);
      expect(r.headers.get("location"), path).toBeNull();
      expect(r.headers.get("cache-control")).toBe("no-store");
      const body = await r.text();
      expect(body).toMatch(/Demo mode is disabled/);
      expect(body).not.toMatch(/key|secret|token|password/i);
    }
  });

  it("demo is also refused on a Vercel production deployment even if NODE_ENV looks like development", async () => {
    vi.stubEnv("BILLING_BACKEND", "demo");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await proxy(req("/billing"))).status).toBe(503);
  });

  it("demo still works in development", async () => {
    vi.stubEnv("BILLING_BACKEND", "demo");
    vi.stubEnv("NODE_ENV", "development");
    const r = await proxy(req("/billing"));
    expect(r.status).toBe(200);
    expect(r.headers.get("location")).toBeNull();
  });

  it("real sign-in is unaffected in production when the backend is supabase", async () => {
    vi.stubEnv("BILLING_BACKEND", "supabase");
    vi.stubEnv("NODE_ENV", "production");
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    expect(location(await proxy(req("/billing")))).toBe("/login?next=%2Fbilling");
  });
});
