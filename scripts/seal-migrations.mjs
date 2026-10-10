// Writes supabase/migrations/SHA256SUMS. Run `npm run migrations:seal` after a DELIBERATE migration edit.
// The unit test src/migrations.test.ts fails if any migration differs from this manifest, so an
// accidental overwrite or truncation (by an editor, another tool or a bad merge) cannot go unnoticed.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Optional argument: a directory relative to the repo root (default supabase/migrations).
const dir = join(import.meta.dirname, "..", ...(process.argv[2] ?? "supabase/migrations").split("/"));
const lines = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => `${createHash("sha256").update(readFileSync(join(dir, f))).digest("hex")}  ${f}`);
writeFileSync(join(dir, "SHA256SUMS"), lines.join("\n") + "\n");
console.log(`Sealed ${lines.length} migrations.`);
