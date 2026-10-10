// Shared by scripts/hosted-diagnose.mjs and tests/db/diagnostics-baseline.test.ts.
// Derives, from each migration's own SQL, the objects it creates, and renders ONE read-only SQL query that reports which of
// them exist in a database. Reads files only; this module never connects to anything.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const strip = (sql) => sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const id = "[a-z_][a-z_0-9]*";

/** statements split on ';' outside of $$ / $tag$ bodies and quotes (good enough for these files) */
function statements(sql) {
  const out = [];
  let cur = "";
  let i = 0;
  let dollar = null;
  let quote = false;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (dollar) {
      if (rest.startsWith(dollar)) {
        cur += dollar;
        i += dollar.length;
        dollar = null;
        continue;
      }
    } else if (!quote) {
      const m = rest.match(/^\$[A-Za-z_0-9]*\$/);
      if (m) {
        dollar = m[0];
        cur += dollar;
        i += dollar.length;
        continue;
      }
      if (sql[i] === "'") quote = true;
      else if (sql[i] === ";") {
        out.push(cur.trim());
        cur = "";
        i++;
        continue;
      }
    } else if (sql[i] === "'") {
      if (sql[i + 1] === "'") {
        cur += "''";
        i += 2;
        continue;
      }
      quote = false;
    }
    cur += sql[i++];
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** [{ mig, kind, sch, name, tbl }] for every checkable object one migration creates */
export function expectedObjects(migrationsDir) {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const objs = [];
  for (const f of files) {
    const mig = f.slice(0, 14);
    const add = (kind, sch, name, tbl = "") => objs.push({ mig, file: f, kind, sch, name, tbl });
    // a later `drop …` removes the object from the expectation: the diagnostic checks the NET result, in migration order
    const forget = (pred) => {
      for (let k = objs.length - 1; k >= 0; k--) if (pred(objs[k])) objs.splice(k, 1);
    };
    for (const st of statements(strip(readFileSync(join(migrationsDir, f), "utf8")))) {
      let m;
      if ((m = st.match(new RegExp(`^drop\\s+policy\\s+(?:if\\s+exists\\s+)?"?(${id})"?\\s+on\\s+(${id})\\.(${id})`, "i")))) forget((o) => o.kind === "policy" && o.name === m[1] && o.sch === m[2] && o.tbl === m[3]);
      else if ((m = st.match(new RegExp(`^drop\\s+trigger\\s+(?:if\\s+exists\\s+)?(${id})\\s+on\\s+(${id})\\.(${id})`, "i")))) forget((o) => o.kind === "trigger" && o.name === m[1] && o.sch === m[2] && o.tbl === m[3]);
      else if ((m = st.match(new RegExp(`^drop\\s+function\\s+(?:if\\s+exists\\s+)?(${id})\\.(${id})`, "i")))) forget((o) => o.kind === "function" && o.sch === m[1] && o.name === m[2]);
      else if ((m = st.match(new RegExp(`^drop\\s+table\\s+(?:if\\s+exists\\s+)?(${id})\\.(${id})`, "i")))) forget((o) => o.sch === m[1] && (o.name === m[2] || o.tbl === m[2]));
      else if ((m = st.match(new RegExp(`^drop\\s+index\\s+(?:if\\s+exists\\s+)?(${id})\\.(${id})`, "i")))) forget((o) => o.kind === "index" && o.sch === m[1] && o.name === m[2]);
      else if ((m = st.match(new RegExp(`^alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(${id})\\.(${id})\\s+([\\s\\S]*)$`, "i"))) && /drop\s+column/i.test(m[3])) {
        for (const c of m[3].matchAll(new RegExp(`drop\\s+column\\s+(?:if\\s+exists\\s+)?(${id})`, "gi"))) forget((o) => o.kind === "column" && o.sch === m[1] && o.tbl === m[2] && o.name === c[1]);
      }
      if ((m = st.match(new RegExp(`^create\\s+schema\\s+(?:if\\s+not\\s+exists\\s+)?(${id})`, "i")))) add("schema", "", m[1]);
      else if ((m = st.match(new RegExp(`^create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(${id})\\.(${id})`, "i")))) add("table", m[1], m[2]);
      else if ((m = st.match(new RegExp(`^create\\s+(?:or\\s+replace\\s+)?function\\s+(${id})\\.(${id})\\s*\\(`, "i")))) add("function", m[1], m[2]);
      else if ((m = st.match(new RegExp(`^create\\s+(?:or\\s+replace\\s+)?(?:constraint\\s+)?trigger\\s+(${id})[\\s\\S]*?\\bon\\s+(${id})\\.(${id})`, "i")))) add("trigger", m[2], m[1], m[3]);
      else if ((m = st.match(new RegExp(`^create\\s+policy\\s+"?(${id})"?\\s+on\\s+(${id})\\.(${id})`, "i")))) add("policy", m[2], m[1], m[3]);
      else if ((m = st.match(new RegExp(`^create\\s+(?:unique\\s+)?index\\s+(?:if\\s+not\\s+exists\\s+)?(${id})\\s+on\\s+(${id})\\.(${id})`, "i")))) add("index", m[2], m[1], m[3]);
      else if ((m = st.match(new RegExp(`^create\\s+type\\s+(${id})\\.(${id})`, "i")))) add("type", m[1], m[2]);
      else if ((m = st.match(new RegExp(`^create\\s+(?:or\\s+replace\\s+)?view\\s+(${id})\\.(${id})`, "i")))) add("view", m[1], m[2]);
      else if ((m = st.match(new RegExp(`^create\\s+sequence\\s+(?:if\\s+not\\s+exists\\s+)?(${id})\\.(${id})`, "i")))) add("sequence", m[1], m[2]);
      else if ((m = st.match(new RegExp(`^alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(${id})\\.(${id})\\s+([\\s\\S]*)$`, "i")))) {
        const [, sch, tbl, rest] = m;
        for (const c of rest.matchAll(new RegExp(`add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?(${id})`, "gi"))) add("column", sch, c[1], tbl);
        if (/enable\s+row\s+level\s+security/i.test(rest)) add("rls", sch, tbl);
      } else if ((m = st.match(new RegExp(`^insert\\s+into\\s+(${id})\\.(${id})`, "i")))) add("rows", m[1], m[2]);
    }
  }
  // the same object listed twice in one migration (e.g. `insert` into one table in several statements) is one check
  const seen = new Set();
  return objs.filter((o) => {
    const k = [o.mig, o.kind, o.sch, o.name, o.tbl].join("|");
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** One read-only SELECT: one row per expected object with present = true/false. */
export function diagnosticSql(objs) {
  const values = objs.map((o) => `(${lit(o.mig)}, ${lit(o.kind)}, ${lit(o.sch)}, ${lit(o.name)}, ${lit(o.tbl)})`).join(",\n    ");
  return `with expected(mig, kind, sch, name, tbl) as (values
    ${values}
)
select e.mig, e.kind, e.sch, e.name, e.tbl,
  case e.kind
    when 'schema'   then exists (select 1 from pg_namespace where nspname = e.name)
    when 'table'    then exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = e.sch and c.relname = e.name and c.relkind in ('r','p'))
    when 'view'     then exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = e.sch and c.relname = e.name and c.relkind in ('v','m'))
    when 'sequence' then exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = e.sch and c.relname = e.name and c.relkind = 'S')
    when 'function' then exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = e.sch and p.proname = e.name)
    when 'type'     then exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = e.sch and t.typname = e.name)
    when 'trigger'  then exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = e.sch and c.relname = e.tbl and g.tgname = e.name and not g.tgisinternal)
    when 'policy'   then exists (select 1 from pg_policies p where p.schemaname = e.sch and p.tablename = e.tbl and p.policyname = e.name)
    when 'index'    then exists (select 1 from pg_indexes i where i.schemaname = e.sch and i.indexname = e.name)
    when 'column'   then exists (select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = e.sch and c.relname = e.tbl and a.attname = e.name and a.attnum > 0 and not a.attisdropped)
    when 'rls'      then exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = e.sch and c.relname = e.name and c.relrowsecurity)
    when 'rows'     then coalesce(to_regclass(e.sch || '.' || e.name) is not null
                         and (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', e.sch, e.name), false, true, '')))[1]::text::bigint > 0, false)
  end as present
from expected e
order by e.mig, e.kind, e.sch, e.name, e.tbl`;
}

/** per-migration verdict from the rows returned by diagnosticSql */
export function verdicts(rows, allMigrations) {
  const by = new Map(allMigrations.map((m) => [m, { mig: m, total: 0, present: 0, missing: [] }]));
  for (const r of rows) {
    const v = by.get(r.mig);
    v.total++;
    if (r.present) v.present++;
    else v.missing.push(`${r.kind} ${r.sch ? r.sch + "." : ""}${r.tbl ? r.tbl + "." : ""}${r.name}`);
  }
  return [...by.values()].map((v) => ({
    ...v,
    status: v.total === 0 ? "UNDETERMINABLE (creates nothing the catalogue can show)" : v.present === v.total ? "CONFIRMED (all objects present)" : v.present === 0 ? "MISSING (no objects present)" : "PARTIAL",
  }));
}

/** function name+args -> md5 of its full definition, computed in one catalogue query */
export const functionHashSql = `select p.oid::regprocedure::text || '|' || md5(pg_get_functiondef(p.oid)) as l
from pg_proc p where p.pronamespace in ('retailos'::regnamespace, 'retailos_private'::regnamespace) order by 1`;

/** per-migration counts, built on diagnosticSql */
export const summarySql = (objs) => `select mig, count(*) as expected_objects, count(*) filter (where present) as present,
  count(*) filter (where not present) as missing,
  left(string_agg(kind || ' ' || case when sch <> '' then sch || '.' else '' end || case when tbl <> '' then tbl || '.' else '' end || name, '; ' order by kind, name) filter (where not present), 600) as first_missing
from (
${diagnosticSql(objs)}
) d
group by mig order by mig`;

/** compares installed function definitions with the baseline captured from a fully migrated LOCAL database */
export function functionCompareSql(expectedLines) {
  const values = expectedLines.map((l) => {
    const i = l.lastIndexOf("|");
    return `(${lit(l.slice(0, i))}, ${lit(l.slice(i + 1))})`;
  });
  return `with expected(sig, hash) as (values
    ${values.join(",\n    ")}
), actual as (
  select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as hash
  from pg_proc p where p.pronamespace in ('retailos'::regnamespace, 'retailos_private'::regnamespace)
)
select coalesce(e.sig, a.sig) as function,
  case when a.sig is null then 'MISSING' when e.sig is null then 'UNEXPECTED' when a.hash = e.hash then 'ok' else 'DIFFERENT DEFINITION' end as status
from expected e full join actual a on a.sig = e.sig
where a.sig is null or e.sig is null or a.hash <> e.hash
order by 2, 1`;
}

/** which migration defines (last) each function, from the migration files */
export function lastDefiningMigration(objs) {
  const m = new Map();
  for (const o of objs) if (o.kind === "function") m.set(`${o.sch}.${o.name}`, o.mig);
  return m;
}
