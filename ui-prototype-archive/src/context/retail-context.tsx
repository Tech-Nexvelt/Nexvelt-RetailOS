"use client";

import React, { createContext, useContext, useState } from "react";
import {
  INITIAL_PRODUCTS,
  INITIAL_CART,
  INITIAL_SALES,
  ProductItem,
  CartItem,
  SaleRecord,
} from "@/domain/mock-data";

export type Role = "cashier" | "manager" | "owner";

interface RetailContextType {
  products: ProductItem[];
  cart: CartItem[];
  sales: SaleRecord[];
  role: Role;
  searchQuery: string;
  selectedCategory: string;
  selectedTab: "All Products" | "Featured" | "Low Stock";
  isCheckoutOpen: boolean;
  isReceiptOpen: boolean;
  isScanModalOpen: boolean;
  isErrorModalOpen: boolean;
  isEmptyStateDemo: boolean;
  isMobilePOSView: boolean;
  isSidebarCollapsed: boolean;
  activeInvoice: SaleRecord | null;

  // State setters & Actions
  setRole: (role: Role) => void;
  setSearchQuery: (q: string) => void;
  setSelectedCategory: (c: string) => void;
  setSelectedTab: (t: "All Products" | "Featured" | "Low Stock") => void;
  addToCart: (product: ProductItem) => void;
  updateCartQuantity: (productId: string, quantity: number) => void;
  removeFromCart: (productId: string) => void;
  clearCart: () => void;
  setIsCheckoutOpen: (open: boolean) => void;
  setIsReceiptOpen: (open: boolean) => void;
  setIsScanModalOpen: (open: boolean) => void;
  setIsErrorModalOpen: (open: boolean) => void;
  setIsEmptyStateDemo: (empty: boolean) => void;
  setIsMobilePOSView: (mobile: boolean) => void;
  setIsSidebarCollapsed: (collapsed: boolean) => void;
  completeCheckout: (
    paymentMethod: "Cash" | "UPI" | "Card" | "Split",
    amountTendered: number,
  ) => SaleRecord;
  addProduct: (product: Omit<ProductItem, "id">) => void;
}

const RetailContext = createContext<RetailContextType | undefined>(undefined);

export function RetailProvider({ children }: { children: React.ReactNode }) {
  const [products, setProducts] = useState<ProductItem[]>(INITIAL_PRODUCTS);
  const [cart, setCart] = useState<CartItem[]>(INITIAL_CART);
  const [sales, setSales] = useState<SaleRecord[]>(INITIAL_SALES);
  const [role, setRole] = useState<Role>("cashier");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedTab, setSelectedTab] = useState<"All Products" | "Featured" | "Low Stock">(
    "All Products",
  );

  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);
  const [isEmptyStateDemo, setIsEmptyStateDemo] = useState(false);
  const [isMobilePOSView, setIsMobilePOSView] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [activeInvoice, setActiveInvoice] = useState<SaleRecord | null>(INITIAL_SALES[0] ?? null);

  const addToCart = (product: ProductItem) => {
    setCart((prev) => {
      const existingIndex = prev.findIndex((item) => item.product.id === product.id);
      if (existingIndex > -1) {
        const next = [...prev];
        const existing = next[existingIndex]!;
        next[existingIndex] = {
          ...existing,
          quantity: existing.quantity + 1,
        };
        return next;
      }
      return [
        ...prev,
        {
          product,
          quantity: 1,
          variant:
            product.category === "Clothing"
              ? "M, Green"
              : product.specs.split("•")[0]?.trim() || "",
        },
      ];
    });
  };

  const updateCartQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }
    setCart((prev) =>
      prev.map((item) => (item.product.id === productId ? { ...item, quantity } : item)),
    );
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const clearCart = () => {
    setCart([]);
  };

  const completeCheckout = (
    paymentMethod: "Cash" | "UPI" | "Card" | "Split",
    amountTendered: number,
  ) => {
    const subtotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    const tax = Math.round(subtotal * 0.03); // 1.5% CGST + 1.5% SGST
    const grandTotal = subtotal + tax;

    const newInvoice: SaleRecord = {
      id: `s${Date.now()}`,
      invoiceNumber: `NR25-${String(sales.length + 124).padStart(5, "0")}`,
      dateTime: new Date().toLocaleString("en-US", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }),
      customerName: "Walk-in",
      itemsCount: cart.reduce((acc, item) => acc + item.quantity, 0),
      totalAmount: grandTotal,
      paymentMethod,
      status: "Completed",
    };

    setSales((prev) => [newInvoice, ...prev]);
    setActiveInvoice(newInvoice);
    setCart([]);
    setIsCheckoutOpen(false);
    return newInvoice;
  };

  const addProduct = (newProd: Omit<ProductItem, "id">) => {
    const created: ProductItem = {
      ...newProd,
      id: `p${Date.now()}`,
    };
    setProducts((prev) => [created, ...prev]);
  };

  return (
    <RetailContext.Provider
      value={{
        products,
        cart,
        sales,
        role,
        searchQuery,
        selectedCategory,
        selectedTab,
        isCheckoutOpen,
        isReceiptOpen,
        isScanModalOpen,
        isErrorModalOpen,
        isEmptyStateDemo,
        isMobilePOSView,
        isSidebarCollapsed,
        activeInvoice,
        setRole,
        setSearchQuery,
        setSelectedCategory,
        setSelectedTab,
        addToCart,
        updateCartQuantity,
        removeFromCart,
        clearCart,
        setIsCheckoutOpen,
        setIsReceiptOpen,
        setIsScanModalOpen,
        setIsErrorModalOpen,
        setIsEmptyStateDemo,
        setIsMobilePOSView,
        setIsSidebarCollapsed,
        completeCheckout,
        addProduct,
      }}
    >
      {children}
    </RetailContext.Provider>
  );
}

export function useRetail() {
  const ctx = useContext(RetailContext);
  if (!ctx) {
    throw new Error("useRetail must be used within a RetailProvider");
  }
  return ctx;
}
