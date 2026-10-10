// Pins every file that would be run against the production database to a SHA-256 hash, so an approval can name exact bytes.
//   node scripts/retailos-manifest.mjs          writes supabase/retailos/MANIFEST.sha256
//   node scripts/retailos-manifest.mjs --check  verifies it (exit 1 on any difference)
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const base = join(import.meta.dirname, "..", "supabase", "retailos");
const list = (dir) => readdirSync(join(base, dir)).filter((f) => f.endsWith(".sql")).sort().map((f) => `${dir}/${f}`);
export const FILES = [...list("migrations"), "bootstrap/first-tenant.sql", "rollback.sql", ...list("verify")];
const sha = (f) => createHash("sha256").update(readFileSync(join(base, f))).digest("hex");
export const manifest = () => FILES.map((f) => `${sha(f)}  ${f}`).join("\n") + "\n";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = join(base, "MANIFEST.sha256");
  if (process.argv.includes("--check")) {
    const ok = readFileSync(file, "utf8") === manifest();
    console.log(ok ? `Manifest OK (${FILES.length} files)` : "MANIFEST DIFFERS: a production file changed after approval");
    process.exit(ok ? 0 : 1);
  }
  writeFileSync(file, manifest());
  console.log(`Wrote MANIFEST.sha256 (${FILES.length} files)`);
}
