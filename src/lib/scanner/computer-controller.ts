/**
 * The billing computer's side. The computer is the gate and the only place a scan can become a cart change.
 * Transport, server verification and the cart are injected, so the whole flow is testable without a network, a camera or a browser.
 */
import { PairingGate, type PairingState } from "./gate";
import { parseMessage, type Ack, type AckStatus, type ScanMessage } from "./protocol";

export interface ComputerDeps {
  /** server check of the MAC and of this user/tenant/branch binding. true = authentic. */
  verify(message: ScanMessage): Promise<boolean>;
  /** send informational feedback (no product or price data) back over the channel */
  send(ack: Ack): void;
  /** hand the barcode to the existing billing pipeline (scanBarcode + cart). Never checks out, pays or moves stock. */
  onScan(barcode: string): Promise<AckStatus>;
  /** false while a checkout is running or the bill is finished: scans are refused, not queued */
  accepting(): boolean;
  now(): number;
  onChange(view: ComputerView): void;
}

export interface ComputerView {
  state: PairingState;
  label: string;
  lastScanAt: number;
  lastBarcode: string;
  scans: number;
  note: string;
}

export class ComputerScanController {
  private readonly done = new Map<string, AckStatus>();
  private scans = 0;
  private lastBarcode = "";
  private note = "";

  constructor(
    readonly gate: PairingGate,
    private readonly d: ComputerDeps,
  ) {}

  view(): ComputerView {
    return { state: this.gate.tick(this.d.now()), label: this.gate.label, lastScanAt: this.gate.lastScanAt, lastBarcode: this.lastBarcode, scans: this.scans, note: this.note };
  }

  private emit(note = this.note) {
    this.note = note;
    this.d.onChange(this.view());
  }

  /** Periodic: re-evaluate time-based states (waiting -> expired, connected -> disconnected). */
  tick(): void {
    const before = this.gate.state;
    const after = this.gate.tick(this.d.now());
    if (after !== before) this.emit();
  }

  /** The owner pressed Disconnect: revoke now. Later messages from this phone are ignored. */
  disconnect(): void {
    this.gate.revoke();
    this.d.send({ v: 1, kind: "state", sid: this.gate.sid, state: "closed" });
    this.emit("Disconnected.");
  }

  /** One raw broadcast payload from the channel. Never throws; anything not clearly valid is dropped silently. */
  async handle(payload: unknown): Promise<void> {
    const m = parseMessage(payload);
    if (!m || m.sid !== this.gate.sid) return;
    const now = this.d.now();
    try {
      if (m.kind === "hello") return await this.onHello(m, now);
      if (m.kind === "ping") return await this.onPing(m, now);
      if (m.kind === "bye") return await this.onBye(m);
      return await this.onScan(m, now);
    } catch {
      this.emit("Phone scanner message could not be processed.");
    }
  }

  private async onHello(m: ScanMessage, now: number) {
    const state = this.gate.tick(now);
    if (state === "closed" || state === "expired") return;
    if (this.gate.deviceId && this.gate.deviceId !== m.did) {
      // authenticate before answering anyone, but tell a second phone it is not the paired one
      if (await this.d.verify(m)) this.d.send({ v: 1, kind: "state", sid: m.sid, did: m.did, state: "busy" });
      return;
    }
    if (!(await this.d.verify(m))) return;
    const r = this.gate.hello(m, this.d.now());
    if (!r.ok) return;
    this.d.send({ v: 1, kind: "state", sid: m.sid, did: m.did, state: "connected" });
    this.emit(r.first ? `${m.label} connected.` : "");
  }

  private async onPing(m: ScanMessage, now: number) {
    if (this.gate.deviceId !== m.did || this.gate.state === "closed" || this.gate.state === "expired") return;
    if (!(await this.d.verify(m))) return;
    const was = this.gate.state;
    if (this.gate.alive(m.did, now) && was !== this.gate.state) this.emit("");
  }

  private async onBye(m: ScanMessage) {
    if (this.gate.deviceId !== m.did || this.gate.state === "closed") return;
    if (!(await this.d.verify(m))) return;
    this.gate.state = "disconnected";
    this.emit("The phone disconnected.");
  }

  private async onScan(m: ScanMessage, now: number) {
    const decision = this.gate.admit(m, now, this.d.accepting());
    if (!decision.ok) {
      if (decision.reason === "duplicate") {
        // a resend after a reconnect: repeat the original answer, do NOT touch the cart again
        const s = this.done.get(m.eid);
        if (s && m.did === this.gate.deviceId) this.d.send({ v: 1, kind: "ack", sid: m.sid, eid: m.eid, status: s });
      } else if (decision.reason === "paused" && m.did === this.gate.deviceId && (await this.d.verify(m))) {
        this.d.send({ v: 1, kind: "ack", sid: m.sid, eid: m.eid, status: "paused" });
        this.emit("Scan ignored: the bill is being completed.");
      }
      return;
    }
    if (!(await this.d.verify(m))) {
      this.gate.release(m);
      return;
    }
    this.gate.confirm(m, this.d.now());
    // The terminal may have started checking out while the server was verifying: re-check, and refuse rather than change the cart.
    const status: AckStatus = this.d.accepting() ? await this.d.onScan(m.bc) : "paused";
    this.done.set(m.eid, status);
    if (status === "added") this.scans++;
    this.lastBarcode = m.bc;
    this.d.send({ v: 1, kind: "ack", sid: m.sid, eid: m.eid, status });
    this.emit(status === "added" ? "" : `Phone scan ${m.bc}: ${status}.`);
  }
}
