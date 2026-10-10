import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { IMAGE_DEFAULTS } from "@/lib/images/validate";
import { clearImage, setImage, signedUrls, type ImageClient, type ImageDeps, type ItemKind } from "@/server/app/images";
import { requireActionSession } from "@/server/app/session";

export const dynamic = "force-dynamic";

/** Upload limit: 5 MB unless PRODUCT_IMAGE_MAX_BYTES says otherwise (never above 10 MB, never below 100 KB). */
const maxBytes = () => {
  const n = Number(process.env.PRODUCT_IMAGE_MAX_BYTES);
  return Number.isFinite(n) && n >= 100_000 ? Math.min(n, 10 * 1024 * 1024) : IMAGE_DEFAULTS.maxBytes;
};
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const kindOf = (v: unknown): ItemKind | null => (v === "VARIANT" || v === "JEWELLERY" ? v : null);
const STATUS = { INVALID_IMAGE: 400, NOT_FOUND: 404, FORBIDDEN: 403, UPLOAD_FAILED: 502, SAVE_FAILED: 502, DELETE_FAILED: 502, DEMO: 400 } as const;

/** Both operations need product.edit, checked on the server from the verified session; storage policies and row-level security check it again. */
async function context(): Promise<{ deps: ImageDeps; client: ImageClient } | NextResponse> {
  const s = await requireActionSession("product.edit");
  if (!s) return json({ ok: false, message: "Your role cannot change product photos. Ask the owner." }, 403);
  if (s.mode === "demo" || !s.client) return json({ ok: false, message: "Photos need the real database. This is the demo." }, 400);
  const client = s.client as unknown as ImageClient;
  return { client, deps: { client, tenantId: s.tenantId, newId: randomUUID, limits: { maxBytes: maxBytes() } } };
}

export async function POST(req: Request) {
  const c = await context();
  if (c instanceof NextResponse) return c;
  const limit = maxBytes();
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > limit + 64 * 1024) return json({ ok: false, message: "That photo is too large. Choose one under the size limit." }, 413);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ ok: false, message: "The upload could not be read. Try again." }, 400);
  }
  const kind = kindOf(form.get("kind"));
  const id = String(form.get("id") ?? "");
  const file = form.get("file");
  if (!kind || !UUID.test(id) || !(file instanceof File)) return json({ ok: false, message: "Choose a photo to upload." }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const r = await setImage(c.deps, { kind, itemId: id, bytes, declaredType: file.type, fileName: file.name });
  if (!r.ok) return json({ ok: false, code: r.code, message: r.message }, STATUS[r.code]);
  const url = (await signedUrls(c.client, c.deps.tenantId, [r.data.path])).get(r.data.path) ?? null;
  return json({ ok: true, url, message: r.data.oldFileLeftBehind ? "Photo saved. The old file could not be deleted; it is hidden and harmless." : "Photo saved." });
}

export async function DELETE(req: Request) {
  const c = await context();
  if (c instanceof NextResponse) return c;
  let body: { kind?: unknown; id?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* validated below */
  }
  const kind = kindOf(body.kind);
  const id = String(body.id ?? "");
  if (!kind || !UUID.test(id)) return json({ ok: false, message: "Nothing to remove." }, 400);
  const r = await clearImage(c.deps, { kind, itemId: id });
  if (!r.ok) return json({ ok: false, code: r.code, message: r.message }, STATUS[r.code]);
  return json({ ok: true, message: r.data.oldFileLeftBehind ? "Photo removed. The old file could not be deleted; it is hidden and harmless." : "Photo removed." });
}
