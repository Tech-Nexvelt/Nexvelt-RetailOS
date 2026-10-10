// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Quote, QuotedLine, SearchResult } from "@/domain/billing";
import { buildImagePath } from "@/lib/images/validate";
import { photoUrlsFor, quoteWithPhotos, resultsWithPhotos, type PhotoClient } from "./cart-photos";

const T = "11111111-1111-4111-8111-111111111111";
const T2 = "99999999-9999-4999-8999-999999999999";
const V1 = "a1111111-1111-4111-8111-111111111111"; // clothing variant, product P1 (has a photo)
const V2 = "a2222222-2222-4222-8222-222222222222"; // clothing variant, product P2 (no photo)
const J1 = "b1111111-1111-4111-8111-111111111111"; // jewellery piece, design D1 (has a photo)
const J2 = "b2222222-2222-4222-8222-222222222222"; // jewellery piece, design D2 (photo path of ANOTHER tenant)
const P1 = "c1111111-1111-4111-8111-111111111111";
const P2 = "c2222222-2222-4222-8222-222222222222";
const D1 = "d1111111-1111-4111-8111-111111111111";
const D2 = "d2222222-2222-4222-8222-222222222222";
const F = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const P1_PATH = buildImagePath({ tenantId: T, owner: "products", ownerId: P1, fileId: F, ext: "jpg" });
const D1_PATH = buildImagePath({ tenantId: T, owner: "jewellery", ownerId: D1, fileId: F, ext: "webp" });
const D2_FOREIGN = buildImagePath({ tenantId: T2, owner: "jewellery", ownerId: D2, fileId: F, ext: "png" });

function client(over: { fail?: boolean } = {}) {
  const queries: string[] = [];
  const signed: string[][] = [];
  const data: Record<string, Record<string, unknown>[]> = {
    product_variants: [{ id: V1, product_id: P1 }, { id: V2, product_id: P2 }],
    jewellery_items: [{ id: J1, design_id: D1 }, { id: J2, design_id: D2 }],
    products: [{ id: P1, image_path: P1_PATH }, { id: P2, image_path: null }],
    jewellery_designs: [{ id: D1, image_path: D1_PATH }, { id: D2, image_path: D2_FOREIGN }],
  };
  const c: PhotoClient = {
    from: (table) => ({
      select: () => ({
        in: async (_col, vals) => {
          queries.push(table);
          if (over.fail) throw new Error("db down");
          return { data: (data[table] ?? []).filter((r) => vals.includes(String(r.id))), error: null };
        },
      }),
    }),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
        createSignedUrls: async (paths: string[]) => {
          signed.push(paths);
          return { data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}?t=1` })), error: null };
        },
      }),
    },
  };
  return { c, queries, signed };
}

const line = (itemId: string, kind: QuotedLine["kind"]): QuotedLine => ({ itemId, kind, name: "N", detail: "d", code: "c", quantity: 1, unitPricePaise: 100, grossPaise: 100, discountPaise: 0, lineTotalPaise: 100, unique: kind !== "CLOTHING", maxQuantity: 5 });
const quote = (lines: QuotedLine[]): Quote => ({ lines, itemCount: lines.length, discountTotalPaise: 0, grandTotalPaise: 100 * lines.length, taxConfigured: false, issues: [] });

describe("photoUrlsFor", () => {
  it("clothing resolves through its product, jewellery through its design; items with no photo are simply absent", async () => {
    const { c } = client();
    const m = await photoUrlsFor(c, T, [{ id: V1, kind: "CLOTHING" }, { id: V2, kind: "CLOTHING" }, { id: J1, kind: "PRECIOUS_JEWELLERY" }]);
    expect([...m.keys()].sort()).toEqual([V1, J1].sort());
    expect(m.get(V1)).toContain(P1_PATH);
    expect(m.get(J1)).toContain(D1_PATH);
  });
  it("never signs another tenant's photo, even if a row somehow points at it", async () => {
    const { c, signed } = client();
    const m = await photoUrlsFor(c, T, [{ id: J2, kind: "IMITATION_JEWELLERY" }]);
    expect(m.size).toBe(0);
    expect(signed.flat()).not.toContain(D2_FOREIGN);
  });
  it("makes no database or storage call at all for an empty or malformed list", async () => {
    const { c, queries, signed } = client();
    expect((await photoUrlsFor(c, T, [])).size).toBe(0);
    expect((await photoUrlsFor(c, T, [{ id: "../../etc", kind: "CLOTHING" }, { id: "x", kind: "PRECIOUS_JEWELLERY" }])).size).toBe(0);
    expect(queries).toEqual([]);
    expect(signed).toEqual([]);
  });
  it("is batched: one read per table and ONE signing call however many lines there are", async () => {
    const { c, queries, signed } = client();
    await photoUrlsFor(c, T, [{ id: V1, kind: "CLOTHING" }, { id: V1, kind: "CLOTHING" }, { id: V2, kind: "CLOTHING" }, { id: J1, kind: "PRECIOUS_JEWELLERY" }]);
    expect(queries.sort()).toEqual(["jewellery_designs", "jewellery_items", "product_variants", "products"]);
    expect(signed.length).toBe(1);
  });
});

describe("quoteWithPhotos / resultsWithPhotos", () => {
  it("attaches imageUrl to lines that have a photo and null to the rest, leaving every price and total untouched", async () => {
    const { c } = client();
    const q = quote([line(V1, "CLOTHING"), line(V2, "CLOTHING"), line(J1, "PRECIOUS_JEWELLERY")]);
    const r = await quoteWithPhotos(c, T, q);
    expect(r.lines.map((l) => (l.imageUrl ? "photo" : l.imageUrl))).toEqual(["photo", null, "photo"]);
    expect(r.lines.map((l) => ({ ...l, imageUrl: undefined }))).toEqual(q.lines.map((l) => ({ ...l, imageUrl: undefined })));
    expect(r.grandTotalPaise).toBe(q.grandTotalPaise);
  });
  it("returns the quote unchanged when nothing has a photo", async () => {
    const { c } = client();
    const q = quote([line(V2, "CLOTHING")]);
    expect(await quoteWithPhotos(c, T, q)).toBe(q);
  });
  it("a database failure never breaks billing: the quote comes back as it was", async () => {
    const { c } = client({ fail: true });
    const q = quote([line(V1, "CLOTHING")]);
    expect(await quoteWithPhotos(c, T, q)).toBe(q);
    const s: SearchResult[] = [{ itemId: V1, kind: "CLOTHING", name: "N", detail: "d", unitPricePaise: 100, available: true }];
    expect(await resultsWithPhotos(c, T, s)).toBe(s);
  });
  it("search results get photos the same way", async () => {
    const { c } = client();
    const s: SearchResult[] = [
      { itemId: V1, kind: "CLOTHING", name: "A", detail: "d", unitPricePaise: 100, available: true },
      { itemId: V2, kind: "CLOTHING", name: "B", detail: "d", unitPricePaise: 100, available: true },
    ];
    const r = await resultsWithPhotos(c, T, s);
    expect(r[0]!.imageUrl).toContain(P1_PATH);
    expect(r[1]!.imageUrl).toBeNull();
  });
});
