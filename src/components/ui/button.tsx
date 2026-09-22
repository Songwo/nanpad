import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "btn inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors duration-150 ease-out active:not-disabled:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        solid:
          "bg-ink text-card hover:bg-ink/90 shadow-[0_1px_3px_rgba(0,0,0,0.12)]",
        primary:
          "bg-ink text-card hover:bg-ink/90 shadow-[0_1px_3px_rgba(0,0,0,0.12)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.16)]",
        secondary:
          "bg-surface text-ink hover:bg-surface-subtle shadow-none",
        outline:
          "bg-card text-ink border border-line-strong hover:border-ink/20 hover:bg-surface-subtle shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
        ghost: "bg-transparent text-ink hover:bg-line",
        danger: "bg-crit text-card hover:bg-crit/90",
        "danger-ghost": "bg-transparent text-crit hover:bg-danger-bg",
        luxury:
          "btn-luxury",
      },
      size: {
        pill: "h-10 rounded-full px-5 text-body",
        sm: "h-8 rounded-full px-3 text-meta",
        md: "h-10 rounded-full px-4 text-body",
        lg: "h-12 rounded-full px-6 text-body font-semibold",
        icon: "size-10 rounded-full",
        "icon-sm": "size-8 rounded-full",
      },
    },
    defaultVariants: { variant: "solid", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
