"use client";

import React, { useState } from "react";
import { TrendingUp, AlertTriangle, ArrowUpRight, ArrowDownRight } from "lucide-react";

export function ReportsDashboard() {
  const [timePeriod, setTimePeriod] = useState<"Today" | "This Week" | "This Month" | "Custom">(
    "Today",
  );

  return (
    <div className="space-y-5">
      {/* Top Time Period Filter */}
      <div className="flex items-center justify-between bg-white border border-gray-200 p-3 rounded-2xl shadow-2xs">
        <h2 className="text-sm font-bold text-gray-900">Executive Summary & Analytics</h2>
        <div className="flex items-center gap-1.5 bg-gray-50 p-1 rounded-xl border border-gray-200">
          {(["Today", "This Week", "This Month", "Custom"] as const).map((period) => (
            <button
              key={period}
              onClick={() => setTimePeriod(period)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                timePeriod === period
                  ? "bg-white text-gray-900 shadow-2xs"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              {period}
            </button>
          ))}
        </div>
      </div>

      {/* 4 Metric KPI Cards (Exact match of reference image) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Sales */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-2xs flex flex-col justify-between">
          <div>
            <span className="text-xs font-semibold text-gray-500">Today's Sales</span>
            <div className="text-2xl font-extrabold text-gray-900 mt-1">₹1,24,580</div>
          </div>
          <div className="flex items-center gap-1 text-xs font-bold text-emerald-600 mt-3">
            <ArrowUpRight size={16} />
            <span>+12%</span>
            <span className="text-gray-400 font-normal ml-1">vs yesterday</span>
          </div>
        </div>

        {/* Card 2: Total Bills */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-2xs flex flex-col justify-between">
          <div>
            <span className="text-xs font-semibold text-gray-500">Total Bills</span>
            <div className="text-2xl font-extrabold text-gray-900 mt-1">36</div>
          </div>
          <div className="flex items-center gap-1 text-xs font-bold text-emerald-600 mt-3">
            <ArrowUpRight size={16} />
            <span>+8%</span>
          </div>
        </div>

        {/* Card 3: Avg Bill Value */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-2xs flex flex-col justify-between">
          <div>
            <span className="text-xs font-semibold text-gray-500">Avg. Bill Value</span>
            <div className="text-2xl font-extrabold text-gray-900 mt-1">₹3,460</div>
          </div>
          <div className="flex items-center gap-1 text-xs font-bold text-red-500 mt-3">
            <ArrowDownRight size={16} />
            <span>-2%</span>
          </div>
        </div>

        {/* Card 4: Low Stock Items */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-2xs flex flex-col justify-between">
          <div>
            <span className="text-xs font-semibold text-gray-500">Low Stock Items</span>
            <div className="text-2xl font-extrabold text-amber-600 mt-1 flex items-center gap-2">
              <span>5</span>
              <AlertTriangle size={18} className="text-amber-500" />
            </div>
          </div>
          <div className="text-xs text-amber-600 font-medium mt-3">Action required</div>
        </div>
      </div>

      {/* Main Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Sales Trend Line Chart (Span 2) */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-2xl p-5 shadow-2xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-sm text-gray-900 flex items-center gap-2">
              <TrendingUp size={18} className="text-[#00D9D9]" />
              Sales Trend
            </h3>
            <span className="text-xs text-gray-400">Hourly revenue</span>
          </div>

          {/* Custom SVG Line Chart */}
          <div className="h-52 w-full pt-2">
            <svg viewBox="0 0 500 180" className="w-full h-full overflow-visible">
              <defs>
                <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00D9D9" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#00D9D9" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Grid Lines */}
              <line x1="0" y1="30" x2="500" y2="30" stroke="#F1F5F9" strokeWidth="1" />
              <line x1="0" y1="70" x2="500" y2="70" stroke="#F1F5F9" strokeWidth="1" />
              <line x1="0" y1="110" x2="500" y2="110" stroke="#F1F5F9" strokeWidth="1" />
              <line x1="0" y1="150" x2="500" y2="150" stroke="#F1F5F9" strokeWidth="1" />

              {/* Area Fill */}
              <path
                d="M 0,140 Q 60,110 120,130 T 240,60 T 360,90 T 480,30 L 480,160 L 0,160 Z"
                fill="url(#salesGradient)"
              />

              {/* Gradient Curve Line */}
              <path
                d="M 0,140 Q 60,110 120,130 T 240,60 T 360,90 T 480,30"
                fill="none"
                stroke="#00D9D9"
                strokeWidth="3.5"
                strokeLinecap="round"
              />

              {/* Active Point Dots */}
              <circle cx="240" cy="60" r="5" fill="#00D9D9" stroke="#FFF" strokeWidth="2" />
              <circle cx="480" cy="30" r="5" fill="#00D9D9" stroke="#FFF" strokeWidth="2" />
            </svg>
            <div className="flex justify-between text-[11px] text-gray-400 mt-2 px-1">
              <span>9AM</span>
              <span>11AM</span>
              <span>1PM</span>
              <span>3PM</span>
              <span>5PM</span>
              <span>7PM</span>
              <span>9PM</span>
            </div>
          </div>
        </div>

        {/* Payment Breakdown Donut Chart */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-2xs flex flex-col justify-between">
          <h3 className="font-bold text-sm text-gray-900 mb-2">Payment Breakdown</h3>

          <div className="relative w-40 h-40 mx-auto flex items-center justify-center my-2">
            <svg viewBox="0 0 100 100" className="w-full h-full transform -rotate-90">
              {/* Cash 42% */}
              <circle
                cx="50"
                cy="50"
                r="38"
                fill="none"
                stroke="#00D9D9"
                strokeWidth="16"
                strokeDasharray="100 138"
                strokeDashoffset="0"
              />
              {/* UPI 38% */}
              <circle
                cx="50"
                cy="50"
                r="38"
                fill="none"
                stroke="#0284C7"
                strokeWidth="16"
                strokeDasharray="90 148"
                strokeDashoffset="-100"
              />
              {/* Card 16% */}
              <circle
                cx="50"
                cy="50"
                r="38"
                fill="none"
                stroke="#8B5CF6"
                strokeWidth="16"
                strokeDasharray="38 200"
                strokeDashoffset="-190"
              />
              {/* Others 4% */}
              <circle
                cx="50"
                cy="50"
                r="38"
                fill="none"
                stroke="#CBD5E1"
                strokeWidth="16"
                strokeDasharray="10 228"
                strokeDashoffset="-228"
              />
            </svg>
            <div className="absolute text-center">
              <span className="text-xs font-semibold text-gray-400 block">Total</span>
              <span className="text-base font-extrabold text-gray-900">₹1.24L</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-gray-100">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#00D9D9]" />
              <span className="text-gray-600">Cash</span>
              <span className="font-bold text-gray-900 ml-auto">42%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#0284C7]" />
              <span className="text-gray-600">UPI</span>
              <span className="font-bold text-gray-900 ml-auto">38%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#8B5CF6]" />
              <span className="text-gray-600">Card</span>
              <span className="font-bold text-gray-900 ml-auto">16%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-slate-300" />
              <span className="text-gray-600">Others</span>
              <span className="font-bold text-gray-900 ml-auto">4%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Lists Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Best Selling Products */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-2xs">
          <h3 className="font-bold text-sm text-gray-900 mb-3">Best Selling Products</h3>
          <div className="space-y-3 divide-y divide-gray-100">
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2.5">
                <span className="w-6 text-center font-bold text-xs text-gray-400">1</span>
                <div>
                  <h4 className="font-bold text-xs text-gray-900">Men's Premium Shirt</h4>
                  <span className="text-[11px] text-gray-500">28 units sold</span>
                </div>
              </div>
              <span className="font-extrabold text-xs text-gray-900">₹36,372</span>
            </div>
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2.5">
                <span className="w-6 text-center font-bold text-xs text-gray-400">2</span>
                <div>
                  <h4 className="font-bold text-xs text-gray-900">Gold Jhumka</h4>
                  <span className="text-[11px] text-gray-500">12 units sold</span>
                </div>
              </div>
              <span className="font-extrabold text-xs text-gray-900">₹5,40,000</span>
            </div>
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2.5">
                <span className="w-6 text-center font-bold text-xs text-gray-400">3</span>
                <div>
                  <h4 className="font-bold text-xs text-gray-900">Imitation Bracelet</h4>
                  <span className="text-[11px] text-gray-500">18 units sold</span>
                </div>
              </div>
              <span className="font-extrabold text-xs text-gray-900">₹8,982</span>
            </div>
          </div>
        </div>

        {/* Inventory Summary Progress */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-2xs flex flex-col justify-between">
          <h3 className="font-bold text-sm text-gray-900 mb-3">Inventory Summary</h3>
          <div className="space-y-3 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-gray-600 font-medium">Total Products</span>
              <span className="font-bold text-gray-900">126</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600 font-medium">In Stock</span>
              <span className="font-bold text-emerald-600">96</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600 font-medium">Low Stock</span>
              <span className="font-bold text-amber-600">9</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600 font-medium">Out of Stock</span>
              <span className="font-bold text-red-600">21</span>
            </div>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2.5 flex overflow-hidden mt-4">
            <div className="bg-emerald-500 h-full" style={{ width: "76%" }} />
            <div className="bg-amber-500 h-full" style={{ width: "7%" }} />
            <div className="bg-red-500 h-full" style={{ width: "17%" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
