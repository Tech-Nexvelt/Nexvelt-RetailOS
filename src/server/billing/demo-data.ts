import type { CatalogRecord } from "./engine";

/** Fictitious demo catalogue. Not NR Collections data. Prices are illustrative only. */
export const DEMO_BRANCH = "B1";

function shirt(id: string, size: string, colour: string, stock: number): CatalogRecord {
  return {
    id,
    kind: "CLOTHING",
    code: `NR${id.replace(/\D/g, "").padStart(8, "0")}`,
    name: "Cotton Shirt",
    detail: `${size} / ${colour}`,
    unitPricePaise: 129900,
    branchId: DEMO_BRANCH,
    active: true,
    stock,
    searchText: `cotton shirt ${size} ${colour} shirts clothing`,
  };
}

export function demoCatalog(): CatalogRecord[] {
  return [
    shirt("v1", "M", "Blue", 5),
    shirt("v2", "L", "Blue", 3),
    shirt("v3", "M", "White", 0),
    {
      id: "v10",
      kind: "CLOTHING",
      code: "NR00000012",
      name: "Slim Jeans",
      detail: "32 / Indigo",
      unitPricePaise: 189900,
      branchId: DEMO_BRANCH,
      active: true,
      stock: 4,
      searchText: "slim jeans 32 indigo clothing",
    },
    {
      id: "j1",
      kind: "IMITATION_JEWELLERY",
      code: "IJ0000123",
      name: "Kundan Necklace",
      detail: "IJ0000123",
      unitPricePaise: 49900,
      branchId: DEMO_BRANCH,
      active: true,
      status: "IN_STOCK",
      searchText: "kundan necklace imitation jewellery",
    },
    {
      id: "j2",
      kind: "IMITATION_JEWELLERY",
      code: "IJ0000124",
      name: "Kundan Necklace",
      detail: "IJ0000124",
      unitPricePaise: 49900,
      branchId: DEMO_BRANCH,
      active: true,
      status: "SOLD",
      searchText: "kundan necklace imitation jewellery",
    },
    {
      id: "j3",
      kind: "IMITATION_JEWELLERY",
      code: "IJ0000125",
      name: "Jhumka Earrings",
      detail: "IJ0000125",
      unitPricePaise: 29900,
      branchId: DEMO_BRANCH,
      active: true,
      status: "ON_HOLD",
      searchText: "jhumka earrings imitation jewellery",
    },
    {
      id: "g1",
      kind: "PRECIOUS_JEWELLERY",
      code: "GJ0000045",
      name: "Gold Chain 22K (fixed tag)",
      detail: "GJ0000045",
      unitPricePaise: 4850000,
      branchId: DEMO_BRANCH,
      active: true,
      status: "IN_STOCK",
      searchText: "gold chain 22k fixed tag precious jewellery",
    },
    {
      id: "x1",
      kind: "IMITATION_JEWELLERY",
      code: "IJ0000999",
      name: "Bangle Set",
      detail: "IJ0000999",
      unitPricePaise: 19900,
      branchId: "B2",
      active: true,
      status: "IN_STOCK",
      searchText: "bangle set imitation jewellery",
    },
  ];
}
