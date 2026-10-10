import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The app shares a Supabase project with Tirumala Furniture. Every request must carry the RetailOS
 * schema profile, otherwise PostgREST would answer from Tirumala's `public` schema. No network is used.
 */
vi.mock("server-only", () => ({}));

const captured: { url: string; method: string; headers: Record<string, string> }[] = [];

function stubEnvAndFetch() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example-project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "legacy-anon-key-for-tests-abcdefghijklmnop");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "legacy-service-role-for-tests-abcdefghijklmnop");
  captured.length = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k.toLowerCase()] = v));
    captured.push({ url: String(input), method: init?.method ?? "GET", headers });
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  });
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Supabase clients target the retailos schema", () => {
  it("browser client: reads send Accept-Profile and writes/RPC send Content-Profile = retailos", async () => {
    stubEnvAndFetch();
    const { createBrowserSupabaseClient } = await import("./client");
    const c = createBrowserSupabaseClient();
    expect(c).not.toBeNull();
    await c!.from("tenants").select("id");
    await c!.rpc("pos_checkout", { p_branch: "00000000-0000-0000-0000-000000000000" });
    const rest = captured.filter((r) => r.url.includes("/rest/v1/"));
    expect(rest).toHaveLength(2);
    expect(rest[0]!.headers["accept-profile"]).toBe("retailos");
    expect(rest[1]!.headers["content-profile"]).toBe("retailos");
    for (const r of rest) {
      expect(r.headers["accept-profile"] ?? r.headers["content-profile"]).not.toBe("public");
    }
  });

  it("admin client (privileged key): defaults to retailos too, so it cannot read Tirumala's public tables by accident", async () => {
    stubEnvAndFetch();
    const { createAdminClient } = await import("./admin");
    const c = createAdminClient();
    expect(c).not.toBeNull();
    await c!.from("tenants").select("id");
    const rest = captured.filter((r) => r.url.includes("/rest/v1/"));
    expect(rest[0]!.headers["accept-profile"]).toBe("retailos");
  });
});
