// Runs supabase/retailos/demo/demo-catalogue.sql against the database in RETAILOS_DATABASE_URL (TLS verified, project ref checked).
//   node scripts/run-demo-catalogue.mjs            show the current state only (read-only)
//   node scripts/run-demo-catalogue.mjs --run      execute the SQL file as one batch (it manages its own transaction)
// Prints counts only; never a credential.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
const root = join(import.meta.dirname, "..");
const env = { ...process.env };
if (existsSync(join(root, ".env.local"))) for (const l of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && m[2] !== "" && env[m[1]] === undefined) env[m[1]] = m[2]; }
const ref = env.RETAILOS_SUPABASE_PROJECT_REF ?? "";
const url = env.RETAILOS_DATABASE_URL ?? "";
const die = (m) => { console.error("ABORT: " + m); process.exit(1); };
if (!/^[a-z0-9]{20}$/.test(ref) || !url) die("RETAILOS_SUPABASE_PROJECT_REF and RETAILOS_DATABASE_URL are required");
const u = new URL(url);
if (!(u.hostname.includes(ref) || decodeURIComponent(u.username).endsWith("." + ref))) die("connection string does not carry the expected project ref");
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true, ...(env.RETAILOS_DB_CA_FILE ? { ca: readFileSync(env.RETAILOS_DB_CA_FILE, "utf8") } : {}) }, connectionTimeoutMillis: 20000, statement_timeout: 120000 });
await c.connect();
const state = async () => (await c.query(`select (select count(*)::int from retailos.tenants) tenants, (select count(*)::int from retailos.products) products, (select count(*)::int from retailos.product_variants) variants,
  (select coalesce(sum(on_hand),0)::int from retailos.inventory_balances) pieces, (select count(*)::int from retailos.jewellery_items) jewellery, (select count(*)::int from retailos.barcode_aliases) barcodes,
  (select count(*)::int from retailos.invoices) invoices, (select count(*)::int from retailos.categories) categories`)).rows[0];
try {
  console.log("before:", JSON.stringify(await state()));
  if (process.argv.includes("--run")) {
    const sql = readFileSync(join(root, "supabase", "retailos", "demo", "demo-catalogue.sql"), "utf8");
    try {
      await c.query(sql);
      console.log("demo-catalogue.sql executed.");
    } catch (e) {
      await c.query("rollback").catch(() => {});
      console.error("FAILED (rolled back):", e.code, String(e.message).split("\n")[0]);
      process.exitCode = 1;
    }
    console.log("after: ", JSON.stringify(await state()));
  } else console.log("(read-only: pass --run to execute)");
} finally {
  await c.end().catch(() => {});
}
