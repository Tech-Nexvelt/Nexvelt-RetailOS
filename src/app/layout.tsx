import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "NexVelt RetailOS", template: "%s · NexVelt RetailOS" },
  description: "Simple billing and stock for retail shops.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#00D9D9",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-dvh bg-app text-ink antialiased">{children}</body>
    </html>
  );
}
