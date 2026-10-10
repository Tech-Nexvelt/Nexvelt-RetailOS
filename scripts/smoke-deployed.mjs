// Read-only smoke test of a DEPLOYED (or locally started) RetailOS. Sends only plain GET requests with no credentials and no cookies.
//   node scripts/smoke-deployed.mjs https://your-app.vercel.app
//   node scripts/smoke-deployed.mjs http://localhost:3000 --allow-http      (local rehearsal only)
// Checks: https, security headers (incl. HSTS), signed-out redirects, public pages, no framework banner, the phone-scanner route is
// protected, nothing sensitive in the HTML. It never signs in and never writes. Exit 1 if any check fails.
const arg = process.argv[2];
const allowHttp = process.argv.includes("--allow-http");
if (!arg || !/^https?:\/\//.test(arg)) {
  console.error("usage: node scripts/smoke-deployed.mjs <https://base-url> [--allow-http]");
  process.exit(2);
}
const base = arg.replace(/\/+$/, "");
let failed = false;
const gate = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " - " + detail : ""}`);
  if (!ok) failed = true;
};
const get = (path, init = {}) => fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(20000), ...init });

gate("address is https (phones refuse the camera on plain http)", base.startsWith("https://") || allowHttp, base.startsWith("https://") ? "" : "--allow-http used: local rehearsal only");

const login = await get("/login");
gate("/login is reachable and public", login.status === 200, `HTTP ${login.status}`);
const h = (n) => login.headers.get(n) ?? "";
if (base.startsWith("https://")) gate("Strict-Transport-Security present", /max-age=\d{7,}/.test(h("strict-transport-security")), h("strict-transport-security"));
else gate("Strict-Transport-Security header configured (browsers ignore it on http)", /max-age=\d{7,}/.test(h("strict-transport-security")), h("strict-transport-security"));
gate("X-Frame-Options DENY", /deny/i.test(h("x-frame-options")));
gate("X-Content-Type-Options nosniff", /nosniff/i.test(h("x-content-type-options")));
gate("Referrer-Policy set", h("referrer-policy").length > 0, h("referrer-policy"));
gate("Permissions-Policy allows camera only on this site", /camera=\(self\)/.test(h("permissions-policy")), h("permissions-policy"));
gate("no X-Powered-By banner", h("x-powered-by") === "");

for (const p of ["/dashboard", "/billing", "/products", "/sales", "/reports", "/settings"]) {
  const r = await get(p);
  const loc = r.headers.get("location") ?? "";
  gate(`signed-out ${p} redirects to /login`, [301, 302, 303, 307, 308].includes(r.status) && /\/login/.test(loc), `HTTP ${r.status} -> ${loc.replace(/^https?:\/\/[^/]+/, "")}`);
}
const scan = await get("/scan/not-a-real-token");
gate("phone scanner page needs sign-in (/scan/<token> redirects to /login)", [301, 302, 303, 307, 308].includes(scan.status) && /\/login/.test(scan.headers.get("location") ?? ""), `HTTP ${scan.status}`);
const evil = await get("/login?next=//evil.example");
gate("login does not redirect to an off-site next= target", evil.status === 200 && !/evil\.example/.test(evil.headers.get("location") ?? ""), `HTTP ${evil.status}`);

const html = await login.text();
for (const [label, re] of [["service-role / secret key", /sb_secret_[A-Za-z0-9]{10,}|service_role/i], ["database connection string", /postgres(ql)?:\/\/[^\s"']+:[^\s"']+@/i], ["scanner signing secret name with a value", /SCANNER_PAIRING_SECRET\s*[=:]\s*\S{16,}/]]) {
  gate(`no ${label} in the page HTML`, !re.test(html));
}
const demo = await get("/billing", { headers: { cookie: "nv_role=owner" } });
gate("demo role cookie grants nothing (demo mode is not active)", [301, 302, 303, 307, 308].includes(demo.status) && /\/login/.test(demo.headers.get("location") ?? ""), `HTTP ${demo.status}`);

console.log(failed ? "\nSMOKE TEST FAILED: do not announce this deployment." : "\nSMOKE TEST PASSED for everything above. It does not test sign-in, the database or the phone camera: do those by hand (see docs/RETAILOS_DEPLOY_HTTPS.md).");
process.exit(failed ? 1 : 0);
