/**
 * Phone-to-PC scanner: wire protocol shared by the billing computer, the phone page and the server.
 * Pure and isomorphic (no Node-only imports). The phone sends ONLY a barcode string and the minimum session metadata.
 * Prices, stock, payments, customer data and invoice commands are never part of this protocol; the computer resolves the
 * barcode through the existing billing lookup (scanBarcode) under its own signed-in user.
 */

export const PROTOCOL_VERSION = 1;
/** The QR is valid for this long. After it the phone can no longer claim the pairing. */
export const PAIR_WINDOW_MS = 5 * 60_000;
/** A claimed pairing (and its scan key) stops working after this long. */
export const SESSION_LIFE_MS = 8 * 60 * 60_000;
/** Phone clocks drift; replay protection is eid + seq, this only bounds how old an event may be. */
export const MAX_EVENT_AGE_MS = 10 * 60_000;
export const HEARTBEAT_MS = 8_000;
/** The computer calls the phone disconnected after this much silence. */
export const DISCONNECT_AFTER_MS = 24_000;
/** A barcode that stays in view (or reappears within this gap) is the same presentation, not a new scan; a gap longer than this starts a new one. */
export const SAME_CODE_COOLDOWN_MS = 1_000;
export const MAX_BARCODE_LENGTH = 64;
export const MAX_LABEL_LENGTH = 40;

export type MessageKind = "hello" | "scan" | "ping" | "bye";
export const MESSAGE_KINDS: readonly MessageKind[] = ["hello", "scan", "ping", "bye"];

/** A message from the phone. `mac` authenticates every other field with the per-device scan key. */
export interface ScanMessage {
  v: number;
  kind: MessageKind;
  /** pairing session id (random, 128 bit) */
  sid: string;
  /** device id issued at claim time */
  did: string;
  /** user id of the signed-in person on the phone (checked at claim time) */
  puid: string;
  /** monotonically increasing per device; replays are rejected */
  seq: number;
  /** unique id per event: transport de-duplication. NEVER the barcode. */
  eid: string;
  ts: number;
  /** the barcode as a string (leading zeros preserved); empty for non-scan kinds */
  bc: string;
  label: string;
  mac: string;
}

export type ScannerError = "NOT_CONFIGURED" | "NOT_SIGNED_IN" | "FORBIDDEN" | "INVALID" | "EXPIRED" | "RATE_LIMITED";

export const channelName = (sid: string) => `nv-scan:${sid}`;
export const BROADCAST_EVENT = "msg";

/** Information the computer sends back so the phone can show feedback. Carries no product or price data. */
export type AckStatus = "added" | "unknown" | "unavailable" | "paused" | "rejected" | "error";
export interface Ack {
  v: number;
  kind: "ack" | "state";
  sid: string;
  /** state messages are addressed to ONE device: other phones on the same channel must ignore them */
  did?: string;
  eid?: string;
  status?: AckStatus;
  /** state messages: "connected" | "busy" | "closed" */
  state?: "connected" | "busy" | "closed";
}

const SAFE = /^[\x21-\x7e]+$/;

/**
 * Normalise a decoded barcode. Barcodes are STRINGS: leading zeros are preserved and no digit-only coercion happens.
 * Returns null when the value cannot be a barcode (empty, control/space characters, too long).
 */
export function normalizeBarcode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (v.length === 0 || v.length > MAX_BARCODE_LENGTH || !SAFE.test(v)) return null;
  return v;
}

export const cleanLabel = (raw: unknown): string => {
  if (typeof raw !== "string") return "Phone";
  const v = raw.replace(/[^\p{L}\p{N} ._()\-]/gu, "").trim().slice(0, MAX_LABEL_LENGTH);
  return v || "Phone";
};

/** The exact byte string that is authenticated. Field order is part of the protocol. */
export function canonical(m: Pick<ScanMessage, "v" | "kind" | "sid" | "did" | "puid" | "seq" | "eid" | "ts" | "bc" | "label">): string {
  return [m.v, m.kind, m.sid, m.did, m.puid, m.seq, m.eid, m.ts, m.bc, m.label].map((x) => String(x).replace(/\|/g, "%7C")).join("|");
}

const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B64URL = /^[A-Za-z0-9_-]{16,200}$/;

/** Structural validation of an untrusted message (from the network). Does not check the MAC. */
export function parseMessage(x: unknown): ScanMessage | null {
  if (!x || typeof x !== "object") return null;
  const m = x as Record<string, unknown>;
  if (m.v !== PROTOCOL_VERSION) return null;
  if (typeof m.kind !== "string" || !MESSAGE_KINDS.includes(m.kind as MessageKind)) return null;
  const { sid, did, puid, eid, mac } = m as Record<string, unknown>;
  if (typeof sid !== "string" || !UUIDISH.test(sid)) return null;
  if (typeof did !== "string" || !UUIDISH.test(did)) return null;
  if (typeof puid !== "string" || puid.length < 8 || puid.length > 64 || !SAFE.test(puid)) return null;
  if (typeof eid !== "string" || !UUIDISH.test(eid)) return null;
  if (typeof mac !== "string" || !B64URL.test(mac)) return null;
  if (!Number.isSafeInteger(m.seq) || (m.seq as number) < 0) return null;
  if (!Number.isFinite(m.ts)) return null;
  const bc = typeof m.bc === "string" ? m.bc : "";
  if (m.kind === "scan") {
    if (normalizeBarcode(bc) !== bc) return null;
  } else if (bc !== "") return null;
  const label = cleanLabel(m.label);
  if (label !== m.label) return null;
  return { v: 1, kind: m.kind as MessageKind, sid, did, puid, seq: m.seq as number, eid, ts: m.ts as number, bc, label, mac };
}

export const b64url = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const fromB64url = (s: string): Uint8Array => {
  const p = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(p);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
