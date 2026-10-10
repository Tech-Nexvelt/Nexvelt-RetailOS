"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, RefreshCw, Trash2 } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { validateImage } from "@/lib/images/validate";
import { ProductThumb } from "./product-thumb";

type Msg = { tone: "success" | "error" | "info"; text: string } | null;

/**
 * Upload, replace and remove the photo of a product (clothing) or jewellery design. The browser checks the file early for fast feedback;
 * the SERVER repeats every check on the real bytes and enforces permission, so this is convenience, not security.
 */
export function ImageUploader({ kind, id, name, url, canEdit }: { kind: "VARIANT" | "JEWELLERY"; id: string; name: string; url: string | null; canEdit: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [shown, setShown] = useState<string | null>(url);
  const [progress, setProgress] = useState<number | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [drag, setDrag] = useState(false);
  const [failed, setFailed] = useState(false);

  // the local preview of the chosen file; released when the file changes or the component goes away
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  const choose = useCallback(async (f: File | undefined | null) => {
    setMsg(null);
    setFailed(false);
    if (!f) return;
    const check = validateImage({ bytes: new Uint8Array(await f.arrayBuffer()), declaredType: f.type, fileName: f.name });
    if (!check.ok) {
      setFile(null);
      return setMsg({ tone: "error", text: check.message });
    }
    setFile(f);
  }, []);

  const upload = useCallback(() => {
    if (!file) return;
    setMsg(null);
    setFailed(false);
    setProgress(0);
    const body = new FormData();
    body.set("kind", kind);
    body.set("id", id);
    body.set("file", file);
    const x = new XMLHttpRequest();
    x.open("POST", "/api/products/image");
    x.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    x.onerror = x.ontimeout = () => {
      setProgress(null);
      setFailed(true);
      setMsg({ tone: "error", text: "No connection. Nothing was changed. Your photo is still selected: press Try again." });
    };
    x.onload = () => {
      setProgress(null);
      let r: { ok?: boolean; message?: string; url?: string | null } = {};
      try {
        r = JSON.parse(x.responseText);
      } catch {
        /* handled below */
      }
      if (x.status >= 200 && x.status < 300 && r.ok) {
        setShown(r.url ?? null);
        setFile(null);
        setMsg({ tone: "success", text: r.message ?? "Photo saved." });
      } else {
        setFailed(x.status >= 500 || x.status === 0);
        setMsg({ tone: "error", text: r.message ?? "The photo could not be saved. Nothing was changed. Try again." });
      }
    };
    x.send(body);
  }, [file, id, kind]);

  const remove = async () => {
    if (!window.confirm("Remove this photo?\n\nThe product stays; it will show a placeholder instead.")) return;
    setMsg(null);
    setProgress(0);
    try {
      const res = await fetch("/api/products/image", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, id }) });
      const r = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (res.ok && r.ok) {
        setShown(null);
        setMsg({ tone: "success", text: r.message ?? "Photo removed." });
      } else setMsg({ tone: "error", text: r.message ?? "The photo could not be removed. Nothing was changed." });
    } catch {
      setMsg({ tone: "error", text: "No connection. Nothing was changed." });
    } finally {
      setProgress(null);
    }
  };

  const busy = progress !== null;
  const current = preview ?? shown;
  return (
    <section aria-label="Photo" className="flex max-w-xl flex-col gap-3">
      <h2 className="font-semibold">Photo</h2>
      <div className="flex flex-wrap items-start gap-4">
        <ProductThumb url={current} name={name} size={144} />
        {canEdit ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void choose(e.dataTransfer.files?.[0]);
            }}
            className={`flex min-h-36 min-w-56 flex-1 flex-col items-center justify-center gap-2 rounded-ctl border-2 border-dashed p-3 text-center text-sm ${drag ? "border-primary bg-primary/10" : "border-line bg-surface"}`}
          >
            <ImagePlus aria-hidden size={24} className="text-muted" />
            <p>{file ? file.name : "Drag a photo here, or"}</p>
            <input ref={input} data-testid="photo-input" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Choose a photo" disabled={busy} onChange={(e) => void choose(e.target.files?.[0])} />
            <Button onClick={() => input.current?.click()} disabled={busy}>
              Choose photo
            </Button>
            <p className="text-xs text-muted">JPG, PNG or WebP, up to 5 MB, at least 200 × 200 pixels.</p>
          </div>
        ) : (
          <p className="text-sm text-muted">Only people who can edit products can change the photo.</p>
        )}
      </div>

      {progress !== null ? (
        <div role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress" className="h-2 w-full overflow-hidden rounded-full bg-app">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      <div aria-live="polite">{msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}</div>

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          {file ? (
            <>
              <Button variant="primary" onClick={upload} disabled={busy}>
                {failed ? (
                  <>
                    <RefreshCw aria-hidden size={16} /> Try again
                  </>
                ) : shown ? (
                  "Replace photo"
                ) : (
                  "Save photo"
                )}
              </Button>
              <Button onClick={() => setFile(null)} disabled={busy}>
                Cancel
              </Button>
            </>
          ) : null}
          {shown && !file ? (
            <Button onClick={() => void remove()} disabled={busy}>
              <Trash2 aria-hidden size={16} /> Remove photo
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
