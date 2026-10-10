"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Plug, PlugZap } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { openScanChannel, type OpenChannel } from "@/lib/scanner/channel";
import { CAMERA_MESSAGES, listCameras, startScanning, zxingDecoder, type CameraError, type Running } from "@/lib/scanner/decoder";
import { PhoneScanController, type PhoneView } from "@/lib/scanner/phone-controller";
import { HEARTBEAT_MS, cleanLabel, fromB64url, type Ack, type ScannerError } from "@/lib/scanner/protocol";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { claimPairingAction } from "@/server/scanner/actions";

const PROBLEMS: Record<ScannerError, string> = {
  NOT_CONFIGURED: "The phone scanner is not set up on this server.",
  NOT_SIGNED_IN: "Please sign in on this phone first.",
  FORBIDDEN: "This code is for a different shop or branch, or your account is not allowed to bill. Sign in with the right account.",
  INVALID: "This code is not valid. Create a new code on the billing computer.",
  EXPIRED: "This code has expired. Create a new code on the billing computer and scan it again.",
  RATE_LIMITED: "Too many attempts. Wait a minute and try again.",
};

const RESULT: Record<string, { text: string; tone: "ok" | "warn" | "bad" | "wait" }> = {
  sending: { text: "Sending…", tone: "wait" },
  added: { text: "Added to the bill", tone: "ok" },
  unknown: { text: "Barcode not found", tone: "bad" },
  unavailable: { text: "That item is not available", tone: "bad" },
  paused: { text: "The bill is being completed. Scan again in a moment.", tone: "warn" },
  rejected: { text: "Not accepted", tone: "bad" },
  error: { text: "Could not add. Try again.", tone: "bad" },
  failed: { text: "No answer from the computer. Check both are online.", tone: "bad" },
};
const TONE = { ok: "text-success", warn: "text-warning", bad: "text-danger", wait: "text-muted" } as const;

interface Claim {
  sid: string;
  did: string;
  scanKey: string;
  until: number;
  userId: string;
}
const STORE = "nv-scan-claim";
const label = () => cleanLabel(/iPhone|iPad/.test(navigator.userAgent) ? "iPhone" : /Android/.test(navigator.userAgent) ? "Android phone" : "Phone");

export function PhoneScanner({ token, sid, problem, who, business }: { token: string; sid: string | null; problem: ScannerError | null; who: string; business: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const ctl = useRef<PhoneScanController | null>(null);
  const chan = useRef<OpenChannel | null>(null);
  const cam = useRef<Running | null>(null);
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);
  const [view, setView] = useState<PhoneView | null>(null);
  const [error, setError] = useState<string | null>(problem ? PROBLEMS[problem] : null);
  const [working, setWorking] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<CameraError | null>(null);
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [typed, setTyped] = useState("");
  const [ended, setEnded] = useState(false);

  const stopCamera = useCallback(() => {
    cam.current?.stop();
    cam.current = null;
    setScanning(false);
  }, []);

  const teardown = useCallback(() => {
    stopCamera();
    for (const t of timers.current) clearInterval(t);
    timers.current = [];
    chan.current?.close();
    chan.current = null;
  }, [stopCamera]);

  // leaving the page (or locking the phone for good) releases the camera and the channel
  useEffect(() => {
    const onHide = () => stopCamera();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      teardown();
    };
  }, [stopCamera, teardown]);

  const attach = useCallback(
    (c: Claim) => {
      const client = createBrowserSupabaseClient();
      if (!client) {
        setError("The app is not connected to its service. Try again later.");
        return;
      }
      const controller = new PhoneScanController(
        { sid: c.sid, did: c.did, puid: c.userId, scanKey: fromB64url(c.scanKey), label: label() },
        { send: (m) => chan.current?.send(m), now: Date.now, newId: () => crypto.randomUUID(), onChange: setView },
      );
      ctl.current = controller;
      chan.current = openScanChannel(client as never, c.sid, {
        onPayload: (p) => {
          const a = p as Ack | null;
          if (a && typeof a === "object" && (a.kind === "ack" || a.kind === "state")) controller.onAck(a);
        },
        onTransport: (up) => void controller.onTransport(up),
      });
      timers.current.push(setInterval(() => void controller.heartbeat(), HEARTBEAT_MS), setInterval(() => controller.retry(), 1000));
      setView({ state: "connecting", lastBarcode: "", lastStatus: "", pending: 0 });
    },
    [],
  );

  // a refresh within the session resumes without needing a new QR
  useEffect(() => {
    if (!sid) return;
    try {
      const raw = sessionStorage.getItem(STORE);
      const c = raw ? (JSON.parse(raw) as Claim) : null;
      // sessionStorage exists only in the browser, so this cannot be decided during server render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (c && c.sid === sid && c.until > Date.now()) attach(c);
    } catch {
      /* storage unavailable: the user taps Connect */
    }
  }, [sid, attach]);

  const connect = async () => {
    setError(null);
    setWorking(true);
    try {
      const r = await claimPairingAction(token);
      if (!r.ok) {
        setError(PROBLEMS[r.code]);
        return;
      }
      const c: Claim = { sid: r.sid, did: r.did, scanKey: r.scanKey, until: r.until, userId: r.userId };
      try {
        sessionStorage.setItem(STORE, JSON.stringify(c));
      } catch {
        /* resume after refresh is optional */
      }
      attach(c);
    } catch {
      setError("Could not reach the server. Check the phone's internet and try again.");
    } finally {
      setWorking(false);
    }
  };

  const onCode = useCallback((code: string) => {
    void ctl.current?.scan(code).then((r) => {
      if (r === "sent") {
        navigator.vibrate?.(50);
        setFlash(true);
        setTimeout(() => setFlash(false), 350);
      }
    });
  }, []);

  const start = async (id: string | null = deviceId) => {
    setCameraError(null);
    if (!videoRef.current) return;
    const r = await startScanning(videoRef.current, onCode, { deviceId: id }, { zxing: zxingDecoder });
    if (!r.ok) {
      setCameraError(r.error);
      return;
    }
    cam.current = r;
    setScanning(true);
    setDeviceId(r.deviceId);
    setCameras(await listCameras()); // labels are only available after permission was granted
  };

  const disconnect = async () => {
    await ctl.current?.disconnect();
    teardown();
    try {
      sessionStorage.removeItem(STORE);
    } catch {
      /* ignore */
    }
    setEnded(true);
  };

  const state = view?.state ?? null;
  const connected = state === "connected";
  const result = view?.lastStatus ? RESULT[view.lastStatus] : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-4">
      <header>
        <p className="text-lg font-bold">
          NexVelt <span className="text-primary-strong">Scanner</span>
        </p>
        <p className="text-sm text-muted">
          {business} · {who}
        </p>
      </header>

      {error ? <Banner tone="error">{error}</Banner> : null}
      {ended ? <Banner tone="info">Disconnected. To scan again, create a new code on the billing computer.</Banner> : null}

      {!view && !ended && sid ? (
        <div className="rounded-ctl border border-line bg-surface p-4">
          <p className="font-semibold">Use this phone as the barcode scanner</p>
          <p className="mb-3 text-sm text-muted">Items you scan appear in the bill on the computer. Payment and printing stay on the computer.</p>
          <Button variant="primary" size="lg" onClick={connect} disabled={working}>
            <Plug aria-hidden size={18} /> Connect
          </Button>
        </div>
      ) : null}

      {view ? (
        <>
          <div className="flex items-center justify-between rounded-ctl border border-line bg-surface px-3 py-2" aria-live="polite">
            <span className="flex items-center gap-2 font-medium">
              <PlugZap aria-hidden size={18} />
              {state === "connected" ? "Connected to the computer" : state === "connecting" ? "Connecting…" : state === "reconnecting" ? "Reconnecting…" : state === "busy" ? "Another phone is already connected" : "Disconnected"}
            </span>
            {view.pending > 0 ? <span className="text-sm text-muted">{view.pending} waiting</span> : null}
          </div>

          <div className={`relative overflow-hidden rounded-ctl border-2 bg-black ${flash ? "border-success" : "border-line"}`}>
            <video ref={videoRef} muted playsInline className="aspect-[4/3] w-full object-cover" />
            {scanning ? <div aria-hidden className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" /> : <div className="absolute inset-0 grid place-items-center text-sm text-white/80">Camera is off</div>}
          </div>

          {cameraError ? <Banner tone="error">{CAMERA_MESSAGES[cameraError]}</Banner> : null}

          <div className="flex flex-wrap gap-2">
            {!scanning ? (
              <Button variant="primary" size="lg" onClick={() => void start()} disabled={!connected && state !== "reconnecting"}>
                <Camera aria-hidden size={18} /> Start scanning
              </Button>
            ) : (
              <Button size="lg" onClick={stopCamera}>
                <CameraOff aria-hidden size={18} /> Stop scanning
              </Button>
            )}
            <Button size="lg" onClick={() => void disconnect()}>
              Disconnect
            </Button>
          </div>

          {cameras.length > 1 ? (
            <label className="flex flex-col gap-1 text-sm">
              Camera
              <select
                className="min-h-11 rounded-ctl border border-line bg-surface px-3"
                value={deviceId ?? ""}
                onChange={(e) => {
                  setDeviceId(e.target.value);
                  if (scanning) void start(e.target.value);
                }}
              >
                {cameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="rounded-ctl border border-line bg-surface p-3" aria-live="polite">
            <p className="text-sm text-muted">Last scan</p>
            <p className="font-mono text-lg">{view.lastBarcode || "—"}</p>
            {result ? <p className={`font-medium ${TONE[result.tone]}`}>{result.text}</p> : null}
          </div>

          <details className="rounded-ctl border border-line bg-surface p-3">
            <summary className="cursor-pointer font-medium">Type a barcode instead</summary>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                onCode(typed);
                setTyped("");
              }}
            >
              <Input aria-label="Barcode" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} />
              <Button type="submit" variant="primary" disabled={!typed.trim() || !connected}>
                Send
              </Button>
            </form>
          </details>
        </>
      ) : null}
    </main>
  );
}
