// @vitest-environment node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "supabase/migrations";
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

describe("migration integrity", () => {
  it("every migration matches the sealed checksum (run `npm run migrations:seal` after a deliberate edit)", () => {
    const manifest = Object.fromEntries(
      readFileSync(`${DIR}/SHA256SUMS`, "utf8").trim().split("\n").map((l) => {
        const [hash, name] = l.split(/\s+/);
        return [name, hash];
      }),
    );
    expect(Object.keys(manifest).sort()).toEqual(files);
    for (const f of files) {
      const actual = createHash("sha256").update(readFileSync(`${DIR}/${f}`)).digest("hex");
      expect(actual, `${f} was changed since it was sealed`).toBe(manifest[f]);
    }
  });

  it("every migration is structurally complete: ends with a statement, balanced $$ quotes", () => {
    for (const f of files) {
      const sql = readFileSync(`${DIR}/${f}`, "utf8").replace(/--[^\n]*/g, "").trim();
      expect(sql.endsWith(";"), `${f} does not end with a complete statement`).toBe(true);
      expect((sql.match(/\$\$/g) ?? []).length % 2, `${f} has an unbalanced $$ quote`).toBe(0);
    }
  });

  it("file names are timestamped and strictly ordered", () => {
    expect(files.every((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f))).toBe(true);
    expect([...files].sort()).toEqual(files);
    expect(new Set(files).size).toBe(files.length);
  });

  it("no migration seeds a GST rate or a metal price", () => {
    for (const f of files) {
      const sql = readFileSync(`${DIR}/${f}`, "utf8");
      expect(sql, f).not.toMatch(/insert into public\.tax_rates/i);
      const metal = [...sql.matchAll(/insert into public\.metal_rates/gi)];
      if (metal.length === 0) continue;
      // the only insert is the body of metal_rate_set, which stores a rate the owner typed
      expect(f).toBe("20261010100010_metal_rates.sql");
      expect(metal).toHaveLength(1);
      expect(sql.indexOf("function public.metal_rate_set")).toBeGreaterThan(-1);
      expect(metal[0]!.index!).toBeGreaterThan(sql.indexOf("function public.metal_rate_set"));
    }
  });
});
