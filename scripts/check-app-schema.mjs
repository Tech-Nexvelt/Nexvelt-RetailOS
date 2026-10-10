// LOCAL, offline compatibility check: does the application code only use tables, columns, RPCs and RPC argument names that the
// APPROVED schema defines? Reads files only; never connects to a database and applies nothing.
//   npm run schema:app-check
// Sources of truth: supabase/retailos/verify/expected_inventory.txt (tables, columns) and supabase/retailos/migrations/*.sql (functions).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const walk = (d) =>
  readdirSync(join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const sources = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));

const tables = new Map();
for (const l of read("supabase/retailos/verify/expected_inventory.txt").split("\n")) {
  const m = l.match(/^column\|retailos\.([a-z_]+)\.([a-z_0-9]+)\|/);
  if (m) (tables.get(m[1]) ?? tables.set(m[1], new Set()).get(m[1])).add(m[2]);
}
const fns = new Map();
for (const f of readdirSync(join(root, "supabase/retailos/migrations")).filter((x) => x.endsWith(".sql"))) {
  const sql = read(join("supabase/retailos/migrations", f)).replace(/--.*$/gm, "");
  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+retailos\.([a-z_]+)\s*\(([\s\S]*?)\)\s*returns/gi)) {
    const parts = m[2].split(",").map((p) => p.trim()).filter(Boolean);
    fns.set(m[1], { params: parts.map((p) => p.split(/\s+/)[0]), required: parts.filter((p) => !/\bdefault\b/i.test(p)).map((p) => p.split(/\s+/)[0]) });
  }
}

/** text of a balanced (...) or {...} group starting at index `open` of src */
const group = (src, open) => {
  const pair = { "(": ")", "{": "}" }[src[open]];
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === src[open]) depth++;
    else if (src[i] === pair && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
};

const problems = [];
let columnRefs = 0;
let rpcCalls = 0;
for (const f of sources) {
  const src = readFileSync(join(root, f), "utf8");
  const starts = [...src.matchAll(/\.from\(\s*["']([a-z_]+)["']\s*\)/g)];
  starts.forEach((m, i) => {
    const cols = tables.get(m[1]);
    if (!cols) return;
    const from = m.index + m[0].length;
    let end = src.indexOf(";", from);
    const next = i + 1 < starts.length ? starts[i + 1].index : -1;
    if (end < 0 || (next >= 0 && next < end)) end = next;
    const body = src.slice(from, end < 0 ? undefined : end);
    const names = new Set();
    for (const s of body.matchAll(/\.select\(\s*["'`]([^"'`]*)["'`]/g)) {
      let depth = 0;
      let cur = "";
      const top = [];
      for (const ch of s[1]) {
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (ch === "," && depth === 0) {
          top.push(cur);
          cur = "";
        }
        else if (depth === 0) cur += ch;
      }
      top.push(cur);
      for (let c of top) {
        c = c.trim();
        if (c.includes(":")) c = c.split(":").pop().trim();
        if (/^[a-z_0-9]+$/.test(c)) names.add(c);
      }
    }
    for (const s of body.matchAll(/\.(?:eq|neq|gt|gte|lt|lte|in|is|ilike|like|order|not)\(\s*["']([a-z_0-9]+)["']/g)) names.add(s[1]);
    for (const n of names) {
      columnRefs++;
      if (!cols.has(n)) problems.push(`${f.replace(/\\/g, "/")}: column ${m[1]}.${n} is not in the approved inventory`);
    }
  });
  for (const m of src.matchAll(/\.(?:rpc|call)(?:<[^>]*>)?\(\s*["']([a-z_]+)["']\s*,\s*\{/g)) {
    const def = fns.get(m[1]);
    if (!def) continue; // a different .call() (not an RPC)
    rpcCalls++;
    const open = m.index + m[0].length - 1;
    const args = group(src, open);
    // top-level keys only (depth 0), so nested JSON payload keys are not mistaken for arguments
    let depth = 0;
    let seg = "";
    const keys = [];
    for (const ch of args + ",") {
      if ("({[".includes(ch)) depth++;
      else if (")}]".includes(ch)) depth--;
      if (ch === "," && depth === 0) {
        const k = seg.trim().match(/^(p_[a-z_0-9]+)\b/);
        if (k) keys.push(k[1]);
        seg = "";
      } else seg += ch;
    }
    const injected = f.endsWith("supabase-backend.ts") ? ["p_branch"] : []; // call() adds p_branch for every POS RPC
    const all = [...keys, ...injected];
    for (const k of keys) if (!def.params.includes(k)) problems.push(`${f.replace(/\\/g, "/")}: rpc ${m[1]} has no parameter ${k}`);
    for (const k of def.required) if (!all.includes(k)) problems.push(`${f.replace(/\\/g, "/")}: rpc ${m[1]} is missing required parameter ${k}`);
  }
}
const rpcNames = new Set();
for (const f of sources) for (const m of readFileSync(join(root, f), "utf8").matchAll(/\.rpc\(\s*["']([a-z_]+)["']/g)) rpcNames.add(m[1]);
for (const n of rpcNames) if (!fns.has(n)) problems.push(`rpc ${n} is called but no migration defines retailos.${n}`);

console.log(`Checked ${columnRefs} column references and ${rpcCalls} RPC calls (${rpcNames.size} distinct RPCs called directly) against the approved schema.`);
if (problems.length) {
  for (const p of problems) console.log("PROBLEM  " + p);
  process.exit(1);
}
console.log("OK  application code is compatible with the approved schema (offline check; the hosted database is verified separately).");
