/**
 * The incremental apply path (scripts/lib/apply-next.mjs): applies ONE further migration to a database that already holds the earlier
 * ones. Each case builds a fresh local database in a specific state and checks that the migration is applied only when it should be,
 * and that every refusal leaves the database exactly as it was.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startDb, type TestDb } from "./harness";
import { applyNext } from "../../scripts/lib/apply-next.mjs";

const ROOT = path.resolve(__dirname, "..", "..");
const MIG = path.join(ROOT, "supabase", "retailos", "migrations");
const TARGET = "20261010100016";
const files = () => fs.readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const approved = () => createHash("sha256").update(fs.readFileSync(path.join(ROOT, "supabase", "retailos", "MANIFEST.sha256"))).digest("hex").slice(0, 12);

let db: TestDb | null = null;
afterEach(async () => {
  await db?.stop();
  db = null;
});

/** a database that holds every migration EXCEPT the target (and optionally except `skip`), like the hosted project before this change */
async function before(skip: string[] = []) {
  db = await startDb({ migrations: false });
  for (const f of files()) {
    if (f.startsWith(TARGET) || skip.some((s) => f.startsWith(s))) continue;
    await db.admin.query(fs.readFileSync(path.join(MIG, f), "utf8"));
  }
  return db.admin;
}
const hasColumn = async (c: TestDb["admin"]) => (await c.query("select 1 from information_schema.columns where table_schema='retailos' and table_name='products' and column_name='image_path'")).rowCount === 1;
const hasBucket = async (c: TestDb["admin"]) => (await c.query("select 1 from storage.buckets where id='product-images'")).rowCount === 1;
const run = (c: TestDb["admin"], over: Record<string, unknown> = {}) => applyNext(c, { root: ROOT, target: TARGET, approvedManifest: approved(), ...over }) as Promise<{ ok: boolean; reason?: string; applied?: string; objects?: number }>;

describe("applyNext", () => {
  it("applies the migration to a database that has everything before it, and reports every expected object present", async () => {
    const c = await before();
    expect(await hasColumn(c)).toBe(false);
    const r = await run(c);
    expect(r).toMatchObject({ ok: true, applied: "20261010100016_product_images.sql" });
    expect(r.objects).toBeGreaterThan(10);
    expect(await hasColumn(c)).toBe(true);
    expect(await hasBucket(c)).toBe(true);
  });

  it("refuses a manifest hash that is not the current one, or not given at all, and changes nothing", async () => {
    const c = await before();
    for (const bad of ["ab468e4fbed8", "", "zzzzzzzzzzzz", "123", undefined]) {
      const r = await run(c, { approvedManifest: bad });
      expect(r.ok, String(bad)).toBe(false);
    }
    expect(await hasColumn(c)).toBe(false);
    expect(await hasBucket(c)).toBe(false);
  });

  it("refuses a malformed or unknown target", async () => {
    const c = await before();
    for (const bad of ["", "2026", "20261010100099", "20261010100016; drop schema retailos", undefined]) expect((await run(c, { target: bad })).ok, String(bad)).toBe(false);
    expect(await hasColumn(c)).toBe(false);
  });

  it("refuses to run twice: the second attempt says it is already applied and does not touch anything", async () => {
    const c = await before();
    expect((await run(c)).ok).toBe(true);
    const again = await run(c);
    expect(again.ok).toBe(false);
    expect(again.reason).toMatch(/already applied/);
  });

  it("never completes a PARTIALLY applied migration: it stops and says so", async () => {
    const c = await before();
    await c.query("alter table retailos.products add column image_path text"); // someone ran only a piece of it
    const r = await run(c);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/PARTIALLY applied/);
    expect(await hasBucket(c)).toBe(false); // nothing else was added
  });

  it("refuses when an earlier migration is missing", async () => {
    const c = await before(["20261010100015"]);
    const r = await run(c);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/earlier migration is not fully applied: 20261010100015/);
    expect(await hasColumn(c)).toBe(false);
  });

  it("a failure inside the migration rolls EVERYTHING back (no half-applied state)", async () => {
    const c = await before();
    await c.query("alter schema storage rename to storage_unavailable"); // the migration needs storage: it will fail at its first statement
    const r = await run(c);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/rolled back/);
    await c.query("alter schema storage_unavailable rename to storage");
    expect(await hasColumn(c)).toBe(false);
    expect(await hasBucket(c)).toBe(false);
    expect((await c.query("select count(*)::int n from pg_proc where proname like 'image_path_%'")).rows[0].n).toBe(0);
    // and after the cause is fixed, the same call now succeeds
    expect((await run(c)).ok).toBe(true);
  });

  it("the guard and tenant rules keep working after the incremental apply (same behaviour as a fresh install)", async () => {
    const c = await before();
    expect((await run(c)).ok).toBe(true);
    const pol = (await c.query("select policyname from pg_policies where schemaname='storage' and tablename='objects' order by 1")).rows.map((r) => r.policyname);
    expect(pol).toEqual(["product_images_delete", "product_images_insert", "product_images_read"]);
  });
});
