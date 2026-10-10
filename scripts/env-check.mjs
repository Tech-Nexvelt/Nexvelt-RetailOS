// Validates the environment variables the app needs, WITHOUT printing any value.
//   node scripts/env-check.mjs                        checks .env.local (if present) merged under the real environment
//   NODE_ENV=production node scripts/env-check.mjs    adds production-only rules
// Output is only OK / PROBLEM with a reason. Key payloads are decoded only to read the public "role" claim.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const jwtRole = (v) => {
  try {
    return JSON.parse(Buffer.from(v.split(".")[1], "base64url").toString("utf8")).role ?? null;
  } catch {
    return null;
  }
};
const isHttps = (v) => {
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
};
const host = (v) => {
  try {
    return new URL(v).hostname;
  } catch {
    return "";
  }
};

export function checkEnv(env, production = false) {
  const r = [];
  const add = (name, ok, detail) => r.push({ name, ok, detail });
  const backend = env.BILLING_BACKEND;
  add("BILLING_BACKEND", backend === "supabase", backend === "supabase" ? "supabase" : backend === "demo" ? "demo is refused in production (development only)" : "must be exactly 'supabase'");

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const urlOk = !!url && /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url);
  add("NEXT_PUBLIC_SUPABASE_URL", urlOk, !url ? "MISSING" : urlOk ? "OK (https://<ref>.supabase.co)" : "INVALID: expected https://<project-ref>.supabase.co");

  const pub = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const pubName = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" : "NEXT_PUBLIC_SUPABASE_ANON_KEY";
  if (!pub) add("publishable/anon key", false, "MISSING (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY)");
  else if (pub.length < 20) add(pubName, false, "INVALID: too short");
  else if (pub.startsWith("sb_secret_") || jwtRole(pub) === "service_role") add(pubName, false, "DANGER: this is a SECRET/service-role key in a browser-visible variable. Replace it with the publishable/anon key and rotate the secret");
  else add(pubName, true, pub.startsWith("sb_publishable_") ? "OK (publishable key)" : jwtRole(pub) === "anon" ? "OK (legacy anon JWT, role=anon)" : "OK (format not recognised, but not a secret key)");

  const site = env.NEXT_PUBLIC_SITE_URL;
  const local = ["localhost", "127.0.0.1"].includes(host(site ?? ""));
  if (!site) add("NEXT_PUBLIC_SITE_URL", false, "MISSING (required: email links are built from it)");
  else if (production) add("NEXT_PUBLIC_SITE_URL", isHttps(site) && !local, isHttps(site) && !local ? "OK (https, not localhost)" : "INVALID for production: must be the public https URL, not localhost");
  else add("NEXT_PUBLIC_SITE_URL", !!host(site), host(site) ? "OK" : "INVALID: not a URL");

  const sec = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  const secName = env.SUPABASE_SECRET_KEY ? "SUPABASE_SECRET_KEY" : "SUPABASE_SERVICE_ROLE_KEY";
  const secOk = !!sec && sec !== pub && sec.length >= 20 && (sec.startsWith("sb_secret_") || jwtRole(sec) === "service_role");
  if (!sec) add("server secret key", false, "MISSING (SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY; needed to invite staff)");
  else if (sec === pub) add(secName, false, "INVALID: identical to the public key");
  else add(secName, secOk, secOk ? "OK (server-only secret)" : "INVALID: not a secret/service-role key");

  // Phone scanner (optional feature): when the signing secret is absent the feature stays off (fail closed); when present it must be strong.
  const scan = env.SCANNER_PAIRING_SECRET;
  if (!scan) add("SCANNER_PAIRING_SECRET", true, "not set: the phone scanner is OFF (set a 32+ character random value to enable it)");
  else add("SCANNER_PAIRING_SECRET", scan.length >= 32 && scan !== sec && scan !== pub, scan.length >= 32 ? "OK (server-only signing secret)" : "INVALID: shorter than 32 characters");

  const exposed = Object.keys(env).filter((k) => k.startsWith("NEXT_PUBLIC_") && /(service[_-]?role|secret|private[_-]?key|password|jwt[_-]?secret)/i.test(k));
  add("no secret-looking NEXT_PUBLIC_ variable", exposed.length === 0, exposed.length ? `DANGER: ${exposed.join(", ")} would be shipped to browsers` : "OK");
  return r;
}

function loadDotenv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = { ...loadDotenv(join(process.cwd(), ".env.local")), ...process.env };
  const res = checkEnv(env, process.env.NODE_ENV === "production");
  for (const x of res) console.log(`${x.ok ? "OK     " : "PROBLEM"}  ${x.name}: ${x.detail}`);
  const bad = res.filter((x) => !x.ok).length;
  console.log(bad ? `\n${bad} problem(s). Values were not printed.` : "\nAll variables present and well-formed. Values were not printed.");
  process.exit(bad ? 1 : 0);
}
