// Applies the 16 sealed RetailOS migrations to the dedicated project, one transaction per file, in order.
//   node scripts/hosted-apply.mjs --i-have-run-the-preflight
// Safety: refuses to start unless the manifest is the approved one, the connection string carries the expected project ref,
// the target is empty (the guard, migration 0000, is the first thing executed and aborts on anything unexpected), and the
// session is read-write. STOPS at the FIRST failure and never retries or reruns a migration. Prints no secrets.
// Needs RETAILOS_DATABASE_URL and RETAILOS_SUPABASE_PROJECT_REF in the process environment (or .env.local).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

if (!process.argv.includes("--i-have-run-the-preflight")) {
  console.error("Refusing: pass --i-have-run-the-preflight after `node scripts/hosted-preflight.mjs` passed completely.");
  process.exit(2);
}
const root = join(import.meta.dirname, "..");
const env = { ...process.env };
const envFile = join(root, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] !== "" && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
const die = (m) => {
  console.error("ABORT: " + m);
  process.exit(1);
};
const ref = env.RETAILOS_SUPABASE_PROJECT_REF ?? "";
const dbUrl = env.RETAILOS_DATABASE_URL ?? "";
if (!/^[a-z0-9]{20}$/.test(ref)) die("RETAILOS_SUPABASE_PROJECT_REF missing or malformed");
let u;
try {
  u = new URL(dbUrl);
} catch {
  die("RETAILOS_DATABASE_URL missing or not a URL");
}
if (!(u.hostname.includes(ref) || decodeURIComponent(u.username).endsWith("." + ref))) die("connection string does not carry the expected project ref");

const sret = join(root, "supabase", "retailos");
const manifestText = readFileSync(join(sret, "MANIFEST.sha256"));
const approved = env.APPROVED_MANIFEST_PREFIX || "ab468e4fbed8";
if (!createHash("sha256").update(manifestText).digest("hex").startsWith(approved)) die("manifest hash is not the approved one");
for (const line of manifestText.toString().trim().split("\n")) {
  const [h, f] = line.split(/\s+/);
  if (createHash("sha256").update(readFileSync(join(sret, f))).digest("hex") !== h) die("file differs from manifest: " + f);
}
const migDir = join(sret, "migrations");
const migs = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
if (migs.length !== 16 || !migs[0].startsWith("20261010100000_") || !migs[15].startsWith("20261010100015_")) die("unexpected migration set");

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: true, ...(env.RETAILOS_DB_CA_FILE ? { ca: readFileSync(env.RETAILOS_DB_CA_FILE, "utf8") } : {}) }, connectionTimeoutMillis: 20000, statement_timeout: 120000 });
try {
  await client.connect();
} catch (e) {
  die("connection failed: " + String(e.message).split(dbUrl).join("<url>"));
}
const done = [];
try {
  const who = (await client.query("select current_user u, current_setting('server_version_num')::int v")).rows[0];
  if (who.u !== "postgres" || who.v < 170000) die(`unsuitable session (user=${who.u}, version=${who.v})`);
  for (const f of migs) {
    const sql = readFileSync(join(migDir, f), "utf8");
    const sum = createHash("sha256").update(sql).digest("hex").slice(0, 12);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("commit");
      done.push(f);
      console.log(`APPLIED  ${f}  sha256=${sum}`);
    } catch (e) {
      await client.query("rollback").catch(() => {});
      console.log(`FAILED   ${f}  sha256=${sum}`);
      console.log("         " + String(e.message).split("\n").slice(0, 6).join("\n         "));
      console.log(`\nSTOPPED at the first failure. Applied before it: ${done.length}/${migs.length}. The failed file ran in its own transaction and was rolled back.`);
      console.log("Do NOT rerun this script. Inspect the actual state first (node scripts/hosted-verify.mjs).");
      process.exitCode = 1;
      break;
    }
  }
} finally {
  await client.end().catch(() => {});
}
if (!process.exitCode) console.log(`\nAll ${done.length} migrations applied. Next: expose the 'retailos' schema in the dashboard, then run node scripts/hosted-verify.mjs`);
