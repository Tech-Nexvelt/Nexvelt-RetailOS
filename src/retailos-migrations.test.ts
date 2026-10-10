import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guard for the SQL that is meant for the SHARED Tirumala/RetailOS Supabase project.
 * These tests read files only; they never touch a database.
 */
const ROOT = join(import.meta.dirname, "..", "supabase", "retailos");
const DIR = join(ROOT, "migrations");
const files = () => readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const strip = (sql: string) => sql.replace(/--.*$/gm, "");
const all = () => [...files().map((f) => ({ f, sql: strip(readFileSync(join(DIR, f), "utf8")) })), { f: "bootstrap/first-tenant.sql", sql: strip(readFileSync(join(ROOT, "bootstrap", "first-tenant.sql"), "utf8")) }, { f: "rollback.sql", sql: strip(readFileSync(join(ROOT, "rollback.sql"), "utf8")) }];

describe("retailos migrations (shared-project safety)", () => {
  it("every migration matches its sealed checksum (run `npm run retailos:port` or `npm run retailos:seal` after a deliberate change)", () => {
    const sums = Object.fromEntries(
      readFileSync(join(DIR, "SHA256SUMS"), "utf8").trim().split("\n").map((l) => {
        const [h, n] = l.split(/\s+/);
        return [n, h];
      }),
    );
    expect(Object.keys(sums).sort()).toEqual(files());
    for (const f of files()) {
      expect(createHash("sha256").update(readFileSync(join(DIR, f))).digest("hex"), f).toBe(sums[f]);
    }
  });

  it("covers the same 14 migrations as the preserved originals, in the same order, plus the hand-written dedicated-project guard (first), the schema marker (second to last) and product images (last)", () => {
    const originals = readdirSync(join(ROOT, "..", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    const f = files();
    expect(f[0]).toBe("20261010100000_fresh_project_guard.sql");
    expect(f[f.length - 2]).toBe("20261010100015_schema_marker.sql");
    expect(f[f.length - 1]).toBe("20261010100016_product_images.sql");
    expect(f.slice(1, -2)).toEqual(originals);
  });

  it("never mentions Tirumala's schema: no `public.` object, no `schema public`, no auth.users trigger", () => {
    for (const { f, sql } of all()) {
      expect(sql, f).not.toMatch(/\bpublic\./i);
      expect(sql, f).not.toMatch(/\bschema\s+public\b/i);
      expect(sql, f).not.toMatch(/create\s+(or\s+replace\s+)?trigger[^;]*\bon\s+auth\./i);
      expect(sql, f).not.toMatch(/\b(alter|drop|truncate)\s+(table\s+)?(only\s+)?auth\./i);
    }
  });

  it("never references the 10 live retailos_* tables or Tirumala's retailos_* helper functions", () => {
    for (const { f, sql } of all()) {
      expect(sql, f).not.toMatch(/retailos\.retailos_/i);
      expect(sql, f).not.toMatch(/\bretailos_(tenants|branches|memberships|products|product_variants|inventory|inventory_ledger|sales|sale_items|payments|has_role|can_access_branch)\b/i);
    }
  });

  it("changes default privileges only inside schema retailos", () => {
    for (const { f, sql } of all()) {
      for (const stmt of sql.match(/alter\s+default\s+privileges[^;]*;/gi) ?? []) {
        expect(stmt, `${f}: ${stmt}`).toMatch(/\bin\s+schema\s+retailos\b/i);
        expect(stmt, f).not.toMatch(/\bfor\s+role\s+(?!postgres\b)/i);
      }
    }
  });

  it("never revokes or grants on 'all tables' or 'all functions' of a schema other than retailos_private", () => {
    for (const { f, sql } of all()) {
      for (const stmt of sql.match(/\b(grant|revoke)\b[^;]*\ball\s+(tables|functions|sequences)\s+in\s+schema[^;]*;/gi) ?? []) {
        expect(stmt, `${f}: ${stmt}`).toMatch(/\bin\s+schema\s+retailos_private\b/i);
      }
    }
  });

  it("has no top-level DROP/TRUNCATE/DELETE except replacing its own policy; rollback.sql never drops schema retailos itself", () => {
    for (const { f, sql } of all()) {
      if (f === "rollback.sql") {
        expect(sql).not.toMatch(/drops+schemas+(ifs+existss+)?retailoss*[;s]/i);
        expect(sql).not.toMatch(/retailos.retailos_/i);
        continue;
      }
      // statement-level only: "before truncate" trigger events and DELETEs inside function bodies are not statements here
      const drops = (sql.match(/^drop[^;]*;/gim) ?? []).filter((d) => !/^drops+policys+ifs+existss+w+s+ons+retailos.w+s*;$/i.test(d.trim()));
      expect(drops, f).toEqual([]);
      expect(sql, f).not.toMatch(/^truncate/gim);
      expect(sql, f).not.toMatch(/^deletes+from/gim);
    }
  });

  it("creates objects only in retailos or retailos_private", () => {
    for (const { f, sql } of all()) {
      if (f === "rollback.sql") continue;
      const re = /create\s+(?:or\s+replace\s+)?(?:unique\s+)?(?:table|function|view|index\s+\S+\s+on|type|sequence)\s+(?:if\s+not\s+exists\s+)?([a-z_]+)\./gi;
      for (const m of sql.matchAll(re)) expect(["retailos", "retailos_private"], `${f}: ${m[0]}`).toContain(m[1]!.toLowerCase());
    }
  });

  it("MANIFEST.sha256 pins every file that would run in production (migrations, bootstrap, rollback, verify queries)", () => {
    const lines = readFileSync(join(ROOT, "MANIFEST.sha256"), "utf8").trim().split("\n");
    const pinned = Object.fromEntries(lines.map((l) => { const [h, f] = l.split(/\s+/); return [f!, h!]; }));
    const onDisk = [
      ...readdirSync(DIR).filter((f) => f.endsWith(".sql")).map((f) => "migrations/" + f),
      "bootstrap/first-tenant.sql",
      "rollback.sql",
      ...readdirSync(join(ROOT, "verify")).filter((f) => f.endsWith(".sql")).map((f) => "verify/" + f),
    ].sort();
    expect(Object.keys(pinned).sort()).toEqual(onDisk);
    for (const f of onDisk) {
      expect(createHash("sha256").update(readFileSync(join(ROOT, f))).digest("hex"), f).toBe(pinned[f]);
    }
  });
});
