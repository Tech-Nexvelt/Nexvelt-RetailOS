"use client";

import React, { useState } from "react";
import Link from "next/link";

export function ForgotPasswordView() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl border border-gray-200 p-8 shadow-xl max-w-sm w-full space-y-5 text-center">
        {/* Logo */}
        <div className="flex flex-col items-center">
          <img src="/logo.png" alt="NexVelt Logo" className="w-14 h-14 object-contain mb-2" />
          <h1 className="text-xl font-extrabold text-gray-900 tracking-tight">NexVelt RetailOS</h1>
          <h2 className="text-sm font-bold text-gray-800 mt-2">Forgot Password</h2>
          <p className="text-xs text-gray-500 mt-0.5">Enter your email to receive a reset link.</p>
        </div>

        {!submitted ? (
          <form onSubmit={handleSubmit} className="space-y-3 text-left">
            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">Email address</label>
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:border-[#00D9D9]"
              />
            </div>

            <button
              type="submit"
              className="w-full mt-2 bg-[#00D9D9] hover:bg-[#00B8B8] text-slate-950 font-extrabold py-3 rounded-xl transition shadow-xs cursor-pointer text-xs"
            >
              Send Reset Link
            </button>
          </form>
        ) : (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-xs font-semibold">
            Reset link sent! Please check your email inbox.
          </div>
        )}

        <div className="pt-2">
          <Link href="/login" className="text-xs font-bold text-[#00B8B8] hover:underline">
            Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}
