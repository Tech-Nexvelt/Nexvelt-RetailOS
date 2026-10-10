"use client";

import React from "react";
import { X, Printer } from "lucide-react";
import { useRetail } from "@/context/retail-context";

export function ReceiptModal() {
  const { isReceiptOpen, setIsReceiptOpen, activeInvoice } = useRetail();

  if (!isReceiptOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  const invoiceNum = activeInvoice ? activeInvoice.invoiceNumber : "NR25-00123";
  const dateStr = activeInvoice ? activeInvoice.dateTime : "10 Oct 2026 10:24 AM";
  const total = activeInvoice ? activeInvoice.totalAmount : 48715;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-gray-200 relative">
        {/* Modal Close Button */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-4 print:hidden">
          <h3 className="font-bold text-sm text-gray-900">Invoice Preview</h3>
          <button
            onClick={() => setIsReceiptOpen(false)}
            className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* Printable Thermal Receipt (80mm format) */}
        <div className="receipt-root bg-white text-slate-900 p-3 font-mono text-xs border border-dashed border-gray-300 rounded-xl space-y-3">
          {/* Header */}
          <div className="text-center space-y-0.5">
            <div className="font-extrabold text-base tracking-wider uppercase">NR COLLECTIONS</div>
            <div className="text-[10px] text-gray-600">Tax Invoice</div>
            <div className="text-[10px] text-gray-500">Invoice: #{invoiceNum}</div>
            <div className="text-[10px] text-gray-500">{dateStr}</div>
          </div>

          <div className="border-t border-dashed border-gray-300 my-2" />

          {/* Line Items Table */}
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="py-1">Item</th>
                <th className="py-1 text-center">Qty</th>
                <th className="py-1 text-right">Price</th>
                <th className="py-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr>
                <td className="py-1.5 font-sans font-medium">Men's Shirt</td>
                <td className="py-1.5 text-center">1</td>
                <td className="py-1.5 text-right">1,299</td>
                <td className="py-1.5 text-right font-bold">1,299</td>
              </tr>
              <tr>
                <td className="py-1.5 font-sans font-medium">Gold Jhumka (5.2g)</td>
                <td className="py-1.5 text-center">1</td>
                <td className="py-1.5 text-right">45,000</td>
                <td className="py-1.5 text-right font-bold">45,000</td>
              </tr>
              <tr>
                <td className="py-1.5 font-sans font-medium">Imitation Bracelet</td>
                <td className="py-1.5 text-center">2</td>
                <td className="py-1.5 text-right">499</td>
                <td className="py-1.5 text-right font-bold">998</td>
              </tr>
            </tbody>
          </table>

          <div className="border-t border-dashed border-gray-300 my-2" />

          {/* Summary */}
          <div className="space-y-1 text-[11px]">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span>₹47,297</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>CGST (1.5%)</span>
              <span>₹709</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>SGST (1.5%)</span>
              <span>₹709</span>
            </div>
            <div className="flex justify-between text-sm font-bold text-slate-900 pt-1 border-t border-gray-200">
              <span>TOTAL</span>
              <span>₹{total.toLocaleString("en-IN")}</span>
            </div>
          </div>

          <div className="border-t border-dashed border-gray-300 my-2" />

          <div className="text-center text-[10px] text-gray-500 pt-1">
            Thank you for shopping at NR Collections!
            <br />
            Visit Again
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-4 flex items-center gap-3 print:hidden">
          <button
            onClick={handlePrint}
            className="flex-1 py-2.5 bg-[#00D9D9] hover:bg-[#00B8B8] text-slate-950 text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition"
          >
            <Printer size={16} />
            <span>Print Receipt</span>
          </button>
        </div>
      </div>
    </div>
  );
}
