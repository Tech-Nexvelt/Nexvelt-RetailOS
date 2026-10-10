/**
 * Product-image validation and storage-path rules. Pure and dependency-free, so it runs on the server (the authoritative check)
 * and, identically, in the browser for early feedback. Nothing here talks to storage or the database.
 *
 * The file's TYPE is decided from its first bytes ("magic numbers"), never from its name or the browser-declared MIME type, and its
 * dimensions are read from the real image header, so a renamed or truncated file cannot slip through.
 */
export const IMAGE_DEFAULTS = {
  /** configurable by the caller (server env PRODUCT_IMAGE_MAX_BYTES); 5 MB unless told otherwise */
  maxBytes: 5 * 1024 * 1024,
  minWidth: 200,
  minHeight: 200,
  maxWidth: 6000,
  maxHeight: 6000,
} as const;

export type ImageKind = "jpeg" | "png" | "webp";
export const EXTENSION: Record<ImageKind, "jpg" | "png" | "webp"> = { jpeg: "jpg", png: "png", webp: "webp" };
export const MIME: Record<ImageKind, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

export type ImageErrorCode = "EMPTY" | "TOO_LARGE" | "UNSUPPORTED_TYPE" | "TYPE_MISMATCH" | "CORRUPT" | "TOO_SMALL" | "TOO_BIG_DIMENSIONS";

export const IMAGE_ERRORS: Record<ImageErrorCode, string> = {
  EMPTY: "That file is empty. Choose a photo.",
  TOO_LARGE: "That photo is too large. Choose one under the size limit.",
  UNSUPPORTED_TYPE: "Only JPG, PNG or WebP photos can be used.",
  TYPE_MISMATCH: "The file name does not match what the file really is. Choose the original photo.",
  CORRUPT: "That photo could not be read. It may be damaged. Try another one.",
  TOO_SMALL: "That photo is too small. Use one at least 200 × 200 pixels.",
  TOO_BIG_DIMENSIONS: "That photo has too many pixels. Use one no larger than 6000 × 6000.",
};

export interface ImageLimits {
  maxBytes: number;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

export type ImageCheck =
  | { ok: true; kind: ImageKind; ext: "jpg" | "png" | "webp"; mime: string; width: number; height: number; bytes: number }
  | { ok: false; code: ImageErrorCode; message: string };

const fail = (code: ImageErrorCode): ImageCheck => ({ ok: false, code, message: IMAGE_ERRORS[code] });

/** Decide the real type from the leading bytes. null = not a supported image. */
export function sniffImageKind(b: Uint8Array): ImageKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  return null;
}

const u16be = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const u32be = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u24le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);

function pngSize(b: Uint8Array) {
  // signature(8) + IHDR chunk: length(4) "IHDR"(4) width(4) height(4)
  if (b.length < 24 || String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!) !== "IHDR") return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function jpegSize(b: Uint8Array) {
  let o = 2;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) return null;
    let m = b[o + 1]!;
    while (m === 0xff && o + 2 < b.length) {
      o++;
      m = b[o + 1]!;
    }
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) {
      o += 2;
      continue;
    }
    if (m === 0xd9 || m === 0xda) return null; // end of image / start of scan before any frame header
    const len = u16be(b, o + 2);
    if (len < 2) return null;
    // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (o + 9 > b.length) return null;
      return { height: u16be(b, o + 5), width: u16be(b, o + 7) };
    }
    o += 2 + len;
  }
  return null;
}

function webpSize(b: Uint8Array) {
  if (b.length < 30) return null;
  const tag = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (tag === "VP8X") return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  if (tag === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const bits = (b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24)) >>> 0;
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (tag === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
  }
  return null;
}

export function readDimensions(b: Uint8Array, kind: ImageKind): { width: number; height: number } | null {
  return kind === "png" ? pngSize(b) : kind === "jpeg" ? jpegSize(b) : webpSize(b);
}

/** the extension a declared file name ends with, lower case, with "jpeg" folded into "jpg" */
const nameExt = (name: string) => {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name.trim());
  const e = m?.[1]?.toLowerCase();
  return e === "jpeg" ? "jpg" : (e ?? "");
};

/**
 * Validate an uploaded image. `declaredType` and `fileName` are only cross-checked: the bytes decide.
 * A name or MIME that disagrees with the bytes is refused (a renamed .exe or .svg never gets in).
 */
export function validateImage(input: { bytes: Uint8Array; declaredType?: string; fileName?: string }, limits: Partial<ImageLimits> = {}): ImageCheck {
  const l: ImageLimits = { ...IMAGE_DEFAULTS, ...limits };
  const { bytes } = input;
  if (bytes.length === 0) return fail("EMPTY");
  if (bytes.length > l.maxBytes) return fail("TOO_LARGE");
  const kind = sniffImageKind(bytes);
  if (!kind) return fail("UNSUPPORTED_TYPE");
  if (input.declaredType !== undefined && input.declaredType !== "" && input.declaredType.toLowerCase() !== MIME[kind]) return fail("TYPE_MISMATCH");
  if (input.fileName !== undefined && input.fileName !== "" && nameExt(input.fileName) !== EXTENSION[kind]) return fail("TYPE_MISMATCH");
  const dim = readDimensions(bytes, kind);
  if (!dim || dim.width < 1 || dim.height < 1) return fail("CORRUPT");
  if (dim.width < l.minWidth || dim.height < l.minHeight) return fail("TOO_SMALL");
  if (dim.width > l.maxWidth || dim.height > l.maxHeight) return fail("TOO_BIG_DIMENSIONS");
  return { ok: true, kind, ext: EXTENSION[kind], mime: MIME[kind], width: dim.width, height: dim.height, bytes: bytes.length };
}

// ---- tenant-scoped storage paths ----------------------------------------------------------------------------------------------
export type ImageOwner = "products" | "jewellery";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** exactly: <tenant uuid>/<products|jewellery>/<owner uuid>/<file uuid>.<jpg|png|webp>. The database policies use the same shape. */
export const IMAGE_PATH = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(products|jewellery)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|webp)$/;

/** A unique path per upload: a replacement never overwrites the old object, and a changed image always has a new URL (no stale cache). */
export function buildImagePath(a: { tenantId: string; owner: ImageOwner; ownerId: string; fileId: string; ext: "jpg" | "png" | "webp" }): string {
  for (const id of [a.tenantId, a.ownerId, a.fileId]) if (!UUID.test(id)) throw new Error("INVALID_ID");
  return `${a.tenantId}/${a.owner}/${a.ownerId}/${a.fileId}.${a.ext}`;
}

export function parseImagePath(path: unknown): { tenantId: string; owner: ImageOwner; ownerId: string; fileId: string; ext: "jpg" | "png" | "webp" } | null {
  if (typeof path !== "string" || path.length > 200) return null;
  const m = IMAGE_PATH.exec(path);
  return m ? { tenantId: m[1]!, owner: m[2] as ImageOwner, ownerId: m[3]!, fileId: m[4]!, ext: m[5] as "jpg" | "png" | "webp" } : null;
}

/** true only when the stored path is well formed AND belongs to this tenant, owner kind and owner id. Never trust a client-supplied path without this. */
export function pathBelongsTo(path: unknown, tenantId: string, owner: ImageOwner, ownerId: string): boolean {
  const p = parseImagePath(path);
  return p !== null && p.tenantId === tenantId && p.owner === owner && p.ownerId === ownerId;
}
