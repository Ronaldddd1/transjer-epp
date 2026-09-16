import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ComponentProps } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const variants = {
  primary: "bg-brand text-ink hover:bg-brand-dark border border-brand-dark/30 font-semibold",
  dark: "bg-ink text-white hover:bg-ink-700 border border-ink",
  outline: "bg-white text-ink border border-steel-300 hover:border-ink hover:bg-steel-50",
  ghost: "bg-transparent text-steel-600 hover:bg-steel-100 hover:text-ink border border-transparent",
  danger: "bg-red-600 text-white hover:bg-red-700 border border-red-700",
} as const;
const sizes = {
  sm: "h-8 px-2.5 text-sm gap-1.5",
  md: "h-10 px-4 text-[15px] gap-2",
  icon: "h-9 w-9 justify-center",
} as const;

export type ButtonVariant = keyof typeof variants;

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: keyof typeof sizes;
  loading?: boolean;
};

export const buttonClass = (variant: ButtonVariant = "primary", size: keyof typeof sizes = "md", className?: string) =>
  cn(
    "inline-flex items-center rounded-md whitespace-nowrap transition-colors select-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2",
    "disabled:opacity-50 disabled:pointer-events-none",
    variants[variant], sizes[size], className,
  );

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", size = "md", loading, className, children, disabled, type = "button", ...props }, ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} className={buttonClass(variant, size, className)} {...props}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export function ButtonLink({ variant = "outline", size = "md", className, ...props }: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: keyof typeof sizes }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}
