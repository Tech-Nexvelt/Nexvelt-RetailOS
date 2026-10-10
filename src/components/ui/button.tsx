import * as React from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg" | "xl";

const variants: Record<Variant, string> = {
  // Dark text on cyan: white on #00D9D9 is below 4.5:1 contrast.
  primary: "bg-primary text-ink hover:bg-primary-strong active:bg-primary-strong font-semibold",
  secondary: "bg-surface text-ink border border-line hover:bg-app",
  ghost: "bg-transparent text-ink hover:bg-app",
  danger: "bg-danger text-white hover:opacity-90 font-semibold",
};
const sizes: Record<Size, string> = {
  md: "min-h-11 px-4 text-base",
  lg: "min-h-12 px-5 text-lg",
  xl: "min-h-16 px-6 text-xl",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "nv-transition inline-flex items-center justify-center gap-2 rounded-ctl",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});
