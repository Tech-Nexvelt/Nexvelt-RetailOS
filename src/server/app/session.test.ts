// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }),
}));
class Redirect extends Error {
  constructor(public to: string) {
    super("redirect");
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
const createUserClient = vi.fn(async () => null);
vi.mock("@/lib/supabase/server", () => ({ createUserClient: () => createUserClient() }));

import { appMode, getAppSession, requireActionSession, requireSession } from "./session";

afterEach(() => vi.unstubAllEnvs());

describe("session modes: demo is a development-only identity", () => {
  it("development: demo works and has a fictitious session with no database client", async () => {
    vi.stubEnv("BILLING_BACKEND", "demo");
    vi.stubEnv("NODE_ENV", "development");
    expect(appMode()).toBe("demo");
    const s = await getAppSession();
    expect(s?.mode).toBe("demo");
    expect(s?.client).toBeNull();
  });

  it("production + demo: no session at all, pages redirect to the explanation, actions get nothing, no database client is made", async () => {
    vi.stubEnv("BILLING_BACKEND", "demo");
    vi.stubEnv("NODE_ENV", "production");
    expect(appMode()).toBe("demo_forbidden");
    expect(await getAppSession()).toBeNull();
    expect(await requireActionSession("sale.create")).toBeNull();
    await expect(requireSession("/billing")).rejects.toMatchObject({ to: "/login?error=demo" });
    expect(createUserClient).not.toHaveBeenCalled();
  });

  it("unconfigured stays unconfigured", async () => {
    vi.stubEnv("BILLING_BACKEND", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(appMode()).toBe("unconfigured");
    await expect(requireSession("/billing")).rejects.toMatchObject({ to: "/login?error=config" });
  });
});
