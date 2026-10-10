/**
 * Only runs with DB_BASE=live-clone and a local .local/live-clone/ (made by scripts/clone-live-schema.mjs).
 * Proves the clone used for the dry run matches the live project on the dimensions the isolation tests
 * compare: Tirumala's public schema, the 10 live retailos tables, the auth.users triggers, and the
 * retailos schema-level privileges. Equal hashes = same catalog metadata; it says nothing about data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Client } from "pg";
import { startDb, type TestDb } from "./harness";

const ROOT = path.resolve(__dirname, "..", "..");
const hashesFile = path.join(ROOT, ".local", "live-clone", "live-hashes.json");
const enabled = process.env.DB_BASE === "live-clone" && fs.existsSync(hashesFile);

describe.skipIf(!enabled)("the local clone matches the live project's catalog", () => {
  let db: TestDb;
  let c: Client;
  let live: { hashes: Record<string, string>; inventory: Record<string, unknown> };
  let queries: Record<string, string>;
  beforeAll(async () => {
    db = await startDb({ migrations: false });
    c = db.admin;
    live = JSON.parse(fs.readFileSync(hashesFile, "utf8"));
    const text = fs.readFileSync(path.join(ROOT, "supabase", "retailos", "verify", "snapshot.sql"), "utf8");
    queries = Object.fromEntries([...text.matchAll(/-- @query (\w+)\n([\s\S]*?)(?=\n-- @query |$)/g)].map((m) => [m[1]!, m[2]!.trim().replace(/;\s*$/, "")]));
  });
  afterAll(async () => {
    await db?.stop();
  });
  for (const name of ["tirumala", "live", "auth_triggers", "retailos_schema"]) {
    it(`snapshot "${name}" is identical to live`, async () => {
      const mine = String((await c.query(queries[name]!)).rows[0].h);
      expect(mine).toBe(live.hashes[name]);
    });
  }
  it("object counts match the live inventory", async () => {
    const r = await c.query(
      `select (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','cms','auth_custom','retailos') and c.relkind='r')::int as tables,
              (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','cms','auth_custom','retailos') and c.relkind='v')::int as views,
              (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','cms','auth_custom','retailos') and p.prokind='f')::int as functions,
              (select count(*) from pg_policies where schemaname in ('public','cms','auth_custom','retailos'))::int as policies`,
    );
    expect(r.rows[0]).toMatchObject({ tables: live.inventory.tables, views: live.inventory.views, functions: live.inventory.functions, policies: live.inventory.policies });
  });
});
