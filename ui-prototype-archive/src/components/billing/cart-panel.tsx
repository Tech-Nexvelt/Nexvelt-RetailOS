"use client";

import React, { useState } from "react";
import { ShoppingBag, Trash2, Plus, Minus, CreditCard } from "lucide-react";
import { useRetail } from "@/context/retail-context";

export function CartPanel() {
  const { cart, updateCartQuantity, removeFromCart, clearCart, setIsCheckoutOpen } = useRetail();

  const [discountAmount, setDiscountAmount] = useState(0);
  const [isDiscountActive, setIsDiscountActive] = useState(false);

  const itemCount = cart.reduce((acc, item) => acc + item.quantity, 0);
  const subtotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

  const effectiveDiscount = isDiscountActive ? discountAmount : 0;
  const taxableAmount = Math.max(0, subtotal - effectiveDiscount);
  const cgst = Math.round(taxableAmount * 0.015); // 1.5%
  const sgst = Math.round(taxableAmount * 0.015); // 1.5%
  const grandTotal = taxableAmount + cgst + sgst;

  return (
    <div className="w-full lg:w-96 bg-white border border-gray-200 rounded-2xl p-4 flex flex-col justify-between shadow-2xs shrink-0 min-h-[550px]">
      {/* Cart Header */}
      <div>
        <div className="flex items-center justify-between pb-3.5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[#00D9D9]/20 text-slate-900 flex items-center justify-center">
              <ShoppingBag size={18} />
            </div>
            <h3 className="font-bold text-base text-gray-900">
              Cart <span className="text-gray-500 font-medium">({itemCount} items)</span>
            </h3>
          </div>
          {cart.length > 0 && (
            <button
              onClick={clearCart}
              className="text-xs font-semibold text-[#00B8B8] hover:underline cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>

        {/* Cart Item List */}
        <div className="divide-y divide-gray-100 max-h-[380px] overflow-y-auto pr-1 my-2">
          {cart.length === 0 ? (
            <div className="py-12 text-center text-gray-400 flex flex-col items-center">
              <ShoppingBag size={40} className="stroke-1 mb-2 text-gray-300" />
              <p className="text-xs font-medium">Your cart is empty</p>
              <p className="text-[11px] text-gray-400">Click + on products to add items</p>
            </div>
          ) : (
            cart.map((item) => {
              const lineTotal = item.product.price * item.quantity;
              return (
                <div
                  key={item.product.id}
                  className="py-3 flex items-center justify-between gap-2 group"
                >
                  {/* Thumbnail & Product Details */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <img
                      src={item.product.image}
                      alt={item.product.name}
                      className="w-11 h-11 rounded-lg bg-gray-50 border border-gray-200 object-contain p-1 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <h4 className="font-bold text-xs text-gray-900 truncate">
                        {item.product.name}
                      </h4>
                      <p className="text-[11px] text-gray-500 truncate">
                        {item.variant || item.product.specs.split("•")[0]}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="font-semibold text-xs text-gray-900">
                          ₹{lineTotal.toLocaleString("en-IN")}
                        </span>
                        {item.quantity > 1 && (
                          <span className="text-[10px] text-gray-400">
                            (₹{item.product.price.toLocaleString("en-IN")} × {item.quantity})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Quantity Controls & Delete */}
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center border border-gray-200 rounded-lg bg-gray-50 p-0.5">
                      <button
                        onClick={() => updateCartQuantity(item.product.id, item.quantity - 1)}
                        className="w-6 h-6 rounded flex items-center justify-center text-gray-600 hover:bg-white hover:text-gray-900 transition"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="w-6 text-center text-xs font-bold text-gray-900">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateCartQuantity(item.product.id, item.quantity + 1)}
                        className="w-6 h-6 rounded flex items-center justify-center text-gray-600 hover:bg-white hover:text-gray-900 transition"
                      >
                        <Plus size={12} />
                      </button>
                    </div>

                    <button
                      onClick={() => removeFromCart(item.product.id)}
                      className="text-gray-400 hover:text-red-600 transition p-1"
                      title="Remove item"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Cart Summary & Checkout */}
      <div className="pt-3 border-t border-gray-200 space-y-2">
        <div className="flex items-center justify-between text-xs text-gray-600">
          <span>Subtotal</span>
          <span className="font-semibold text-gray-900">₹{subtotal.toLocaleString("en-IN")}</span>
        </div>

        {/* Discount Row */}
        <div className="flex items-center justify-between text-xs text-gray-600">
          <div className="flex items-center gap-2">
            <span>Discount</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={isDiscountActive}
                onChange={(e) => setIsDiscountActive(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-7 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#00D9D9]"></div>
            </label>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-gray-400">₹</span>
            <input
              type="number"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(Number(e.target.value))}
              disabled={!isDiscountActive}
              className="w-16 px-1.5 py-0.5 border border-gray-200 rounded text-right text-xs font-semibold text-gray-900 disabled:bg-gray-100 disabled:text-gray-400 focus:outline-none focus:border-[#00D9D9]"
            />
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-gray-600">
          <span>CGST (1.5%)</span>
          <span className="font-semibold text-gray-900">₹{cgst.toLocaleString("en-IN")}</span>
        </div>

        <div className="flex items-center justify-between text-xs text-gray-600">
          <span>SGST (1.5%)</span>
          <span className="font-semibold text-gray-900">₹{sgst.toLocaleString("en-IN")}</span>
        </div>

        <div className="pt-2 border-t border-gray-200 flex items-center justify-between">
          <span className="font-bold text-base text-gray-900">Total</span>
          <span className="font-extrabold text-2xl text-[#00B8B8]">
            ₹{grandTotal.toLocaleString("en-IN")}
          </span>
        </div>

        {/* Checkout Button */}
        <button
          onClick={() => setIsCheckoutOpen(true)}
          disabled={cart.length === 0}
          className="w-full mt-3 bg-[#00D9D9] hover:bg-[#00B8B8] disabled:bg-gray-200 disabled:text-gray-400 text-slate-950 font-extrabold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition shadow-sm cursor-pointer"
        >
          <CreditCard size={18} />
          <span>Checkout</span>
          <span className="bg-slate-950/15 px-1.5 py-0.5 rounded text-xs font-semibold">F2</span>
        </button>
      </div>
    </div>
  );
}
