# Product images: findings, proposal and approval request

**Status: NOT implemented end to end. Waiting for your approval of a storage and schema change.** Nothing was applied to the hosted project. The only things built so far need no approval: the validation library and a rehearsal of the proposed SQL on a local copy.

## 1. What I found (read-only, hosted project)
| Question | Answer |
|---|---|
| Storage buckets | **none** (`storage.buckets` is empty) |
| Storage policies on `storage.objects` | **none**; no objects |
| An image column or metadata field on products, variants, jewellery items or designs | **none** (no `image*`, `photo*`, `path`, `url` or JSON metadata column on the catalogue tables) |
| Application code using Supabase Storage | **none** |
| Permission helpers available for policies | `retailos_private.has_tenant_access(tenant)`, `has_tenant_permission(tenant, perm)` |
| Who has `product.edit` today | Owner (everything) and **Branch Manager** (default); Cashier does not. The owner can change this per person. |

So there is no suitable existing bucket, and there is nowhere to store a reference. Both need a change. Per your rules I have not made it.

## 2. What I need you to approve
The file **`docs/proposals/product-images.sql`** (outside the migrations folder; not applied). If approved it becomes migration `20261010100016_product_images.sql`, which I would seal, add to the manifest and verify, and **you apply it yourself**. It adds only:
1. a **private** bucket `product-images`: 5 MB limit, JPEG/PNG/WebP only, enforced by Storage itself;
2. `image_path` (text) on `retailos.products` and `retailos.jewellery_designs`: the storage key, never the image (no Base64 in PostgreSQL);
3. a **guard trigger**: a stored path must be well formed and belong to the same tenant, the same kind and the same row, so a manipulated path cannot point a product at another tenant's or another product's file;
4. three **storage policies**, scoped by the tenant id in the first folder of the file path: read for any member of the tenant, upload and delete for members holding `product.edit`. **No update policy**: files are immutable, a replacement is a new uniquely named file;
5. an **audit entry** whenever an image reference changes.
It changes no invoice, payment, stock or ledger row and no existing function, privilege or policy.

Why images attach to the **product** (clothing) and the **jewellery design**: every size/colour of a shirt shares the photo, and every tagged piece of a design shares it. That keeps one upload per product instead of one per variant or piece. If you want a photo per individual jewellery piece instead, tell me before approval; it changes the column and the path.

## 3. Rehearsal evidence (local copy of the schema, stand-in `storage`; NOT Supabase Storage itself)
`tests/db/images-proposal.test.ts` applies the proposal file exactly as written and then attacks it. 15 of 15 tests pass:
* the bucket is private, 5 MB, three MIME types; the two columns, three policies and four closed helper functions exist; **no update policy**;
* an owner uploads and reads under their tenant; a manager can exactly when `product.edit` is granted; a cashier can **read** (so images show in billing) but cannot upload or delete (and a delete changes nothing);
* **another tenant's owner cannot upload into, read or delete this tenant's images**; an outsider and an anonymous caller get nothing;
* nine malformed or manipulated names are refused even for the owner (traversal, wrong extension, upper case, unknown kind, non-uuid tenant folder, missing folder, extra segment, double slash, another tenant smuggled in front) and so is any other bucket;
* objects cannot be overwritten or renamed; the owner can delete their own old image;
* the guard refuses another tenant's path, another product's path, the wrong kind and junk, accepts the row's own path and NULL, and audits only real changes; jewellery designs use their own kind and id; another tenant's user still cannot touch the rows.

## 4. Built now (needs no approval): `src/lib/images/validate.ts` (16 tests)
The file type is decided from the **bytes** (JPEG, PNG, WebP), never the name or declared MIME; a name or MIME that disagrees is refused; real width and height are read from the header (PNG, JPEG, all three WebP variants); defaults: 5 MB (configurable by the caller), 200 to 6000 pixels per side (stops tiny files and decompression bombs); empty, corrupt and truncated files are refused with plain messages; `buildImagePath` makes `tenant/products|jewellery/owner/unique-file.ext` from validated UUIDs only; `pathBelongsTo` is the check that a stored or submitted path really belongs to this tenant, kind and row.

## 5. The upload design I would build after approval
1. **Add Product:** create the product with the existing `catalog_create_clothing` (or `catalog_create_jewellery`); only then upload; if the upload or the reference save fails the product stays valid, the form says exactly what failed, and **Retry** repeats just the image step with the same data.
2. **Upload** goes through a server route handler (not the browser straight to storage): it checks the session and `product.edit`, runs `validateImage` on the real bytes, uploads with **the user's own session** (so the storage policies apply as the second lock), then sets `image_path`. Server actions have a 1 MB default body limit, so a route handler is used.
3. **Replace:** upload the new file, save the new reference, and only then delete the previous object; if the reference save fails the new file is deleted again (no orphan); if deleting the old file fails the UI is still correct and the leftover is reported, never hidden.
4. **Remove:** clear the reference first, then delete the object; a storage failure leaves the product consistent.
5. **Display:** a private bucket means short-lived **signed URLs**, created on the server with the user's session (no secret key anywhere in the browser). Unique file names mean a changed image gets a new URL, so no stale browser cache. Lists and the billing cart use lazy-loaded thumbnails with fixed dimensions and a **placeholder** instead of a broken-image icon. Optional later: resize in the browser before upload to keep files small.
6. **Where it appears:** product list and detail, billing search results and cart, jewellery pieces, any catalogue view.

## 6. Your acceptance tests: current status
| # | Test | Status |
|---|---|---|
| 1 | Owner uploads while creating a product | **BLOCKED**: needs the approved change |
| 2 | Authorised manager uploads and replaces | **BLOCKED**; permission logic rehearsed locally (manager allowed exactly when `product.edit`) |
| 3 | Unauthorised user cannot modify an image | **Rehearsed locally: PASS** (cashier, outsider, anonymous); real Storage not yet tested |
| 4 | Image survives refresh and sign-out/in | **BLOCKED** |
| 5 | Replace updates list, detail and billing | **BLOCKED** |
| 6 | Products without images show a placeholder | **BLOCKED** (nothing to display yet; will be built with the display work) |
| 7 | Unsupported type and oversized file rejected | **PASS** at the validation layer (16 tests); the Storage-side limit needs the bucket |
| 8 | Upload failure recoverable without corrupting data | **BLOCKED**; design in section 5 |
| 9 | Removal clears the right reference and handles storage errors | **BLOCKED** |
| 10 | Jewellery images with the existing workflow | **BLOCKED**; path/guard rehearsed for jewellery designs |
| 11 | Cross-tenant access to image objects denied | **Rehearsed locally: PASS**; real Storage not yet tested |
| 12 | Existing functionality and tests | **PASS** (see the totals in the report) |

## 7. Approval checklist
1. Approve `docs/proposals/product-images.sql` as is, or tell me what to change (per-product versus per-piece jewellery photos; the 5 MB and 200 to 6000 pixel limits; audit triggers).
2. After approval I will: turn it into migration 016, seal it, update the manifest and the expected inventory, run all tests, and then **you** apply it and run the hosted verification script.
3. Then I build the upload route, the uploader component (drag and drop, browse, preview, progress, replace, remove), the display components and the tests, and verify on the hosted project with a real image.
4. No deploy and no push at any point without your explicit approval.
