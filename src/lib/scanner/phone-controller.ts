/**
 * The phone's side: turns decoded barcodes into authenticated events, delivers them reliably, and reports status.
 * The camera, the transport and the clock are injected. Only the barcode string and session metadata ever leave the phone.
 */
import { signMessage } from "./crypto";
import { ScanDebouncer } from "./gate";
import { HEARTBEAT_MS, normalizeBarcode, type Ack, type AckStatus, type ScanMessage } from "./protocol";

export type PhoneState = "connecting" | "connected" | "reconnecting" | "busy" | "closed";

export interface PhoneDeps {
  send(m: ScanMessage): void;
  now(): number;
  newId(): string;
  onChange(view: PhoneView): void;
}

export interface PhoneView {
  state: PhoneState;
  lastBarcode: string;
  lastStatus: AckStatus | "sending" | "failed" | "";
  pending: number;
}

const RETRY_AFTER_MS = 3_000;
const GIVE_UP_AFTER_MS = 30_000;

interface Pending {
  msg: ScanMessage;
  firstSentAt: number;
  lastSentAt: number;
}

export class PhoneScanController {
  state: PhoneState = "connecting";
  private seq = 0;
  private lastBarcode = "";
  private lastStatus: PhoneView["lastStatus"] = "";
  private readonly pending = new Map<string, Pending>();
  private readonly debounce = new ScanDebouncer();
  private connected = false;

  constructor(
    private readonly id: { sid: string; did: string; puid: string; scanKey: Uint8Array; label: string },
    private readonly d: PhoneDeps,
  ) {}

  private view(): PhoneView {
    return { state: this.state, lastBarcode: this.lastBarcode, lastStatus: this.lastStatus, pending: this.pending.size };
  }
  private emit() {
    this.d.onChange(this.view());
  }

  private async build(kind: ScanMessage["kind"], bc = ""): Promise<ScanMessage> {
    return signMessage(this.id.scanKey, { v: 1, kind, sid: this.id.sid, did: this.id.did, puid: this.id.puid, seq: ++this.seq, eid: this.d.newId(), ts: this.d.now(), bc, label: this.id.label });
  }

  /** announce this phone to the billing computer (also used after every reconnect) */
  async hello(): Promise<void> {
    if (this.state === "closed") return;
    this.d.send(await this.build("hello"));
  }

  /** keep-alive; the computer shows Disconnected when these stop */
  async heartbeat(): Promise<void> {
    if (this.state === "closed" || this.state === "busy") return;
    this.d.send(await this.build("ping"));
  }
  readonly heartbeatMs = HEARTBEAT_MS;

  /**
   * A barcode was decoded. Applies the same-presentation debounce, validates it, signs it and sends it. Returns what happened locally.
   * Nothing here can create a sale: the event carries only the barcode.
   */
  async scan(raw: string): Promise<"sent" | "ignored" | "invalid" | "closed"> {
    if (this.state === "closed" || this.state === "busy") return "closed";
    const code = normalizeBarcode(raw);
    if (!code) return "invalid";
    if (!this.debounce.sighting(code, this.d.now())) return "ignored";
    const msg = await this.build("scan", code);
    const now = this.d.now();
    this.pending.set(msg.eid, { msg, firstSentAt: now, lastSentAt: now });
    this.lastBarcode = code;
    this.lastStatus = "sending";
    this.d.send(msg);
    this.emit();
    return "sent";
  }

  /** feedback from the computer */
  onAck(a: Ack): void {
    if (a.sid !== this.id.sid) return;
    if (a.kind === "state") {
      if (a.did && a.did !== this.id.did) return; // addressed to another phone sharing this channel
      if (a.state === "connected") this.connected = true;
      if (a.state === "busy") this.state = "busy";
      else if (a.state === "closed") this.state = "closed";
      else if (a.state === "connected" && this.state !== "closed") this.state = "connected";
      this.emit();
      return;
    }
    if (a.eid && this.pending.delete(a.eid) && a.status) {
      this.lastStatus = a.status;
      this.emit();
    }
  }

  /** transport went down / came back. On return every unacknowledged event is resent with the SAME id, so the computer can de-duplicate. */
  async onTransport(up: boolean): Promise<void> {
    if (this.state === "closed" || this.state === "busy") return;
    if (!up) {
      this.state = "reconnecting";
      this.emit();
      return;
    }
    this.state = this.connected ? "connected" : "connecting";
    await this.hello();
    const now = this.d.now();
    for (const p of this.pending.values()) {
      p.lastSentAt = now;
      this.d.send(p.msg);
    }
    this.emit();
  }

  /** Periodic: resend unacknowledged events, and give up (visibly) on ones that never get an answer. */
  retry(): void {
    const now = this.d.now();
    for (const [eid, p] of this.pending) {
      if (now - p.firstSentAt > GIVE_UP_AFTER_MS) {
        this.pending.delete(eid);
        this.lastStatus = "failed";
        continue;
      }
      if (now - p.lastSentAt >= RETRY_AFTER_MS) {
        p.lastSentAt = now;
        this.d.send(p.msg);
      }
    }
    this.emit();
  }

  /** Disconnect: tell the computer, then stop accepting scans. */
  async disconnect(): Promise<void> {
    if (this.state !== "closed") this.d.send(await this.build("bye"));
    this.state = "closed";
    this.pending.clear();
    this.emit();
  }
}
