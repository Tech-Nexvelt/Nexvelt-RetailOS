// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildImagePath } from "@/lib/images/validate";
import { clearImage, setImage, signedUrls, type ImageClient } from "./images";

const T = "11111111-1111-4111-8111-111111111111";
const T2 = "99999999-9999-4999-8999-999999999999";
const PRODUCT = "33333333-3333-4333-8333-333333333333";
const DESIGN = "55555555-5555-4555-8555-555555555555";
const VARIANT = "66666666-6666-4666-8666-666666666666";
const ITEM = "77777777-7777-4777-8777-777777777777";
const F1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const F2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OLD = buildImagePath({ tenantId: T, owner: "products", ownerId: PRODUCT, fileId: F1, ext: "jpg" });

// real minimal PNG (800x800) so the true validator runs
const be32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(800), ...be32(800), 8, 6, 0, 0, 0, ...new Array(40).fill(0)]);

interface World {
  current: string | null; // image_path now stored on the owner row
  uploaded: string[];
  removed: string[];
  uploadError: { message: string } | null;
  updateError: { message: string } | null;
  updateRows: unknown[] | null;
  removeError: { message: string } | null;
  ownerFound: boolean;
  updates: { table: string; patch: Record<string, unknown> }[];
  order: string[];
}
let w: World;
const client: ImageClient = {
  from(table) {
    return {
      select: (cols: string) => ({
        eq: () => ({
          maybeSingle: async () => {
            if (!w.ownerFound) return { data: null, error: null };
            if (cols.includes("product_id")) return { data: { product_id: PRODUCT }, error: null };
            if (cols.includes("design_id")) return { data: { design_id: DESIGN }, error: null };
            return { data: { image_path: w.current }, error: null };
          },
        }),
      }),
      update: (patch) => ({
        eq: () => ({
          select: async () => {
            w.order.push("update");
            w.updates.push({ table, patch });
            if (!w.updateError && w.updateRows && w.updateRows.length > 0 && "image_path" in patch) w.current = patch.image_path as string | null;
            return { data: w.updateError ? null : w.updateRows, error: w.updateError };
          },
        }),
      }),
    };
  },
  storage: {
    from: () => ({
      upload: async (path: string) => {
        w.order.push("upload");
        if (w.uploadError) return { error: w.uploadError };
        w.uploaded.push(path);
        return { error: null };
      },
      remove: async (paths: string[]) => {
        w.order.push("remove:" + paths[0]);
        if (w.removeError) return { error: w.removeError };
        w.removed.push(...paths);
        return { error: null };
      },
      createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: "https://signed.example/" + p + "?token=x" })), error: null }),
    }),
  },
};
let n = 0;
const deps = () => ({ client, tenantId: T, newId: () => F2.replace("bbbbbbbb", String(10000000 + ++n)) });

beforeEach(() => {
  n = 0;
  w = { current: OLD, uploaded: [], removed: [], uploadError: null, updateError: null, updateRows: [{ id: PRODUCT }], removeError: null, ownerFound: true, updates: [], order: [] };
});

describe("setImage (replace)", () => {
  it("uploads the NEW file first, saves the reference, and only then deletes the old file", async () => {
    const r = await setImage(deps(), { kind: "VARIANT", itemId: VARIANT, bytes: png, declaredType: "image/png", fileName: "front.png" });
    expect(r).toMatchObject({ ok: true, data: { oldFileLeftBehind: false } });
    expect(w.order).toEqual(["upload", "update", "remove:" + OLD]);
    expect(w.uploaded.length).toBe(1);
    expect(w.uploaded[0]).toMatch(new RegExp(`^${T}/products/${PRODUCT}/[0-9a-f-]{36}\\.png$`));
    expect(w.updates).toEqual([{ table: "products", patch: { image_path: w.uploaded[0] } }]);
    expect(w.current).toBe(w.uploaded[0]);
    expect(w.removed).toEqual([OLD]);
  });
  it("uses a NEW path every time, so a changed photo has a new URL (no stale browser cache) and nothing is overwritten", async () => {
    await setImage(deps(), { kind: "VARIANT", itemId: VARIANT, bytes: png });
    const first = w.uploaded[0];
    await setImage(deps(), { kind: "VARIANT", itemId: VARIANT, bytes: png });
    expect(w.uploaded[1]).not.toBe(first);
    expect(w.uploaded[1]).not.toBe(OLD);
  });
  it("jewellery photos belong to the DESIGN and live under the jewellery folder", async () => {
    w.current = null;
    const r = await setImage(deps(), { kind: "JEWELLERY", itemId: ITEM, bytes: png });
    expect(r.ok).toBe(true);
    expect(w.updates[0]).toMatchObject({ table: "jewellery_designs" });
    expect(w.uploaded[0]).toMatch(new RegExp(`^${T}/jewellery/${DESIGN}/`));
  });
  it("a first photo (nothing to replace) deletes nothing", async () => {
    w.current = null;
    expect((await setImage(deps(), { kind: "VARIANT", itemId: VARIANT, bytes: png })).ok).toBe(true);
    expect(w.removed).toEqual([]);
  });
  it("an invalid file is refused BEFORE anything is stored or changed", async () => {
    for (const bytes of [new Uint8Array(0), Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]), png.slice(0, 15)]) {
      const r = await setImage(deps(), { kind: "VARIANT", itemId: VARIANT, bytes });
      expect(r).toMatchObject({ ok: false, code: "INVALID_IMAGE" });
    }
    expect(w.order).toEqual([]);
    expect(w.current).toBe(OLD);
  });
  it("a file larger than the configured limit is refused", async () => {
    const r = await setImage({ ...deps(), limits: { maxBytes: 20 } }, { kind: "VARIANT", itemId: VARIANT, bytes: png });
    expect(r).toMatchObject({ ok: false, code: "INVALID_IMAGE" });
    expect(w.order).toEqual([]);
  });
  it("a name or type that disagrees with the real file is refused", async () => {
    expect(await setImage(deps(), { kind: "VARIANT", itemId: VARIANT, bytes: png, fileName: "shirt.jpg" })).toMatchObject({ ok: false, code: "INVALID_IMAGE" });
    expect(await setImage(deps(), { kind: "VARIANT", itemId: VARIANT, bytes: png, declaredType: "image/jpeg" })).toMatchObject({ ok: false, code: "INVALID_IMAGE" });
  });
  it("an item that does not exist (or that RLS hides) changes nothing", async () => {
    w.ownerFound = false;
    expect(await setImage(deps(), { kind: "VARIANT", itemId: VARIANT, bytes: png })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(w.order).toEqual([]);
  });
  it("if the UPLOAD fails nothing changes and the old photo stays", async () => {
    w.uploadError = { message: "network down" };
    expect(await setImage(deps(), { kind: "VARIANT", itemId: VARIANT, bytes: png })).toMatchObject({ ok: false, code: "UPLOAD_FAILED" });
    expect(w.order).toEqual(["upload"]);
    expect(w.current).toBe(OLD);
    expect(w.removed).toEqual([]);
  });
  it("a storage policy refusal is reported as 'your role cannot do this', not a generic error", async () => {
    w.uploadError = { message: 'new row violates row-level security policy for table "objects"' };
    expect(await setImage(deps(), { kind: "VARIANT", itemId: VARIANT, bytes: png })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
  it("if SAVING the reference fails, the new file is deleted again (no orphan) and the OLD photo is untouched", async () => {
    w.updateError = { message: "boom" };
    expect(await setImage(deps(), { kind: "VARIANT", itemId: VARIANT, bytes: png })).toMatchObject({ ok: false, code: "SAVE_FAILED" });
    expect(w.removed).toEqual(w.uploaded); // the file just uploaded, and only that
    expect(w.removed).not.toContain(OLD);
    expect(w.current).toBe(OLD);
  });
  it("if row-level security updates zero rows, the new file is deleted and the user is told they may not", async () => {
    w.updateRows = [];
    expect(await setImage(deps(), { kind: "VARIANT", itemId: VARIANT, bytes: png })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(w.removed).toEqual(w.uploaded);
    expect(w.current).toBe(OLD);
  });
  it("if deleting the OLD file fails the replacement still succeeds and says a file was left behind", async () => {
    w.removeError = { message: "storage hiccup" };
    expect(await setImage(deps(), { kind: "VARIANT", itemId: VARIANT, bytes: png })).toMatchObject({ ok: true, data: { oldFileLeftBehind: true } });
    expect(w.current).toBe(w.uploaded[0]);
  });
  it("never deletes a stored path that is not this item's own (a tampered or foreign reference)", async () => {
    const foreign = buildImagePath({ tenantId: T2, owner: "products", ownerId: PRODUCT, fileId: F1, ext: "jpg" });
    w.current = foreign;
    const r = await setImage(deps(), { kind: "VARIANT", itemId: VARIANT, bytes: png });
    expect(r.ok).toBe(true);
    expect(w.removed).toEqual([]);
  });
});

describe("clearImage (remove)", () => {
  it("clears the reference FIRST, then deletes the file", async () => {
    expect(await clearImage(deps(), { kind: "VARIANT", itemId: VARIANT })).toMatchObject({ ok: true, data: { oldFileLeftBehind: false } });
    expect(w.order).toEqual(["update", "remove:" + OLD]);
    expect(w.current).toBeNull();
  });
  it("a failed reference update leaves both the reference and the file alone", async () => {
    w.updateError = { message: "boom" };
    expect(await clearImage(deps(), { kind: "VARIANT", itemId: VARIANT })).toMatchObject({ ok: false, code: "SAVE_FAILED" });
    expect(w.removed).toEqual([]);
    expect(w.current).toBe(OLD);
  });
  it("a failed file delete still leaves the product consistent (no photo) and says so", async () => {
    w.removeError = { message: "x" };
    expect(await clearImage(deps(), { kind: "VARIANT", itemId: VARIANT })).toMatchObject({ ok: true, data: { oldFileLeftBehind: true } });
    expect(w.current).toBeNull();
  });
  it("removing when there is no photo is a harmless no-op; zero rows updated means 'not allowed'", async () => {
    w.current = null;
    expect(await clearImage(deps(), { kind: "VARIANT", itemId: VARIANT })).toMatchObject({ ok: true });
    expect(w.order).toEqual([]);
    w.current = OLD;
    w.updateRows = [];
    expect(await clearImage(deps(), { kind: "VARIANT", itemId: VARIANT })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});

describe("signedUrls", () => {
  it("signs only this tenant's well-formed paths, once each", async () => {
    const mine = OLD;
    const foreign = buildImagePath({ tenantId: T2, owner: "products", ownerId: PRODUCT, fileId: F1, ext: "jpg" });
    const spy = vi.spyOn(client.storage.from("x"), "createSignedUrls");
    void spy;
    const m = await signedUrls(client, T, [mine, mine, foreign, null, "../../etc/passwd", ""]);
    expect([...m.keys()]).toEqual([mine]);
    expect(m.get(mine)).toMatch(/^https:\/\/signed\.example\//);
  });
  it("an error never breaks the page: it simply returns no URLs", async () => {
    const broken: ImageClient = { ...client, storage: { from: () => ({ ...client.storage.from("x"), createSignedUrls: async () => { throw new Error("down"); } }) } };
    expect((await signedUrls(broken, T, [OLD])).size).toBe(0);
  });
});
