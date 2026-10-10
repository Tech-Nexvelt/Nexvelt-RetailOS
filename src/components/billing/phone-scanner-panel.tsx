"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Smartphone } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { openScanChannel, type OpenChannel } from "@/lib/scanner/channel";
import { ComputerScanController, type ComputerView } from "@/lib/scanner/computer-controller";
import { PairingGate } from "@/lib/scanner/gate";
import type { AckStatus, ScannerError } from "@/lib/scanner/protocol";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

/** The server calls this panel needs. Injected (like BillingApi) so the screen renders and tests without a server. */
export interface ScannerApi {
  createPairing(): Promise<{ ok: true; token: string; sid: string; pairBy: number; until: number } | { ok: false; code: ScannerError }>;
  verifyIncoming(token: string, message: unknown): Promise<{ ok: boolean }>;
}

const MESSAGES: Record<ScannerError, string> = {
  NOT_CONFIGURED: "The phone scanner is not set up on this server yet. Ask the administrator to set SCANNER_PAIRING_SECRET.",
  NOT_SIGNED_IN: "Please sign in again, then connect the phone.",
  FORBIDDEN: "You are not allowed to use the phone scanner here.",
  INVALID: "The pairing could not be created. Try again.",
  EXPIRED: "That pairing expired. Create a new one.",
  RATE_LIMITED: "Too many attempts. Wait a minute and try again.",
};

const STATE_TEXT: Record<ComputerView["state"], string> = {
  waiting: "Waiting for the phone",
  connected: "Connected",
  disconnected: "Disconnected",
  expired: "Expired",
  closed: "Disconnected by you",
};
const STATE_STYLE: Record<ComputerView["state"], string> = {
  waiting: "bg-warning-bg text-warning",
  connected: "bg-success-bg text-success",
  disconnected: "bg-danger-bg text-danger",
  expired: "bg-app text-muted",
  closed: "bg-app text-muted",
};

function ago(now: number, t: number) {
  if (!t) return "no scan yet";
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 5 ? "just now" : s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
}

/**
 * Phone Scanner panel for the Billing screen. The phone only sends barcodes; every barcode goes through the same
 * scanBarcode + cart code as a typed or wedge-scanner barcode (onScan). Nothing here can complete a bill.
 */
export function PhoneScannerPanel({ api, onScan, accepting }: { api: ScannerApi; onScan: (code: string) => Promise<AckStatus>; accepting: boolean }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ComputerView | null>(null);
  const [qr, setQr] = useState<{ url: string; image: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [transportUp, setTransportUp] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const ctl = useRef<ComputerScanController | null>(null);
  const chan = useRef<OpenChannel | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const onScanRef = useRef(onScan);
  const acceptingRef = useRef(accepting);
  useEffect(() => {
    onScanRef.current = onScan;
    acceptingRef.current = accepting;
  }, [onScan, accepting]);

  const teardown = useCallback((notify: boolean) => {
    if (notify) ctl.current?.disconnect();
    chan.current?.close();
    chan.current = null;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  // leaving the Billing screen releases the pairing and the channel
  useEffect(() => () => teardown(true), [teardown]);

  const connect = async () => {
    setError(null);
    setWorking(true);
    try {
      teardown(false);
      const client = createBrowserSupabaseClient();
      if (!client) {
        setError("The phone scanner needs the live connection, which is not configured in this mode.");
        return;
      }
      const p = await api.createPairing();
      if (!p.ok) {
        setError(MESSAGES[p.code]);
        return;
      }
      const token = p.token;
      const url = `${window.location.origin}/scan/${token}`;
      const QRCode = (await import("qrcode")).default;
      const image = await QRCode.toDataURL(url, { margin: 1, width: 224, errorCorrectionLevel: "M" });
      const c: ComputerScanController = new ComputerScanController(new PairingGate(p.sid, p.pairBy, p.until), {
        verify: async (m) => (await api.verifyIncoming(token, m)).ok,
        send: (a) => chan.current?.send(a),
        onScan: (code) => onScanRef.current(code),
        accepting: () => acceptingRef.current,
        now: Date.now,
        onChange: setView,
      });
      ctl.current = c;
      chan.current = openScanChannel(client as never, p.sid, { onPayload: (x) => void c.handle(x), onTransport: setTransportUp });
      timer.current = setInterval(() => {
        c.tick();
        setNow(Date.now());
        setView(c.view());
      }, 1000);
      setQr({ url, image });
      setView(c.view());
      setOpen(true);
    } catch {
      setError("The phone scanner could not be started. Check the connection and try again.");
    } finally {
      setWorking(false);
    }
  };

  const disconnect = () => {
    teardown(true);
    setQr(null);
    setView(ctl.current?.view() ?? null);
  };

  const state = view?.state ?? null;
  const isLocalhost = typeof window !== "undefined" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  const showQr = qr && (state === "waiting" || state === null);

  return (
    <section aria-label="Phone scanner" className="rounded-ctl border border-line bg-surface p-3 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="flex items-center gap-2 font-semibold" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Smartphone aria-hidden size={18} /> Phone scanner
        </button>
        <div className="flex items-center gap-2" aria-live="polite">
          {state ? (
            <span className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${STATE_STYLE[state]}`}>
              {STATE_TEXT[state]}
              {state === "connected" && !transportUp ? " · reconnecting…" : ""}
            </span>
          ) : (
            <span className="text-sm text-muted">Not connected</span>
          )}
        </div>
      </div>

      {open ? (
        <div className="mt-3 flex flex-col gap-3">
          {error ? <Banner tone="error">{error}</Banner> : null}

          {state === "connected" || state === "disconnected" ? (
            <div className="text-sm">
              <p>
                <strong>{view?.label || "Phone"}</strong> · last scan {ago(now, view?.lastScanAt ?? 0)} · {view?.scans ?? 0} item(s) added
              </p>
              {!accepting ? <p className="text-warning">The bill is being completed, so phone scans are paused.</p> : null}
              {state === "disconnected" ? <p className="text-danger">The phone stopped responding. Your bill is safe. Open the scanner page on the phone to reconnect, or create a new code.</p> : null}
            </div>
          ) : null}
          {view?.note ? <p className="text-sm text-muted">{view.note}</p> : null}

          {showQr ? (
            <div className="flex flex-wrap items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr.image} alt="QR code: scan with the phone to connect it as a scanner" width={160} height={160} className="rounded-ctl border border-line bg-white p-1" />
              <div className="max-w-xs text-sm">
                <p className="font-medium">1. Scan this code with the phone camera.</p>
                <p>2. Sign in on the phone if asked, then tap Connect.</p>
                <p className="text-muted">The code works for 5 minutes. It contains no password.</p>
                <div className="mt-2 flex items-center gap-2">
                  <input readOnly aria-label="Pairing link" value={qr.url} className="min-h-9 w-40 rounded-ctl border border-line bg-app px-2 text-xs" onFocus={(e) => e.currentTarget.select()} />
                  <Button size="md" onClick={() => void navigator.clipboard?.writeText(qr.url)}>
                    Copy link
                  </Button>
                </div>
                {isLocalhost ? <p className="mt-1 text-warning">This page is open on “localhost”, which a phone cannot reach. Open the app from its https address instead.</p> : null}
              </div>
            </div>
          ) : null}
          {state === "expired" ? <p className="text-sm text-muted">This code expired before a phone connected.</p> : null}

          <div className="flex flex-wrap gap-2">
            {state === null || state === "expired" || state === "closed" ? (
              <Button variant="primary" onClick={connect} disabled={working}>
                {state === null ? "Connect phone scanner" : "Create a new code"}
              </Button>
            ) : (
              <>
                {state === "disconnected" ? (
                  <Button onClick={connect} disabled={working}>
                    Reconnect with a new code
                  </Button>
                ) : null}
                <Button onClick={disconnect}>Disconnect</Button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
