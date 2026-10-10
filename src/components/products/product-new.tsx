"use client";

import { ProductForm } from "./product-form";
import { createClothingAction, createJewelleryAction } from "@/server/app/catalog-actions";

/** Wires the form to the real server actions. (Kept separate so the form itself is easy to test.) */
export function ProductNew() {
  return <ProductForm api={{ createClothing: createClothingAction, createJewellery: createJewelleryAction }} />;
}
