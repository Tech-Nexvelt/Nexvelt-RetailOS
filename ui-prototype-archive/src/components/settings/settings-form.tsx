"use client";

import React, { useState } from "react";
import {
  Store,
  Building,
  Users,
  Percent,
  ShieldCheck,
  Printer,
  FileText,
  CreditCard,
  Save,
} from "lucide-react";

export function SettingsForm() {
  const [activeTab, setActiveTab] = useState("store");
  const [storeName, setStoreName] = useState("NR Collections");
  const [address, setAddress] = useState("MG Road, Narsapur, AP - 534275");
  const [phone, setPhone] = useState("+91 98765 43210");
  const [email, setEmail] = useState("nrcollections@gmail.com");
  const [savedSuccess, setSavedSuccess] = useState(false);

  const subNav = [
    { key: "store", label: "Store Profile", icon: Store },
    { key: "branches", label: "Branches & Counters", icon: Building },
    { key: "staff", label: "Staff & Permissions", icon: Users },
    { key: "taxes", label: "Tax Configuration", icon: Percent },
    { key: "jewellery", label: "Jewellery Pricing", icon: ShieldCheck },
    { key: "printers", label: "Barcode & Printers", icon: Printer },
    { key: "invoices", label: "Invoice Preferences", icon: FileText },
    { key: "payments", label: "Payment Methods", icon: CreditCard },
  ];

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="flex flex-col md:flex-row gap-5 items-start">
      {/* Settings Sub-nav (Left Rail) */}
      <div className="w-full md:w-64 bg-white border border-gray-200 rounded-2xl p-2 shrink-0 shadow-2xs space-y-1">
        {subNav.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.key;
          return (
            <button
              key={item.key}
              onClick={() => setActiveTab(item.key)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition cursor-pointer text-left ${
                isActive
                  ? "bg-[#00D9D9]/20 text-slate-950 border-l-4 border-[#00D9D9]"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <Icon size={16} className={isActive ? "text-slate-950" : "text-gray-400"} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Settings Content Area */}
      <div className="flex-1 bg-white border border-gray-200 rounded-2xl p-6 shadow-2xs min-w-0">
        <div className="pb-4 border-b border-gray-100 mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">Store Profile</h2>
            <p className="text-xs text-gray-500">Manage your business details and branding</p>
          </div>
          {savedSuccess && (
            <span className="text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-xl">
              Changes saved successfully!
            </span>
          )}
        </div>

        <form onSubmit={handleSave} className="space-y-4 max-w-xl">
          {/* Store Name */}
          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1">Store Name</label>
            <input
              type="text"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:outline-none focus:border-[#00D9D9]"
            />
          </div>

          {/* Logo Dropzone */}
          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1">Logo</label>
            <div className="border-2 border-dashed border-gray-200 rounded-2xl p-6 text-center bg-gray-50/50 hover:bg-gray-50 transition cursor-pointer flex flex-col items-center justify-center">
              <img src="/logo.png" alt="NexVelt Logo" className="w-14 h-14 object-contain mb-2" />
              <span className="text-xs text-gray-400">Recommended: 512 x 512 px</span>
            </div>
          </div>

          {/* Address */}
          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1">Address</label>
            <textarea
              rows={2}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:border-[#00D9D9]"
            />
          </div>

          {/* Phone & Email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">Phone</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:border-[#00D9D9]"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:border-[#00D9D9]"
              />
            </div>
          </div>

          {/* Save Button */}
          <div className="pt-4">
            <button
              type="submit"
              className="bg-[#00D9D9] hover:bg-[#00B8B8] text-slate-950 font-extrabold text-xs px-6 py-3 rounded-xl flex items-center gap-2 transition shadow-xs cursor-pointer"
            >
              <Save size={16} />
              <span>Save Changes</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
