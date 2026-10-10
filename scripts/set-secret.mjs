// Safely stores a credential in .env.local (git-ignored). Run it in YOUR OWN terminal: input is hidden, nothing is echoed,
// logged or committed, and the value never appears in chat.
//   node scripts/set-secret.mjs token     prompts for the NEW Supabase access token  -> SUPABASE_ACCESS_TOKEN
//   node scripts/set-secret.mjs dburl     prompts for the NEW database password       -> RETAILOS_DATABASE_URL (session pooler,
//                                         percent-encoded, built for the project ref in .env.local)
//   node scripts/set-secret.mjs ca <path> records the path of the Supabase CA file    -> RETAILOS_DB_CA_FILE (verification stays ON)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const file = join(import.meta.dirname, "..", ".env.local");
try {
  execFileSync("git", ["check-ignore", "-q", ".env.local"], { cwd: join(import.meta.dirname, "..") });
} catch {
  console.error("ABORT: .env.local is not git-ignored here");
  process.exit(1);
}
const get = (k) => (readFileSync(file, "utf8").match(new RegExp(`^${k}=(.*)$`, "m")) ?? [])[1] ?? "";
const set = (k, v) => {
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const re = new RegExp(`^${k}=.*$`, "m");
  writeFileSync(file, re.test(text) ? text.replace(re, () => `${k}=${v}`) : text.replace(/\n?$/, "\n") + `${k}=${v}\n`);
};
const hidden = (label) =>
  new Promise((resolve) => {
    process.stdout.write(label);
    let buf = "";
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (ch) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n" || c === "\u0004") {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(buf);
        }
        if (c === "\u0003") process.exit(130);
        if (c === "\u007f" || c === "\b") buf = buf.slice(0, -1);
        else buf += c;
      }
    };
    stdin.on("data", onData);
  });

const what = process.argv[2];
if (what === "token") {
  const v = (await hidden("NEW Supabase access token (hidden): ")).trim();
  if (!/^sbp_[A-Za-z0-9]{30,}$/.test(v)) {
    console.error("ABORT: that does not look like a Supabase access token (sbp_...)");
    process.exit(1);
  }
  set("SUPABASE_ACCESS_TOKEN", v);
  console.log(`Saved SUPABASE_ACCESS_TOKEN to .env.local (${v.length} characters; value not shown).`);
} else if (what === "dburl") {
  const ref = get("RETAILOS_SUPABASE_PROJECT_REF");
  if (!/^[a-z0-9]{20}$/.test(ref)) {
    console.error("ABORT: RETAILOS_SUPABASE_PROJECT_REF is not set in .env.local");
    process.exit(1);
  }
  const pw = await hidden("NEW database password (hidden): ");
  if (pw.length < 8) {
    console.error("ABORT: password too short");
    process.exit(1);
  }
  const host = process.argv[3] || "aws-0-ap-south-1.pooler.supabase.com";
  set("RETAILOS_DATABASE_URL", `postgresql://postgres.${ref}:${encodeURIComponent(pw)}@${host}:5432/postgres`);
  console.log(`Saved RETAILOS_DATABASE_URL to .env.local (session pooler ${host}:5432; password stored percent-encoded; value not shown).`);
} else if (what === "ca") {
  const p = process.argv[3];
  const pem = p && existsSync(p) ? readFileSync(p, "utf8") : "";
  if (!pem.includes("BEGIN CERTIFICATE")) {
    console.error("ABORT: that path is not a PEM certificate file");
    process.exit(1);
  }
  set("RETAILOS_DB_CA_FILE", p);
  console.log("Saved RETAILOS_DB_CA_FILE (TLS verification stays ON).");
} else {
  console.error("usage: node scripts/set-secret.mjs token | dburl | ca <path-to-crt>");
  process.exit(2);
}
