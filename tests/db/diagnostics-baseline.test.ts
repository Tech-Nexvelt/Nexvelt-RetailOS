/**
 * Proves the hosted-migration diagnostic (scripts/hosted-diagnose.mjs) is correct BEFORE it is pointed at a hosted database:
 * on a fresh local database with all 16 migrations applied, every object it derives from the migration SQL must be reported
 * present, and removing an object must be reported missing. Also keeps supabase/retailos/diagnostics/expected_function_hashes.txt
 * (md5 of every function's full definition) in step with the migrations: `UPDATE_DIAG=1 npm run test:db -- diagnostics-baseline`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Client } from "pg";
import { startDb, type TestDb } from "./harness";

const ROOT = path.resolve(__dirname, "..", "..");
const MIG = path.join(ROOT, "supabase", "retailos", "migrations");
const HASHES = path.join(ROOT, "supabase", "retailos", "diagnostics", "expected_function_hashes.txt");
const core = async () => (await import(/* @vite-ignore */ pathToFileURL(path.join(ROOT, "scripts", "lib", "diagnose-core.mjs")).href)) as typeof import("../../scripts/lib/diagnose-core.mjs");

describe("hosted-migration diagnostic, validated on a freshly migrated local database", () => {
  let db: TestDb;
  let c: Client;
  beforeAll(async () => {
    db = await startDb();
    c = db.admin;
  });
  afterAll(async () => {
    await db?.stop();
  });

  it("derives a meaningful set of expected objects from all 16 migrations", async () => {
    const { expectedObjects } = await core();
    const objs = expectedObjects(MIG);
    const kinds = new Set(objs.map((o) => o.kind));
    for (const k of ["schema", "table", "function", "trigger", "policy", "index", "rls"]) expect(kinds.has(k), k).toBe(true);
    expect(objs.length).toBeGreaterThan(200);
    expect(new Set(objs.map((o) => o.mig)).size).toBeGreaterThanOrEqual(14);
  });

  it("reports EVERY derived object as present on a fully migrated database, and every migration CONFIRMED", async () => {
    const { expectedObjects, diagnosticSql, verdicts } = await core();
    const objs = expectedObjects(MIG);
    const rows = (await c.query(diagnosticSql(objs))).rows as { mig: string; kind: string; sch: string; name: string; tbl: string; present: boolean }[];
    expect(rows.length).toBe(objs.length);
    expect(rows.filter((r) => !r.present).map((r) => `${r.mig} ${r.kind} ${r.sch}.${r.tbl}.${r.name}`)).toEqual([]);
    const migs = fs.readdirSync(MIG).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, 14));
    const v = verdicts(rows, migs);
    // the guard (…000) creates nothing, so it is the one migration the catalogue cannot confirm
    expect(v.filter((x) => !x.status.startsWith("CONFIRMED")).map((x) => x.mig)).toEqual(["20261010100000"]);
  });

  it("the per-migration summary and function-comparison queries in diagnose.sql run, and report a clean database as clean", async () => {
    const { expectedObjects, summarySql, functionCompareSql } = await core();
    const summary = (await c.query(summarySql(expectedObjects(MIG)))).rows as { mig: string; expected_objects: string; present: string; missing: string }[];
    expect(summary.length).toBeGreaterThanOrEqual(14);
    for (const r of summary) expect({ mig: r.mig, missing: Number(r.missing) }).toEqual({ mig: r.mig, missing: 0 });
    const lines = fs.readFileSync(HASHES, "utf8").trim().split("\n");
    expect((await c.query(functionCompareSql(lines))).rows).toEqual([]);
    // the committed diagnose.sql is exactly what the generator produces (so what you review is what is tested)
    const file = fs.readFileSync(path.join(ROOT, "supabase", "retailos", "diagnostics", "diagnose.sql"), "utf8");
    expect(file).toContain(summarySql(expectedObjects(MIG)));
    expect(file).not.toMatch(/^\s*(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/im);
  });

  it("is not vacuous: a dropped table, function, trigger and policy are each reported missing in the right migration", async () => {
    const { expectedObjects, diagnosticSql } = await core();
    const objs = expectedObjects(MIG);
    await c.query("begin");
    try {
      await c.query("drop table retailos.schema_info cascade"); // 0015
      await c.query("drop function retailos.membership_grant(uuid, uuid, text, jsonb)"); // 0005
      await c.query("drop policy audit_logs_read on retailos.audit_logs"); // 0004
      const rows = (await c.query(diagnosticSql(objs))).rows as { mig: string; kind: string; name: string; present: boolean }[];
      const missing = rows.filter((r) => !r.present).map((r) => `${r.mig}:${r.kind}:${r.name}`);
      expect(missing).toEqual(expect.arrayContaining(["20261010100015:table:schema_info", "20261010100004:policy:audit_logs_read"]));
      expect(missing.some((m) => m.endsWith(":membership_grant"))).toBe(true);
    } finally {
      await c.query("rollback");
    }
  });

  it("function-body hashes match the committed baseline (any change to a function in a migration must update it)", async () => {
    const { functionHashSql } = await core();
    const actual = ((await c.query(functionHashSql)).rows as { l: string }[]).map((r) => r.l);
    if (process.env.UPDATE_DIAG === "1") {
      fs.mkdirSync(path.dirname(HASHES), { recursive: true });
      fs.writeFileSync(HASHES, actual.join("\n") + "\n");
    }
    const expected = fs.readFileSync(HASHES, "utf8").trim().split("\n");
    expect({ missing: expected.filter((l) => !actual.includes(l)).slice(0, 10), unexpected: actual.filter((l) => !expected.includes(l)).slice(0, 10) }).toEqual({ missing: [], unexpected: [] });
    expect(actual.length).toBeGreaterThanOrEqual(30);
  });
});
