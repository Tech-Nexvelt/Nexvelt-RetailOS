// Regenerates supabase/retailos/verify/expected_inventory.txt and supabase/retailos/rollback.sql from a freshly migrated
// LOCAL embedded database (never a hosted one). Review the git diff before committing: it is the approved shape of the schema.
//   npm run retailos:verify:update
import { spawnSync } from "node:child_process";
const r = spawnSync("npx", ["vitest", "run", "-c", "vitest.db.config.mts", "tests/db/dedicated-project.test.ts"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, UPDATE_VERIFY: "1" },
});
process.exit(r.status ?? 1);
