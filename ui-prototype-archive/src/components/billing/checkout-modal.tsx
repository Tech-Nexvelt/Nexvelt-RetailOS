"use client";

import React, { useState } from "react";
import { X, Check, Printer, Plus, CheckCircle2 } from "lucide-react";
import { useRetail } from "@/context/retail-context";

export function CheckoutModal() {
  const { cart, isCheckoutOpen, setIsCheckoutOpen, completeCheckout, setIsReceiptOpen } =
    useRetail();

  const [paymentMethod, setPaymentMethod] = useState<"Cash" | "UPI" | "Card" | "Split">("Cash");
  const [amountReceived, setAmountReceived] = useState<number>(50000);
  const [printInvoice, setPrintInvoice] = useState(true);
  const [completedSale, setCompletedSale] = useState<{
    invoiceNumber: string;
    total: number;
  } | null>(null);

  if (!isCheckoutOpen) return null;

  const subtotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const tax = Math.round(subtotal * 0.03); // 1.5% CGST + 1.5% SGST
  const grandTotal = subtotal > 0 ? subtotal + tax : 48715;

  const changeToReturn = Math.max(0, amountReceived - grandTotal);

  const handleConfirm = () => {
    const sale = completeCheckout(paymentMethod, amountReceived);
    setCompletedSale({
      invoiceNumber: sale.invoiceNumber,
      total: sale.totalAmount,
    });
  };

  const handleClose = () => {
    setIsCheckoutOpen(false);
    setCompletedSale(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 relative overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-900">Checkout</h2>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {!completedSale ? (
          <div className="mt-4 space-y-4">
            {/* Total Amount Box */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 text-center">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Total Amount
              </span>
              <div className="text-3xl font-extrabold text-gray-900 mt-1">
                ₹{grandTotal.toLocaleString("en-IN")}
              </div>
            </div>

            {/* Payment Method Selector */}
            <div className="grid grid-cols-4 gap-2">
              {(["Cash", "UPI", "Card", "Split"] as const).map((method) => {
                const isActive = paymentMethod === method;
                return (
                  <button
                    key={method}
                    onClick={() => setPaymentMethod(method)}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold transition border cursor-pointer ${
                      isActive
                        ? "bg-[#00D9D9]/15 border-[#00D9D9] text-slate-950 shadow-2xs"
                        : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {method}
                  </button>
                );
              })}
            </div>

            {/* Amount Received Input (Cash mode) */}
            {paymentMethod === "Cash" && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">
                    Amount Received
                  </label>
                  <div className="relative flex items-center">
                    <span className="absolute left-3.5 text-gray-500 font-bold">₹</span>
                    <input
                      type="number"
                      value={amountReceived}
                      onChange={(e) => setAmountReceived(Number(e.target.value))}
                      className="w-full pl-8 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-base font-bold text-gray-900 focus:outline-none focus:border-[#00D9D9]"
                    />
                  </div>
                </div>

                {/* Quick Add Chips */}
                <div className="flex items-center gap-2">
                  {[100, 500, 1000].map((chip) => (
                    <button
                      key={chip}
                      onClick={() => setAmountReceived((prev) => prev + chip)}
                      className="flex-1 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-semibold rounded-lg transition"
                    >
                      +{chip}
                    </button>
                  ))}
                </div>

                {/* Change to Return Banner */}
                <div className="bg-emerald-50 border border-emerald-200/80 rounded-2xl p-3.5 flex items-center justify-between text-emerald-950">
                  <span className="text-xs font-bold">Change to Return</span>
                  <span className="text-xl font-extrabold text-emerald-700">
                    ₹{changeToReturn.toLocaleString("en-IN")}
                  </span>
                </div>
              </div>
            )}

            {/* Confirm Sale Button */}
            <button
              onClick={handleConfirm}
              className="w-full mt-2 bg-[#00D9D9] hover:bg-[#00B8B8] text-slate-950 font-extrabold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition shadow-md cursor-pointer"
            >
              <Check size={20} strokeWidth={3} />
              <span>Confirm Sale</span>
            </button>

            {/* Print Invoice Checkbox */}
            <div className="flex items-center gap-2 text-xs text-gray-600 pt-1">
              <input
                type="checkbox"
                id="printInvoice"
                checked={printInvoice}
                onChange={(e) => setPrintInvoice(e.target.checked)}
                className="w-4 h-4 rounded text-[#00D9D9] focus:ring-[#00D9D9] border-gray-300"
              />
              <label htmlFor="printInvoice" className="cursor-pointer select-none">
                Print Invoice (3 copies)
              </label>
            </div>
          </div>
        ) : (
          /* Sale Completed Toast Card (Exact match of bottom right toast in reference image) */
          <div className="mt-6 text-center space-y-4">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full mx-auto flex items-center justify-center shadow-xs">
              <CheckCircle2 size={36} strokeWidth={2.5} />
            </div>

            <div>
              <h3 className="text-lg font-extrabold text-gray-900">Sale Completed!</h3>
              <p className="text-xs text-gray-500 mt-1">
                Invoice{" "}
                <span className="font-bold text-gray-700">#{completedSale.invoiceNumber}</span>
              </p>
              <div className="text-xl font-extrabold text-gray-900 mt-1">
                ₹{completedSale.total.toLocaleString("en-IN")}
              </div>
            </div>

            <div className="flex items-center gap-3 pt-3 border-t border-gray-100">
              <button
                onClick={() => {
                  handleClose();
                  setIsReceiptOpen(true);
                }}
                className="flex-1 py-2.5 border border-gray-300 hover:bg-gray-50 text-gray-800 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition"
              >
                <Printer size={15} />
                <span>Print Invoice</span>
              </button>

              <button
                onClick={handleClose}
                className="flex-1 py-2.5 bg-[#00D9D9] hover:bg-[#00B8B8] text-slate-950 text-xs font-extrabold rounded-xl transition shadow-xs"
              >
                New Sale
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
