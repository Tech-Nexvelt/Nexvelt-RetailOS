# Phone-to-PC wireless barcode scanner

The phone is the scanner; the billing computer is the terminal. The phone decodes barcodes on-device and sends **only the barcode text**. The computer resolves it with the existing `scanBarcode` lookup and the existing cart. Checkout, payment, receipts and stock stay on the computer, and a scan can never start any of them.

**Status:** implemented and tested with mocks and on the hosted project with two browser tabs. **A real phone-camera test has not been done** (see section 7).

## 1. How to pair (what the cashier does)
1. On the computer, sign in and open **Billing**. Expand **Phone scanner**, press **Connect phone scanner**. A QR code and a status chip ("Waiting for the phone") appear.
2. On the phone, scan the QR with the normal camera app. The scanner page opens in the phone's browser (the phone must reach the app's **https** address).
3. Sign in on the phone if asked (same shop and branch, and a role that may bill), then tap **Connect**. The computer shows **Connected** and the device name.
4. Tap **Start scanning**, allow the camera, point at a barcode. The item appears in the bill on the computer; the phone shows "Added to the bill" and vibrates.
5. **Stop scanning** switches the camera off. **Disconnect** (either device) ends the pairing immediately. To pair again create a new code.

Status words: *Waiting, Connected, Disconnected* (no heartbeat for 24 s; reconnects automatically if the phone comes back), *Expired* (QR not used within 5 minutes, or the 8-hour session ended), *Disconnected by you*.

## 2. Architecture
```
phone camera -> local decoder (native BarcodeDetector, or zxing fallback)       [nothing leaves the phone but text]
  -> PhoneScanController (debounce, sign with HMAC scan key, retry until acknowledged)
  -> Supabase Realtime BROADCAST channel  nv-scan:<session id>                  [barcode + metadata only]
  -> billing computer: ComputerScanController
       1. cheap gate (PairingGate): right session, right device, fresh, not a duplicate, bill not busy
       2. server verification (verifyIncomingAction): HMAC valid, same user/tenant/branch as the pairing, session alive
       3. existing billing pipeline: scanBarcode(code, cart) -> cart  (serial queue: one scan at a time)
  -> acknowledgement back to the phone (status only: added / unknown / unavailable / paused)
```
Files: `src/lib/scanner/*` (protocol, crypto, gate, controllers, channel, decoder), `src/server/scanner/*` (rules + server actions), `src/components/billing/phone-scanner-panel.tsx`, `src/components/scanner/phone-scanner.tsx`, `src/app/scan/[token]/page.tsx`. **No database change and no migration is needed**: pairing is stateless and signed.

## 3. Security controls
| Requirement | Control |
|---|---|
| Unpredictable pairing | 128-bit random session id; the QR carries a token signed with HMAC-SHA-256 using the server-only `SCANNER_PAIRING_SECRET`. |
| No credentials in the QR | The token holds session/user/tenant/branch ids and two expiry times. No Supabase key, no database credential, no permanent token. |
| Short expiry | The QR can be claimed for 5 minutes. A claimed session lasts at most 8 hours. |
| Bound to user, tenant, branch, terminal | Server checks the token against the verified server session (`getAppSession`), never against request data. The computer's own user/tenant/branch must match when it verifies. |
| Authorized phone | `claimPairingAction` requires a signed-in user of the **same tenant and branch** holding `sale.create`. Others are refused. |
| Channel name is not the authorization | The channel is public Broadcast. Every message carries an HMAC made with a per-device **scan key** that only the claimed phone has (derived from the secret + session + device + phone user). The computer verifies each message on the server before using it. A forged message fails. |
| Expired / revoked sessions | Server rejects after expiry. **Disconnect** makes the computer discard everything from that pairing at once. |
| One phone per terminal | The first authenticated hello locks the device; a second phone is told "busy" and ignored. |
| Replay / duplicates | Unique event id per message (transport de-duplication, NOT barcode equality), freshness window of 10 minutes, retries reuse the same id. A repeated scan of the same product gets a new event id and is counted. |
| Wrong cart | Each Connect creates a new session id; a terminal only accepts its own. Tested with two terminals. |
| Checkout in progress | While a checkout is running or a bill is finished, scans are refused with "paused" (not queued, not moved to another cart). |
| No sale from a scan | The protocol has no fields for prices, stock, payments or invoices; unknown fields are dropped. The only call the computer makes is `scanBarcode`. |
| Rate limits | New codes 10/min/user, claims 8/min/user, incoming messages 400/min/pairing. **In memory per server instance**: it bounds bursts, it is not a global quota. |
| Server secret | `SCANNER_PAIRING_SECRET` is read only in a server action; tested absent from the client bundle. Without it the feature fails closed. |
| Privacy | No camera image or video is sent anywhere. Acknowledgements carry a status word only, no product names or prices. |

## 4. Configuration (required to enable)
| Setting | Where | Notes |
|---|---|---|
| `SCANNER_PAIRING_SECRET` | server environment (hosting platform), **never** `NEXT_PUBLIC_` | 32+ random characters, different for production. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Check: `npm run env:check`. Rotating it invalidates open pairings (users just reconnect). |
| HTTPS | the app's public address | Phone browsers allow the camera only on https (or localhost on that device). An `http://192.168.x.x` address cannot use the camera. |
| Realtime Broadcast | Supabase project | Public Broadcast channels must be allowed (the default). If "private channels only" is enabled in Realtime settings, the scanner cannot connect; see section 8. |
| Allowed origin | phone and computer must open the same deployed origin | The QR uses the address the computer is currently using (`window.location.origin`). On `localhost` the panel warns that a phone cannot reach it. |
| `SUPABASE_SECRET_KEY` | not required | The scanner does not use it. |

## 5. Automated tests (all run without a phone, network or database)
`src/lib/scanner/scanner.test.ts` (protocol, HMAC, gate, debounce, limiter, 36), `src/server/scanner/service.test.ts` (pairing, claim, verification, tenant/branch/user binding, 17), `src/lib/scanner/integration.test.ts` (controllers over an in-memory bus, channel reconnect, camera decoder with mocks, 27), `src/components/billing/billing-workspace.phone.test.tsx` (real Billing screen: serial scan queue, unknown barcode, network error, scan never checks out, 5), plus `env.test.ts` (browser env fix). Existing checkout, invoice, stock and receipt tests are unchanged and pass.
Coverage map: pairing creation/expiry, authorized connection, rejection of other tenant/branch/user, delivery to the correct terminal, unknown barcode, repeated scans, duplicate event rejection, reconnect and resend, disconnect and revocation, two terminals with isolated carts, scan during checkout (including checkout starting mid-verification), camera permission denial, insecure page, unsupported browser, single decode loop, camera released on stop.

## 6. Hosted verification (done, two browser tabs, real Supabase Realtime and real server verification)
Computer tab: Billing -> Connect -> QR + "Waiting". Second tab opened the pairing link as the signed-in owner -> Connect -> **both sides "Connected"**. A typed barcode from the phone page (same pipeline as the camera) added the product to the computer's cart (cart total updated), the phone showed "Added to the bill". An unknown barcode showed "Barcode not found" on the phone and a warning on the computer with the cart unchanged. The same product again made quantity 2. **Disconnect** on the computer: phone showed "Disconnected" and a later scan changed nothing. The database afterwards still had the same 2 invoices, 2 payments, stock 5 and 4 stock movements: scans created no sale, payment or stock movement.

## 7. NOT verified (be honest)
* **A real phone camera decoding real barcodes** and a real phone-to-computer scan on two devices. The decoder is tested with mocks only. This needs your phone over https.
* iOS Safari / Android Chrome behaviour of the zxing fallback and native detector on real labels, lighting and motion.
* Behaviour over a flaky mobile network beyond the simulated reconnect tests.
* Scan arrival during checkout on the hosted app (covered by unit and integration tests, not run live).

## 8. Known limits and optional hardening
* UPC-A is reported by some detectors as a 13-digit EAN with a leading 0. Lookup is exact on purpose (never guess); a product stored with the 12-digit form would then not match. Store the barcode the detector returns, or tell me and I will add an explicit, tested alias rule.
* Pairing is in the browser's memory on the computer: reloading Billing ends it (create a new code). The phone resumes after a refresh within the session.
* Rate limits are per server instance (see above).
* Acknowledgements/state notices on the public channel are unauthenticated hints; a third party who knew the (secret, 128-bit) session id could disturb the phone's display but cannot add anything to a cart.
* **Optional hardening (a proposal, nothing applied):** Supabase *private* Broadcast channels with a row-level policy on `realtime.messages` would also stop outsiders from joining the channel. That requires SQL on the `realtime` schema, i.e. a migration you would apply yourself. It is not needed for the security properties above, because authorization does not rely on the channel.
