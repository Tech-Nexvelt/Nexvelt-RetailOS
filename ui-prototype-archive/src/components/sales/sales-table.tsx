"use client";

import React, { useState } from "react";
import { Download, Calendar, Search } from "lucide-react";
import { useRetail } from "@/context/retail-context";

export function SalesTable() {
  const { sales } = useRetail();
  const [filterTab, setFilterTab] = useState<"All" | "Completed" | "Draft" | "Returned">("All");
  const [search, setSearch] = useState("");

  const filteredSales = sales.filter((s) => {
    const matchesSearch =
      s.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
      s.customerName.toLowerCase().includes(search.toLowerCase());
    const matchesTab = filterTab === "All" || s.status === filterTab;
    return matchesSearch && matchesTab;
  });

  return (
    <div className="space-y-4">
      {/* Top Filter & Export Bar */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-2xs">
        {/* Filter Tabs */}
        <div className="flex items-center gap-1.5 bg-gray-50 p-1 rounded-xl border border-gray-200">
          {(["All", "Completed", "Draft", "Returned"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilterTab(tab)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                filterTab === tab
                  ? "bg-white text-gray-900 shadow-2xs"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {/* Search Box */}
          <div className="relative min-w-[200px]">
            <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search invoice or customer..."
              className="w-full pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:border-[#00D9D9]"
            />
          </div>

          {/* Date Picker Button */}
          <button className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium text-gray-700 hover:bg-gray-100">
            <Calendar size={14} className="text-gray-500" />
            <span>Oct 10, 2026</span>
          </button>

          {/* Export CSV Button */}
          <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-800 rounded-xl text-xs font-bold transition shadow-2xs">
            <Download size={14} />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Sales Table */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-2xs overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
              <th className="py-3 px-4">Invoice</th>
              <th className="py-3 px-4">Date & Time</th>
              <th className="py-3 px-4">Customer</th>
              <th className="py-3 px-4">Items</th>
              <th className="py-3 px-4">Total</th>
              <th className="py-3 px-4">Payment</th>
              <th className="py-3 px-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-xs">
            {filteredSales.map((sale) => (
              <tr key={sale.id} className="hover:bg-gray-50/80 transition">
                <td className="py-3 px-4 font-bold text-[#00B8B8] cursor-pointer hover:underline">
                  {sale.invoiceNumber}
                </td>
                <td className="py-3 px-4 text-gray-600">{sale.dateTime}</td>
                <td className="py-3 px-4 font-medium text-gray-900">{sale.customerName}</td>
                <td className="py-3 px-4 text-gray-700">{sale.itemsCount}</td>
                <td className="py-3 px-4 font-extrabold text-gray-900">
                  ₹{sale.totalAmount.toLocaleString("en-IN")}
                </td>
                <td className="py-3 px-4 font-medium text-gray-600">{sale.paymentMethod}</td>
                <td className="py-3 px-4">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800">
                    {sale.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination Bar */}
        <div className="p-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between text-xs text-gray-500">
          <span>
            Showing 1 to {filteredSales.length} of {filteredSales.length} entries
          </span>
          <div className="flex items-center gap-1">
            <button className="px-2.5 py-1 rounded-lg border border-gray-200 bg-white font-bold text-[#00B8B8]">
              1
            </button>
            <button className="px-2.5 py-1 rounded-lg border border-gray-200 bg-white font-medium hover:bg-gray-100">
              2
            </button>
            <button className="px-2.5 py-1 rounded-lg border border-gray-200 bg-white font-medium hover:bg-gray-100">
              3
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
