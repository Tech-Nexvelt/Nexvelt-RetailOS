// Compares the output of supabase/retailos/verify/inventory.sql (run against the NEW project) with expected_inventory.txt.
//   psql -At -f supabase/retailos/verify/inventory.sql > inventory-actual.txt
//   node scripts/verify-schema.mjs inventory-actual.txt
// Prints exactly which lines are MISSING or UNEXPECTED. Exit 1 on any difference. Reads files only; connects to nothing.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const lines = (f) => readFileSync(f, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const actualFile = process.argv[2];
if (!actualFile) {
  console.error("usage: node scripts/verify-schema.mjs <inventory-actual.txt>");
  process.exit(2);
}
const expected = lines(join(import.meta.dirname, "..", "supabase", "retailos", "verify", "expected_inventory.txt"));
const actual = lines(actualFile);
const missing = expected.filter((l) => !actual.includes(l));
const unexpected = actual.filter((l) => !expected.includes(l));
for (const l of missing) console.log("MISSING     " + l);
for (const l of unexpected) console.log("UNEXPECTED  " + l);
console.log(missing.length || unexpected.length ? `SCHEMA DIFFERS (${missing.length} missing, ${unexpected.length} unexpected)` : `Schema matches the expected inventory (${expected.length} lines)`);
process.exit(missing.length || unexpected.length ? 1 : 0);
