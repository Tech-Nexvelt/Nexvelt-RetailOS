// Checks that a pg_dump backup (custom format) actually contains what the live project has, WITHOUT restoring it.
// It reads TEXT you generate from the dump; it never connects to a database and never sees credentials.
//
//   pg_restore --list backup.dump > listing.txt                              (structure: tables, functions, policies, ...)
//   pg_restore --data-only --file=data.sql backup.dump                       (data as COPY blocks)
//   psql ... --csv -f supabase/retailos/verify/row_counts.sql > counts.csv   (live row counts, taken at backup time)
//   node scripts/verify-backup.mjs --listing listing.txt [--data data.sql --counts counts.csv]
//
// Expected object counts come from the 2026-10-10 live audit (override with --expect-json file).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const EXPECTED = { tables: 39, views: 5, functions: 19, policies: 58, rowSecurity: 39, tableData: 39, triggers: 18 };
export const LIVE_RETAILOS_TABLES = [
  "retailos_tenants", "retailos_branches", "retailos_memberships", "retailos_products", "retailos_product_variants",
  "retailos_inventory", "retailos_inventory_ledger", "retailos_sales", "retailos_sale_items", "retailos_payments",
];
const SCHEMAS = new Set(["public", "cms", "auth_custom", "retailos"]);
const TYPES = ["TABLE DATA", "MATERIALIZED VIEW", "ROW SECURITY", "FK CONSTRAINT", "DEFAULT ACL", "TABLE", "VIEW", "FUNCTION", "POLICY", "TRIGGER", "ACL", "SCHEMA", "INDEX", "CONSTRAINT"];

export function parseListing(text) {
  const entries = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\d+;\s+\d+\s+\d+\s+(.+)$/);
    if (!m) continue;
    const rest = m[1];
    const type = TYPES.find((t) => rest === t || rest.startsWith(t + " "));
    if (!type) continue;
    const parts = rest.slice(type.length).trim().split(/\s+/);
    entries.push({ type, schema: parts[0] ?? "", name: parts[1] ?? "", rest });
  }
  return entries;
}

export function checkListing(text, expected = EXPECTED) {
  const e = parseListing(text);
  const mine = (t) => e.filter((x) => x.type === t && SCHEMAS.has(x.schema));
  const results = [];
  const eq = (name, got, want) => results.push({ name, ok: got === want, detail: `found ${got}, expected ${want}` });
  eq("tables (structure)", mine("TABLE").length, expected.tables);
  eq("tables (data entries)", mine("TABLE DATA").length, expected.tableData);
  eq("views", mine("VIEW").length, expected.views);
  eq("functions", mine("FUNCTION").length, expected.functions);
  eq("RLS policies", mine("POLICY").length, expected.policies);
  eq("row-level-security flags", mine("ROW SECURITY").length, expected.rowSecurity);
  eq("triggers on application tables", mine("TRIGGER").length, expected.triggers);
  const aclCount = e.filter((x) => x.type === "ACL" && (SCHEMAS.has(x.schema) || x.schema === "-")).length;
  results.push({ name: "grants (ACL entries)", ok: aclCount > 0, detail: `found ${aclCount}, expected at least 1 (a dump without grants cannot restore access rules)` });
  const defAcl = e.filter((x) => x.type === "DEFAULT ACL").length;
  results.push({ name: "default privileges", ok: defAcl > 0, detail: `found ${defAcl}, expected at least 1` });
  const names = new Set(mine("TABLE").map((x) => x.name));
  const missing = LIVE_RETAILOS_TABLES.filter((t) => !names.has(t));
  results.push({ name: "the 10 existing retailos_* tables", ok: missing.length === 0, detail: missing.length ? `missing: ${missing.join(", ")}` : "all present" });
  const authTrigger = e.some((x) => x.type === "TRIGGER" && x.rest.includes("trg_on_auth_user_created"));
  results.push({
    name: "Tirumala auth trigger trg_on_auth_user_created",
    ok: true,
    warn: !authTrigger,
    detail: authTrigger ? "present" : "NOT in this dump (the auth schema was not included): record its definition separately or include schema auth",
  });
  return results;
}

export function parseCopyCounts(sql) {
  const counts = {};
  let current = null;
  for (const line of sql.split(/\r?\n/)) {
    const m = line.match(/^COPY\s+("?[\w$]+"?\.)?("?[\w$]+"?)\s*(\(.*\))?\s+FROM stdin;/);
    if (m) {
      const schema = (m[1] ?? "public.").replace(/"/g, "").replace(/\.$/, "");
      current = `${schema}.${m[2].replace(/"/g, "")}`;
      counts[current] = 0;
    } else if (current && line === "\\.") current = null;
    else if (current) counts[current]++;
  }
  return counts;
}

export function parseCountsCsv(csv) {
  const out = {};
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const m = line.match(/^"?([^",]+)"?,(\d+)\s*$/);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

export function checkData(dumpCounts, liveCounts) {
  const results = [];
  for (const [tbl, want] of Object.entries(liveCounts)) {
    const got = dumpCounts[tbl] ?? 0;
    results.push({ name: `rows ${tbl}`, ok: got === want, detail: `dump ${got}, live ${want}` });
  }
  return results;
}

function main() {
  const arg = (n) => {
    const i = process.argv.indexOf(n);
    return i > -1 ? process.argv[i + 1] : undefined;
  };
  const listing = arg("--listing");
  if (!listing) {
    console.error("usage: node scripts/verify-backup.mjs --listing listing.txt [--data data.sql --counts counts.csv]");
    process.exit(2);
  }
  const expected = arg("--expect-json") ? JSON.parse(readFileSync(arg("--expect-json"), "utf8")) : EXPECTED;
  let results = checkListing(readFileSync(listing, "utf8"), expected);
  if (arg("--data") && arg("--counts")) {
    results = results.concat(checkData(parseCopyCounts(readFileSync(arg("--data"), "utf8")), parseCountsCsv(readFileSync(arg("--counts"), "utf8"))));
  } else console.log("NOTE: data rows not compared (give --data and --counts).");
  for (const r of results) console.log(`${r.ok ? (r.warn ? "WARN" : "PASS") : "FAIL"}  ${r.name}: ${r.detail}`);
  const bad = results.filter((r) => !r.ok).length;
  console.log(bad ? `\n${bad} check(s) FAILED. Do not treat this file as a usable backup.` : "\nAll checks passed. This confirms the dump's CONTENT, not that a restore has been rehearsed.");
  process.exit(bad ? 1 : 0);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
