"use client";

import React, { useState } from "react";
import {
  Scan,
  AlertTriangle,
  X,
  Smartphone,
  Monitor,
  Box,
  UserCheck,
  Printer,
  Sparkles,
} from "lucide-react";
import { useRetail } from "@/context/retail-context";

export function DemoOverlays() {
  const {
    isScanModalOpen,
    setIsScanModalOpen,
    isErrorModalOpen,
    setIsErrorModalOpen,
    isEmptyStateDemo,
    setIsEmptyStateDemo,
    isMobilePOSView,
    setIsMobilePOSView,
    role,
    setRole,
    setIsReceiptOpen,
    products,
    addToCart,
  } = useRetail();

  const [barcodeInput, setBarcodeInput] = useState("NR-CL-001");

  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const found = products.find((p) => p.tag === barcodeInput || p.sku === barcodeInput);
    if (found) {
      addToCart(found);
      setIsScanModalOpen(false);
    } else {
      setIsScanModalOpen(false);
      setIsErrorModalOpen(true);
    }
  };

  return (
    <>
      {/* Top Interactive Demo Switcher Toolbar */}
      <div className="bg-slate-900 text-slate-100 text-xs py-1.5 px-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 z-40 sticky top-0">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-[#00D9D9]" />
          <span className="font-bold text-[#00D9D9]">NexVelt RetailOS UI Workbench</span>
          <span className="text-[11px] text-slate-400 hidden sm:inline">
            | Interactive Reference Implementation
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* View Mode Switcher */}
          <div className="flex items-center gap-1 bg-slate-800 p-0.5 rounded-lg">
            <button
              onClick={() => setIsMobilePOSView(false)}
              className={`px-2 py-1 rounded text-[11px] font-semibold flex items-center gap-1 transition ${
                !isMobilePOSView ? "bg-[#00D9D9] text-slate-950" : "text-slate-400 hover:text-white"
              }`}
            >
              <Monitor size={12} /> Desktop
            </button>
            <button
              onClick={() => setIsMobilePOSView(true)}
              className={`px-2 py-1 rounded text-[11px] font-semibold flex items-center gap-1 transition ${
                isMobilePOSView ? "bg-[#00D9D9] text-slate-950" : "text-slate-400 hover:text-white"
              }`}
            >
              <Smartphone size={12} /> Mobile POS
            </button>
          </div>

          {/* Quick Demo State Toggles */}
          <button
            onClick={() => setIsEmptyStateDemo(!isEmptyStateDemo)}
            className={`px-2 py-1 rounded text-[11px] font-semibold flex items-center gap-1 border border-slate-700 transition ${
              isEmptyStateDemo
                ? "bg-amber-500/20 border-amber-500 text-amber-300"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Box size={12} /> Empty State
          </button>

          <button
            onClick={() => setIsErrorModalOpen(true)}
            className="px-2 py-1 rounded text-[11px] font-semibold text-red-400 hover:bg-red-950/40 border border-slate-700 flex items-center gap-1"
          >
            <AlertTriangle size={12} /> Error Modal
          </button>

          <button
            onClick={() => setIsReceiptOpen(true)}
            className="px-2 py-1 rounded text-[11px] font-semibold text-slate-300 hover:bg-slate-800 border border-slate-700 flex items-center gap-1"
          >
            <Printer size={12} /> Thermal Receipt
          </button>

          {/* Role Switcher */}
          <div className="flex items-center gap-1 text-[11px] text-slate-400">
            <UserCheck size={12} className="text-[#00D9D9]" />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as any)}
              className="bg-slate-800 text-white font-bold rounded px-1.5 py-0.5 border border-slate-700 focus:outline-none"
            >
              <option value="cashier">Cashier</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </select>
          </div>
        </div>
      </div>

      {/* Barcode Scanner Modal */}
      {isScanModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-gray-200 text-center relative">
            <button
              onClick={() => setIsScanModalOpen(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
            >
              <X size={18} />
            </button>

            <div className="w-14 h-14 bg-[#00D9D9]/20 text-slate-900 rounded-2xl mx-auto flex items-center justify-center mb-3">
              <Scan size={30} />
            </div>

            <h3 className="text-base font-bold text-gray-900">Scan Product Barcode</h3>
            <p className="text-xs text-gray-500 mb-4">
              Point your hardware scanner or type SKU tag
            </p>

            <form onSubmit={handleScanSubmit} className="space-y-3">
              <input
                type="text"
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                placeholder="e.g. NR-CL-001 or IJ-1023"
                className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 text-center focus:outline-none focus:border-[#00D9D9]"
                autoFocus
              />

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsScanModalOpen(false);
                    setIsErrorModalOpen(true);
                  }}
                  className="flex-1 py-2 border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold rounded-xl"
                >
                  Test Not Found
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-[#00D9D9] hover:bg-[#00B8B8] text-slate-950 text-xs font-extrabold rounded-xl shadow-xs"
                >
                  Scan & Add
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Error State Modal (Exact match of reference image "Error State") */}
      {isErrorModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-gray-200 text-center space-y-4">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full mx-auto flex items-center justify-center border border-red-100">
              <AlertTriangle size={36} strokeWidth={2} />
            </div>

            <div>
              <h3 className="text-lg font-extrabold text-gray-900">Product not found</h3>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                We couldn't find a product matching this barcode tag.
              </p>
            </div>

            <div className="space-y-2 pt-2">
              <button
                onClick={() => {
                  setIsErrorModalOpen(false);
                  setIsScanModalOpen(true);
                }}
                className="w-full py-2.5 bg-[#00D9D9] hover:bg-[#00B8B8] text-slate-950 text-xs font-extrabold rounded-xl transition shadow-xs"
              >
                Try Again
              </button>
              <button
                onClick={() => setIsErrorModalOpen(false)}
                className="w-full py-2 text-xs font-bold text-[#00B8B8] hover:underline"
              >
                Add New Product
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
