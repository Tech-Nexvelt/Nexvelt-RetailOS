/**
 * Camera barcode decoding, entirely on the phone. No image or video ever leaves the device: frames go from the camera to the
 * decoder in memory and only the decoded text is passed on.
 *
 * Uses the browser's native BarcodeDetector where it exists (Chrome/Android) and the zxing decoder otherwise (iOS Safari, Firefox).
 * Both read EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39 and ITF.
 * Camera access needs a secure context (HTTPS or localhost): an http:// LAN address cannot use the camera.
 */
export type CameraError = "INSECURE_CONTEXT" | "UNSUPPORTED" | "PERMISSION_DENIED" | "NO_CAMERA" | "IN_USE" | "FAILED";

export const CAMERA_MESSAGES: Record<CameraError, string> = {
  INSECURE_CONTEXT: "The camera needs a secure (https) page. Open this page from the https address of the app.",
  UNSUPPORTED: "This browser cannot use the camera for scanning. Try Chrome (Android) or Safari (iPhone).",
  PERMISSION_DENIED: "Camera permission was refused. Allow the camera for this site in the browser settings, then tap Start scanning again.",
  NO_CAMERA: "No camera was found on this device.",
  IN_USE: "The camera is busy in another app or tab. Close it and try again.",
  FAILED: "The camera could not be started. Try again.",
};

export const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"] as const;

interface DetectorLike {
  detect(source: unknown): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = (new (o: { formats: string[] }) => DetectorLike) & { getSupportedFormats?: () => Promise<string[]> };

export interface CameraDeps {
  mediaDevices?: Pick<MediaDevices, "getUserMedia" | "enumerateDevices">;
  isSecureContext?: boolean;
  Detector?: DetectorCtor | null;
  /** zxing fallback: returns a stopper */
  zxing?: (stream: MediaStream, video: HTMLVideoElement, onText: (t: string) => void) => Promise<() => void>;
  setTimer?: (f: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export interface Running {
  ok: true;
  deviceId: string | null;
  stop(): void;
}
export type StartResult = Running | { ok: false; error: CameraError };

let active: { stop: () => void } | null = null;

const mapError = (e: unknown): CameraError => {
  const n = (e as { name?: string } | null)?.name;
  if (n === "NotAllowedError" || n === "SecurityError" || n === "PermissionDeniedError") return "PERMISSION_DENIED";
  if (n === "NotFoundError" || n === "OverconstrainedError" || n === "DevicesNotFoundError") return "NO_CAMERA";
  if (n === "NotReadableError" || n === "TrackStartError" || n === "AbortError") return "IN_USE";
  return "FAILED";
};

/** Start the camera and decode. Only ONE decode loop can exist: starting again stops the previous one first. */
export async function startScanning(video: HTMLVideoElement, onCode: (text: string) => void, opts: { deviceId?: string | null } = {}, deps: CameraDeps = {}): Promise<StartResult> {
  active?.stop();
  active = null;
  const secure = deps.isSecureContext ?? (typeof window !== "undefined" ? window.isSecureContext : true);
  if (!secure) return { ok: false, error: "INSECURE_CONTEXT" };
  const md = deps.mediaDevices ?? (typeof navigator !== "undefined" ? navigator.mediaDevices : undefined);
  if (!md?.getUserMedia) return { ok: false, error: "UNSUPPORTED" };

  let stream: MediaStream;
  try {
    // Rear camera by default; an explicit device (camera selection) wins.
    stream = await md.getUserMedia({ audio: false, video: opts.deviceId ? { deviceId: { exact: opts.deviceId } } : { facingMode: { ideal: "environment" } } });
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }

  let stopped = false;
  let stopLoop: () => void = () => {};
  const stop = () => {
    if (stopped) return;
    stopped = true;
    stopLoop();
    for (const t of stream.getTracks()) t.stop(); // release the camera on disconnect and on page exit
    try {
      video.srcObject = null;
    } catch {
      /* element already gone */
    }
    if (active && active.stop === stop) active = null;
  };
  active = { stop };

  try {
    video.srcObject = stream;
    video.setAttribute?.("playsinline", "true");
    await video.play?.();
    const Detector = deps.Detector !== undefined ? deps.Detector : ((globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector ?? null);
    const setT = deps.setTimer ?? ((f, ms) => setTimeout(f, ms));
    const clearT = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));

    if (Detector) {
      const supported = (await Detector.getSupportedFormats?.().catch(() => null)) ?? [...FORMATS];
      const detector = new Detector({ formats: FORMATS.filter((f) => supported.includes(f)) });
      let timer: unknown = null;
      let busy = false;
      const loop = async () => {
        if (stopped) return;
        if (!busy) {
          busy = true;
          try {
            const found = await detector.detect(video);
            const text = found[0]?.rawValue;
            if (text && !stopped) onCode(text);
          } catch {
            /* a frame that cannot be read is simply skipped */
          } finally {
            busy = false;
          }
        }
        if (!stopped) timer = setT(loop, 120);
      };
      timer = setT(loop, 0);
      stopLoop = () => clearT(timer);
    } else if (deps.zxing) {
      stopLoop = await deps.zxing(stream, video, (t) => !stopped && onCode(t));
    } else {
      stop();
      return { ok: false, error: "UNSUPPORTED" };
    }
  } catch (e) {
    stop();
    return { ok: false, error: mapError(e) };
  }
  const settings = stream.getVideoTracks()[0]?.getSettings?.();
  return { ok: true, deviceId: settings?.deviceId ?? opts.deviceId ?? null, stop };
}

export async function listCameras(deps: CameraDeps = {}): Promise<{ id: string; label: string }[]> {
  const md = deps.mediaDevices ?? (typeof navigator !== "undefined" ? navigator.mediaDevices : undefined);
  try {
    const all = (await md?.enumerateDevices()) ?? [];
    return all.filter((d) => d.kind === "videoinput").map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  } catch {
    return [];
  }
}

/** zxing fallback, loaded only when the native detector is missing so the common path ships no extra code. */
export async function zxingDecoder(stream: MediaStream, video: HTMLVideoElement, onText: (t: string) => void): Promise<() => void> {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF]);
  const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
  const controls = await reader.decodeFromStream(stream, video, (result) => {
    if (result) onText(result.getText());
  });
  return () => controls.stop();
}
