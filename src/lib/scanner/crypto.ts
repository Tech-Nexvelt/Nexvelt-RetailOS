/**
 * HMAC-SHA-256 helpers using Web Crypto, which exists in Node 22 and in every phone browser, so the SAME code signs on the phone
 * and verifies on the server. Verification uses subtle.verify (constant time).
 *
 * Keys:
 *  - server secret  (SCANNER_PAIRING_SECRET, server only, never sent anywhere)
 *  - pairing token  = payload + HMAC(secret, "pair|" + payload)               (in the QR; short-lived; no credentials inside)
 *  - scan key       = HMAC(secret, "scankey|sid|did|puid")                      (issued to ONE authenticated phone at claim time)
 *  - message MAC    = HMAC(scan key, canonical(message))
 */
import { b64url, canonical, fromB64url, type ScanMessage } from "./protocol";

const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;
// Web Crypto's types want a plain ArrayBuffer; copy so a Uint8Array view over a larger buffer can't leak extra bytes.
const ab = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer;

const importKey = (raw: Uint8Array) => subtle().importKey("raw", ab(raw), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export async function hmac(key: Uint8Array, message: string): Promise<Uint8Array> {
  return new Uint8Array(await subtle().sign("HMAC", await importKey(key), ab(enc.encode(message))));
}

export async function hmacVerify(key: Uint8Array, message: string, mac: string): Promise<boolean> {
  try {
    return await subtle().verify("HMAC", await importKey(key), ab(fromB64url(mac)), ab(enc.encode(message)));
  } catch {
    return false;
  }
}

/** The server secret as key bytes. Must be at least 32 characters of entropy. */
export function secretBytes(secret: string): Uint8Array {
  return enc.encode(secret);
}
export const isUsableSecret = (s: string | null | undefined): s is string => typeof s === "string" && s.length >= 32;

// ---- pairing token --------------------------------------------------------------------------------------------------------
export interface PairingPayload {
  /** pairing session id */
  sid: string;
  /** user who created the pairing on the billing computer */
  uid: string;
  tid: string;
  bid: string;
  /** random id of the billing terminal (one per Connect action) */
  tmid: string;
  /** claim deadline (ms epoch) */
  pairBy: number;
  /** end of the session's life (ms epoch) */
  until: number;
}

export async function signPairing(secret: string, p: PairingPayload): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(p)));
  const mac = b64url(await hmac(secretBytes(secret), "pair|" + body));
  return `${body}.${mac}`;
}

/** Returns the payload when the signature is valid; the caller still checks expiry and the signed-in user. */
export async function openPairing(secret: string, token: unknown): Promise<PairingPayload | null> {
  if (typeof token !== "string" || token.length > 1000) return null;
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  if (!(await hmacVerify(secretBytes(secret), "pair|" + body, mac))) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body))) as PairingPayload;
    const ok = [p.sid, p.uid, p.tid, p.bid, p.tmid].every((x) => typeof x === "string" && x.length > 0 && x.length <= 64) && Number.isFinite(p.pairBy) && Number.isFinite(p.until);
    return ok ? p : null;
  } catch {
    return null;
  }
}

// ---- scan key and message MAC ---------------------------------------------------------------------------------------------
export async function deriveScanKey(secret: string, sid: string, did: string, puid: string): Promise<Uint8Array> {
  return hmac(secretBytes(secret), `scankey|${sid}|${did}|${puid}`);
}

export async function signMessage(scanKey: Uint8Array, m: Omit<ScanMessage, "mac">): Promise<ScanMessage> {
  return { ...m, mac: b64url(await hmac(scanKey, canonical(m))) };
}

export async function verifyMessageMac(scanKey: Uint8Array, m: ScanMessage): Promise<boolean> {
  return hmacVerify(scanKey, canonical(m), m.mac);
}
