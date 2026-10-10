/**
 * Pure state machines for the scanner. No timers, no I/O: the caller passes `now`, so every rule is unit-testable.
 */
import { DISCONNECT_AFTER_MS, MAX_EVENT_AGE_MS, SAME_CODE_COOLDOWN_MS, type ScanMessage } from "./protocol";

export type PairingState = "waiting" | "connected" | "disconnected" | "expired" | "closed";

export type Rejection =
  | "closed" // the owner disconnected this pairing
  | "expired" // the QR window or the whole session elapsed
  | "wrong_session"
  | "wrong_device" // a different phone than the one this terminal is paired with
  | "stale" // event older than the allowed age
  | "duplicate" // same event id already seen inside the freshness window (reconnect resend or replay)
  | "not_connected" // scan before hello
  | "paused"; // checkout in progress or no active bill

export type Decision = { ok: true } | { ok: false; reason: Rejection };

/**
 * The billing computer's view of ONE pairing. The computer is the gate: a message only reaches the cart if this says ok,
 * regardless of what any server or channel claims. Created per "Connect Phone Scanner" click (one terminal, one cart).
 */
export class PairingGate {
  state: PairingState = "waiting";
  deviceId: string | null = null;
  label = "";
  lastSeq = 0;
  lastSeenAt = 0;
  lastScanAt = 0;
  /** event id -> its timestamp. Entries older than the freshness window are pruned: such events are refused as stale anyway. */
  private readonly seen = new Map<string, number>();

  constructor(
    readonly sid: string,
    readonly pairBy: number,
    readonly until: number,
  ) {}

  /** Re-evaluate time-based states. Call on a timer and before every decision. */
  tick(now: number): PairingState {
    if (this.state === "closed") return this.state;
    if (now > this.until || (this.state === "waiting" && now > this.pairBy)) this.state = "expired";
    else if (this.state === "connected" && now - this.lastSeenAt > DISCONNECT_AFTER_MS) this.state = "disconnected";
    return this.state;
  }

  /** Owner pressed Disconnect. Irreversible for this pairing: a new Connect creates a new pairing. */
  revoke(): void {
    this.state = "closed";
  }

  /** hello: the first authenticated phone locks the pairing; any other device is refused. */
  hello(m: Pick<ScanMessage, "sid" | "did" | "label" | "ts">, now: number): Decision & { first?: boolean } {
    const s = this.tick(now);
    if (s === "closed") return { ok: false, reason: "closed" };
    if (s === "expired") return { ok: false, reason: "expired" };
    if (m.sid !== this.sid) return { ok: false, reason: "wrong_session" };
    if (this.deviceId && this.deviceId !== m.did) return { ok: false, reason: "wrong_device" };
    const first = this.deviceId === null;
    this.deviceId = m.did;
    this.label = m.label;
    this.state = "connected";
    this.lastSeenAt = now;
    return { ok: true, first };
  }

  /** Liveness (ping/scan after MAC verification). A reconnect after "disconnected" restores "connected". */
  alive(did: string, now: number): boolean {
    if (this.state === "closed" || this.state === "expired" || did !== this.deviceId) return false;
    this.lastSeenAt = now;
    if (this.state === "disconnected") this.state = "connected";
    return true;
  }

  /**
   * Decide whether a scan message may proceed to server verification. Reserves the event id so a duplicate that arrives while the
   * first is still being verified is refused. Call confirm() after the MAC is verified, release() if it was not.
   * `accepting` is false while a checkout is running or the bill is finished: the scan is refused, NOT queued or moved elsewhere.
   */
  admit(m: ScanMessage, now: number, accepting: boolean): Decision {
    const s = this.tick(now);
    if (s === "closed") return { ok: false, reason: "closed" };
    if (s === "expired") return { ok: false, reason: "expired" };
    if (m.sid !== this.sid) return { ok: false, reason: "wrong_session" };
    if (this.deviceId === null) return { ok: false, reason: "not_connected" };
    if (m.did !== this.deviceId) return { ok: false, reason: "wrong_device" };
    if (now - m.ts > MAX_EVENT_AGE_MS || m.ts - now > MAX_EVENT_AGE_MS) return { ok: false, reason: "stale" };
    if (this.seen.has(m.eid)) return { ok: false, reason: "duplicate" };
    // Replay protection is the event id (unique per event) within the freshness window, NOT ordering: if scan 3 is lost and scan 4
    // arrives first, the phone's retry of 3 is a new event and must still be accepted.
    if (!accepting) return { ok: false, reason: "paused" };
    for (const [id, ts] of this.seen) if (now - ts > MAX_EVENT_AGE_MS * 1.1) this.seen.delete(id);
    this.seen.set(m.eid, m.ts);
    return { ok: true };
  }

  /** The MAC verified: record the highest sequence seen (informational) and liveness. */
  confirm(m: ScanMessage, now: number): void {
    if (m.seq > this.lastSeq) this.lastSeq = m.seq;
    this.lastSeenAt = now;
    this.lastScanAt = now;
    if (this.state === "disconnected") this.state = "connected";
  }

  /** The MAC did not verify: free the event id (nothing was learned from a forged message). */
  release(m: ScanMessage): void {
    this.seen.delete(m.eid);
  }
}

/**
 * Phone-side: the camera sees the same barcode in many consecutive frames. A code that stays in view, or reappears within
 * SAME_CODE_COOLDOWN_MS, is one presentation; a gap longer than that starts a new scan. A DIFFERENT code is always accepted at once,
 * so scanning A, B, A in quick succession yields three events.
 */
export class ScanDebouncer {
  private lastCode: string | null = null;
  private lastSeen = 0;

  constructor(private readonly gapMs = SAME_CODE_COOLDOWN_MS) {}

  /** true when this sighting should become a scan event */
  sighting(code: string, now: number): boolean {
    const isNew = code !== this.lastCode || now - this.lastSeen > this.gapMs;
    this.lastCode = code;
    this.lastSeen = now; // every sighting extends the presentation
    return isNew;
  }

  reset(): void {
    this.lastCode = null;
    this.lastSeen = 0;
  }
}

/** Fixed-window limiter with an injected clock. Best effort per server instance (documented): it limits bursts, it is not a global quota. */
export class RateLimiter {
  private readonly hits = new Map<string, { start: number; n: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** true when the call is allowed */
  take(key: string, now: number): boolean {
    const h = this.hits.get(key);
    if (!h || now - h.start >= this.windowMs) {
      this.hits.set(key, { start: now, n: 1 });
      if (this.hits.size > 5000) this.prune(now);
      return true;
    }
    if (h.n >= this.max) return false;
    h.n++;
    return true;
  }

  private prune(now: number) {
    for (const [k, v] of this.hits) if (now - v.start >= this.windowMs) this.hits.delete(k);
  }
}
