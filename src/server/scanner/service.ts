/**
 * Server-side rules for the phone scanner. Pure: the secret, clock and id source are injected, so every rule is unit-tested.
 * Nothing here touches the database, products, prices, stock or payments.
 */
import { deriveScanKey, openPairing, signPairing, verifyMessageMac } from "@/lib/scanner/crypto";
import { PAIR_WINDOW_MS, SESSION_LIFE_MS, b64url, parseMessage, type ScanMessage } from "@/lib/scanner/protocol";

/** Who is calling, taken from the verified server session (never from the request body). */
export interface Caller {
  userId: string;
  tenantId: string;
  branchId: string;
  /** holds sale.create in the active branch */
  canSell: boolean;
}

export interface Deps {
  secret: string;
  now: () => number;
  newId: () => string;
}

export type Fail = { ok: false; code: "FORBIDDEN" | "INVALID" | "EXPIRED" };

export interface Pairing {
  ok: true;
  token: string;
  sid: string;
  pairBy: number;
  until: number;
}

/** Billing computer: create a short-lived pairing bound to this user, tenant, branch and terminal. */
export async function createPairing(c: Caller, d: Deps): Promise<Pairing | Fail> {
  if (!c.canSell) return { ok: false, code: "FORBIDDEN" };
  const now = d.now();
  const payload = { sid: d.newId(), uid: c.userId, tid: c.tenantId, bid: c.branchId, tmid: d.newId(), pairBy: now + PAIR_WINDOW_MS, until: now + SESSION_LIFE_MS };
  return { ok: true, token: await signPairing(d.secret, payload), sid: payload.sid, pairBy: payload.pairBy, until: payload.until };
}

export interface Claim {
  ok: true;
  sid: string;
  did: string;
  /** base64url scan key: bound to this session, this device and this signed-in user; expires with the session */
  scanKey: string;
  until: number;
}

/**
 * Phone: exchange the QR token for a scan key. Requires the phone's user to be signed in, in the SAME tenant and branch as the
 * billing terminal, and to be allowed to sell. The QR itself never contains a credential.
 */
export async function claimPairing(token: unknown, c: Caller, d: Deps): Promise<Claim | Fail> {
  const p = await openPairing(d.secret, token);
  if (!p) return { ok: false, code: "INVALID" };
  const now = d.now();
  if (now > p.pairBy || now > p.until) return { ok: false, code: "EXPIRED" };
  if (!c.canSell || c.tenantId !== p.tid || c.branchId !== p.bid) return { ok: false, code: "FORBIDDEN" };
  const did = d.newId();
  const key = await deriveScanKey(d.secret, p.sid, did, c.userId);
  return { ok: true, sid: p.sid, did, scanKey: b64url(key), until: p.until };
}

/** What the phone page needs to know before showing "Connect": is this QR valid for ME? No secrets returned. */
export async function inspectPairing(token: unknown, c: Caller, d: Deps): Promise<{ ok: true; sid: string } | Fail> {
  const p = await openPairing(d.secret, token);
  if (!p) return { ok: false, code: "INVALID" };
  const now = d.now();
  if (now > p.pairBy || now > p.until) return { ok: false, code: "EXPIRED" };
  if (!c.canSell || c.tenantId !== p.tid || c.branchId !== p.bid) return { ok: false, code: "FORBIDDEN" };
  return { ok: true, sid: p.sid };
}

/**
 * Billing computer: verify a message it received over the (public) channel before acting on it. The computer sends its own pairing
 * token; the server checks that the caller IS the user/tenant/branch the pairing was created for, that the pairing is alive, and that
 * the MAC was produced with the scan key of that session+device+phone-user. A message forged by anyone who merely knows the channel
 * name fails here.
 */
export async function verifyIncoming(token: unknown, raw: unknown, c: Caller, d: Deps): Promise<{ ok: true; msg: ScanMessage } | Fail> {
  const p = await openPairing(d.secret, token);
  if (!p) return { ok: false, code: "INVALID" };
  if (c.userId !== p.uid || c.tenantId !== p.tid || c.branchId !== p.bid || !c.canSell) return { ok: false, code: "FORBIDDEN" };
  if (d.now() > p.until) return { ok: false, code: "EXPIRED" };
  const msg = parseMessage(raw);
  if (!msg || msg.sid !== p.sid) return { ok: false, code: "INVALID" };
  const key = await deriveScanKey(d.secret, msg.sid, msg.did, msg.puid);
  if (!(await verifyMessageMac(key, msg))) return { ok: false, code: "INVALID" };
  return { ok: true, msg };
}
