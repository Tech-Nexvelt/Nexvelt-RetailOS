"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export function LoginView() {
  const router = useRouter();
  const [email, setEmail] = useState("cashier@nr.com");
  const [password, setPassword] = useState("••••••••");

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    router.push("/billing");
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl border border-gray-200 p-8 shadow-xl max-w-sm w-full space-y-5 text-center">
        {/* Logo */}
        <div className="flex flex-col items-center">
          <img src="/logo.png" alt="NexVelt Logo" className="w-14 h-14 object-contain mb-2" />
          <h1 className="text-xl font-extrabold text-gray-900 tracking-tight">NexVelt RetailOS</h1>
          <p className="text-xs text-gray-500 mt-1 font-semibold">Welcome Back</p>
          <span className="text-[11px] text-gray-400">Sign in to continue</span>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="space-y-3.5 text-left">
          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1">Email or Username</label>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:border-[#00D9D9]"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:border-[#00D9D9]"
            />
          </div>

          <div className="flex items-center justify-between text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer text-gray-600">
              <input type="checkbox" defaultChecked className="rounded text-[#00D9D9]" />
              <span>Remember me</span>
            </label>
            <Link href="/forgot-password" className="text-[#00B8B8] font-bold hover:underline">
              Forgot password?
            </Link>
          </div>

          <button
            type="submit"
            className="w-full mt-2 bg-[#00D9D9] hover:bg-[#00B8B8] text-slate-950 font-extrabold py-3 rounded-xl transition shadow-xs cursor-pointer text-xs uppercase tracking-wider"
          >
            Sign In
          </button>
        </form>

        <div className="text-[11px] text-gray-400 pt-2 border-t border-gray-100">
          Demo Accounts: Cashier / Manager / Owner
        </div>
      </div>
    </div>
  );
}
