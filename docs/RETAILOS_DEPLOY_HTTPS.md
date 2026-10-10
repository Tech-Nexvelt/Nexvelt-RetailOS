# Deploying NexVelt RetailOS over https (so the phone scanner works)

**Status: prepared, NOT deployed.** Nothing here has been run against a hosting account. Phones only open the camera on an **https** address, so the phone scanner needs this. The runbook plans **Vercel** (region Mumbai, next to your ap-south-1 database); the steps below use it. Any host that runs Next.js 16 on Node 22 works the same way with the same variables.

## 0. What is already prepared in the repository
| Item | Purpose |
|---|---|
| `vercel.json` | pins functions to `bom1` (Mumbai) |
| `.vercelignore` | the CLI never uploads `.env*`, `.local`, `.claude`, `archive`, `supabase/.temp`, the CA file |
| `npm run predeploy` | one command: typecheck, lint, 338 unit tests, schema check, manifest check, production build |
| `npm run smoke:deployed -- <url>` | read-only HTTP checks of the live site (https, headers, redirects, no secrets in HTML) |
| Clean-copy rehearsal (done) | only the files a deployment receives, fresh `npm ci`, **no env vars**: build OK, typecheck OK, 338/338 tests OK |

## 1. Decide how it will be deployed (your decision)
* **Route A: Vercel CLI from this folder.** No GitHub needed. Run by you: `npx vercel login`, `npx vercel link`, set variables, `npx vercel deploy --prod`. Fastest tonight.
* **Route B: GitHub + Vercel integration.** There is currently **no git remote**; this needs a repository, a `git push` (I will not push without your explicit approval), and the Vercel GitHub app. Better for the long term (preview deployments, rollbacks by commit).
Either way: Node **22.x** in Vercel project settings (the app is tested on 22.23; `engines` is `>=22.13`).

## 2. Values you must create (never paste secrets into chat)
| Variable | Browser-visible | Value | Notes |
|---|---|---|---|
| `BILLING_BACKEND` | no | `supabase` | any other value is refused in production |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | `https://dlxgvpmvlwbqxogyzlhr.supabase.co` | |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes (public by design) | Supabase > Project Settings > API Keys > publishable key | RLS protects the data |
| `NEXT_PUBLIC_SITE_URL` | yes | the final **https** origin, e.g. `https://<project-name>.vercel.app` (no trailing path) | compiled into the build: set it BEFORE the build. Choose the Vercel project name first so the URL is known, or deploy twice. `localhost` is rejected in production. |
| `SCANNER_PAIRING_SECRET` | **no, server only** | a NEW random value for production | generate on your machine: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Do not reuse the local one. Without it the Connect button says the scanner is not set up (fail closed). |
| `SUPABASE_SECRET_KEY` | **no, server only** | optional | only for inviting staff by email; not used by the scanner |

**Do NOT set in Vercel:** `RETAILOS_DATABASE_URL`, `RETAILOS_DB_CA_FILE`, `RETAILOS_SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, any database password. The app never reads them. Scope everything to **Production**; mark the two server-only secrets "Sensitive".
Add them without echoing: `npx vercel env add SCANNER_PAIRING_SECRET production` (paste at the hidden prompt), or in the dashboard under Project > Settings > Environment Variables.

## 3. Pre-deploy gate (run on this machine; all already pass today)
```powershell
cd E:\Softwares\NexveltretailOS
npm run predeploy                                   # must end with a successful build
npm run test:db                                     # 233 database tests (takes a few minutes)
$env:NODE_ENV="production"; npm run env:check       # run with the production values loaded in this shell; OK/PROBLEM only
```

## 4. Deploy
**Route A (CLI):**
```powershell
npx vercel@latest login
npx vercel@latest link                # create/choose the project; name it first so the URL is predictable
# add the variables from section 2 (production scope), then:
npx vercel@latest deploy --prod
```
**Route B:** create the GitHub repository, add the remote, push `master` (or rename to `main`), import it in Vercel, add the variables, deploy. Needs your approval before any push.

## 5. Supabase settings that depend on the final URL (dashboard, you)
| Setting | Value |
|---|---|
| Authentication > URL Configuration > **Site URL** | the https URL |
| Authentication > URL Configuration > **Redirect URLs** | add `https://<url>/auth/confirm` |
| Realtime | public Broadcast channels must stay allowed (the default). Do not enable "private channels only": the scanner would not connect. |
| Data API exposed schemas | already `retailos` only (verified) |

## 6. After it is live
1. `npm run smoke:deployed -- https://<url>` must end `SMOKE TEST PASSED`. It checks https, HSTS and the other headers, signed-out redirects, that `/scan/<token>` needs sign-in, and that no secret appears in the HTML. It does not sign in.
2. Sign in as the owner on the computer at the **https** address (not localhost) and open Billing.
3. **Phone scanner, step by step:** Billing > Phone scanner > *Connect phone scanner* > on the phone scan the QR with the camera app > sign in as an account of the same shop that may bill > *Connect* (computer shows **Connected**) > *Start scanning* > allow the camera > scan a printed barcode from `docs/RETAILOS_DEMO_BARCODES.md` > the item appears in the bill; the phone shows "Added to the bill" and vibrates.
4. Try: an unknown code (phone shows "Barcode not found"), the same item twice (quantity 2), airplane mode on the phone for a few seconds then off (it reconnects and nothing is lost or doubled), and *Disconnect* on the computer (later scans change nothing).
5. Record which phone and browser you used and what happened. **The camera path is not verified until this is done.**

## 7. If something does not work
| Symptom | Cause / fix |
|---|---|
| Phone says the camera needs a secure page | the QR was made on an http or localhost address: open the computer on the https URL and create a new code |
| Computer says the scanner is not set up | `SCANNER_PAIRING_SECRET` missing or shorter than 32 characters in the **Production** environment; redeploy after adding it |
| Stays on "Waiting for the phone" | phone not signed in / different shop; Realtime public channels disabled; or the 5-minute code expired: create a new code |
| "This code is for a different shop or branch" | the phone account belongs to another tenant/branch or cannot bill |
| Login links in emails point to the wrong place | `NEXT_PUBLIC_SITE_URL` / Supabase Site URL mismatch; fix and redeploy (the URL is compiled in) |
| Camera does not start on iPhone | Safari needs a tap on *Start scanning* and the camera permission for the site; check Settings > Safari > Camera |

## 8. Rollback and cleanup
* Bad release: Vercel > Deployments > promote the previous deployment (instant). Route A: redeploy the last good build.
* Disable the scanner without a redeploy: remove `SCANNER_PAIRING_SECRET` (the feature fails closed) or rotate it (all open pairings stop).
* Before real trading: the hosted project still contains `TEST Shirt`, two test bills and the demo catalogue. Decide whether to keep the demo data in the production project.
* Still owed: reset the database password that was shown in chat; keep `SUPABASE_ACCESS_TOKEN` out of `.env.local`.
