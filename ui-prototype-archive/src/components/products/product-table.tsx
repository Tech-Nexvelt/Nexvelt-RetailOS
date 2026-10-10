"use client";

import React, { useState } from "react";
import { Plus, Search, Filter, Package } from "lucide-react";
import { useRetail } from "@/context/retail-context";

export function ProductTable() {
  const { products, addProduct } = useRetail();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // New product form state
  const [newName, setNewName] = useState("");
  const [newCat, setNewCat] = useState<any>("Clothing");
  const [newPrice, setNewPrice] = useState(999);
  const [newStock, setNewStock] = useState(10);
  const [newSku, setNewSku] = useState("NR-CL-004");

  const filtered = products.filter((p) => {
    const matchQuery =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase());
    const matchCat = categoryFilter === "All" || p.category === categoryFilter;
    return matchQuery && matchCat;
  });

  const handleCreateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    addProduct({
      name: newName || "New Item",
      category: newCat,
      price: newPrice,
      specs: `${newStock} in stock`,
      stock: newStock,
      tag: newSku,
      sku: newSku,
      status: "Active",
      image: products[0]?.image || "",
    });
    setIsAddModalOpen(false);
    setNewName("");
  };

  return (
    <div className="space-y-4">
      {/* Top Action & Filter Bar */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-2xs">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          {/* Search Box */}
          <div className="relative min-w-[240px] flex-1">
            <Search size={16} className="absolute left-3 text-gray-400 top-3" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products..."
              className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:border-[#00D9D9]"
            />
          </div>

          {/* Category Filter */}
          <div className="flex items-center gap-2">
            <Filter size={15} className="text-gray-400" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-900 font-medium focus:outline-none"
            >
              <option value="All">All Categories</option>
              <option value="Clothing">Clothing</option>
              <option value="Imitation Jewellery">Imitation Jewellery</option>
              <option value="Gold Jewellery">Gold Jewellery</option>
              <option value="Accessories">Accessories</option>
            </select>
          </div>
        </div>

        {/* Add Product Button */}
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="bg-[#00D9D9] hover:bg-[#00B8B8] text-slate-950 font-bold text-xs px-4 py-2.5 rounded-xl flex items-center gap-1.5 transition shadow-xs cursor-pointer"
        >
          <Plus size={16} />
          <span>Add Product</span>
        </button>
      </div>

      {/* Table Container */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-2xs overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
              <th className="py-3 px-4">Image</th>
              <th className="py-3 px-4">Name</th>
              <th className="py-3 px-4">Category</th>
              <th className="py-3 px-4">SKU / Barcode</th>
              <th className="py-3 px-4">Price</th>
              <th className="py-3 px-4">Stock</th>
              <th className="py-3 px-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-xs">
            {filtered.map((item) => (
              <tr key={item.id} className="hover:bg-gray-50/80 transition">
                <td className="py-3 px-4">
                  <img
                    src={item.image}
                    alt={item.name}
                    className="w-10 h-10 rounded-lg bg-gray-50 border border-gray-200 object-contain p-1"
                  />
                </td>
                <td className="py-3 px-4 font-bold text-gray-900">{item.name}</td>
                <td className="py-3 px-4 text-gray-600">{item.category}</td>
                <td className="py-3 px-4 font-mono text-gray-500">{item.sku}</td>
                <td className="py-3 px-4 font-bold text-gray-900">
                  ₹{item.price.toLocaleString("en-IN")}
                </td>
                <td className="py-3 px-4 font-semibold text-gray-700">{item.stock}</td>
                <td className="py-3 px-4">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800">
                    Active
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Product Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-200">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Package size={20} className="text-[#00D9D9]" />
              Add New Product
            </h3>
            <form onSubmit={handleCreateProduct} className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">
                  Product Name
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Silk Saree"
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-medium focus:outline-none focus:border-[#00D9D9]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Category</label>
                  <select
                    value={newCat}
                    onChange={(e) => setNewCat(e.target.value as any)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-medium focus:outline-none"
                  >
                    <option value="Clothing">Clothing</option>
                    <option value="Imitation Jewellery">Imitation Jewellery</option>
                    <option value="Gold Jewellery">Gold Jewellery</option>
                    <option value="Accessories">Accessories</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">
                    SKU / Code
                  </label>
                  <input
                    type="text"
                    value={newSku}
                    onChange={(e) => setNewSku(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-medium focus:outline-none focus:border-[#00D9D9]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">
                    Price (₹)
                  </label>
                  <input
                    type="number"
                    value={newPrice}
                    onChange={(e) => setNewPrice(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-medium focus:outline-none focus:border-[#00D9D9]"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">
                    Stock Count
                  </label>
                  <input
                    type="number"
                    value={newStock}
                    onChange={(e) => setNewStock(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-medium focus:outline-none focus:border-[#00D9D9]"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-xl text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#00D9D9] hover:bg-[#00B8B8] text-slate-950 rounded-xl text-xs font-extrabold shadow-xs"
                >
                  Save Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
