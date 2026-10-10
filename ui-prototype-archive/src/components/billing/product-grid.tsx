"use client";

import React, { useState } from "react";
import { Plus, LayoutGrid, List } from "lucide-react";
import { useRetail } from "@/context/retail-context";
import { cn } from "@/lib/cn";

export function ProductGrid() {
  const {
    products,
    searchQuery,
    selectedCategory,
    setSelectedCategory,
    selectedTab,
    setSelectedTab,
    addToCart,
    isEmptyStateDemo,
  } = useRetail();

  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const categories = [
    { name: "All", label: "All Products", count: 124 },
    { name: "Clothing", label: "Clothing", count: 56 },
    { name: "Imitation Jewellery", label: "Imitation Jewellery", count: 38 },
    { name: "Gold Jewellery", label: "Gold Jewellery", count: 24 },
    { name: "Silver Jewellery", label: "Silver Jewellery", count: 12 },
    { name: "Accessories", label: "Accessories", count: 8 },
  ];

  const filteredProducts = products.filter((p) => {
    if (isEmptyStateDemo) return false;
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.tag.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.specs.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "All" || p.category === selectedCategory;
    const matchesTab =
      selectedTab === "All Products"
        ? true
        : selectedTab === "Featured"
          ? p.featured
          : p.stock <= 5;
    return matchesSearch && matchesCategory && matchesTab;
  });

  return (
    <div className="flex gap-4 flex-1 min-w-0">
      {/* Category Rail (Left Column) */}
      <aside className="w-48 shrink-0 space-y-1 bg-white p-3 rounded-2xl border border-gray-200 shadow-2xs hidden lg:block">
        {categories.map((cat) => {
          const isActive = selectedCategory === cat.name;
          return (
            <button
              key={cat.name}
              onClick={() => setSelectedCategory(cat.name)}
              className={cn(
                "w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer text-left",
                isActive
                  ? "bg-[#00D9D9]/20 text-slate-950 font-semibold border-l-4 border-[#00D9D9]"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
              )}
            >
              <span className="truncate">{cat.label}</span>
              <span
                className={cn(
                  "px-2 py-0.5 rounded-full text-[11px] font-medium",
                  isActive ? "bg-[#00D9D9] text-slate-950" : "bg-gray-100 text-gray-500",
                )}
              >
                {cat.count}
              </span>
            </button>
          );
        })}
      </aside>

      {/* Product Grid Area (Main Center Column) */}
      <div className="flex-1 flex flex-col min-w-0 space-y-4">
        {/* Top Product Filter Bar */}
        <div className="flex items-center justify-between gap-4 bg-white px-4 py-2.5 rounded-2xl border border-gray-200 shadow-2xs">
          <div className="flex items-center gap-1.5">
            {(["All Products", "Featured", "Low Stock"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setSelectedTab(tab)}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer",
                  selectedTab === tab
                    ? "bg-gray-100 text-gray-900 shadow-2xs"
                    : "text-gray-500 hover:text-gray-900 hover:bg-gray-50",
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 border border-gray-200 rounded-lg p-0.5 bg-gray-50">
            <button
              onClick={() => setViewMode("grid")}
              className={cn(
                "p-1.5 rounded-md text-xs transition cursor-pointer",
                viewMode === "grid"
                  ? "bg-white text-gray-900 shadow-2xs"
                  : "text-gray-400 hover:text-gray-700",
              )}
              title="Grid View"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={cn(
                "p-1.5 rounded-md text-xs transition cursor-pointer",
                viewMode === "list"
                  ? "bg-white text-gray-900 shadow-2xs"
                  : "text-gray-400 hover:text-gray-700",
              )}
              title="List View"
            >
              <List size={16} />
            </button>
          </div>
        </div>

        {/* Empty State Display */}
        {filteredProducts.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 bg-white rounded-2xl border border-gray-200 text-center min-h-[350px]">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center text-gray-400 mb-3 border border-gray-200">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M21 8L12 3L3 8V16L12 21L21 16V8Z" strokeLinejoin="round" />
                <path d="M3 8L12 13L21 8" />
                <path d="M12 13V21" />
              </svg>
            </div>
            <h3 className="text-base font-bold text-gray-900 mb-1">No products yet</h3>
            <p className="text-xs text-gray-500 mb-4">Add your first product to start billing</p>
            <button
              onClick={() => alert("Add Product Modal")}
              className="bg-[#00D9D9] hover:bg-[#00B8B8] text-slate-950 text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-1.5 shadow-xs"
            >
              <Plus size={16} />
              <span>Add Product</span>
            </button>
          </div>
        ) : viewMode === "grid" ? (
          /* Grid View */
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3.5">
            {filteredProducts.map((product) => (
              <div
                key={product.id}
                className="bg-white border border-gray-200 rounded-2xl p-3 flex flex-col justify-between hover:shadow-md transition group relative"
              >
                <div>
                  {/* Image Thumbnail */}
                  <div className="w-full h-36 bg-gray-50 rounded-xl overflow-hidden mb-3 border border-gray-100 flex items-center justify-center relative">
                    <img
                      src={product.image}
                      alt={product.name}
                      className="w-full h-full object-contain p-2 group-hover:scale-105 transition duration-200"
                    />
                  </div>
                  {/* Product Title */}
                  <h4 className="font-bold text-sm text-gray-900 line-clamp-1">{product.name}</h4>
                  {/* Specs & Stock */}
                  <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-1">{product.specs}</p>
                </div>

                {/* Price & Add Button Row */}
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
                  <span className="font-extrabold text-base text-gray-900">
                    ₹{product.price.toLocaleString("en-IN")}
                  </span>
                  <button
                    onClick={() => addToCart(product)}
                    className="w-8 h-8 rounded-full bg-[#00D9D9] hover:bg-[#00B8B8] text-slate-950 flex items-center justify-center transition shadow-xs cursor-pointer active:scale-95"
                    title="Add to Cart"
                  >
                    <Plus size={18} strokeWidth={2.5} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* List View */
          <div className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-100 overflow-hidden">
            {filteredProducts.map((product) => (
              <div
                key={product.id}
                className="p-3 flex items-center justify-between hover:bg-gray-50 transition"
              >
                <div className="flex items-center gap-3">
                  <img
                    src={product.image}
                    alt={product.name}
                    className="w-12 h-12 rounded-lg bg-gray-50 object-contain p-1 border border-gray-200"
                  />
                  <div>
                    <h4 className="font-bold text-sm text-gray-900">{product.name}</h4>
                    <p className="text-xs text-gray-500">{product.specs}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-extrabold text-base text-gray-900">
                    ₹{product.price.toLocaleString("en-IN")}
                  </span>
                  <button
                    onClick={() => addToCart(product)}
                    className="bg-[#00D9D9] hover:bg-[#00B8B8] text-slate-950 font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1"
                  >
                    <Plus size={14} /> Add
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
