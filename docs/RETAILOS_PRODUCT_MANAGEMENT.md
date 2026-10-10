# Product & inventory management: what exists, what was added, what is missing

Verified on the hosted project (owner session, real data) unless marked otherwise. No schema change and no migration was needed for anything below.

## Added in this pass (all server-enforced; no direct stock writes)
| Capability | How |
|---|---|
| List: search, status filter (in stock / low / out / switched off), type filter (clothing / jewellery), sort (name, price, stock), pagination (25 per page) | `src/domain/catalog.ts` (`parseCatalogQuery`, `queryCatalog`, pure and tested) + `/products` page; URL parameters are validated and fall back to safe defaults |
| Low-stock and out-of-stock indicators, header count | uses the existing `product_variants.reorder_level`; a "Low stock" badge and filter |
| MRP shown beside the price (struck through when higher) | existing `product_variants.mrp` |
| Edit MRP and low-stock level | `updateItemAction`: MRP needs `product.price_edit`, reorder level needs `product.edit`; a request mixing groups needs both; MRP below price is refused with a clear message; the database also enforces it |
| Confirmation before a price change and before switching an item on/off | in `EditItem` (names the old and new price, says past bills are unchanged) |
| Stock history (movement ledger) on the detail page | read-only, `inventory_movements` under the caller's own permission (inventory.view) |

## Already existed and was reused
Create clothing (multi-variant, opening stock, barcodes, duplicate style/SKU/barcode refused) via `catalog_create_clothing`; create jewellery via `catalog_create_jewellery`; stock in/out via `inventory_adjust` (reason, note, idempotency, no negative stock); price and availability for jewellery via `catalog_update_jewellery`; permissions per action (`product.create`, `product.edit`, `product.price_edit`, `inventory.adjust`); audit trigger on variant changes.

## Verified live
Pagination 55 items / 25 per page; filters and sorts; nonsense URL parameters fall back safely; MRP and low-stock alert saved and shown (audit row with before/after); MRP below price refused; price change confirmed, billing quotes the new price at once, invoices already issued still show the old price; a switched-off item is refused by billing; mobile layout has no overflow. All live edits were reverted afterwards.

## Gaps: no safe RPC or schema support today (not built, proposals needed)
| Spec item | Gap | Minimal proposal (needs your approval) |
|---|---|---|
| Add a variant (size/colour) to an EXISTING product | no function; creating one needs product_variants + barcode + opening-stock ledger rows in one transaction | new `retailos.catalog_add_variant(...)` mirroring `catalog_create_clothing` |
| Edit product name, category, brand; edit SKU; add/retire barcode aliases | allowed by row-level policies on the tables but there is no validated function, uniqueness and audit rules would live in the browser path | `catalog_update_product(...)`, `catalog_set_barcode(...)` |
| Edit jewellery weights, purity, tag | `catalog_update_jewellery` only changes price and availability | extend it (sold pieces stay locked by the existing trigger) |
| Initial-stock confirmation dialog on create | UI only, small | can be added |
| Product images | no storage bucket, no image column | see `docs/RETAILOS_PRODUCT_IMAGES_PROPOSAL.md` |
| Stock "current stock by branch" across branches | UI shows the active branch only | small UI addition |
