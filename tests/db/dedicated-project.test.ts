/**
 * The dedicated RetailOS Supabase project: guard, isolation, anonymous denial, sign-up without access,
 * verification tools and rollback.
 *
 * Environment: embedded PostgreSQL 17 + the Supabase-like shim, starting from a FRESH database (the same
 * starting point as a brand-new project). It is not Supabase: Auth, the Data API and email are not exercised.
 *
 * `UPDATE_VERIFY=1 npm run retailos:verify:update` regenerates verify/expected_inventory.txt and rollback.sql from the
 * migrated catalog; without it these tests only COMPARE, so any drift fails.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Client } from "pg";
import { asUser, probe, refused, startDb, type TestDb } from "./harness";
import { buildWorld, type World } from "./fixtures";
import { buildShop } from "./shop";

const ROOT = path.resolve(__dirname, "..", "..");
const MIG = path.join(ROOT, "supabase", "retailos", "migrations");
const VERIFY = path.join(ROOT, "supabase", "retailos", "verify");
const ROLLBACK = path.join(ROOT, "supabase", "retailos", "rollback.sql");
const EXPECTED = path.join(VERIFY, "expected_inventory.txt");
const UPDATE = process.env.UPDATE_VERIFY === "1";

const migrationFiles = () => fs.readdirSync(MIG).filter((n) => n.endsWith(".sql")).sort();
const guardSql = fs.readFileSync(path.join(MIG, "20261010100000_fresh_project_guard.sql"), "utf8");
const named = (file: string): Record<string, string> => {
  const text = fs.readFileSync(path.join(VERIFY, file), "utf8");
  return Object.fromEntries([...text.matchAll(/-- @query (\w+)\n([\s\S]*?)(?=\n-- @query |$)/g)].map((m) => [m[1]!, m[2]!.trim().replace(/;\s*$/, "")]));
};
async function applyAll(c: Client) {
  for (const f of migrationFiles()) {
    try {
      await c.query(fs.readFileSync(path.join(MIG, f), "utf8"));
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    }
  }
}
/** Run the guard inside a transaction that is always rolled back. Returns the refusal message, or null if it passed. */
async function guardOutcome(c: Client, mutation?: string): Promise<string | null> {
  await c.query("begin");
  try {
    if (mutation) await c.query(mutation);
    await c.query(guardSql);
    return null;
  } catch (e) {
    return (e as Error).message;
  } finally {
    await c.query("rollback");
  }
}
const inventoryLines = async (c: Client): Promise<string[]> =>
  ((await c.query(fs.readFileSync(path.join(VERIFY, "inventory.sql"), "utf8"))).rows as { l: string }[]).map((r) => r.l).sort();

// ---------------------------------------------------------------------------------------------------------
describe("fresh-project guard", () => {
  let db: TestDb;
  let c: Client;
  beforeAll(async () => {
    db = await startDb({ migrations: false });
    c = db.admin;
  });
  afterAll(async () => {
    await db?.stop();
  });

  it("passes on a fresh Supabase-like database", async () => {
    expect(await guardOutcome(c)).toBeNull();
  });

  it("does not treat Supabase's own platform objects as a problem", async () => {
    const platform = `
      create schema storage;   create table storage.buckets (id text primary key);
      create schema realtime;  create table realtime.messages (id bigint);
      create schema extensions; create function extensions.uuid_generate_v4() returns uuid language sql as 'select gen_random_uuid()';
      create schema graphql_public; create function graphql_public.graphql() returns jsonb language sql as 'select 1::text::jsonb';
      create schema vault;     create table vault.secrets (id uuid primary key);`;
    expect(await guardOutcome(c, platform)).toBeNull();
  });

  const refusals: [string, string, RegExp][] = [
    ["an application table in public", "create table public.stores (id int)", /public\.stores/],
    ["an application view in public", "create view public.v_demo as select 1 as x", /public\.v_demo/],
    ["an application function in public", "create function public.helper() returns int language sql as 'select 1'", /public\.helper/],
    ["an application enum type in public", "create type public.mood as enum ('a', 'b')", /public\.mood/],
    ["tables in an unknown, non-platform schema", "create schema other_app; create table other_app.t (id int)", /other_app\.t/],
    ["an existing retailos schema", "create schema retailos", /schema "retailos" already exists/],
    ["an existing retailos_private schema", "create schema retailos_private", /schema "retailos_private" already exists/],
    [
      "an application trigger on auth.users",
      "create function public.x() returns trigger language plpgsql as 'begin return new; end'; create trigger hook after insert on auth.users for each row execute function public.x()",
      /trigger "hook" exists on auth\.users/,
    ],
    ["a database that is not a Supabase Auth database", "alter table auth.users rename to users_renamed", /auth\.users does not exist/],
  ];
  for (const [name, mutation, expected] of refusals) {
    it(`REFUSES ${name}, says why, and changes nothing`, async () => {
      const message = await guardOutcome(c, mutation);
      expect(message).toMatch(/RetailOS migration REFUSED/);
      expect(message).toMatch(expected);
      expect(message).toMatch(/Nothing was changed/);
    });
  }

  it("reports all problems together, not just the first", async () => {
    const message = await guardOutcome(c, "create table public.a (id int); create schema retailos");
    expect(message).toMatch(/public\.a/);
    expect(message).toMatch(/schema "retailos" already exists/);
  });
});

describe("migration refusal on an unsuitable target (the wrong project)", () => {
  it("startDb with the wrong-target fixture fails with the guard's explanation and leaves nothing running", async () => {
    await expect(startDb({ fixture: "wrong-target.sql" })).rejects.toThrow(/20261010100000_fresh_project_guard\.sql failed: RetailOS migration REFUSED/);
  });

  it("changes nothing on that target, and the migration is not even attempted past the guard; skipping the guard still fails on plain CREATE SCHEMA", async () => {
    const db = await startDb({ fixture: "wrong-target.sql", migrations: false });
    try {
      const c = db.admin;
      const before = (await c.query("select count(*)::int n from pg_class where relnamespace in ('retailos'::regnamespace, 'public'::regnamespace) and relkind = 'r'")).rows[0].n;
      await expect(c.query(guardSql)).rejects.toThrow(/REFUSED[\s\S]*retailos[\s\S]*public\.stores[\s\S]*trg_on_auth_user_created/);
      // second line of defence: even without the guard, the foundation uses a plain CREATE SCHEMA
      const foundation = fs.readFileSync(path.join(MIG, "20261010100001_foundation.sql"), "utf8");
      await expect(c.query(foundation)).rejects.toThrow(/already exists/);
      expect((await c.query("select count(*)::int n from pg_namespace where nspname = 'retailos_private'")).rows[0].n).toBe(0);
      expect((await c.query("select count(*)::int n from pg_class where relnamespace in ('retailos'::regnamespace, 'public'::regnamespace) and relkind = 'r'")).rows[0].n).toBe(before);
    } finally {
      await db.stop();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------
describe("a freshly migrated dedicated project", () => {
  let db: TestDb;
  let c: Client;
  let w: World;
  let tenantTables: string[];
  const allTables = async () =>
    ((await c.query("select relname from pg_class where relnamespace = 'retailos'::regnamespace and relkind in ('r', 'p') order by 1")).rows as { relname: string }[]).map((r) => r.relname);

  beforeAll(async () => {
    db = await startDb();
    c = db.admin;
    w = await buildWorld(c);
    await buildShop(c, w);
    tenantTables = ((await c.query("select table_name from information_schema.columns where table_schema = 'retailos' and column_name = 'tenant_id' order by 1")).rows as { table_name: string }[]).map((r) => r.table_name);
  });
  afterAll(async () => {
    await db?.stop();
  });

  it("every post-migration check returns zero rows (RLS everywhere, no anon access, no open policies, closed functions, no auth hook, marker present)", async () => {
    const checks = named("post_checks.sql");
    expect(Object.keys(checks).length).toBeGreaterThanOrEqual(10);
    for (const [name, sql] of Object.entries(checks)) {
      expect(sql, name).toMatch(/^select\b/i);
      expect({ name, rows: (await c.query(sql)).rows }).toEqual({ name, rows: [] });
    }
  });

  it("the post-checks are not vacuous: each class of mistake is reported", async () => {
    const checks = named("post_checks.sql");
    const trial = async (name: string, mutation: string) => {
      await c.query("begin");
      try {
        await c.query(mutation);
        return (await c.query(checks[name]!)).rows.length;
      } finally {
        await c.query("rollback");
      }
    };
    expect(await trial("table_privilege_held_by_anon", "grant select on retailos.products to anon")).toBeGreaterThan(0);
    expect(await trial("function_callable_by_anon_or_public", "grant execute on function retailos_private.fail(text, jsonb) to anon")).toBeGreaterThan(0);
    expect(await trial("table_without_row_level_security", "alter table retailos.brands disable row level security")).toBeGreaterThan(0);
    expect(await trial("policy_open_to_public_or_anon", "create policy leak on retailos.brands for select to anon using (tenant_id is not null)")).toBeGreaterThan(0);
    expect(await trial("tautological_policy", "create policy leak on retailos.brands for select to authenticated using (true)")).toBeGreaterThan(0);
    expect(await trial("ledger_table_with_write_privilege_for_api_roles", "grant insert on retailos.payments to authenticated")).toBeGreaterThan(0);
    expect(await trial("schema_usable_by_anon", "grant usage on schema retailos to anon")).toBeGreaterThan(0);
    expect(await trial("trigger_on_auth_users", "create function public.x() returns trigger language plpgsql as 'begin return new; end'; create trigger hook after insert on auth.users for each row execute function public.x()")).toBeGreaterThan(0);
    expect(await trial("application_object_in_public_schema", "create table public.leftover (id int)")).toBeGreaterThan(0);
    expect(await trial("schema_marker_missing_or_wrong", "alter table retailos.schema_info disable trigger schema_info_no_change; update retailos.schema_info set schema_version = 2")).toBeGreaterThan(0);
  });

  it("the schema inventory matches the expected inventory exactly (a mismatch lists what is missing or unexpected)", async () => {
    const actual = await inventoryLines(c);
    if (UPDATE) fs.writeFileSync(EXPECTED, actual.join("\n") + "\n");
    const expected = fs.readFileSync(EXPECTED, "utf8").trim().split("\n").sort();
    const missing = expected.filter((l) => !actual.includes(l));
    const unexpected = actual.filter((l) => !expected.includes(l));
    expect({ missing: missing.slice(0, 10), unexpected: unexpected.slice(0, 10) }).toEqual({ missing: [], unexpected: [] });
  });

  it("rollback.sql names exactly the tables and functions the migrations create, with no CASCADE", async () => {
    const tables = await allTables();
    const fns = ((await c.query("select p.oid::regprocedure::text as f from pg_proc p where p.pronamespace in ('retailos'::regnamespace, 'retailos_private'::regnamespace) order by 1")).rows as { f: string }[]).map((r) => r.f);
    expect((await c.query("select count(*)::int n from pg_class where relnamespace = 'retailos_private'::regnamespace")).rows[0].n).toBe(0);
    const text = [
      "-- ROLLBACK for supabase/retailos/migrations (dedicated project). NOT APPLIED. Requires explicit approval.",
      "-- GENERATED by tests/db/dedicated-project.test.ts (UPDATE_VERIFY=1) from the migrated catalog; that test keeps it in step.",
      "-- Drops ONLY objects the migrations create, each by exact name, with NO CASCADE: if anything else depends on one of",
      "-- them the statement FAILS and nothing is dropped. Both schemas are dropped without CASCADE, so they must be empty.",
      "-- It never touches schema public, auth or any other schema, and it does not remove Auth users or their data.",
      "-- LIMITS: every row in the dropped tables is lost (business data, audit log, bootstrap rows); dashboard settings",
      "-- (schema exposure, sign-up and URL settings) and Auth users are not undone. After real sales exist do NOT roll back:",
      "-- restore from backup or fix forward.",
      "",
      "begin;",
      "",
      `drop table ${tables.map((t) => "retailos." + t).join(",\n           ")};`,
      "",
      `drop function ${fns.join(",\n              ")};`,
      "",
      "drop schema retailos_private;",
      "drop schema retailos;",
      "",
      "commit;",
      "",
    ].join("\n");
    if (UPDATE) fs.writeFileSync(ROLLBACK, text);
    const current = fs.readFileSync(ROLLBACK, "utf8");
    expect(current).toBe(text);
    expect(current).not.toMatch(/cascade/i);
    expect(current).not.toMatch(/\bpublic\./i);
  });

  it("anonymous callers can reach nothing: every table, every function, both schemas", async () => {
    for (const t of await allTables()) {
      await asUser(c, null, async (x) => {
        expect(await refused(x, `select count(*) from retailos.${t}`), t).toBeTruthy();
      });
    }
    await asUser(c, null, async (x) => {
      expect(await refused(x, "select retailos.pos_quote_cart($1, '[]'::jsonb)", [w.a1.id])).toBeTruthy();
      expect(await refused(x, "select retailos_private.is_platform_admin()")).toBeTruthy();
      expect(await refused(x, "select retailos.report_sales_summary($1, current_date, current_date)", [w.a1.id])).toBeTruthy();
    });
    const usage = await c.query("select has_schema_privilege('anon', 'retailos', 'usage') a, has_schema_privilege('anon', 'retailos_private', 'usage') b");
    expect(usage.rows[0]).toEqual({ a: false, b: false });
  });

  it("there is no trigger on auth.users, and a sign-up (whatever its metadata claims) creates nothing and grants nothing", async () => {
    expect((await c.query("select count(*)::int n from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal")).rows[0].n).toBe(0);
    const evil = (
      await c.query("insert into auth.users (email, raw_user_meta_data) values ('signup@test.local', $1) returning id", [
        JSON.stringify({ full_name: "Sign Up", role: "tenant_owner", tenant_id: w.tenantA, is_admin: true, permissions: ["settings.manage"] }),
      ])
    ).rows[0].id as string;
    for (const t of ["profiles", "tenant_memberships", "branch_memberships", "platform_admins", "permission_overrides"]) {
      const col = t === "platform_admins" ? "user_id" : t === "profiles" ? "id" : "user_id";
      expect((await c.query(`select count(*)::int n from retailos.${t} where ${col} = $1`, [evil])).rows[0].n, t).toBe(0);
    }
    const global = new Set(["permissions", "roles", "role_permissions"]); // the permission catalogue, not tenant data
    for (const t of await allTables()) {
      if (global.has(t)) continue;
      await probe(c, evil, async (x) => {
        await x.query("savepoint t");
        try {
          const n = Number((await x.query(`select count(*)::int n from retailos.${t}`)).rows[0].n);
          expect({ t, n }).toEqual({ t, n: 0 });
        } catch (e) {
          expect((e as { code?: string }).code, t).toBe("42501"); // permission denied is also a refusal
          await x.query("rollback to savepoint t");
        }
      });
    }
    await probe(c, evil, async (x) => {
      expect(await refused(x, "select retailos.pos_start_day($1, $2, 0)", [w.a1.id, w.a1.counterId])).toBeTruthy();
      expect(await refused(x, "select retailos.pos_quote_cart($1, '[]'::jsonb)", [w.a1.id])).toBeTruthy();
      expect(await refused(x, "select retailos.membership_grant($1, $2, 'tenant_owner', '[]'::jsonb)", [w.tenantA, evil])).toBeTruthy();
      expect(await refused(x, "select retailos.platform_create_tenant('XYZ', 'x', 'x', $1)", [evil])).toBeTruthy();
      expect(await refused(x, "select retailos.report_sales_summary($1, current_date, current_date)", [w.a1.id])).toBeTruthy();
    });
  });

  it("tenant isolation covers EVERY tenant-owned table: a user of another business sees none of its rows and cannot change them", async () => {
    expect(tenantTables.length).toBeGreaterThanOrEqual(15);
    // sanity: the sweep is meaningful because the first business really has rows in many of these tables
    let populated = 0;
    for (const t of tenantTables) if (Number((await c.query(`select count(*)::int n from retailos.${t} where tenant_id = $1`, [w.tenantA])).rows[0].n) > 0) populated++;
    expect(populated).toBeGreaterThanOrEqual(8);

    for (const actor of [w.ownerB, w.cashierB1]) {
      for (const t of tenantTables) {
        await asUser(c, actor, async (x) => {
          await x.query("savepoint t");
          try {
            const n = Number((await x.query(`select count(*)::int n from retailos.${t} where tenant_id = $1`, [w.tenantA])).rows[0].n);
            expect({ t, n }).toEqual({ t, n: 0 });
          } catch (e) {
            expect((e as { code?: string }).code, t).toBe("42501");
            await x.query("rollback to savepoint t");
          }
        });
      }
    }
    const before = (await c.query("select name from retailos.products where tenant_id = $1 order by id", [w.tenantA])).rows;
    await asUser(c, w.ownerB, async (x) => {
      expect((await x.query("update retailos.products set name = 'hacked' where tenant_id = $1", [w.tenantA])).rowCount).toBe(0);
      expect((await x.query("update retailos.tenants set trade_name = 'hacked' where id = $1", [w.tenantA])).rowCount).toBe(0);
      expect(await refused(x, "insert into retailos.products (tenant_id, name, category_id) select $1, 'planted', id from retailos.categories limit 1", [w.tenantA])).toBeTruthy();
      expect(await refused(x, "delete from retailos.products where tenant_id = $1", [w.tenantA])).toBeTruthy();
    });
    expect((await c.query("select name from retailos.products where tenant_id = $1 order by id", [w.tenantA])).rows).toEqual(before);
  });

  it("every tenant-owned table declares tenant_id NOT NULL (only the system role catalogue may have none)", async () => {
    const r = await c.query("select table_name from information_schema.columns where table_schema = 'retailos' and column_name = 'tenant_id' and is_nullable = 'YES' order by 1");
    expect((r.rows as { table_name: string }[]).map((x) => x.table_name)).toEqual(["roles"]);
  });

  it("the schema marker records the application and version, and is invisible to API roles and write-once", async () => {
    expect((await c.query("select app, schema_version, migration_set from retailos.schema_info")).rows).toEqual([{ app: "retailos", schema_version: 1, migration_set: "dedicated-project-v1" }]);
    await asUser(c, w.ownerA, async (x) => {
      expect(await refused(x, "select * from retailos.schema_info")).toBeTruthy();
    });
    await expect(c.query("update retailos.schema_info set schema_version = 2")).rejects.toThrow(/write-once/);
    await expect(c.query("delete from retailos.schema_info")).rejects.toThrow(/write-once/);
    await expect(c.query("truncate retailos.schema_info")).rejects.toThrow(/write-once/);
  });

  it("the migration is one-shot: re-running it, or any single file, fails instead of being absorbed by IF NOT EXISTS", async () => {
    await expect(c.query(guardSql)).rejects.toThrow(/REFUSED[\s\S]*already exists/);
    await expect(c.query(fs.readFileSync(path.join(MIG, "20261010100001_foundation.sql"), "utf8"))).rejects.toThrow(/already exists/);
    expect(fs.readFileSync(path.join(MIG, "20261010100001_foundation.sql"), "utf8")).not.toMatch(/create schema if not exists/i);
  });

  it("rollback removes only RetailOS objects, preserves unrelated data, and the project can be migrated again to the identical inventory", async () => {
    const expected = fs.readFileSync(EXPECTED, "utf8").trim().split("\n").sort();
    await c.query("create table public.unrelated_demo (id int primary key, note text)");
    await c.query("insert into public.unrelated_demo values (1, 'keep me')");
    const users = (await c.query("select count(*)::int n from auth.users")).rows[0].n;

    await c.query(fs.readFileSync(ROLLBACK, "utf8"));

    expect((await c.query("select count(*)::int n from pg_namespace where nspname in ('retailos', 'retailos_private')")).rows[0].n).toBe(0);
    expect((await c.query("select note from public.unrelated_demo")).rows).toEqual([{ note: "keep me" }]);
    expect((await c.query("select count(*)::int n from auth.users")).rows[0].n).toBe(users);
    expect((await c.query("select count(*)::int n from pg_roles where rolname in ('anon', 'authenticated', 'service_role')")).rows[0].n).toBe(3);

    // the guard now (correctly) refuses because an unrelated application table is present
    await expect(applyAll(c)).rejects.toThrow(/public\.unrelated_demo/);
    await c.query("drop table public.unrelated_demo");
    await applyAll(c);
    expect(await inventoryLines(c)).toEqual(expected);
  });
});
