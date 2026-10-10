import { describe, expect, it } from "vitest";
import { signMessage } from "@/lib/scanner/crypto";
import { PAIR_WINDOW_MS, SESSION_LIFE_MS, fromB64url, type ScanMessage } from "@/lib/scanner/protocol";
import { claimPairing, createPairing, inspectPairing, verifyIncoming, type Caller, type Deps } from "./service";

const SECRET = "s".repeat(48);
let clock = 1_000_000;
let counter = 0;
const deps = (over: Partial<Deps> = {}): Deps => ({
  secret: SECRET,
  now: () => clock,
  newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
  ...over,
});
const owner: Caller = { userId: "user-owner-1", tenantId: "tenant-A", branchId: "branch-A1", canSell: true };
const phoneUser: Caller = { userId: "user-phone-1", tenantId: "tenant-A", branchId: "branch-A1", canSell: true };

async function pair() {
  const p = await createPairing(owner, deps());
  if (!p.ok) throw new Error("pairing failed");
  return p;
}

async function scanFrom(claim: { sid: string; did: string; scanKey: string }, puid: string, over: Partial<ScanMessage> = {}) {
  return signMessage(fromB64url(claim.scanKey), { v: 1, kind: "scan", sid: claim.sid, did: claim.did, puid, seq: 1, eid: `99999999-9999-4999-8999-${String(++counter).padStart(12, "0")}`, ts: clock, bc: "0012345678905", label: "Phone", ...over });
}

describe("createPairing (billing computer)", () => {
  it("creates a short-lived pairing bound to the signed-in user, tenant and branch", async () => {
    const p = await createPairing(owner, deps());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.pairBy - clock).toBe(PAIR_WINDOW_MS);
    expect(p.until - clock).toBe(SESSION_LIFE_MS);
    const payload = JSON.parse(Buffer.from(p.token.split(".")[0]!, "base64url").toString());
    expect(payload).toMatchObject({ uid: owner.userId, tid: owner.tenantId, bid: owner.branchId });
    expect(p.token).not.toContain(SECRET);
  });
  it("two pairings never collide and carry different terminal ids", async () => {
    const a = await pair();
    const b = await pair();
    expect(a.sid).not.toBe(b.sid);
    expect(a.token).not.toBe(b.token);
  });
  it("refuses a user who may not sell", async () => {
    expect(await createPairing({ ...owner, canSell: false }, deps())).toEqual({ ok: false, code: "FORBIDDEN" });
  });
});

describe("claimPairing (phone)", () => {
  it("an authorised user of the same tenant and branch receives a scan key bound to this session and device", async () => {
    const p = await pair();
    const c = await claimPairing(p.token, phoneUser, deps());
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.sid).toBe(p.sid);
    expect(c.until).toBe(p.until);
    expect(fromB64url(c.scanKey).length).toBe(32);
  });
  it("refuses other tenants, other branches and users who cannot sell", async () => {
    const p = await pair();
    expect(await claimPairing(p.token, { ...phoneUser, tenantId: "tenant-B" }, deps())).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(await claimPairing(p.token, { ...phoneUser, branchId: "branch-A2" }, deps())).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(await claimPairing(p.token, { ...phoneUser, canSell: false }, deps())).toEqual({ ok: false, code: "FORBIDDEN" });
  });
  it("refuses an expired QR, a tampered token and junk", async () => {
    const p = await pair();
    clock += PAIR_WINDOW_MS + 1;
    expect(await claimPairing(p.token, phoneUser, deps())).toEqual({ ok: false, code: "EXPIRED" });
    clock -= PAIR_WINDOW_MS + 1;
    const [body, mac] = p.token.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), tid: "tenant-B" })).toString("base64url");
    expect(await claimPairing(`${forged}.${mac}`, { ...phoneUser, tenantId: "tenant-B" }, deps())).toEqual({ ok: false, code: "INVALID" });
    expect(await claimPairing("junk", phoneUser, deps())).toEqual({ ok: false, code: "INVALID" });
    expect(await claimPairing(undefined, phoneUser, deps())).toEqual({ ok: false, code: "INVALID" });
  });
  it("a token signed with a different secret (another deployment) is refused", async () => {
    const p = await pair();
    expect(await claimPairing(p.token, phoneUser, deps({ secret: "t".repeat(48) }))).toEqual({ ok: false, code: "INVALID" });
  });
  it("two claims of the same QR yield different device ids and different keys (the computer then locks to the first)", async () => {
    const p = await pair();
    const a = await claimPairing(p.token, phoneUser, deps());
    const b = await claimPairing(p.token, phoneUser, deps());
    if (!a.ok || !b.ok) throw new Error("claims failed");
    expect(a.did).not.toBe(b.did);
    expect(a.scanKey).not.toBe(b.scanKey);
  });
  it("inspect tells a phone whether this QR is valid FOR IT, without returning any key", async () => {
    const p = await pair();
    expect(await inspectPairing(p.token, phoneUser, deps())).toEqual({ ok: true, sid: p.sid });
    expect(await inspectPairing(p.token, { ...phoneUser, tenantId: "tenant-B" }, deps())).toEqual({ ok: false, code: "FORBIDDEN" });
  });
});

describe("verifyIncoming (billing computer checks what arrived on the public channel)", () => {
  it("accepts a message authenticated by the key issued to the phone at claim time", async () => {
    const p = await pair();
    const c = await claimPairing(p.token, phoneUser, deps());
    if (!c.ok) throw new Error("claim");
    const m = await scanFrom(c, phoneUser.userId);
    expect(await verifyIncoming(p.token, m, owner, deps())).toEqual({ ok: true, msg: m });
  });
  it("rejects a message forged by someone who only knows the channel name (no scan key)", async () => {
    const p = await pair();
    const forged = { v: 1, kind: "scan", sid: p.sid, did: "22222222-2222-4222-8222-222222222222", puid: "attacker-user-1", seq: 1, eid: "99999999-9999-4999-8999-000000000001", ts: clock, bc: "0012345678905", label: "Phone", mac: "A".repeat(43) };
    expect(await verifyIncoming(p.token, forged, owner, deps())).toEqual({ ok: false, code: "INVALID" });
  });
  it("rejects a message whose barcode was changed after signing", async () => {
    const p = await pair();
    const c = await claimPairing(p.token, phoneUser, deps());
    if (!c.ok) throw new Error("claim");
    const m = await scanFrom(c, phoneUser.userId);
    expect(await verifyIncoming(p.token, { ...m, bc: "9999999999999" }, owner, deps())).toEqual({ ok: false, code: "INVALID" });
  });
  it("rejects a valid key presented with another phone user's id (the key is bound to the claiming user)", async () => {
    const p = await pair();
    const c = await claimPairing(p.token, phoneUser, deps());
    if (!c.ok) throw new Error("claim");
    const m = await scanFrom(c, "someone-else-1");
    expect(await verifyIncoming(p.token, m, owner, deps())).toEqual({ ok: false, code: "INVALID" });
  });
  it("only the computer's own user, tenant and branch may verify (another tenant's user cannot use this pairing)", async () => {
    const p = await pair();
    const c = await claimPairing(p.token, phoneUser, deps());
    if (!c.ok) throw new Error("claim");
    const m = await scanFrom(c, phoneUser.userId);
    expect(await verifyIncoming(p.token, m, { ...owner, tenantId: "tenant-B" }, deps())).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(await verifyIncoming(p.token, m, { ...owner, userId: "user-other-9" }, deps())).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(await verifyIncoming(p.token, m, { ...owner, branchId: "branch-A2" }, deps())).toEqual({ ok: false, code: "FORBIDDEN" });
  });
  it("a message from a different pairing (another terminal) is refused even if its own MAC is valid", async () => {
    const p1 = await pair();
    const p2 = await pair();
    const c2 = await claimPairing(p2.token, phoneUser, deps());
    if (!c2.ok) throw new Error("claim");
    const m = await scanFrom(c2, phoneUser.userId);
    expect(await verifyIncoming(p1.token, m, owner, deps())).toEqual({ ok: false, code: "INVALID" });
  });
  it("after the session life ends nothing verifies, so an expired session cannot add scans", async () => {
    const p = await pair();
    const c = await claimPairing(p.token, phoneUser, deps());
    if (!c.ok) throw new Error("claim");
    const m = await scanFrom(c, phoneUser.userId);
    clock = p.until + 1;
    expect(await verifyIncoming(p.token, m, owner, deps())).toEqual({ ok: false, code: "EXPIRED" });
  });
  it("a hello and a ping verify like scans; a non-protocol payload does not", async () => {
    const p = await pair();
    const c = await claimPairing(p.token, phoneUser, deps());
    if (!c.ok) throw new Error("claim");
    for (const kind of ["hello", "ping"] as const) {
      const m = await scanFrom(c, phoneUser.userId, { kind, bc: "" });
      expect((await verifyIncoming(p.token, m, owner, deps())).ok).toBe(true);
    }
    expect(await verifyIncoming(p.token, { v: 1, kind: "pay", amount: 1 }, owner, deps())).toEqual({ ok: false, code: "INVALID" });
  });
});
