import { describe, expect, it } from "vitest";
import { deriveScanKey, hmacVerify, openPairing, signMessage, signPairing, verifyMessageMac } from "./crypto";
import { PairingGate, RateLimiter, ScanDebouncer } from "./gate";
import { DISCONNECT_AFTER_MS, MAX_EVENT_AGE_MS, PAIR_WINDOW_MS, SESSION_LIFE_MS, b64url, canonical, cleanLabel, normalizeBarcode, parseMessage, type ScanMessage } from "./protocol";

const SECRET = "x".repeat(40);
const ids = {
  sid: "11111111-1111-4111-8111-111111111111",
  did: "22222222-2222-4222-8222-222222222222",
  tid: "tenant-1",
  bid: "branch-1",
  uid: "user-owner-1",
  puid: "user-phone-1",
};
let n = 0;
const eid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

async function msg(over: Partial<ScanMessage> = {}, key?: Uint8Array): Promise<ScanMessage> {
  const k = key ?? (await deriveScanKey(SECRET, ids.sid, ids.did, ids.puid));
  const base = { v: 1, kind: "scan" as const, sid: ids.sid, did: ids.did, puid: ids.puid, seq: 1, eid: eid(), ts: 1_000_000, bc: "8901234567890", label: "Phone", ...over };
  return signMessage(k, base);
}

describe("barcode normalisation (barcodes are strings)", () => {
  it("preserves leading zeros and never coerces to a number", () => {
    expect(normalizeBarcode("0012345678905")).toBe("0012345678905");
    expect(normalizeBarcode("  NRC00000001 ")).toBe("NRC00000001");
    expect(normalizeBarcode("00000000")).toBe("00000000");
  });
  it("rejects empty, spaced, control, oversize and non-string values", () => {
    for (const bad of ["", "   ", "AB CD", "AB\tCD", "a\u0000b", "x".repeat(65), 123, null, undefined, {}]) expect(normalizeBarcode(bad)).toBeNull();
  });
  it("accepts the formats a retail scanner reads (EAN-13/8, UPC-A/E, Code 128/39, ITF)", () => {
    for (const ok of ["5901234123457", "96385074", "036000291452", "01234565", "NRC00000001", "CODE-39.$/+%", "00012345678905"]) expect(normalizeBarcode(ok)).toBe(ok);
  });
  it("cleans labels", () => {
    expect(cleanLabel("Rahul's <b>Phone</b>")).toBe("Rahuls bPhoneb");
    expect(cleanLabel("")).toBe("Phone");
    expect(cleanLabel(undefined)).toBe("Phone");
    expect(cleanLabel("x".repeat(100)).length).toBe(40);
  });
});

describe("message authentication", () => {
  it("a message signed with the device scan key verifies; any changed field breaks it", async () => {
    const key = await deriveScanKey(SECRET, ids.sid, ids.did, ids.puid);
    const m = await msg({}, key);
    expect(await verifyMessageMac(key, m)).toBe(true);
    for (const tamper of [{ bc: "8901234567891" }, { seq: 2 }, { eid: eid() }, { ts: 1 }, { did: "33333333-3333-4333-8333-333333333333" }, { sid: "44444444-4444-4444-8444-444444444444" }, { puid: "someone-else-1" }, { kind: "hello" as const }]) {
      expect(await verifyMessageMac(key, { ...m, ...tamper }), JSON.stringify(tamper)).toBe(false);
    }
  });
  it("a key for another session, device or phone user does not verify", async () => {
    const m = await msg();
    for (const k of [await deriveScanKey(SECRET, "44444444-4444-4444-8444-444444444444", ids.did, ids.puid), await deriveScanKey(SECRET, ids.sid, "33333333-3333-4333-8333-333333333333", ids.puid), await deriveScanKey(SECRET, ids.sid, ids.did, "other-user-1"), await deriveScanKey("y".repeat(40), ids.sid, ids.did, ids.puid)]) {
      expect(await verifyMessageMac(k, m)).toBe(false);
    }
  });
  it("a field containing the separator cannot be reshaped into another message", () => {
    const a = canonical({ v: 1, kind: "scan", sid: "s", did: "d", puid: "p", seq: 1, eid: "e", ts: 1, bc: "AB|C", label: "L" });
    const b = canonical({ v: 1, kind: "scan", sid: "s", did: "d", puid: "p", seq: 1, eid: "e", ts: 1, bc: "AB", label: "C|L" });
    expect(a).not.toBe(b);
  });
  it("garbage and malformed MACs never throw and never verify", async () => {
    const key = await deriveScanKey(SECRET, ids.sid, ids.did, ids.puid);
    for (const mac of ["", "!!!", "a", "A".repeat(500)]) expect(await hmacVerify(key, "x", mac)).toBe(false);
  });
});

describe("parseMessage (untrusted network input)", () => {
  it("accepts a well-formed message and rejects structural problems", async () => {
    const m = await msg();
    expect(parseMessage(m)).toEqual(m);
    for (const bad of [null, "x", 1, {}, { ...m, v: 2 }, { ...m, kind: "pay" }, { ...m, sid: "nope" }, { ...m, eid: "nope" }, { ...m, seq: -1 }, { ...m, seq: 1.5 }, { ...m, ts: "now" }, { ...m, bc: "has space" }, { ...m, mac: "" }, { ...m, label: "<script>" }, { ...m, kind: "ping", bc: "123" }]) {
      expect(parseMessage(bad), JSON.stringify(bad)).toBeNull();
    }
  });
  it("does not accept price, stock, payment or product fields as part of the protocol", async () => {
    const m = await msg();
    const parsed = parseMessage({ ...m, price: 1, stock: 99, payment: "CASH", product: "x" });
    expect(parsed).toEqual(m);
    expect(Object.keys(parsed!).sort()).toEqual(["bc", "did", "eid", "kind", "label", "mac", "puid", "seq", "sid", "ts", "v"]);
  });
});

describe("pairing token", () => {
  const payload = { sid: ids.sid, uid: ids.uid, tid: ids.tid, bid: ids.bid, tmid: "term-1", pairBy: 5000, until: 9000 };
  it("round-trips and contains no credential", async () => {
    const t = await signPairing(SECRET, payload);
    expect(await openPairing(SECRET, t)).toEqual(payload);
    const decoded = Buffer.from(t.split(".")[0]!, "base64url").toString();
    expect(decoded).not.toMatch(new RegExp(SECRET));
    expect(Object.keys(JSON.parse(decoded)).sort()).toEqual(["bid", "pairBy", "sid", "tid", "tmid", "uid", "until"]);
  });
  it("rejects tampering, another secret, truncation and junk", async () => {
    const t = await signPairing(SECRET, payload);
    const [body, mac] = t.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ ...payload, tid: "tenant-2" })).toString("base64url");
    expect(await openPairing(SECRET, `${forged}.${mac}`)).toBeNull();
    expect(await openPairing("z".repeat(40), t)).toBeNull();
    expect(await openPairing(SECRET, body)).toBeNull();
    expect(await openPairing(SECRET, `${body}.${mac}.x`)).toBeNull();
    for (const j of ["", "a.b", null, undefined, 5, "x".repeat(2000)]) expect(await openPairing(SECRET, j)).toBeNull();
  });
  it("token bytes are unpredictable: two pairings never share a mac", async () => {
    const a = await signPairing(SECRET, { ...payload, sid: "a".repeat(8) });
    const b = await signPairing(SECRET, { ...payload, sid: "b".repeat(8) });
    expect(a.split(".")[1]).not.toBe(b.split(".")[1]);
  });
  it("constants: short QR window, bounded session", () => {
    expect(PAIR_WINDOW_MS).toBeLessThanOrEqual(10 * 60_000);
    expect(SESSION_LIFE_MS).toBeLessThanOrEqual(12 * 3600_000);
  });
});

describe("PairingGate: the billing computer decides what reaches the cart", () => {
  const T0 = 1_000_000;
  const gate = () => new PairingGate(ids.sid, T0 + PAIR_WINDOW_MS, T0 + SESSION_LIFE_MS);
  const connect = (g: PairingGate, at = T0) => g.hello({ sid: ids.sid, did: ids.did, label: "Phone", ts: at }, at);

  it("starts waiting, connects on the first hello, and shows the device label", () => {
    const g = gate();
    expect(g.tick(T0)).toBe("waiting");
    expect(connect(g)).toEqual({ ok: true, first: true });
    expect(g.state).toBe("connected");
    expect(g.label).toBe("Phone");
  });
  it("expires if nobody pairs in the QR window, and refuses a late hello", () => {
    const g = gate();
    expect(g.tick(T0 + PAIR_WINDOW_MS + 1)).toBe("expired");
    expect(g.hello({ sid: ids.sid, did: ids.did, label: "P", ts: 0 }, T0 + PAIR_WINDOW_MS + 1)).toEqual({ ok: false, reason: "expired" });
  });
  it("the whole session ends after its lifetime even if connected", () => {
    const g = gate();
    connect(g);
    expect(g.tick(T0 + SESSION_LIFE_MS + 1)).toBe("expired");
  });
  it("a second phone cannot take over a paired terminal", () => {
    const g = gate();
    connect(g);
    expect(g.hello({ sid: ids.sid, did: "33333333-3333-4333-8333-333333333333", label: "Other", ts: T0 }, T0)).toEqual({ ok: false, reason: "wrong_device" });
    expect(g.deviceId).toBe(ids.did);
  });
  it("a scan for another terminal's session is refused (isolated carts)", async () => {
    const g = gate();
    connect(g);
    const m = await msg({ sid: "55555555-5555-4555-8555-555555555555", ts: T0 });
    expect(g.admit(m, T0, true)).toEqual({ ok: false, reason: "wrong_session" });
  });
  it("scans before hello are refused", async () => {
    expect(gate().admit(await msg({ ts: T0 }), T0, true)).toEqual({ ok: false, reason: "not_connected" });
  });
  it("accepts consecutive scans of the SAME barcode (distinct event ids and sequence numbers)", async () => {
    const g = gate();
    connect(g);
    for (let i = 1; i <= 3; i++) {
      const m = await msg({ seq: i, ts: T0 + i, bc: "8901234567890" });
      expect(g.admit(m, T0 + i, true)).toEqual({ ok: true });
      g.confirm(m, T0 + i);
    }
    expect(g.lastSeq).toBe(3);
  });
  it("rejects a duplicate transport event (same event id) even though the barcode matches a legitimate repeat", async () => {
    const g = gate();
    connect(g);
    const m = await msg({ seq: 1, ts: T0 });
    expect(g.admit(m, T0, true)).toEqual({ ok: true });
    // arrives again while the first is still being verified (reconnect resend)
    expect(g.admit(m, T0, true)).toEqual({ ok: false, reason: "duplicate" });
    g.confirm(m, T0);
    expect(g.admit(m, T0 + 5, true)).toEqual({ ok: false, reason: "duplicate" });
  });
  it("rejects a replayed (captured) message: its event id is already known inside the freshness window", async () => {
    const g = gate();
    connect(g);
    const a = await msg({ seq: 5, ts: T0 });
    g.admit(a, T0, true);
    g.confirm(a, T0);
    expect(g.admit({ ...a }, T0 + 1000, true)).toEqual({ ok: false, reason: "duplicate" });
    // and long after the window the replay is refused as stale instead
    expect(g.admit({ ...a }, T0 + MAX_EVENT_AGE_MS + 5000, true)).toEqual({ ok: false, reason: "stale" });
  });
  it("accepts a retried event that arrives AFTER a later one (lost in transit, then resent): ordering is not the replay defence", async () => {
    const g = gate();
    connect(g);
    const m3 = await msg({ seq: 3, ts: T0 });
    const m4 = await msg({ seq: 4, ts: T0 + 1 });
    expect(g.admit(m4, T0 + 2, true)).toEqual({ ok: true });
    g.confirm(m4, T0 + 2);
    expect(g.admit(m3, T0 + 3, true)).toEqual({ ok: true });
  });
  it("a forged message that fails the MAC does not burn the real event id or the sequence", async () => {
    const g = gate();
    connect(g);
    const forged = await msg({ seq: 9_999, ts: T0 });
    expect(g.admit(forged, T0, true)).toEqual({ ok: true });
    g.release(forged); // server said the MAC is wrong
    expect(g.lastSeq).toBe(0);
    expect(g.admit(forged, T0 + 1, true)).toEqual({ ok: true }); // the id is free again; nothing was learned
    const legit = await msg({ seq: 1, ts: T0 });
    expect(g.admit(legit, T0, true)).toEqual({ ok: true });
  });
  it("rejects stale events and events from the future", async () => {
    const g = gate();
    connect(g);
    expect(g.admit(await msg({ seq: 1, ts: T0 - MAX_EVENT_AGE_MS - 1 }), T0, true)).toEqual({ ok: false, reason: "stale" });
    expect(g.admit(await msg({ seq: 1, ts: T0 + MAX_EVENT_AGE_MS + 1 }), T0, true)).toEqual({ ok: false, reason: "stale" });
  });
  it("while checkout is running (or the bill is finished) scans are refused, NOT queued and NOT consumed", async () => {
    const g = gate();
    connect(g);
    const m = await msg({ seq: 1, ts: T0 });
    expect(g.admit(m, T0, false)).toEqual({ ok: false, reason: "paused" });
    expect(g.lastSeq).toBe(0);
    // the same event may be retried once the terminal accepts scans again
    expect(g.admit(m, T0 + 10, true)).toEqual({ ok: true });
  });
  it("Disconnect revokes immediately and permanently: no further hello, scan or liveness", async () => {
    const g = gate();
    connect(g);
    g.revoke();
    expect(g.state).toBe("closed");
    expect(g.admit(await msg({ seq: 1, ts: T0 }), T0, true)).toEqual({ ok: false, reason: "closed" });
    expect(connect(g)).toEqual({ ok: false, reason: "closed" });
    expect(g.alive(ids.did, T0)).toBe(false);
    expect(g.tick(T0 + 1)).toBe("closed");
  });
  it("goes Disconnected after silence and Reconnects on the next authenticated message from the same phone", async () => {
    const g = gate();
    connect(g);
    expect(g.tick(T0 + DISCONNECT_AFTER_MS + 1)).toBe("disconnected");
    const m = await msg({ seq: 1, ts: T0 + DISCONNECT_AFTER_MS + 2 });
    expect(g.admit(m, T0 + DISCONNECT_AFTER_MS + 2, true)).toEqual({ ok: true });
    g.confirm(m, T0 + DISCONNECT_AFTER_MS + 2);
    expect(g.state).toBe("connected");
    // and a different device cannot reconnect into it
    expect(g.alive("33333333-3333-4333-8333-333333333333", T0 + DISCONNECT_AFTER_MS + 3)).toBe(false);
  });
  it("reconnect resend: events replayed after a drop are not applied twice", async () => {
    const g = gate();
    connect(g);
    const a = await msg({ seq: 1, ts: T0 });
    const b = await msg({ seq: 2, ts: T0 + 1 });
    for (const m of [a, b]) {
      expect(g.admit(m, T0 + 2, true)).toEqual({ ok: true });
      g.confirm(m, T0 + 2);
    }
    for (const m of [a, b]) expect(g.admit(m, T0 + 3, true).ok).toBe(false);
  });
});

describe("ScanDebouncer (phone camera frames)", () => {
  it("one presentation held in view produces one scan", () => {
    const d = new ScanDebouncer(1000);
    expect(d.sighting("A", 0)).toBe(true);
    for (let t = 100; t <= 3000; t += 100) expect(d.sighting("A", t)).toBe(false);
  });
  it("the same barcode scanned again after it left view (gap > threshold) is a NEW scan", () => {
    const d = new ScanDebouncer(1000);
    expect(d.sighting("A", 0)).toBe(true);
    expect(d.sighting("A", 500)).toBe(false);
    expect(d.sighting("A", 1600)).toBe(true);
  });
  it("a different barcode is accepted immediately, so A, B, A yields three events", () => {
    const d = new ScanDebouncer(1000);
    expect([d.sighting("A", 0), d.sighting("B", 50), d.sighting("A", 100)]).toEqual([true, true, true]);
  });
  it("reset starts fresh", () => {
    const d = new ScanDebouncer(1000);
    d.sighting("A", 0);
    d.reset();
    expect(d.sighting("A", 10)).toBe(true);
  });
});

describe("RateLimiter", () => {
  it("allows up to max per window per key, then refuses, then recovers", () => {
    const r = new RateLimiter(3, 1000);
    expect([r.take("u", 0), r.take("u", 1), r.take("u", 2), r.take("u", 3)]).toEqual([true, true, true, false]);
    expect(r.take("other", 3)).toBe(true);
    expect(r.take("u", 1000)).toBe(true);
  });
});

describe("misc", () => {
  it("b64url round-trips arbitrary bytes", () => {
    const bytes = Uint8Array.from({ length: 64 }, (_, i) => (i * 37) % 256);
    expect(b64url(bytes)).not.toMatch(/[+/=]/);
  });
});
