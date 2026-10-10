// @vitest-environment node
import { describe, expect, it } from "vitest";

/** Tests for the operator helpers in scripts/ (backup content check, environment check). No network, no database. */
interface Row {
  name: string;
  ok: boolean;
  warn?: boolean;
  detail: string;
}
interface BackupMod {
  checkListing(text: string): Row[];
  parseCopyCounts(sql: string): Record<string, number>;
  parseCountsCsv(csv: string): Record<string, number>;
  checkData(dump: Record<string, number>, live: Record<string, number>): Row[];
}
interface EnvMod {
  checkEnv(env: Record<string, string>, production?: boolean): Row[];
}
async function load<T>(file: string): Promise<T> {
  const p = "../scripts/" + file;
  return (await import(/* @vite-ignore */ p)) as T;
}

// A fabricated `pg_restore --list` for a dump that has everything the live project has.
function goodListing(overrides: { drop?: RegExp } = {}) {
  const live = ["tenants", "branches", "memberships", "products", "product_variants", "inventory", "inventory_ledger", "sales", "sale_items", "payments"].map((n) => `retailos_${n}`);
  const tables: [string, string][] = [
    ...live.map((t) => ["retailos", t] as [string, string]),
    ...Array.from({ length: 16 }, (_, i) => ["public", `t${i}`] as [string, string]),
    ...Array.from({ length: 12 }, (_, i) => ["cms", `c${i}`] as [string, string]),
    ["auth_custom", "admin_users"],
  ];
  let n = 1;
  const L: string[] = ["; Archive created at 2026-10-10 15:00:00"];
  const add = (s: string) => L.push(`${n++}; 1259 ${16000 + n} ${s}`);
  for (const [s, t] of tables) {
    add(`TABLE ${s} ${t} postgres`);
    add(`TABLE DATA ${s} ${t} postgres`);
    add(`ROW SECURITY ${s} ${t} postgres`);
    add(`ACL ${s} TABLE ${t} postgres`);
  }
  for (let i = 0; i < 5; i++) add(`VIEW public v${i} postgres`);
  for (let i = 0; i < 19; i++) add(`FUNCTION public f${i}() postgres`);
  for (let i = 0; i < 58; i++) add(`POLICY public t${i % 16} p${i} postgres`);
  for (let i = 0; i < 18; i++) add(`TRIGGER public t${i % 16} trg${i} postgres`);
  add("TRIGGER auth users trg_on_auth_user_created supabase_auth_admin");
  add("DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES postgres");
  const text = L.join("\n");
  const drop = overrides.drop;
  return drop ? text.split("\n").filter((l) => !drop.test(l)).join("\n") : text;
}

describe("scripts/verify-backup.mjs", () => {
  it("passes a dump that contains every table, view, function, policy, trigger, grant and default privilege", async () => {
    const m = await load<BackupMod>("verify-backup.mjs");
    expect(m.checkListing(goodListing()).filter((r) => !r.ok)).toEqual([]);
  });

  it("fails when policies, grants, functions or the 10 live tables are missing from the dump", async () => {
    const m = await load<BackupMod>("verify-backup.mjs");
    const failing = (drop: RegExp) => m.checkListing(goodListing({ drop })).filter((r) => !r.ok).map((r) => r.name);
    expect(failing(/POLICY/)).toContain("RLS policies");
    expect(failing(/ACL /)).toContain("grants (ACL entries)");
    expect(failing(/FUNCTION/)).toContain("functions");
    expect(failing(/TABLE DATA/)).toContain("tables (data entries)");
    expect(failing(/retailos_payments/)).toContain("the 10 existing retailos_* tables");
  });

  it("warns (does not fail) when the auth trigger is not in the dump", async () => {
    const m = await load<BackupMod>("verify-backup.mjs");
    const t = m.checkListing(goodListing({ drop: /trg_on_auth_user_created/ })).find((r) => r.name.startsWith("Tirumala auth trigger"));
    expect(t?.ok).toBe(true);
    expect(t?.warn).toBe(true);
  });

  it("compares dumped row counts with the live counts table by table", async () => {
    const m = await load<BackupMod>("verify-backup.mjs");
    const data = ["COPY public.products (id, name) FROM stdin;", "1\ta", "2\tb", "\\.", "", "COPY public.invoices (id) FROM stdin;", "9", "\\."].join("\n");
    const dump = m.parseCopyCounts(data);
    expect(dump).toEqual({ "public.products": 2, "public.invoices": 1 });
    const live = m.parseCountsCsv("tbl,rows\npublic.products,2\npublic.invoices,2\nretailos.retailos_sales,0\n");
    const res = m.checkData(dump, live);
    expect(res.filter((r) => !r.ok).map((r) => r.name)).toEqual(["rows public.invoices"]);
    expect(res.find((r) => r.name === "rows retailos.retailos_sales")?.ok).toBe(true);
  });
});

describe("scripts/env-check.mjs", () => {
  const anon = "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url") + ".sig";
  const service = "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url") + ".sig";
  const good: Record<string, string> = {
    BILLING_BACKEND: "supabase",
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghij.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    NEXT_PUBLIC_SITE_URL: "https://retail.example.com",
    SUPABASE_SERVICE_ROLE_KEY: service,
  };
  const without = (env: Record<string, string>, ...keys: string[]) => Object.fromEntries(Object.entries(env).filter(([k]) => !keys.includes(k)));
  const problems = async (env: Record<string, string>, production = true) => (await load<EnvMod>("env-check.mjs")).checkEnv(env, production).filter((r) => !r.ok);

  it("accepts a correct production configuration using either set of variable names", async () => {
    expect(await problems(good)).toEqual([]);
    const alt = {
      ...without(good, "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnopqrstuv",
      SUPABASE_SECRET_KEY: "sb_secret_abcdefghijklmnopqrstuvwxyz",
    };
    expect(await problems(alt)).toEqual([]);
  });

  it("flags the missing NEXT_PUBLIC_SITE_URL, demo mode, localhost in production and a missing secret", async () => {
    expect((await problems(without(good, "NEXT_PUBLIC_SITE_URL"))).map((p) => p.name)).toContain("NEXT_PUBLIC_SITE_URL");
    expect((await problems({ ...good, BILLING_BACKEND: "demo" })).map((p) => p.name)).toContain("BILLING_BACKEND");
    expect((await problems({ ...good, NEXT_PUBLIC_SITE_URL: "http://localhost:3000" })).map((p) => p.name)).toContain("NEXT_PUBLIC_SITE_URL");
    expect((await problems({ ...good, NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }, false)).map((p) => p.name)).not.toContain("NEXT_PUBLIC_SITE_URL");
    expect((await problems(without(good, "SUPABASE_SERVICE_ROLE_KEY"))).map((p) => p.name)).toContain("server secret key");
  });

  it("catches the dangerous mistake: a service-role key in a browser-visible variable", async () => {
    const p = await problems({ ...good, NEXT_PUBLIC_SUPABASE_ANON_KEY: service });
    expect(p.some((x) => /DANGER/.test(x.detail))).toBe(true);
    const q = await problems({ ...good, NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: service });
    expect(q.some((x) => x.name === "no secret-looking NEXT_PUBLIC_ variable")).toBe(true);
  });

  it("never puts a key value into its output", async () => {
    const m = await load<EnvMod>("env-check.mjs");
    const out = JSON.stringify(m.checkEnv({ ...good, NEXT_PUBLIC_SUPABASE_ANON_KEY: service }, true));
    expect(out).not.toContain(service);
    expect(out).not.toContain(anon);
  });
});
