"use client";

import React from "react";
import Image from "next/image";

interface ProductImageProps {
  src?: string | null;
  name: string;
  className?: string;
  size?: number;
}

export function ProductImage({ src, name, className = "", size = 120 }: ProductImageProps) {
  if (src && (src.startsWith("http") || src.startsWith("/") || src.startsWith("data:"))) {
    return (
      <div className={`relative overflow-hidden bg-slate-50 flex items-center justify-center ${className}`}>
        <Image src={src} alt={name} width={size} height={size} className="object-contain w-full h-full" />
      </div>
    );
  }

  // Generate a distinct visual vector SVG representation based on item name/type
  const n = name.toLowerCase();

  if (n.includes("shirt") || n.includes("top")) {
    return (
      <div className={`flex items-center justify-center bg-teal-50/80 rounded-xl p-3 text-[#00bba7] ${className}`}>
        <svg viewBox="0 0 64 64" fill="none" className="w-full h-full max-w-[80%] max-h-[80%]" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 14L28 22H36L46 14L54 26L46 30V54H18V30L10 26L18 14Z" fill="#00bba7" fillOpacity="0.15" />
          <path d="M28 22C28 26 36 26 36 22" />
          <path d="M32 24V54" strokeDasharray="3 3" />
        </svg>
      </div>
    );
  }

  if (n.includes("kurti") || n.includes("dress") || n.includes("women")) {
    return (
      <div className={`flex items-center justify-center bg-rose-50/80 rounded-xl p-3 text-rose-500 ${className}`}>
        <svg viewBox="0 0 64 64" fill="none" className="w-full h-full max-w-[80%] max-h-[80%]" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 14L28 20H36L42 14L50 24L44 28V54H20V28L14 24L22 14Z" fill="#f43f5e" fillOpacity="0.15" />
          <path d="M28 20C28 24 36 24 36 20" />
        </svg>
      </div>
    );
  }

  if (n.includes("jhumka") || n.includes("earring")) {
    return (
      <div className={`flex items-center justify-center bg-amber-50/80 rounded-xl p-3 text-amber-500 ${className}`}>
        <svg viewBox="0 0 64 64" fill="none" className="w-full h-full max-w-[80%] max-h-[80%]" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="32" cy="18" r="4" fill="#f59e0b" fillOpacity="0.2" />
          <path d="M32 22V28" />
          <path d="M22 36C22 28 42 28 42 36L46 44H18L22 36Z" fill="#f59e0b" fillOpacity="0.3" />
          <circle cx="24" cy="48" r="2" fill="#f59e0b" />
          <circle cx="32" cy="49" r="2" fill="#f59e0b" />
          <circle cx="40" cy="48" r="2" fill="#f59e0b" />
        </svg>
      </div>
    );
  }

  if (n.includes("bracelet") || n.includes("bangle")) {
    return (
      <div className={`flex items-center justify-center bg-amber-50/80 rounded-xl p-3 text-amber-600 ${className}`}>
        <svg viewBox="0 0 64 64" fill="none" className="w-full h-full max-w-[80%] max-h-[80%]" stroke="currentColor" strokeWidth="2.5">
          <ellipse cx="32" cy="32" rx="20" ry="14" fill="#d97706" fillOpacity="0.15" strokeLinecap="round" />
          <circle cx="16" cy="30" r="3" fill="#f59e0b" />
          <circle cx="24" cy="43" r="3" fill="#f59e0b" />
          <circle cx="40" cy="43" r="3" fill="#f59e0b" />
          <circle cx="48" cy="30" r="3" fill="#f59e0b" />
        </svg>
      </div>
    );
  }

  if (n.includes("jeans") || n.includes("trouser") || n.includes("pant")) {
    return (
      <div className={`flex items-center justify-center bg-blue-50/80 rounded-xl p-3 text-blue-600 ${className}`}>
        <svg viewBox="0 0 64 64" fill="none" className="w-full h-full max-w-[80%] max-h-[80%]" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 16H46V24L42 54H33L32 30L31 54H22L18 24V16Z" fill="#2563eb" fillOpacity="0.15" />
          <path d="M18 22H46" />
        </svg>
      </div>
    );
  }

  if (n.includes("handbag") || n.includes("bag")) {
    return (
      <div className={`flex items-center justify-center bg-amber-50/80 rounded-xl p-3 text-amber-700 ${className}`}>
        <svg viewBox="0 0 64 64" fill="none" className="w-full h-full max-w-[80%] max-h-[80%]" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M24 24C24 16 40 16 40 24" />
          <path d="M16 24H48L52 52H12L16 24Z" fill="#b45309" fillOpacity="0.15" />
        </svg>
      </div>
    );
  }

  if (n.includes("chain") || n.includes("necklace")) {
    return (
      <div className={`flex items-center justify-center bg-amber-50/80 rounded-xl p-3 text-amber-500 ${className}`}>
        <svg viewBox="0 0 64 64" fill="none" className="w-full h-full max-w-[80%] max-h-[80%]" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M18 16C18 36 46 36 46 16" fill="#f59e0b" fillOpacity="0.1" />
          <polygon points="32,36 37,45 32,50 27,45" fill="#f59e0b" fillOpacity="0.4" />
        </svg>
      </div>
    );
  }

  // Default fallback visual
  return (
    <div className={`flex items-center justify-center bg-slate-100 rounded-xl p-3 text-slate-400 ${className}`}>
      <svg viewBox="0 0 64 64" fill="none" className="w-full h-full max-w-[70%] max-h-[70%]" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="16" y="16" width="32" height="32" rx="6" fill="#94a3b8" fillOpacity="0.15" />
        <circle cx="28" cy="28" r="4" />
        <path d="M48 40L38 30L20 48" />
      </svg>
    </div>
  );
}
