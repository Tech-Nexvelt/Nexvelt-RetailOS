/**
 * Product photo operations. Pure server logic with the database/storage client and ids injected, so every rule is unit-tested.
 * The caller passes the signed-in user's OWN client: the storage policies and row-level security apply as a second lock after the
 * permission check made by the route. Nothing here uses the Supabase secret key.
 *
 * Order of operations protects the data:
 *   replace: upload the NEW file -> save the reference -> only then delete the OLD file (a failed save deletes the new file again)
 *   remove : clear the reference -> only then delete the file (a failed delete leaves a harmless orphan and says so)
 */
import { buildImagePath, parseImagePath, pathBelongsTo, validateImage, type ImageLimits } from "@/lib/images/validate";

export const BUCKET = "product-images";
export const SIGNED_URL_SECONDS = 3600;

type Result<T> = { ok: true; data: T } | { ok: false; code: ImageFailure; message: string };
export type ImageFailure = "INVALID_IMAGE" | "NOT_FOUND" | "FORBIDDEN" | "UPLOAD_FAILED" | "SAVE_FAILED" | "DELETE_FAILED" | "DEMO";

const MESSAGES: Record<Exclude<ImageFailure, "INVALID_IMAGE">, string> = {
  NOT_FOUND: "That item no longer exists. Refresh the page.",
  FORBIDDEN: "Your role cannot change product photos. Ask the owner.",
  UPLOAD_FAILED: "The photo could not be uploaded. Nothing was changed. Check the connection and try again.",
  SAVE_FAILED: "The photo was uploaded but could not be attached to the product, so it was discarded. Nothing was changed. Try again.",
  DELETE_FAILED: "The photo was removed from the product, but the old file could not be deleted. It is hidden and harmless.",
  DEMO: "Photos need the real database. This is the demo.",
};
const fail = (code: Exclude<ImageFailure, "INVALID_IMAGE">): Result<never> => ({ ok: false, code, message: MESSAGES[code] });

/** the slice of the Supabase client these functions use */
export interface ImageClient {
  from(table: string): {
    select(cols: string): { eq(col: string, v: string): { maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message?: string; code?: string } | null }> } };
    update(patch: Record<string, unknown>): { eq(col: string, v: string): { select(cols: string): Promise<{ data: unknown[] | null; error: { message?: string; code?: string } | null }> } };
  };
  storage: {
    from(bucket: string): {
      upload(path: string, body: Uint8Array, opts: { contentType: string; upsert: boolean; cacheControl: string }): Promise<{ error: { message?: string } | null }>;
      remove(paths: string[]): Promise<{ error: { message?: string } | null }>;
      createSignedUrls(paths: string[], seconds: number): Promise<{ data: { path: string | null; signedUrl: string }[] | null; error: { message?: string } | null }>;
    };
  };
}

export interface ImageDeps {
  client: ImageClient;
  tenantId: string;
  newId(): string;
  limits?: Partial<ImageLimits>;
}

export type ItemKind = "VARIANT" | "JEWELLERY";

interface Owner {
  owner: "products" | "jewellery";
  table: "products" | "jewellery_designs";
  ownerId: string;
  current: string | null;
}

/** The product (for a clothing variant) or the design (for a jewellery piece) that holds the photo. Read under the caller's own permissions. */
export async function resolveOwner(client: ImageClient, kind: ItemKind, itemId: string): Promise<Owner | null> {
  const item = await client.from(kind === "VARIANT" ? "product_variants" : "jewellery_items").select(kind === "VARIANT" ? "product_id" : "design_id").eq("id", itemId).maybeSingle();
  const ownerId = item.data ? String(item.data[kind === "VARIANT" ? "product_id" : "design_id"]) : null;
  if (item.error || !ownerId) return null;
  const table = kind === "VARIANT" ? "products" : "jewellery_designs";
  const row = await client.from(table).select("image_path").eq("id", ownerId).maybeSingle();
  if (row.error || !row.data) return null;
  return { owner: kind === "VARIANT" ? "products" : "jewellery", table, ownerId, current: (row.data.image_path as string | null) ?? null };
}

const removeQuietly = async (client: ImageClient, path: string): Promise<boolean> => {
  try {
    return !(await client.storage.from(BUCKET).remove([path])).error;
  } catch {
    return false;
  }
};

export async function setImage(d: ImageDeps, a: { kind: ItemKind; itemId: string; bytes: Uint8Array; declaredType?: string; fileName?: string }): Promise<Result<{ path: string; oldFileLeftBehind: boolean }>> {
  const v = validateImage({ bytes: a.bytes, declaredType: a.declaredType, fileName: a.fileName }, d.limits);
  if (!v.ok) return { ok: false, code: "INVALID_IMAGE", message: v.message };
  const o = await resolveOwner(d.client, a.kind, a.itemId);
  if (!o) return fail("NOT_FOUND");
  const path = buildImagePath({ tenantId: d.tenantId, owner: o.owner, ownerId: o.ownerId, fileId: d.newId(), ext: v.ext });

  // 1. store the new file under a brand-new name (never overwrites anything)
  let up;
  try {
    up = await d.client.storage.from(BUCKET).upload(path, a.bytes, { contentType: v.mime, upsert: false, cacheControl: "31536000" });
  } catch {
    return fail("UPLOAD_FAILED");
  }
  if (up.error) return /row-level security|permission|not authorized|unauthorized/i.test(up.error.message ?? "") ? fail("FORBIDDEN") : fail("UPLOAD_FAILED");

  // 2. attach it. If this fails the new file is deleted again so nothing is orphaned and the product is unchanged.
  let saved;
  try {
    saved = await d.client.from(o.table).update({ image_path: path }).eq("id", o.ownerId).select("id");
  } catch {
    saved = { data: null, error: { message: "network" } };
  }
  if (saved.error || !saved.data || saved.data.length === 0) {
    await removeQuietly(d.client, path);
    return saved.data && saved.data.length === 0 && !saved.error ? fail("FORBIDDEN") : fail("SAVE_FAILED");
  }

  // 3. only now remove the previous file (and only if it really is this item's own previous photo)
  let left = false;
  if (o.current && o.current !== path && pathBelongsTo(o.current, d.tenantId, o.owner, o.ownerId)) left = !(await removeQuietly(d.client, o.current));
  return { ok: true, data: { path, oldFileLeftBehind: left } };
}

export async function clearImage(d: ImageDeps, a: { kind: ItemKind; itemId: string }): Promise<Result<{ oldFileLeftBehind: boolean }>> {
  const o = await resolveOwner(d.client, a.kind, a.itemId);
  if (!o) return fail("NOT_FOUND");
  if (!o.current) return { ok: true, data: { oldFileLeftBehind: false } };
  let saved;
  try {
    saved = await d.client.from(o.table).update({ image_path: null }).eq("id", o.ownerId).select("id");
  } catch {
    saved = { data: null, error: { message: "network" } };
  }
  if (saved.error) return fail("SAVE_FAILED");
  if (!saved.data || saved.data.length === 0) return fail("FORBIDDEN");
  const left = pathBelongsTo(o.current, d.tenantId, o.owner, o.ownerId) ? !(await removeQuietly(d.client, o.current)) : false;
  return { ok: true, data: { oldFileLeftBehind: left } };
}

/** Short-lived signed URLs for a batch of stored paths, created with the caller's own session. Paths of another tenant are never signed. */
export async function signedUrls(client: ImageClient, tenantId: string, paths: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(paths.filter((p): p is string => typeof p === "string" && parseImagePath(p)?.tenantId === tenantId))];
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;
  try {
    const r = await client.storage.from(BUCKET).createSignedUrls(wanted, SIGNED_URL_SECONDS);
    for (const e of r.data ?? []) if (e.path && e.signedUrl) out.set(e.path, e.signedUrl);
  } catch {
    /* images are cosmetic: a failure means placeholders, never a broken page */
  }
  return out;
}
