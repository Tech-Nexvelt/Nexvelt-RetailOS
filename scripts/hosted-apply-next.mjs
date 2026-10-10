// Applies ONE further sealed migration to the hosted RetailOS database (database connection only; no token, no Management API).
//   node scripts/hosted-apply-next.mjs --migration 20261010100016 --manifest <first 12+ hex of MANIFEST.sha256>
// It will REFUSE unless: the manifest hash you typed is the current one and every pinned file matches; the connection string carries the
// project ref; TLS is verified; migrations before it are fully present; the migration itself is completely absent. It then applies it in one
// transaction (any failure rolls back everything) and re-checks. It never reruns or completes a partially applied migration.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { applyNext } from "./lib/apply-next.mjs";

const root = join(import.meta.dirname, "..");
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const env = { ...process.env };
if (existsSync(join(root, ".env.local"))) for (const l of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && m[2] !== "" && env[m[1]] === undefined) env[m[1]] = m[2]; }
const die = (m) => { console.error("ABORT: " + m); process.exit(1); };
const target = arg("--migration");
const manifest = arg("--manifest");
if (!target || !manifest) die("usage: node scripts/hosted-apply-next.mjs --migration <id> --manifest <hash prefix>");
const ref = env.RETAILOS_SUPABASE_PROJECT_REF ?? "";
const url = env.RETAILOS_DATABASE_URL ?? "";
if (!/^[a-z0-9]{20}$/.test(ref) || !url) die("RETAILOS_SUPABASE_PROJECT_REF and RETAILOS_DATABASE_URL are required");
const u = new URL(url);
if (!(u.hostname.includes(ref) || decodeURIComponent(u.username).endsWith("." + ref))) die("connection string does not carry the expected project ref");
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true, ...(env.RETAILOS_DB_CA_FILE ? { ca: readFileSync(env.RETAILOS_DB_CA_FILE, "utf8") } : {}) }, connectionTimeoutMillis: 20000, statement_timeout: 120000 });
try {
  await client.connect();
} catch (e) {
  die("database connection failed: " + String(e.message).split(url).join("<url>"));
}
let r;
try {
  r = await applyNext(client, { root, target, approvedManifest: manifest, log: (m) => console.log(m) });
} finally {
  await client.end().catch(() => {});
}
if (!r.ok) {
  console.error("NOT APPLIED: " + r.reason);
  process.exit(1);
}
console.log(`APPLIED ${r.applied} (${r.objects} objects). Next: node scripts/hosted-verify.mjs --db-only`);
