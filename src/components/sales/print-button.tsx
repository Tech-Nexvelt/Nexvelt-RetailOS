"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton({ label = "Print receipt" }: { label?: string }) {
  return (
    <Button variant="primary" size="lg" onClick={() => window.print()}>
      <Printer aria-hidden size={18} /> {label}
    </Button>
  );
}
