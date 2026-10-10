import { describe, expect, it } from "vitest";
import { claimPairing, createPairing, verifyIncoming, type Caller, type Deps } from "@/server/scanner/service";
import { openScanChannel, type ChannelLike, type RealtimeClient } from "./channel";
import { ComputerScanController, type ComputerView } from "./computer-controller";
import { PairingGate } from "./gate";
import { PhoneScanController, type PhoneView } from "./phone-controller";
import { fromB64url, type Ack, type AckStatus, type ScanMessage } from "./protocol";
import { startScanning, type CameraDeps } from "./decoder";

const SECRET = "k".repeat(48);
const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};

/** In-memory Supabase-Broadcast-like bus: a message goes to every OTHER subscriber of the same channel. */
class Bus {
  subs = new Map<string, Set<(p: unknown) => void>>();
  up = true;
  subscribe(name: string, cb: (p: unknown) => void) {
    (this.subs.get(name) ?? this.subs.set(name, new Set()).get(name)!).add(cb);
    return () => this.subs.get(name)!.delete(cb);
  }
  publish(name: string, from: (p: unknown) => void, payload: unknown) {
    if (!this.up) return;
    for (const cb of this.subs.get(name) ?? []) if (cb !== from) queueMicrotask(() => cb(JSON.parse(JSON.stringify(payload))));
  }
}

const CATALOGUE: Record<string, AckStatus> = { "0012345678905": "added", NRC00000001: "added", "5901234123457": "added", INACTIVE1: "unavailable" };

interface Terminal {
  caller: Caller;
  token: string;
  sid: string;
  cart: Map<string, number>;
  views: ComputerView[];
  acks: Ack[];
  accepting: boolean;
  ctl: ComputerScanController;
  clock: { t: number };
  onBusPayload: (p: unknown) => void;
}

let uid = 0;
const newId = () => `00000000-0000-4000-8000-${String(++uid).padStart(12, "0")}`;
const depsAt = (clock: { t: number }): Deps => ({ secret: SECRET, now: () => clock.t, newId });

async function terminal(bus: Bus, clock: { t: number }, caller: Caller): Promise<Terminal> {
  const p = await createPairing(caller, depsAt(clock));
  if (!p.ok) throw new Error("pairing");
  const t = { caller, token: p.token, sid: p.sid, cart: new Map<string, number>(), views: [] as ComputerView[], acks: [] as Ack[], accepting: true, clock } as Terminal;
  const name = `nv-scan:${p.sid}`;
  t.ctl = new ComputerScanController(new PairingGate(p.sid, p.pairBy, p.until), {
    verify: async (m: ScanMessage) => (await verifyIncoming(p.token, m, caller, depsAt(clock))).ok,
    send: (a) => {
      t.acks.push(a);
      bus.publish(name, t.onBusPayload, a);
    },
    onScan: async (bc) => {
      const s = CATALOGUE[bc] ?? "unknown";
      if (s === "added") t.cart.set(bc, (t.cart.get(bc) ?? 0) + 1);
      return s;
    },
    accepting: () => t.accepting,
    now: () => clock.t,
    onChange: (v) => t.views.push(v),
  });
  t.onBusPayload = (payload) => void t.ctl.handle(payload);
  bus.subscribe(name, t.onBusPayload);
  return t;
}

interface Phone {
  ctl: PhoneScanController;
  views: PhoneView[];
  sent: ScanMessage[];
  onBusPayload: (p: unknown) => void;
}
async function phone(bus: Bus, clock: { t: number }, term: Terminal, user: Caller, opts: { claimToken?: string } = {}): Promise<Phone> {
  const c = await claimPairing(opts.claimToken ?? term.token, user, depsAt(clock));
  if (!c.ok) throw new Error("claim " + c.code);
  const name = `nv-scan:${c.sid}`;
  const ph = { views: [] as PhoneView[], sent: [] as ScanMessage[] } as Phone;
  ph.ctl = new PhoneScanController(
    { sid: c.sid, did: c.did, puid: user.userId, scanKey: fromB64url(c.scanKey), label: "Test phone" },
    {
      send: (m) => {
        ph.sent.push(m);
        bus.publish(name, ph.onBusPayload, m);
      },
      now: () => clock.t,
      newId,
      onChange: (v) => ph.views.push(v),
    },
  );
  ph.onBusPayload = (payload) => ph.ctl.onAck(payload as Ack);
  bus.subscribe(name, ph.onBusPayload);
  return ph;
}

const owner: Caller = { userId: "user-owner-1", tenantId: "tenant-A", branchId: "branch-A1", canSell: true };
const phoneUser: Caller = { userId: "user-phone-1", tenantId: "tenant-A", branchId: "branch-A1", canSell: true };

async function pairedUp() {
  const bus = new Bus();
  const clock = { t: 1_700_000_000_000 };
  const term = await terminal(bus, clock, owner);
  const ph = await phone(bus, clock, term, phoneUser);
  await ph.ctl.hello();
  await settle();
  return { bus, clock, term, ph };
}

describe("pairing flow", () => {
  it("waiting -> connected after the phone's first authenticated hello; label is shown", async () => {
    const bus = new Bus();
    const clock = { t: 1_700_000_000_000 };
    const term = await terminal(bus, clock, owner);
    expect(term.ctl.view().state).toBe("waiting");
    const ph = await phone(bus, clock, term, phoneUser);
    await ph.ctl.hello();
    await settle();
    expect(term.ctl.view()).toMatchObject({ state: "connected", label: "Test phone" });
    expect(term.acks.at(-1)).toMatchObject({ kind: "state", state: "connected" });
    expect(ph.ctl.state).toBe("connected");
  });

  it("the QR expires: after the window nobody can claim it and the terminal shows Expired", async () => {
    const bus = new Bus();
    const clock = { t: 1_700_000_000_000 };
    const term = await terminal(bus, clock, owner);
    clock.t += 5 * 60_000 + 1;
    await expect(phone(bus, clock, term, phoneUser)).rejects.toThrow(/EXPIRED/);
    expect(term.ctl.view().state).toBe("expired");
  });

  it("a user from another tenant cannot join, and a forged hello from someone who only knows the channel name is ignored", async () => {
    const bus = new Bus();
    const clock = { t: 1_700_000_000_000 };
    const term = await terminal(bus, clock, owner);
    await expect(phone(bus, clock, term, { ...phoneUser, tenantId: "tenant-B" })).rejects.toThrow(/FORBIDDEN/);
    bus.publish(`nv-scan:${term.sid}`, () => {}, { v: 1, kind: "hello", sid: term.sid, did: newId(), puid: "intruder-user-1", seq: 1, eid: newId(), ts: clock.t, bc: "", label: "Evil", mac: "A".repeat(43) });
    await settle();
    expect(term.ctl.view().state).toBe("waiting");
    expect(term.ctl.view().label).toBe("");
  });

  it("a second phone using the same QR is told the terminal is busy and cannot scan", async () => {
    const { bus, clock, term, ph } = await pairedUp();
    const ph2 = await phone(bus, clock, term, { ...phoneUser, userId: "user-phone-2" });
    await ph2.ctl.hello();
    await settle();
    expect(ph2.ctl.state).toBe("busy");
    expect(await ph2.ctl.scan("NRC00000001")).toBe("closed");
    expect(term.cart.size).toBe(0);
    expect(ph.ctl.state).toBe("connected");
  });
});

describe("scan delivery into the cart", () => {
  it("a scan on the phone appears in the paired terminal's cart, and the phone is told it was added", async () => {
    const { term, ph, clock } = await pairedUp();
    clock.t += 10;
    expect(await ph.ctl.scan("0012345678905")).toBe("sent"); // leading zeros preserved
    await settle();
    expect(term.cart.get("0012345678905")).toBe(1);
    expect(ph.views.at(-1)).toMatchObject({ lastBarcode: "0012345678905", lastStatus: "added", pending: 0 });
    expect(term.ctl.view().scans).toBe(1);
  });

  it("an unknown barcode is reported and nothing is added", async () => {
    const { term, ph, clock } = await pairedUp();
    clock.t += 10;
    await ph.ctl.scan("9999999999999");
    await settle();
    expect(term.cart.size).toBe(0);
    expect(ph.views.at(-1)?.lastStatus).toBe("unknown");
    expect(term.ctl.view().note).toMatch(/unknown/);
  });

  it("an inactive/unavailable product is not added", async () => {
    const { term, ph, clock } = await pairedUp();
    clock.t += 10;
    await ph.ctl.scan("INACTIVE1");
    await settle();
    expect(term.cart.size).toBe(0);
    expect(ph.views.at(-1)?.lastStatus).toBe("unavailable");
  });

  it("scanning the same product again after it left view adds again; holding it in view does not", async () => {
    const { term, ph, clock } = await pairedUp();
    clock.t += 10;
    await ph.ctl.scan("NRC00000001");
    for (let i = 0; i < 8; i++) {
      clock.t += 100; // the same frame sequence
      expect(await ph.ctl.scan("NRC00000001")).toBe("ignored");
    }
    await settle();
    expect(term.cart.get("NRC00000001")).toBe(1);
    clock.t += 1200; // item removed, next one presented
    expect(await ph.ctl.scan("NRC00000001")).toBe("sent");
    await settle();
    expect(term.cart.get("NRC00000001")).toBe(2);
  });

  it("A, B, A scanned quickly produces three events", async () => {
    const { term, ph, clock } = await pairedUp();
    for (const code of ["NRC00000001", "5901234123457", "NRC00000001"]) {
      clock.t += 50;
      await ph.ctl.scan(code);
    }
    await settle();
    expect(term.cart.get("NRC00000001")).toBe(2);
    expect(term.cart.get("5901234123457")).toBe(1);
  });

  it("invalid barcodes never leave the phone", async () => {
    const { ph } = await pairedUp();
    const before = ph.sent.length;
    for (const bad of ["", "  ", "has space", "x".repeat(80)]) expect(await ph.ctl.scan(bad)).toBe("invalid");
    expect(ph.sent.length).toBe(before);
  });
});

describe("duplicates, reconnection and loss", () => {
  it("a duplicate transport event (same event id) does not add twice, and the original answer is repeated", async () => {
    const { bus, term, ph, clock } = await pairedUp();
    clock.t += 10;
    await ph.ctl.scan("NRC00000001");
    await settle();
    const scan = ph.sent.find((m) => m.kind === "scan")!;
    bus.publish(`nv-scan:${term.sid}`, ph.onBusPayload, scan); // delivered a second time
    bus.publish(`nv-scan:${term.sid}`, ph.onBusPayload, scan);
    await settle();
    expect(term.cart.get("NRC00000001")).toBe(1);
    expect(term.acks.filter((a) => a.kind === "ack" && a.eid === scan.eid).length).toBeGreaterThanOrEqual(2);
  });

  it("connection loss: scans made while offline are retried with the SAME ids after reconnect and applied exactly once", async () => {
    const { bus, term, ph, clock } = await pairedUp();
    await ph.ctl.onTransport(false);
    expect(ph.ctl.state).toBe("reconnecting");
    bus.up = false;
    clock.t += 10;
    await ph.ctl.scan("NRC00000001");
    clock.t += 1500;
    await ph.ctl.scan("5901234123457");
    await settle();
    expect(term.cart.size).toBe(0); // nothing silently lost, nothing delivered yet
    expect(ph.views.at(-1)?.pending).toBe(2);
    bus.up = true;
    await ph.ctl.onTransport(true);
    await settle();
    expect(term.cart.get("NRC00000001")).toBe(1);
    expect(term.cart.get("5901234123457")).toBe(1);
    expect(ph.views.at(-1)?.pending).toBe(0);
    // a further retry tick resends nothing because everything was acknowledged
    const n = ph.sent.length;
    clock.t += 10_000;
    ph.ctl.retry();
    expect(ph.sent.length).toBe(n);
  });

  it("an event that is never acknowledged is retried, then reported as failed (never silently dropped)", async () => {
    const { bus, ph, clock } = await pairedUp();
    bus.up = false;
    clock.t += 10;
    await ph.ctl.scan("NRC00000001");
    const before = ph.sent.length;
    clock.t += 3500;
    ph.ctl.retry();
    expect(ph.sent.length).toBe(before + 1);
    clock.t += 40_000;
    ph.ctl.retry();
    expect(ph.views.at(-1)?.lastStatus).toBe("failed");
  });

  it("silence marks the phone Disconnected; the next authenticated heartbeat reconnects it; the cart is untouched throughout", async () => {
    const { term, ph, clock } = await pairedUp();
    clock.t += 10;
    await ph.ctl.scan("NRC00000001");
    await settle();
    clock.t += 30_000;
    term.ctl.tick();
    expect(term.ctl.view().state).toBe("disconnected");
    expect(term.cart.get("NRC00000001")).toBe(1);
    await ph.ctl.heartbeat();
    await settle();
    expect(term.ctl.view().state).toBe("connected");
  });
});

describe("disconnection, revocation and checkout", () => {
  it("Disconnect on the computer revokes immediately: later scans are not applied and the phone is told", async () => {
    const { term, ph, clock } = await pairedUp();
    clock.t += 10;
    await ph.ctl.scan("NRC00000001");
    await settle();
    term.ctl.disconnect();
    await settle();
    expect(ph.ctl.state).toBe("closed");
    clock.t += 2000;
    // even a phone that ignores the notice cannot add anything
    const forced = new PhoneScanController({ sid: term.sid, did: ph.sent[0]!.did, puid: phoneUser.userId, scanKey: new Uint8Array(32), label: "x" }, { send: () => {}, now: () => clock.t, newId, onChange: () => {} });
    void forced;
    for (const m of ph.sent.filter((x) => x.kind === "scan")) await term.ctl.handle({ ...m, eid: newId(), seq: 99 }); // forged resend: MAC fails
    await term.ctl.handle(ph.sent.find((x) => x.kind === "hello")); // old hello
    expect(term.cart.get("NRC00000001")).toBe(1);
    expect(term.ctl.view().state).toBe("closed");
  });

  it("when the phone disconnects, the terminal says so and keeps its cart", async () => {
    const { term, ph, clock } = await pairedUp();
    clock.t += 10;
    await ph.ctl.scan("NRC00000001");
    await settle();
    await ph.ctl.disconnect();
    await settle();
    expect(term.ctl.view().state).toBe("disconnected");
    expect(term.cart.get("NRC00000001")).toBe(1);
  });

  it("a scan that arrives while checkout is running is refused (not queued, not applied), and works once billing is ready again", async () => {
    const { term, ph, clock } = await pairedUp();
    term.accepting = false;
    clock.t += 10;
    await ph.ctl.scan("NRC00000001");
    await settle();
    expect(term.cart.size).toBe(0);
    expect(ph.views.at(-1)?.lastStatus).toBe("paused");
    term.accepting = true;
    clock.t += 1500;
    await ph.ctl.scan("NRC00000001");
    await settle();
    expect(term.cart.get("NRC00000001")).toBe(1);
  });

  it("checkout starting during server verification still prevents the scan from touching the cart", async () => {
    const bus = new Bus();
    const clock = { t: 1_700_000_000_000 };
    const term = await terminal(bus, clock, owner);
    const ph = await phone(bus, clock, term, phoneUser);
    await ph.ctl.hello();
    await settle();
    const realVerify = (term.ctl as unknown as { d: { verify: (m: ScanMessage) => Promise<boolean> } }).d;
    const orig = realVerify.verify;
    realVerify.verify = async (m) => {
      const ok = await orig(m);
      term.accepting = false; // the cashier pressed Complete bill meanwhile
      return ok;
    };
    clock.t += 10;
    await ph.ctl.scan("NRC00000001");
    await settle();
    expect(term.cart.size).toBe(0);
    expect(ph.views.at(-1)?.lastStatus).toBe("paused");
  });

  it("the protocol cannot create a sale, payment or stock change: the only thing the computer does with a scan is onScan(barcode)", async () => {
    const { term, ph, clock } = await pairedUp();
    const calls: string[] = [];
    (term.ctl as unknown as { d: { onScan: (b: string) => Promise<AckStatus> } }).d.onScan = async (b) => (calls.push(b), "added");
    clock.t += 10;
    await ph.ctl.scan("NRC00000001");
    await settle();
    expect(calls).toEqual(["NRC00000001"]);
  });
});

describe("multiple terminals keep separate carts", () => {
  it("two terminals, two phones: each scan lands only in its own cart, even for the same barcode", async () => {
    const bus = new Bus();
    const clock = { t: 1_700_000_000_000 };
    const a = await terminal(bus, clock, owner);
    const b = await terminal(bus, clock, { ...owner, userId: "user-owner-2" });
    const pa = await phone(bus, clock, a, phoneUser);
    const pb = await phone(bus, clock, b, { ...phoneUser, userId: "user-phone-2" });
    await pa.ctl.hello();
    await pb.ctl.hello();
    await settle();
    clock.t += 10;
    await pa.ctl.scan("NRC00000001");
    await pb.ctl.scan("5901234123457");
    clock.t += 1500;
    await pa.ctl.scan("NRC00000001");
    await settle();
    expect([...a.cart]).toEqual([["NRC00000001", 2]]);
    expect([...b.cart]).toEqual([["5901234123457", 1]]);
  });

  it("a message replayed into ANOTHER terminal's channel is ignored (wrong session)", async () => {
    const bus = new Bus();
    const clock = { t: 1_700_000_000_000 };
    const a = await terminal(bus, clock, owner);
    const b = await terminal(bus, clock, owner);
    const pa = await phone(bus, clock, a, phoneUser);
    await pa.ctl.hello();
    await settle();
    clock.t += 10;
    await pa.ctl.scan("NRC00000001");
    await settle();
    const scan = pa.sent.find((m) => m.kind === "scan")!;
    bus.publish(`nv-scan:${b.sid}`, () => {}, scan);
    await settle();
    expect(b.cart.size).toBe(0);
  });
});

describe("realtime channel wrapper", () => {
  function fakeClient() {
    const log: string[] = [];
    const channels: { name: string; cb?: (s: string) => void; handler?: (p: { payload: unknown }) => void; sent: unknown[] }[] = [];
    const client: RealtimeClient = {
      channel(name) {
        const rec: (typeof channels)[number] = { name, sent: [] };
        channels.push(rec);
        const ch: ChannelLike = {
          on(_t, _f, cb) {
            rec.handler = cb;
            return ch;
          },
          subscribe(cb) {
            rec.cb = cb;
            return ch;
          },
          send: (m) => (rec.sent.push(m.payload), "ok"),
        };
        (rec as unknown as { ch: ChannelLike }).ch = ch;
        return ch;
      },
      removeChannel: () => (log.push("removed"), Promise.resolve()),
    };
    return { client, channels, log };
  }
  const manual = () => {
    const q: { f: () => void; ms: number }[] = [];
    return { q, timers: { set: (f: () => void, ms: number) => (q.push({ f, ms }), q.length), clear: () => {} } };
  };

  it("reports up/down, resubscribes with growing backoff, and ignores callbacks from replaced channels", () => {
    const { client, channels, log } = fakeClient();
    const m = manual();
    const transport: boolean[] = [];
    const payloads: unknown[] = [];
    const ch = openScanChannel(client, "11111111-1111-4111-8111-111111111111", { onPayload: (p) => payloads.push(p), onTransport: (u) => transport.push(u) }, m.timers);
    expect(channels[0]!.name).toBe("nv-scan:11111111-1111-4111-8111-111111111111");
    channels[0]!.cb!("SUBSCRIBED");
    channels[0]!.handler!({ payload: { hi: 1 } });
    ch.send({ x: 1 });
    expect(channels[0]!.sent).toEqual([{ x: 1 }]);
    channels[0]!.cb!("CHANNEL_ERROR");
    channels[0]!.cb!("TIMED_OUT"); // only one retry is scheduled
    expect(m.q.length).toBe(1);
    expect(m.q[0]!.ms).toBe(1000);
    ch.send({ lost: true }); // offline: not sent
    expect(channels[0]!.sent.length).toBe(1);
    m.q[0]!.f();
    expect(channels.length).toBe(2);
    expect(log).toEqual(["removed"]);
    channels[0]!.cb!("SUBSCRIBED"); // stale callback from the old channel
    channels[0]!.handler!({ payload: "stale" });
    channels[1]!.cb!("CHANNEL_ERROR");
    expect(m.q[1]!.ms).toBe(2000);
    m.q[1]!.f();
    channels[2]!.cb!("SUBSCRIBED");
    channels[2]!.handler!({ payload: { hi: 2 } });
    expect(transport).toEqual([true, false, true]);
    expect(payloads).toEqual([{ hi: 1 }, { hi: 2 }]);
    ch.close();
    channels[2]!.cb!("CLOSED");
    channels[2]!.handler!({ payload: "after close" });
    expect(payloads.length).toBe(2);
    ch.send({ after: true });
    expect(channels[2]!.sent.length).toBe(0);
  });
});

describe("camera decoder (mocked; real camera needs a real phone)", () => {
  const track = () => ({ stopped: false, stop() { this.stopped = true; }, getSettings: () => ({ deviceId: "cam-1" }) });
  const video = () => ({ srcObject: null as unknown, setAttribute() {}, play: async () => {} }) as unknown as HTMLVideoElement;
  const media = (opts: { reject?: string } = {}) => {
    const tracks = [track()];
    const calls: unknown[] = [];
    const mediaDevices = {
      getUserMedia: async (c: unknown) => {
        calls.push(c);
        if (opts.reject) throw Object.assign(new Error("x"), { name: opts.reject });
        return { getTracks: () => tracks, getVideoTracks: () => tracks } as unknown as MediaStream;
      },
      enumerateDevices: async () => [],
    };
    return { mediaDevices, tracks, calls };
  };

  it("permission denied, no camera, camera busy, insecure page and unsupported browser each give a distinct, actionable error", async () => {
    for (const [name, expected] of [["NotAllowedError", "PERMISSION_DENIED"], ["NotFoundError", "NO_CAMERA"], ["NotReadableError", "IN_USE"], ["Weird", "FAILED"]] as const) {
      const m = media({ reject: name });
      expect(await startScanning(video(), () => {}, {}, { mediaDevices: m.mediaDevices, isSecureContext: true, Detector: null })).toEqual({ ok: false, error: expected });
    }
    expect(await startScanning(video(), () => {}, {}, { isSecureContext: false })).toEqual({ ok: false, error: "INSECURE_CONTEXT" });
    expect(await startScanning(video(), () => {}, {}, { isSecureContext: true, mediaDevices: {} as never })).toEqual({ ok: false, error: "UNSUPPORTED" });
    const m = media();
    expect(await startScanning(video(), () => {}, {}, { mediaDevices: m.mediaDevices, isSecureContext: true, Detector: null })).toEqual({ ok: false, error: "UNSUPPORTED" });
    expect(m.tracks[0]!.stopped).toBe(true); // an unusable start must not leave the camera on
  });

  it("requests the rear camera by default, decodes locally with the native detector, and stop() releases every track", async () => {
    const m = media();
    const codes: string[] = [];
    const timers: (() => void)[] = [];
    class Det {
      static getSupportedFormats = async () => ["ean_13", "code_128", "qr_code"];
      formats: string[];
      constructor(o: { formats: string[] }) {
        this.formats = o.formats;
        Det.last = this;
      }
      static last: Det;
      async detect() {
        return [{ rawValue: "0012345678905" }];
      }
    }
    const deps: CameraDeps = { mediaDevices: m.mediaDevices, isSecureContext: true, Detector: Det as never, setTimer: (f) => (timers.push(f), timers.length), clearTimer: () => {} };
    const r = await startScanning(video(), (c) => codes.push(c), {}, deps);
    expect(r.ok).toBe(true);
    expect(m.calls[0]).toEqual({ audio: false, video: { facingMode: { ideal: "environment" } } });
    expect(Det.last.formats).toEqual(["ean_13", "code_128"]); // only supported formats are requested
    timers.shift()!();
    await settle();
    expect(codes).toEqual(["0012345678905"]); // leading zeros intact, nothing but text leaves the decoder
    if (r.ok) r.stop();
    expect(m.tracks[0]!.stopped).toBe(true);
    const n = codes.length;
    timers.shift()?.();
    await settle();
    expect(codes.length).toBe(n); // no decode after stop
  });

  it("a chosen camera is requested by exact device id", async () => {
    const m = media();
    await startScanning(video(), () => {}, { deviceId: "cam-9" }, { mediaDevices: m.mediaDevices, isSecureContext: true, Detector: class { async detect() { return []; } } as never, setTimer: () => 1, clearTimer: () => {} });
    expect(m.calls[0]).toEqual({ audio: false, video: { deviceId: { exact: "cam-9" } } });
  });

  it("starting again stops the previous decode loop first: there is never more than one", async () => {
    const m1 = media();
    const m2 = media();
    const D = class { async detect() { return []; } };
    const common = { isSecureContext: true, Detector: D as never, setTimer: () => 1, clearTimer: () => {} };
    await startScanning(video(), () => {}, {}, { ...common, mediaDevices: m1.mediaDevices });
    await startScanning(video(), () => {}, {}, { ...common, mediaDevices: m2.mediaDevices });
    expect(m1.tracks[0]!.stopped).toBe(true);
    expect(m2.tracks[0]!.stopped).toBe(false);
  });

  it("uses the zxing fallback when the browser has no native detector", async () => {
    const m = media();
    const seen: string[] = [];
    let stopped = false;
    const r = await startScanning(video(), (c) => seen.push(c), {}, { mediaDevices: m.mediaDevices, isSecureContext: true, Detector: null, zxing: async (_s, _v, onText) => (onText("NRC00000001"), () => (stopped = true)) });
    expect(r.ok).toBe(true);
    expect(seen).toEqual(["NRC00000001"]);
    if (r.ok) r.stop();
    expect(stopped).toBe(true);
    expect(m.tracks[0]!.stopped).toBe(true);
  });
});
