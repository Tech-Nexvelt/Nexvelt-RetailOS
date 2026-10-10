// Runs the database suite against the LOCAL clone of the live schema (see scripts/clone-live-schema.mjs).
// Cross-platform replacement for `DB_BASE=live-clone vitest ...`.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
const root = join(import.meta.dirname, "..");
if (!existsSync(join(root, ".local", "live-clone", "schema.sql"))) {
  console.error("No .local/live-clone/schema.sql. Run: SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... node scripts/clone-live-schema.mjs");
  process.exit(2);
}
const r = spawnSync("npx", ["vitest", "run", "-c", "vitest.db.config.mts", ...process.argv.slice(2)], {
  cwd: root, stdio: "inherit", shell: true, env: { ...process.env, DB_BASE: "live-clone" },
});
process.exit(r.status ?? 1);
