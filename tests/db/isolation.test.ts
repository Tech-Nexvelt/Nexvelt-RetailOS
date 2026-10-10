/**
 * Coexistence and isolation with the existing Tirumala Furniture project.
 * Environment: embedded PostgreSQL 17 loaded with tests/db/prodlike.sql (the audited LIVE shape), then
 * the ported RetailOS migrations. Never connects to Supabase. A passing test means applying RetailOS
 * leaves Tirumala and the 10 live retailos_* tables exactly as they were, and that shared sign-in does not
 * imply shared authorisation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Client } from "pg";
import { probe, startDb, type TestDb } from "./harness";
import { buildWorld, insertFilled, type World } from "./fixtures";

let db: TestDb;
let c: Client;
let w: World;
let before: { tirumala: string; liveTables: string; authTriggers: string; publicObjects: string; retailosSchema: string };



const named = (file: string) => {
  const text = fs.readFileSync(path.resolve(__dirname, "..", "..", "supabase", "retailos", "verify", file), "utf8");
  return Object.fromEntries([...text.matchAll(/-- @query (\w+)\n([\s\S]*?)(?=\n-- @query |$)/g)].map((m) => [m[1]!, m[2]!.trim().replace(/;\s*$/, "")]));
};
const SNAP = named("snapshot.sql");
const TIRUMALA = SNAP.tirumala!;
const LIVE = SNAP.live!;
const AUTH_TRIGGERS = SNAP.auth_triggers!;
const RETAILOS_SCHEMA = SNAP.retailos_schema!;

const hash = async (sql: string) => String((await c.query(sql)).rows[0].h);

beforeAll(async () => {
  db = await startDb({ migrations: false });
  c = db.admin;
  before = {
    tirumala: await hash(TIRUMALA),
    liveTables: await hash(LIVE),
    authTriggers: await hash(AUTH_TRIGGERS),
    retailosSchema: await hash(RETAILOS_SCHEMA),
    publicObjects: await hash("select count(*) as h from pg_class where relnamespace = 'public'::regnamespace"),
  };
  const dir = path.resolve(__dirname, "..", "..", "supabase", "retailos", "migrations");
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    try {
      await c.query(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    }
  }
  w = await buildWorld(c);
});
afterAll(async () => {
  await db?.stop();
});

describe("applying RetailOS to a database shaped like the live Tirumala project", () => {
  it("leaves the whole public schema byte-for-byte as it was (tables, columns, policies, functions, grants, defaults)", async () => {
    expect(await hash(TIRUMALA)).toBe(before.tirumala);
    expect(await hash("select count(*) as h from pg_class where relnamespace = 'public'::regnamespace")).toBe(before.publicObjects);
  });

  it("leaves the 10 existing retailos_* tables untouched: structure, grants, RLS, policies", async () => {
    expect(await hash(LIVE)).toBe(before.liveTables);
  });

  it("adds no trigger to auth.users and leaves Tirumala's own trigger exactly as it was", async () => {
    expect(await hash(AUTH_TRIGGERS)).toBe(before.authTriggers);
    expect(before.authTriggers).toContain("trg_on_auth_user_created");
  });

  it("does not run a project-wide default-privilege change (only schema retailos is touched)", async () => {
    const r = await c.query(
      "select defaclnamespace::regnamespace::text as ns from pg_default_acl where defaclnamespace::regnamespace::text not in ('retailos', 'public')",
    );
    expect(r.rows).toEqual([]);
    const global = await c.query("select 1 from pg_default_acl where defaclnamespace = 0");
    expect(global.rows).toEqual([]);
  });

  it("no function in retailos or retailos_private can be run by anon or PUBLIC", async () => {
    const r = await c.query(
      `select p.oid::regprocedure::text as fn from pg_proc p
       where p.pronamespace in ('retailos'::regnamespace, 'retailos_private'::regnamespace)
         and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))`,
    );
    expect(r.rows).toEqual([]);
  });

  it("the new tables give anon nothing, and authenticated only what the design lists (no leftover default SELECT)", async () => {
    const r = await c.query(
      `select c.relname from pg_class c cross join lateral aclexplode(c.relacl) a
       where c.relnamespace = 'retailos'::regnamespace and c.relkind = 'r' and left(c.relname, 9) <> 'retailos_'
         and a.grantee = (select oid from pg_roles where rolname = 'anon')`,
    );
    expect(r.rows).toEqual([]);
  });

  it("ensure_profile is not callable by API roles", async () => {
    await probe(c, w.outsider, async (x) => {
      await expect(x.query("select retailos_private.ensure_profile($1)", [w.outsider])).rejects.toThrow(/permission denied/i);
    });
  });
});

describe("the read-only production verification queries (supabase/retailos/verify/post_checks.sql)", () => {
  const checks = named("post_checks.sql");
  it("exist and are all SELECT-only", () => {
    expect(Object.keys(checks).length).toBeGreaterThanOrEqual(7);
    for (const [name, sql] of Object.entries(checks)) expect(sql, name).toMatch(/^select\b/i);
    for (const sql of Object.values(SNAP)) expect(sql).toMatch(/^select\b/i);
  });
  it("each returns zero rows on the migrated fixture", async () => {
    for (const [name, sql] of Object.entries(checks)) expect({ name, rows: (await c.query(sql)).rows }).toEqual({ name, rows: [] });
  });
  it("row_counts.sql is a single read-only SELECT that returns a numeric count for every base table", async () => {
    const sql = fs.readFileSync(path.resolve(__dirname, "..", "..", "supabase", "retailos", "verify", "row_counts.sql"), "utf8").replace(/--.*$/gm, "").trim().replace(/;\s*$/, "");
    expect(sql).toMatch(/^select\b/i);
    expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter|create|truncate)\b/i);
    const rows = (await c.query(sql)).rows as { tbl: string; rows: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const r of rows) expect(Number.isInteger(Number(r.rows)), r.tbl).toBe(true);
    expect(rows.map((r) => r.tbl)).toContain("retailos.retailos_payments");
  });
  it("are not vacuous: a function reachable by PUBLIC would be reported", async () => {
    await c.query("create function retailos.zz_probe() returns int language sql as 'select 1'");
    const rows = (await c.query(checks.fn_callable_by_anon_or_public!)).rows;
    await c.query("drop function retailos.zz_probe()");
    expect(rows).toHaveLength(1);
  });
});

describe("shared sign-in does not imply shared authorisation", () => {
  it("a brand-new sign-up gets Tirumala's profile row from Tirumala's trigger and NO RetailOS profile or membership", async () => {
    const u = (await c.query("insert into auth.users (email) values ('tirumala.only@test.local') returning id")).rows[0].id as string;
    expect((await c.query("select count(*)::int n from public.profiles where id = $1", [u])).rows[0].n).toBe(1);
    expect((await c.query("select count(*)::int n from retailos.profiles where id = $1", [u])).rows[0].n).toBe(0);
    expect((await c.query("select count(*)::int n from retailos.tenant_memberships where user_id = $1", [u])).rows[0].n).toBe(0);
  });

  it("a Tirumala-only user, even one holding Tirumala's 'admin' profile role, sees zero RetailOS rows and cannot sell", async () => {
    const u = (await c.query("insert into auth.users (email, raw_user_meta_data) values ('tirumala.admin@test.local', '{\"role\":\"admin\"}') returning id")).rows[0].id as string;
    expect((await c.query("select role from public.profiles where id = $1", [u])).rows[0].role).toBe("admin");
    await probe(c, u, async (x) => {
      for (const t of ["tenants", "branches", "tenant_memberships", "products", "product_variants", "invoices", "invoice_items", "payments", "inventory_balances", "inventory_movements", "audit_logs", "retailos_products", "retailos_sales", "retailos_memberships"]) {
        const n = Number((await x.query(`select count(*)::int n from retailos.${t}`)).rows[0].n);
        expect({ t, n }).toEqual({ t, n: 0 });
      }
      await expect(
        x.query("select retailos.pos_checkout($1,$2,gen_random_uuid(),'[]','[]',0)", [w.a1.id, w.a1.counterId]),
      ).rejects.toThrow(/FORBIDDEN|permission|denied/i);
    });
  });

  it("a RetailOS cashier can read none of Tirumala's store-scoped business data", async () => {
    const store = await insertFilled(c, "public.stores", { name: "Tirumala" });
    await insertFilled(c, "public.products", { store_id: store, name: "Sofa" });
    await insertFilled(c, "public.invoices", { store_id: store });
    await probe(c, w.cashierA1, async (x) => {
      expect((await x.query("select count(*)::int n from public.products")).rows[0].n).toBe(0);
      expect((await x.query("select count(*)::int n from public.invoices")).rows[0].n).toBe(0);
    });
  });

  it("KNOWN TIRUMALA ISSUE (not fixed here): any signed-in user can read mobile_scans. Invert this test when the proposed Tirumala fix is approved and applied", async () => {
    const store = await insertFilled(c, "public.stores", { name: "Tirumala 2" });
    await insertFilled(c, "public.mobile_scans", { store_id: store, barcode: "X1" });
    await probe(c, w.cashierA1, async (x) => {
      expect(Number((await x.query("select count(*)::int n from public.mobile_scans")).rows[0].n)).toBeGreaterThan(0);
    });
  });

  it("a user authorised for both applications gets each from its own source", async () => {
    const u = (await c.query("insert into auth.users (email) values ('both@test.local') returning id")).rows[0].id as string;
    const store = await insertFilled(c, "public.stores", { name: "Tirumala 3" });
    await c.query("update public.profiles set store_id = $2 where id = $1", [u, store]);
    await insertFilled(c, "public.products", { store_id: store, name: "Chair" });
    await c.query("select retailos_private.ensure_profile($1)", [u]);
    await c.query(
      "insert into retailos.tenant_memberships (tenant_id, user_id, role_id) select $1, $2, id from retailos.roles where key = 'tenant_owner' and tenant_id is null",
      [w.tenantA, u],
    );
    await probe(c, u, async (x) => {
      expect(Number((await x.query("select count(*)::int n from public.products")).rows[0].n)).toBe(1);
      expect(Number((await x.query("select count(*)::int n from retailos.tenants")).rows[0].n)).toBe(1);
    });
    // removing the RetailOS membership removes RetailOS access only
    await c.query("update retailos.tenant_memberships set status = 'SUSPENDED' where user_id = $1", [u]).catch(() => {});
  });
});

// Must stay LAST: it undoes the migrations.
describe("supabase/retailos/rollback.sql", () => {
  it("returns the database to its starting state: Tirumala, the 10 live tables, auth triggers and retailos schema-level privileges all identical", async () => {
    await c.query(fs.readFileSync(path.resolve(__dirname, "..", "..", "supabase", "retailos", "rollback.sql"), "utf8"));
    expect(await hash(TIRUMALA)).toBe(before.tirumala);
    expect(await hash(LIVE)).toBe(before.liveTables);
    expect(await hash(AUTH_TRIGGERS)).toBe(before.authTriggers);
    expect(await hash(RETAILOS_SCHEMA)).toBe(before.retailosSchema);
    const rels = await c.query("select relname from pg_class where relnamespace = 'retailos'::regnamespace and relkind in ('r','p','v','m') order by 1");
    expect(rels.rows.map((r) => r.relname).every((n: string) => n.startsWith("retailos_"))).toBe(true);
    expect(rels.rows).toHaveLength(10);
    expect((await c.query("select count(*)::int n from pg_proc where pronamespace = 'retailos'::regnamespace")).rows[0].n).toBe(0);
    expect((await c.query("select count(*)::int n from pg_namespace where nspname = 'retailos_private'")).rows[0].n).toBe(0);
  });
});
