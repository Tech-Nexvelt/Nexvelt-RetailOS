// Applies ONE further migration to a database that already holds the earlier ones. All checks happen before anything is written and the
// migration itself runs in a single transaction, so a failure leaves the database exactly as it was. Used by scripts/hosted-apply-next.mjs
// (TLS and the project-ref check live there) and tested directly against a local database.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { diagnosticSql, expectedObjects, verdicts } from "./diagnose-core.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");

/**
 * @param client       a connected pg client (superuser-like role that owns the migration's objects)
 * @param opts.root    repository root
 * @param opts.target  the 14-digit migration id to apply, e.g. "20261010100016"
 * @param opts.approvedManifest  the manifest hash (any prefix of 12+ hex chars) the owner approved. Required: there is no default.
 * @returns { ok: true, applied: file } or { ok: false, reason }
 */
export async function applyNext(client, { root, target, approvedManifest, log = () => {} }) {
  const sret = join(root, "supabase", "retailos");
  const migDir = join(sret, "migrations");
  if (!/^[0-9]{14}$/.test(target ?? "")) return { ok: false, reason: "target must be a 14-digit migration id" };
  if (!/^[0-9a-f]{12,64}$/.test(approvedManifest ?? "")) return { ok: false, reason: "the approved manifest hash (12+ hex characters) must be given explicitly" };

  // 1. the files are the approved ones
  const manifestBytes = readFileSync(join(sret, "MANIFEST.sha256"));
  const manifestHash = sha(manifestBytes);
  if (!manifestHash.startsWith(approvedManifest)) return { ok: false, reason: `MANIFEST.sha256 is ${manifestHash.slice(0, 12)}, not the approved ${approvedManifest}` };
  for (const line of manifestBytes.toString().trim().split("\n")) {
    const [h, f] = line.split(/\s+/);
    if (sha(readFileSync(join(sret, f))) !== h) return { ok: false, reason: `file differs from the manifest: ${f}` };
  }
  const files = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
  const file = files.find((f) => f.startsWith(target + "_"));
  if (!file) return { ok: false, reason: `no migration file for ${target}` };
  const sums = Object.fromEntries(readFileSync(join(migDir, "SHA256SUMS"), "utf8").trim().split("\n").map((l) => l.split(/\s+/).reverse()));
  const sql = readFileSync(join(migDir, file));
  if (sha(sql) !== sums[file]) return { ok: false, reason: `${file} does not match SHA256SUMS` };

  // 2. the database is in the exact state this migration expects: everything before it is fully there, it is completely absent
  const who = (await client.query("select current_user u, current_setting('server_version_num')::int v")).rows[0];
  if (who.v < 170000) return { ok: false, reason: `PostgreSQL ${who.v} is older than 17` };
  const objs = expectedObjects(migDir);
  const rows = (await client.query(diagnosticSql(objs))).rows;
  const v = verdicts(rows, files.map((f) => f.slice(0, 14)));
  const mine = v.find((x) => x.mig === target);
  if (!mine || mine.total === 0) return { ok: false, reason: `${target} creates nothing the catalogue can check; refusing to guess its state` };
  if (mine.present > 0) return { ok: false, reason: `${target} is already ${mine.present === mine.total ? "applied" : "PARTIALLY applied"} (${mine.present}/${mine.total} objects). Not touching it: inspect with scripts/hosted-diagnose.mjs.` };
  for (const x of v) {
    if (x.mig >= target || x.total === 0) continue; // later migrations do not exist yet; the guard (0 objects) cannot be checked
    if (x.present !== x.total) return { ok: false, reason: `an earlier migration is not fully applied: ${x.mig} (${x.present}/${x.total}). Fix that first.` };
  }
  log(`preconditions OK: ${v.filter((x) => x.mig < target && x.total > 0).length} earlier migrations fully present, ${target} absent`);

  // 3. apply in ONE transaction
  try {
    await client.query("begin");
    await client.query("set local lock_timeout = '10s'");
    await client.query(sql.toString("utf8"));
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    return { ok: false, reason: `migration failed and was rolled back: ${e.code ?? ""} ${String(e.message).split("\n")[0]}` };
  }

  // 4. confirm
  const after = verdicts((await client.query(diagnosticSql(objs))).rows, files.map((f) => f.slice(0, 14))).find((x) => x.mig === target);
  if (!after || after.present !== after.total) return { ok: false, reason: `applied, but only ${after?.present}/${after?.total} expected objects are present: run scripts/hosted-diagnose.mjs` };
  log(`${file}: ${after.present}/${after.total} expected objects present`);
  return { ok: true, applied: file, objects: after.total };
}
