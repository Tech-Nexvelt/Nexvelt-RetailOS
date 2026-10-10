// READ-ONLY verification of the hosted RetailOS database after the migrations.
//   node scripts/hosted-verify.mjs
// Runs verify/post_checks.sql (every query must return zero rows), compares verify/inventory.sql with
// verify/expected_inventory.txt, probes anonymous denial inside a rolled-back transaction, and (with a token) reads the
// Data API exposed-schema setting. Prints PASS/FAIL only; never a secret or a business row.
import { existsSync, readFileSync } from "node:fs";
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
};
const ref = env.RETAILOS_SUPABASE_PROJECT_REF ?? "";
const dbUrl = env.RETAILOS_DATABASE_URL ?? "";
if (!ref || !dbUrl) {
  console.error("BLOCKED: RETAILOS_SUPABASE_PROJECT_REF and RETAILOS_DATABASE_URL are required");
  process.exit(1);
}
const u = new URL(dbUrl);
if (!(u.hostname.includes(ref) || decodeURIComponent(u.username).endsWith("." + ref))) {
  console.error("ABORT: connection string does not carry the expected project ref");
  process.exit(1);
}
const verify = join(root, "supabase", "retailos", "verify");
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: true, ...(env.RETAILOS_DB_CA_FILE ? { ca: readFileSync(env.RETAILOS_DB_CA_FILE, "utf8") } : {}) }, connectionTimeoutMillis: 20000, statement_timeout: 60000 });
await client.connect();
try {
  await client.query("begin read only");
  // 1. post-checks: every named query returns zero rows
  const text = readFileSync(join(verify, "post_checks.sql"), "utf8");
  const checks = [...text.matchAll(/-- @query (\w+)\n([\s\S]*?)(?=\n-- @query |\n-- The ONLY|$)/g)].map((m) => [m[1], m[2].trim().replace(/;\s*$/, "")]);
  for (const [name, sql] of checks) {
    const rows = (await client.query(sql)).rows;
    gate(`post-check ${name} returns zero rows`, rows.length === 0, rows.length ? `${rows.length} row(s): ${rows.slice(0, 5).map((r) => r.problem).join(", ")}` : "");
  }
  gate("at least 10 post-checks ran", checks.length >= 10, `${checks.length} ran`);
  // 2. inventory equals the approved expected inventory
  const actual = (await client.query(readFileSync(join(verify, "inventory.sql"), "utf8"))).rows.map((r) => r.l).sort();
  const expected = readFileSync(join(verify, "expected_inventory.txt"), "utf8").trim().split("\n").sort();
  const missing = expected.filter((l) => !actual.includes(l));
  const unexpected = actual.filter((l) => !expected.includes(l));
  for (const l of missing.slice(0, 10)) console.log("      MISSING     " + l.slice(0, 150));
  for (const l of unexpected.slice(0, 10)) console.log("      UNEXPECTED  " + l.slice(0, 150));
  gate("schema inventory matches expected_inventory.txt", !missing.length && !unexpected.length, `${actual.length} lines, ${missing.length} missing, ${unexpected.length} unexpected`);
  // 3. migration marker
  const mk = (await client.query("select app, schema_version, migration_set from retailos.schema_info")).rows;
  gate("schema marker present (retailos / 1 / dedicated-project-v1)", mk.length === 1 && mk[0].app === "retailos" && mk[0].schema_version === 1 && mk[0].migration_set === "dedicated-project-v1");
  await client.query("rollback");
  // 4. anonymous and signed-in-without-membership denial, each probe rolled back
  const denied = async (role, sql, claims) => {
    await client.query("begin");
    try {
      await client.query(`set local role ${role}`);
      if (claims) await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
      await client.query("savepoint p");
      try {
        const r = await client.query(sql);
        return r.rows.length === 0 ? "empty" : "DATA";
      } catch (e) {
        return e.code === "42501" ? "denied" : "error:" + e.code;
      }
    } finally {
      await client.query("rollback");
    }
  };
  const tables = (await client.query("select relname from pg_class where relnamespace='retailos'::regnamespace and relkind in ('r','p') order by 1")).rows.map((r) => r.relname);
  let anonLeaks = 0;
  for (const t of tables) if ((await denied("anon", `select 1 from retailos.${t} limit 1`)) === "DATA") anonLeaks++;
  gate(`anon cannot read any of ${tables.length} tables`, anonLeaks === 0 && tables.length > 0);
  const stranger = JSON.stringify({ sub: "00000000-0000-4000-8000-000000000001", role: "authenticated", aal: "aal1" });
  let strangerLeaks = 0;
  const catalogue = new Set(["permissions", "roles", "role_permissions"]); // global permission catalogue: readable by design, no tenant data
  const leaked = [];
  for (const t of tables) if (!catalogue.has(t) && (await denied("authenticated", `select 1 from retailos.${t} limit 1`, stranger)) === "DATA") leaked.push(t);
  strangerLeaks = leaked.length;
  gate("a signed-in user with no membership sees no rows in any tenant table (catalogue tables excluded)", strangerLeaks === 0, leaked.join(", "));
  gate("anon has no usage on retailos / retailos_private", (await client.query("select has_schema_privilege('anon','retailos','usage') a, has_schema_privilege('anon','retailos_private','usage') b")).rows.every((r) => !r.a && !r.b));
  // NOT asserted: 'authenticated' needs USAGE on retailos_private so RLS helper functions can run; the approved inventory pins it (authenticated=true)
  // and the helpers' execute rights are pinned there too. What matters is that retailos_private is not exposed through the Data API (checked below).
} finally {
  await client.query("rollback").catch(() => {});
  await client.end().catch(() => {});
}
// 5. Data API exposure (needs the Management API token; read-only GET)
const token = process.argv.includes("--db-only") ? "" : (env.SUPABASE_ACCESS_TOKEN ?? "");
if (token) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/postgrest`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  if (res.ok) {
    const cfg = await res.json();
    const schemas = String(cfg.db_schema ?? "").split(",").map((s) => s.trim());
    console.log(`      exposed schemas: ${schemas.join(", ")}`);
    gate("Data API exposes 'retailos'", schemas.includes("retailos"), schemas.includes("retailos") ? "" : "dashboard action still required");
    gate("Data API does NOT expose 'retailos_private'", !schemas.includes("retailos_private"));
  } else console.log(`BLOCKED  Data API setting could not be read (HTTP ${res.status})`);
} else console.log("BLOCKED  Data API exposure not checked (no Management API access in this run); verify 'retailos' exposure in the dashboard");
console.log(failed ? "\nVERIFICATION FAILED." : "\nVERIFICATION PASSED for everything that ran.");
process.exit(failed ? 1 : 0);
