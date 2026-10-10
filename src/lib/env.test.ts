import { describe, expect, it } from "vitest";
import { exposedSecretNames, publicEnv, RETAILOS_SCHEMA, safeNextPath, serverSecretKey } from "./env";

describe("public environment", () => {
  const ok = {
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnopqrstuvwxyz",
    NEXT_PUBLIC_SITE_URL: "https://app.example/",
  };

  it("reads the three public values and trims a trailing slash", () => {
    expect(publicEnv(ok)).toEqual({
      supabaseUrl: "https://abc.supabase.co",
      supabaseKey: ok.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      siteUrl: "https://app.example",
    });
  });

  it("returns null (not configured) when anything is missing or malformed", () => {
    expect(publicEnv({})).toBeNull();
    expect(publicEnv({ ...ok, NEXT_PUBLIC_SUPABASE_URL: "not a url" })).toBeNull();
    expect(publicEnv({ ...ok, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "short" })).toBeNull();
    expect(publicEnv({ ...ok, NEXT_PUBLIC_SITE_URL: undefined })).toBeNull();
  });

  it("accepts the legacy anon key name; the publishable name wins when both are present", () => {
    const { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: _drop, ...rest } = ok;
    void _drop;
    const anon = "eyJhbnl_legacy_anon_key_abcdefghijklmnopqrstuvwxyz";
    expect(publicEnv({ ...rest, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon })?.supabaseKey).toBe(anon);
    expect(publicEnv({ ...ok, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon })?.supabaseKey).toBe(ok.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    expect(publicEnv({ ...rest, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: anon })?.supabaseKey).toBe(anon);
    expect(publicEnv({ ...rest })).toBeNull();
  });

  it("targets the dedicated retailos schema, never public", () => {
    expect(RETAILOS_SCHEMA).toBe("retailos");
  });

  it("the server secret may come from either name, and is null when neither is set", () => {
    expect(serverSecretKey({ SUPABASE_SECRET_KEY: "a" })).toBe("a");
    expect(serverSecretKey({ SUPABASE_SERVICE_ROLE_KEY: "b" })).toBe("b");
    expect(serverSecretKey({ SUPABASE_SECRET_KEY: "a", SUPABASE_SERVICE_ROLE_KEY: "b" })).toBe("a");
    expect(serverSecretKey({})).toBeNull();
  });

  it("never exposes the secret key through the public configuration", () => {
    const withSecret = { ...ok, SUPABASE_SECRET_KEY: "sb_secret_should_not_leak_anywhere", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_legacy_should_not_leak" };
    expect(JSON.stringify(publicEnv(withSecret))).not.toContain("sb_secret");
  });
});

describe("secrets must not be browser-visible", () => {
  it("flags any NEXT_PUBLIC_ variable that looks like a secret", () => {
    expect(
      exposedSecretNames({
        NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "x",
        NEXT_PUBLIC_API_SECRET: "x",
        NEXT_PUBLIC_DB_PASSWORD: "x",
      }).sort(),
    ).toEqual([
      "NEXT_PUBLIC_API_SECRET",
      "NEXT_PUBLIC_DB_PASSWORD",
      "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
    ]);
  });

  it("allows the legitimate public values and server-only secrets", () => {
    expect(
      exposedSecretNames({
        NEXT_PUBLIC_SUPABASE_URL: "x",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "x",
        NEXT_PUBLIC_SITE_URL: "x",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "x",
        SUPABASE_SECRET_KEY: "x",
        SUPABASE_SERVICE_ROLE_KEY: "x",
      }),
    ).toEqual([]);
  });

  it("the repository's own environment template exposes none", async () => {
    const { readFileSync } = await import("node:fs");
    const names = readFileSync(".env.example", "utf8")
      .split("\n")
      .map((l) => l.replace(/^#\s*/, "").split("=")[0] ?? "")
      .filter((n) => /^[A-Z_]+$/.test(n));
    expect(exposedSecretNames(Object.fromEntries(names.map((n) => [n, "x"])))).toEqual([]);
  });
});

describe("safeNextPath", () => {
  it("allows same-site relative paths", () => {
    expect(safeNextPath("/reports")).toBe("/reports");
    expect(safeNextPath("/settings/staff?tab=1")).toBe("/settings/staff?tab=1");
  });
  it("falls back for anything else", () => {
    for (const v of [
      null,
      undefined,
      "",
      "reports",
      "//evil.com",
      "/\\evil.com",
      "https://evil.com",
      "javascript:1",
      "/a\u0000b",
      "/a\nb",
    ]) {
      expect(safeNextPath(v as string | null), String(v)).toBe("/billing");
    }
  });
});

describe("publicEnv default source (browser bundles only inline literal NEXT_PUBLIC_ names)", () => {
  it("reads the public variables from process.env by literal name when no source is passed", () => {
    const saved = { u: process.env.NEXT_PUBLIC_SUPABASE_URL, k: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, s: process.env.NEXT_PUBLIC_SITE_URL };
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_" + "x".repeat(30);
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.com/";
    try {
      expect(publicEnv()).toEqual({ supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co", supabaseKey: "sb_publishable_" + "x".repeat(30), siteUrl: "https://app.example.com" });
    } finally {
      for (const [k, v] of [["NEXT_PUBLIC_SUPABASE_URL", saved.u], ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", saved.k], ["NEXT_PUBLIC_SITE_URL", saved.s]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
