// READ-ONLY preflight for the hosted RetailOS database. Executes NO migration and writes nothing.
//   node scripts/hosted-preflight.mjs
// Reads .env.local (git-ignored) merged under the real environment. Prints PASS/FAIL lines only: never a token, password
// or connection string. Stops at the first failed section (exit 1).
//   RETAILOS_SUPABASE_PROJECT_REF   the new project's ref
//   SUPABASE_ACCESS_TOKEN           Management API token (identity check only; one read-only GET)
//   RETAILOS_DATABASE_URL           session-pooler connection string of the NEW project (port 5432)
//   TIRUMALA_SUPABASE_PROJECT_REF   the OTHER project's ref, used ONLY for string comparison; it is never contacted
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const root = join(import.meta.dirname, "..");
const env = { ...process.env };
const envFile = join(root, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] !== "" && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
let failed = false;
const gate = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " - " + detail : ""}`);
  if (!ok) failed = true;
  return ok;
};
const stop = (msg) => {
  console.log(`\nSTOPPED: ${msg}\nNo SQL was executed beyond read-only inspection.`);
  process.exit(1);
};

// 1. configuration present and consistent
const ref = env.RETAILOS_SUPABASE_PROJECT_REF ?? "";
const other = env.TIRUMALA_SUPABASE_PROJECT_REF ?? "";
const dbUrl = env.RETAILOS_DATABASE_URL ?? "";
const dbOnly = process.argv.includes("--db-only"); // never reads or uses the Management API token
const token = dbOnly ? "" : (env.SUPABASE_ACCESS_TOKEN ?? "");
gate("RETAILOS_SUPABASE_PROJECT_REF is set and well-formed", /^[a-z0-9]{20}$/.test(ref), ref ? "" : "MISSING");
console.log(other ? "INFO  Tirumala ref provided: used for string comparison only" : "INFO  project separation: owner-confirmed (no Tirumala ref supplied; string comparison skipped)");
if (dbOnly) console.log("INFO  --db-only: Management API identity check SKIPPED by request; identity rests on the connection string carrying the project ref plus the empty-target guard");
else gate("SUPABASE_ACCESS_TOKEN is set", token.length > 20, token ? "(value not shown)" : "MISSING");
gate("RETAILOS_DATABASE_URL is set", dbUrl.length > 20, dbUrl ? "(value not shown)" : "MISSING");
if (failed) stop("configuration incomplete");
if (other) gate("new ref differs from the Tirumala ref", ref !== other);
if (env.NEXT_PUBLIC_SUPABASE_URL) gate("NEXT_PUBLIC_SUPABASE_URL points at the new project", env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "") === `https://${ref}.supabase.co`);
let u;
try {
  u = new URL(dbUrl);
} catch {
  stop("RETAILOS_DATABASE_URL is not a valid URL");
}
const userPart = decodeURIComponent(u.username);
gate("database URL belongs to the new project (host or user carries the ref)", u.hostname.includes(ref) || userPart.endsWith("." + ref), `host=${u.hostname}`);
if (other) gate("database URL does NOT mention the Tirumala ref", !dbUrl.includes(other));
gate("database URL is a postgres connection string (not the https API address)", /^postgres(ql)?:$/.test(u.protocol), "scheme=" + u.protocol);
gate("database host is the Supabase pooler or the project's db host", u.hostname.endsWith(".pooler.supabase.com") || u.hostname === "db." + ref + ".supabase.co", "host kind check");
gate("database URL has a password and port 5432", u.password.length > 0 && u.port === "5432", "port=" + (u.port || "none"));
if (failed) stop("project identity mismatch");

// 2. manifest + checksums
const sret = join(root, "supabase", "retailos");
const manifestText = readFileSync(join(sret, "MANIFEST.sha256"));
const manifestHash = createHash("sha256").update(manifestText).digest("hex");
const approved = env.APPROVED_MANIFEST_PREFIX || "512177b144f1";
gate("MANIFEST.sha256 hash matches the approved prefix", manifestHash.startsWith(approved), `sha256=${manifestHash.slice(0, 12)} approved=${approved}`);
let manifestOk = true;
for (const line of manifestText.toString().trim().split("\n")) {
  const [h, f] = line.split(/\s+/);
  if (createHash("sha256").update(readFileSync(join(sret, f))).digest("hex") !== h) {
    manifestOk = false;
    console.log("      differs: " + f);
  }
}
gate("every file in the manifest matches its pinned hash", manifestOk);
const migDir = join(sret, "migrations");
const migs = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
const sums = Object.fromEntries(readFileSync(join(migDir, "SHA256SUMS"), "utf8").trim().split("\n").map((l) => l.split(/\s+/).reverse()));
gate("SHA256SUMS matches every migration", migs.every((f) => createHash("sha256").update(readFileSync(join(migDir, f))).digest("hex") === sums[f]));
gate("migration order: guard first, images last, 17 files", migs[0].startsWith("20261010100000_") && migs.at(-1).startsWith("20261010100016_") && migs.length === 17, `${migs.length} files`);
if (failed) stop("manifest/migration integrity");

// 3. Management API identity (one read-only GET of the new project)
if (!dbOnly) try {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  if (!gate("Management API can read the new project (token valid for it)", res.ok, `HTTP ${res.status}`)) stop("cannot verify project identity");
  const p = await res.json();
  gate("API reports the same ref", p.id === ref || p.ref === ref);
  console.log(`      project name="${p.name}" region=${p.region} status=${p.status}`);
  gate("project status is ACTIVE_HEALTHY", p.status === "ACTIVE_HEALTHY");
  gate("project name does not look like the other application (advisory; the ref comparison is authoritative)", !/tirumala|furniture/i.test(String(p.name)));
} catch (e) {
  stop("Management API unreachable: " + e.message);
}
if (failed) stop("project identity not established");

// 4. database inspection: one READ ONLY transaction, always rolled back
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: true, ...(env.RETAILOS_DB_CA_FILE ? { ca: readFileSync(env.RETAILOS_DB_CA_FILE, "utf8") } : {}) }, statement_timeout: 20000, connectionTimeoutMillis: 20000 });
try {
  await client.connect();
} catch (e) {
  stop("database connection failed: " + String(e.message).split(dbUrl).join("<url>"));
}
try {
  await client.query("begin read only");
  const q = async (sql) => (await client.query(sql)).rows;
  const id = (await q("select current_user u, current_setting('server_version_num')::int v"))[0];
  gate("connected as postgres", id.u === "postgres", `user=${id.u}`);
  gate("PostgreSQL 17 or newer", id.v >= 170000, `server_version_num=${id.v}`);
  gate("Supabase roles exist (anon, authenticated, service_role)", (await q("select rolname from pg_roles where rolname in ('anon','authenticated','service_role')")).length === 3);
  gate("auth.users exists", (await q("select to_regclass('auth.users') r"))[0].r !== null);
  gate("no RetailOS schemas yet", (await q("select 1 from pg_namespace where nspname in ('retailos','retailos_private')")).length === 0);
  const platform =
    "('information_schema','auth','storage','realtime','extensions','graphql','graphql_public','pgbouncer','vault','supabase_functions','supabase_migrations','_realtime','net','cron','pgsodium','pgsodium_masks','_analytics','_supavisor','pgmq','topology','tiger','tiger_data')";
  const rel = await q(
    `select n.nspname||'.'||c.relname as o from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p','v','m','f','S') and n.nspname not in ${platform} and n.nspname !~ '^pg_' and not exists (select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype in ('e','a','i')) limit 10`,
  );
  gate("no application tables/views/sequences outside platform schemas", rel.length === 0, rel.map((r) => r.o).join(", "));
  const fn = await q(
    `select n.nspname||'.'||p.proname as o from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not in ${platform} and n.nspname !~ '^pg_' and not exists (select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') limit 10`,
  );
  gate("no application functions outside platform schemas", fn.length === 0, fn.map((r) => r.o).join(", "));
  gate("no non-internal trigger on auth.users", (await q("select 1 from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal")).length === 0);
  console.log(`      auth.users rows: ${(await q("select count(*)::int n from auth.users"))[0].n} (count only; no content read)`);
  // guard dry run: the guard only READS the catalogue, and this transaction is read-only and rolled back
  try {
    await client.query(readFileSync(join(migDir, "20261010100000_fresh_project_guard.sql"), "utf8"));
    gate("fresh-project guard PASSES on this target (dry run, read-only transaction)", true);
  } catch (e) {
    gate("fresh-project guard PASSES on this target (dry run, read-only transaction)", false, String(e.message).split("\n").slice(0, 4).join(" | "));
  }
} finally {
  await client.query("rollback").catch(() => {});
  await client.end().catch(() => {});
}
console.log(failed ? "\nPREFLIGHT FAILED: do not migrate." : "\nPREFLIGHT PASSED (read-only). Nothing has been applied. Waiting for your confirmation to migrate.");
process.exit(failed ? 1 : 0);
