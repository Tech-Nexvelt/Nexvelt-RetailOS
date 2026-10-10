import { describe, expect, it } from "vitest";
import { DEFAULT_QUERY, isLowStock, isOutOfStock, parseCatalogQuery, queryCatalog, type CatalogRow } from "./catalog";

const row = (over: Partial<CatalogRow> & { id: string }): CatalogRow => ({
  kind: "VARIANT", name: "Shirt", detail: "M / Blue", barcode: "8901230000018", pricePaise: 129900, stock: 5, status: "In stock", active: true, reorderLevel: null, mrpPaise: null, imagePath: null, imageOwnerId: null, ...over,
});

describe("low-stock and out-of-stock rules", () => {
  it("low stock needs a reorder level, some stock, and stock at or below the level", () => {
    expect(isLowStock(row({ id: "1", stock: 3, reorderLevel: 5 }))).toBe(true);
    expect(isLowStock(row({ id: "1", stock: 5, reorderLevel: 5 }))).toBe(true);
    expect(isLowStock(row({ id: "1", stock: 6, reorderLevel: 5 }))).toBe(false);
    expect(isLowStock(row({ id: "1", stock: 0, reorderLevel: 5 }))).toBe(false); // zero is "out", not "low"
    expect(isLowStock(row({ id: "1", stock: 3, reorderLevel: null }))).toBe(false); // no alert set
    expect(isLowStock(row({ id: "1", stock: 3, reorderLevel: 5, active: false }))).toBe(false); // switched off is not an alert
    expect(isLowStock(row({ id: "1", kind: "JEWELLERY", stock: null, reorderLevel: 5 }))).toBe(false);
    expect(isLowStock(row({ id: "1", stock: null, reorderLevel: 5 }))).toBe(false); // stock unknown (no inventory.view)
  });
  it("out of stock is an active clothing variant with zero (or fewer) units, and never deletes or switches anything off", () => {
    expect(isOutOfStock(row({ id: "1", stock: 0 }))).toBe(true);
    expect(isOutOfStock(row({ id: "1", stock: 1 }))).toBe(false);
    expect(isOutOfStock(row({ id: "1", stock: 0, active: false }))).toBe(false);
    expect(isOutOfStock(row({ id: "1", stock: null }))).toBe(false);
  });
});

describe("parseCatalogQuery (untrusted URL input)", () => {
  it("accepts known values", () => {
    expect(parseCatalogQuery({ status: "low", kind: "jewellery", sort: "price", dir: "desc", page: "3" })).toEqual({ status: "low", kind: "jewellery", sort: "price", dir: "desc", page: 3, pageSize: 25 });
  });
  it("falls back to safe defaults for anything else", () => {
    for (const bad of [{ status: "DROP TABLE" }, { kind: "<script>" }, { sort: "created_at; --" }, { dir: "sideways" }, { page: "-4" }, { page: "abc" }, { page: "0" }, { page: "99999999" }, { page: "1.5" }]) {
      expect(parseCatalogQuery(bad)).toEqual(DEFAULT_QUERY);
    }
    expect(parseCatalogQuery({})).toEqual(DEFAULT_QUERY);
  });
});

describe("queryCatalog: filter, sort, paginate", () => {
  const rows: CatalogRow[] = [
    row({ id: "a", name: "Apple Shirt", pricePaise: 50000, stock: 10 }),
    row({ id: "b", name: "Banana Jeans", pricePaise: 200000, stock: 2, reorderLevel: 3 }),
    row({ id: "c", name: "Cherry Kurti", pricePaise: 90000, stock: 0, status: "Out of stock" }),
    row({ id: "d", name: "Dates Saree", pricePaise: 350000, stock: 7, active: false, status: "Switched off" }),
    row({ id: "e", kind: "JEWELLERY", name: "Emerald Ring", detail: "GJ1", pricePaise: 2800000, stock: null, status: "In stock" }),
    row({ id: "f", kind: "JEWELLERY", name: "Fine Chain", detail: "GJ2", pricePaise: 5000000, stock: null, status: "Sold" }),
  ];
  const q = (o = {}) => ({ ...DEFAULT_QUERY, ...o });
  const ids = (r: { rows: CatalogRow[] }) => r.rows.map((x) => x.id);

  it("default: everything, by name", () => {
    expect(ids(queryCatalog(rows, q()))).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
  it("status filters", () => {
    expect(ids(queryCatalog(rows, q({ status: "in_stock" })))).toEqual(["a", "b", "e"]);
    expect(ids(queryCatalog(rows, q({ status: "low" })))).toEqual(["b"]);
    expect(ids(queryCatalog(rows, q({ status: "out" })))).toEqual(["c", "f"]); // a sold one-off piece is out too
    expect(ids(queryCatalog(rows, q({ status: "off" })))).toEqual(["d"]);
  });
  it("kind filters", () => {
    expect(ids(queryCatalog(rows, q({ kind: "clothing" })))).toEqual(["a", "b", "c", "d"]);
    expect(ids(queryCatalog(rows, q({ kind: "jewellery" })))).toEqual(["e", "f"]);
  });
  it("sorting by price and stock, both directions, with a stable tie-break", () => {
    expect(ids(queryCatalog(rows, q({ sort: "price", dir: "desc" })))).toEqual(["f", "e", "d", "b", "c", "a"]);
    expect(ids(queryCatalog(rows, q({ sort: "price", dir: "asc" })))).toEqual(["a", "c", "b", "d", "e", "f"]);
    // an out-of-stock shirt (0) and a sold one-off piece (counts as 0) tie, then the name decides; the most stocked item is last
    const byStock = ids(queryCatalog(rows, q({ sort: "stock", dir: "asc" })));
    expect(byStock.slice(0, 2)).toEqual(["c", "f"]);
    expect(byStock.at(-1)).toBe("a");
    const same = [row({ id: "z", name: "Same" }), row({ id: "y", name: "Same" }), row({ id: "x", name: "Same" })];
    expect(ids(queryCatalog(same, q({ sort: "price" })))).toEqual(["x", "y", "z"]);
  });
  it("pagination: counts, clamps a page past the end, and never returns more than a page", () => {
    const many = Array.from({ length: 60 }, (_, i) => row({ id: `id${String(i).padStart(2, "0")}`, name: `Item ${String(i).padStart(2, "0")}` }));
    const p1 = queryCatalog(many, q());
    expect([p1.rows.length, p1.total, p1.page, p1.pages]).toEqual([25, 60, 1, 3]);
    const p3 = queryCatalog(many, q({ page: 3 }));
    expect([p3.rows.length, p3.rows[0]!.name]).toEqual([10, "Item 50"]);
    expect(queryCatalog(many, q({ page: 99 })).page).toBe(3);
    expect(queryCatalog([], q())).toEqual({ rows: [], total: 0, page: 1, pages: 1 });
  });
  it("does not modify the input array", () => {
    const copy = [...rows];
    queryCatalog(rows, q({ sort: "price", dir: "desc" }));
    expect(rows).toEqual(copy);
  });
});
