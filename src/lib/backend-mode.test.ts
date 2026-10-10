import { describe, expect, it } from "vitest";
import { backendMode, DEMO_FORBIDDEN_MESSAGE } from "./backend-mode";

describe("backendMode: demo exists only in development and test processes", () => {
  it("allows demo in development and test", () => {
    expect(backendMode({ BILLING_BACKEND: "demo", NODE_ENV: "development" })).toBe("demo");
    expect(backendMode({ BILLING_BACKEND: "demo", NODE_ENV: "test" })).toBe("demo");
  });

  it("rejects demo in production, with an unknown or missing NODE_ENV, and on Vercel production", () => {
    for (const NODE_ENV of ["production", undefined, "", "staging", "PRODUCTION"]) {
      expect(backendMode({ BILLING_BACKEND: "demo", NODE_ENV }), String(NODE_ENV)).toBe("demo_forbidden");
    }
    expect(backendMode({ BILLING_BACKEND: "demo", NODE_ENV: "development", VERCEL_ENV: "production" })).toBe("demo_forbidden");
    expect(backendMode({ BILLING_BACKEND: "demo", NODE_ENV: "development", VERCEL_ENV: "preview" })).toBe("demo");
  });

  it("supabase mode is unaffected by the environment", () => {
    for (const NODE_ENV of ["production", "development", "test", undefined]) {
      expect(backendMode({ BILLING_BACKEND: "supabase", NODE_ENV })).toBe("supabase");
    }
  });

  it("anything else is unconfigured, including look-alike values", () => {
    for (const v of [undefined, "", "DEMO", "Demo", "demo ", "true", "1", "production", "supabase "]) {
      expect(backendMode({ BILLING_BACKEND: v, NODE_ENV: "development" }), String(v)).toBe("unconfigured");
    }
  });

  it("the error text names the fix but contains no environment values", () => {
    expect(DEMO_FORBIDDEN_MESSAGE).toMatch(/BILLING_BACKEND=supabase/);
    expect(DEMO_FORBIDDEN_MESSAGE).not.toMatch(/key|secret|token|password/i);
  });

  it("reads the real process environment by default", () => {
    // vitest runs with NODE_ENV=test; no BILLING_BACKEND is set by default in the suite
    const before = process.env.BILLING_BACKEND;
    process.env.BILLING_BACKEND = "demo";
    try {
      expect(backendMode()).toBe("demo");
    } finally {
      if (before === undefined) delete process.env.BILLING_BACKEND;
      else process.env.BILLING_BACKEND = before;
    }
  });
});
