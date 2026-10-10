import { describe, expect, it } from "vitest";
import { IMAGE_DEFAULTS, buildImagePath, parseImagePath, pathBelongsTo, readDimensions, sniffImageKind, validateImage } from "./validate";

const T = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const F = "44444444-4444-4444-8444-444444444444";

const be16 = (n: number) => [(n >> 8) & 255, n & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const pad = (a: number[], total: number) => Uint8Array.from([...a, ...new Array(Math.max(0, total - a.length)).fill(0)]);

/** minimal but structurally real images */
const png = (w: number, h: number, total = 64) => pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...ascii("IHDR"), ...be32(w), ...be32(h), 8, 6, 0, 0, 0], total);
const jpeg = (w: number, h: number, total = 64) =>
  pad([0xff, 0xd8, 0xff, 0xe0, ...be16(16), ...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xdb, ...be16(4), 0, 0, 0xff, 0xc0, ...be16(11), 8, ...be16(h), ...be16(w), 3, 1, 0x22, 0], total);
const webpX = (w: number, h: number, total = 64) => pad([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...ascii("VP8X"), 10, 0, 0, 0, 0, 0, 0, 0, (w - 1) & 255, ((w - 1) >> 8) & 255, ((w - 1) >> 16) & 255, (h - 1) & 255, ((h - 1) >> 8) & 255, ((h - 1) >> 16) & 255], total);
const webpL = (w: number, h: number, total = 64) => {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
  return pad([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...ascii("VP8L"), 5, 0, 0, 0, 0x2f, bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >>> 24) & 255], total);
};
const webpLossy = (w: number, h: number, total = 64) => pad([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...ascii("VP8 "), 10, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, w & 255, (w >> 8) & 255, h & 255, (h >> 8) & 255], total);

describe("real type comes from the bytes", () => {
  it("recognises JPEG, PNG and WebP", () => {
    expect(sniffImageKind(jpeg(800, 600))).toBe("jpeg");
    expect(sniffImageKind(png(800, 600))).toBe("png");
    expect(sniffImageKind(webpX(800, 600))).toBe("webp");
  });
  it("rejects everything else, however it is named", () => {
    const gif = Uint8Array.from([...ascii("GIF89a"), 1, 0, 1, 0]);
    const svg = Uint8Array.from(ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
    const exe = Uint8Array.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]);
    const pdf = Uint8Array.from(ascii("%PDF-1.7"));
    const html = Uint8Array.from(ascii("<html><body>hi</body></html>"));
    const riffWav = Uint8Array.from([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE"), 0, 0]);
    for (const [name, bytes] of [["x.jpg", gif], ["x.png", svg], ["x.webp", exe], ["x.jpg", pdf], ["x.png", html], ["x.webp", riffWav]] as const) {
      expect(validateImage({ bytes, fileName: name, declaredType: "image/jpeg" })).toMatchObject({ ok: false, code: "UNSUPPORTED_TYPE" });
    }
  });
});

describe("dimensions are read from the real header", () => {
  it("PNG, JPEG and the three WebP variants", () => {
    expect(readDimensions(png(1200, 900), "png")).toEqual({ width: 1200, height: 900 });
    expect(readDimensions(jpeg(1600, 1200), "jpeg")).toEqual({ width: 1600, height: 1200 });
    expect(readDimensions(webpX(1024, 768), "webp")).toEqual({ width: 1024, height: 768 });
    expect(readDimensions(webpL(640, 480), "webp")).toEqual({ width: 640, height: 480 });
    expect(readDimensions(webpLossy(500, 400), "webp")).toEqual({ width: 500, height: 400 });
  });
  it("a JPEG whose first frame header is behind other segments is still found", () => {
    const pre = [0xff, 0xd8, 0xff, 0xe1, ...be16(30), ...new Array(28).fill(7), 0xff, 0xe2, ...be16(10), ...new Array(8).fill(1), 0xff, 0xc2, ...be16(11), 8, ...be16(333), ...be16(444), 3, 1, 0x22, 0];
    expect(readDimensions(pad(pre, 120), "jpeg")).toEqual({ width: 444, height: 333 });
  });
  it("truncated or malformed headers return null instead of throwing or guessing", () => {
    expect(readDimensions(png(100, 100).slice(0, 18), "png")).toBeNull();
    expect(readDimensions(jpeg(100, 100).slice(0, 12), "jpeg")).toBeNull();
    expect(readDimensions(webpX(100, 100).slice(0, 20), "webp")).toBeNull();
    expect(readDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 0, 0]), "jpeg")).toBeNull();
  });
});

describe("validateImage", () => {
  it("accepts a good photo of each type and reports its real size", () => {
    expect(validateImage({ bytes: jpeg(1600, 1200), declaredType: "image/jpeg", fileName: "shirt.JPG" })).toMatchObject({ ok: true, kind: "jpeg", ext: "jpg", width: 1600, height: 1200 });
    expect(validateImage({ bytes: jpeg(800, 800), fileName: "shirt.jpeg" })).toMatchObject({ ok: true, ext: "jpg" });
    expect(validateImage({ bytes: png(800, 800), declaredType: "image/png", fileName: "a.png" })).toMatchObject({ ok: true, kind: "png" });
    expect(validateImage({ bytes: webpL(800, 800), declaredType: "image/webp", fileName: "a.webp" })).toMatchObject({ ok: true, kind: "webp" });
  });
  it("empty file", () => {
    expect(validateImage({ bytes: new Uint8Array(0) })).toMatchObject({ ok: false, code: "EMPTY" });
  });
  it("size limit: 5 MB by default, configurable, checked before anything is parsed", () => {
    const big = jpeg(800, 800, 5 * 1024 * 1024 + 1);
    expect(validateImage({ bytes: big })).toMatchObject({ ok: false, code: "TOO_LARGE" });
    expect(validateImage({ bytes: jpeg(800, 800, 5 * 1024 * 1024) })).toMatchObject({ ok: true });
    expect(validateImage({ bytes: jpeg(800, 800, 2000) }, { maxBytes: 1000 })).toMatchObject({ ok: false, code: "TOO_LARGE" });
    expect(IMAGE_DEFAULTS.maxBytes).toBe(5 * 1024 * 1024);
  });
  it("a declared type or file name that disagrees with the bytes is refused", () => {
    expect(validateImage({ bytes: png(800, 800), declaredType: "image/jpeg" })).toMatchObject({ ok: false, code: "TYPE_MISMATCH" });
    expect(validateImage({ bytes: png(800, 800), fileName: "x.jpg" })).toMatchObject({ ok: false, code: "TYPE_MISMATCH" });
    expect(validateImage({ bytes: png(800, 800), fileName: "noextension" })).toMatchObject({ ok: false, code: "TYPE_MISMATCH" });
    expect(validateImage({ bytes: jpeg(800, 800), fileName: "evil.png.jpg" })).toMatchObject({ ok: true });
  });
  it("too small, too large in pixels, and unreadable headers", () => {
    expect(validateImage({ bytes: png(100, 100) })).toMatchObject({ ok: false, code: "TOO_SMALL" });
    expect(validateImage({ bytes: png(800, 150) })).toMatchObject({ ok: false, code: "TOO_SMALL" });
    expect(validateImage({ bytes: png(8000, 800) })).toMatchObject({ ok: false, code: "TOO_BIG_DIMENSIONS" });
    expect(validateImage({ bytes: png(40000, 40000) })).toMatchObject({ ok: false, code: "TOO_BIG_DIMENSIONS" }); // a decompression-bomb header
    expect(validateImage({ bytes: png(800, 800).slice(0, 15) })).toMatchObject({ ok: false, code: "CORRUPT" });
    expect(validateImage({ bytes: pad([0xff, 0xd8, 0xff, 0xe0], 40) })).toMatchObject({ ok: false, code: "CORRUPT" });
  });
  it("every refusal comes with a plain-language message", () => {
    const r = validateImage({ bytes: new Uint8Array(0) });
    expect(!r.ok && r.message.length > 10).toBe(true);
  });
});

describe("tenant-scoped storage paths", () => {
  it("builds <tenant>/<products|jewellery>/<owner>/<file>.<ext> and parses it back", () => {
    const p = buildImagePath({ tenantId: T, owner: "products", ownerId: P, fileId: F, ext: "webp" });
    expect(p).toBe(`${T}/products/${P}/${F}.webp`);
    expect(parseImagePath(p)).toEqual({ tenantId: T, owner: "products", ownerId: P, fileId: F, ext: "webp" });
    expect(parseImagePath(buildImagePath({ tenantId: T, owner: "jewellery", ownerId: P, fileId: F, ext: "jpg" }))?.owner).toBe("jewellery");
  });
  it("two uploads never share a path (replacement cannot overwrite, URLs change)", () => {
    const F2 = "55555555-5555-4555-8555-555555555555";
    expect(buildImagePath({ tenantId: T, owner: "products", ownerId: P, fileId: F, ext: "jpg" })).not.toBe(buildImagePath({ tenantId: T, owner: "products", ownerId: P, fileId: F2, ext: "jpg" }));
  });
  it("refuses to build a path from anything that is not a UUID (no traversal, no injection)", () => {
    for (const bad of ["../x", "a/b", "", "11111111-1111-4111-8111-11111111111g", T + "/../" + T2]) {
      expect(() => buildImagePath({ tenantId: bad, owner: "products", ownerId: P, fileId: F, ext: "jpg" })).toThrow();
      expect(() => buildImagePath({ tenantId: T, owner: "products", ownerId: bad, fileId: F, ext: "jpg" })).toThrow();
    }
  });
  it("parse rejects traversal, wrong shapes, extra segments and non-strings", () => {
    for (const bad of [`${T}/products/${P}/../${T2}/products/${P}/${F}.jpg`, `${T}/products/${P}/${F}.gif`, `${T}/other/${P}/${F}.jpg`, `${T}/products/${F}.jpg`, `/${T}/products/${P}/${F}.jpg`, `${T}/products/${P}/${F}.jpg/`, `${T}/products/${P}/${F}.JPG`, `${T}\\products\\${P}\\${F}.jpg`, `${T}/products/${P}/${F}.jpg?x=1`, 5, null, undefined, "x".repeat(300)]) {
      expect(parseImagePath(bad), String(bad)).toBeNull();
    }
  });
  it("pathBelongsTo is the guard against a manipulated storage path: tenant, kind AND owner must all match", () => {
    const own = `${T}/products/${P}/${F}.png`;
    expect(pathBelongsTo(own, T, "products", P)).toBe(true);
    expect(pathBelongsTo(own, T2, "products", P)).toBe(false); // another tenant's path presented as ours
    expect(pathBelongsTo(own, T, "jewellery", P)).toBe(false);
    expect(pathBelongsTo(own, T, "products", F)).toBe(false);
    expect(pathBelongsTo(`${T2}/products/${P}/${F}.png`, T, "products", P)).toBe(false);
    expect(pathBelongsTo("not a path", T, "products", P)).toBe(false);
  });
});
