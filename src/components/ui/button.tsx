import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,color,box-shadow,transform,opacity] duration-150 ease-out active:not-disabled:scale-[0.96] disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        solid:
          "bg-ink text-card hover:bg-ink/90 shadow-[0_0_0_1px_rgba(15,20,25,0.08)]",
        outline:
          "bg-card text-ink shadow-card hover:shadow-card-hover",
        ghost: "bg-transparent text-ink hover:bg-line",
        danger: "bg-crit text-card hover:bg-crit/90",
      },
      size: {
        sm: "h-8 rounded-full px-3 text-meta",
        md: "h-10 rounded-full px-4 text-body",
        lg: "h-12 rounded-full px-6 text-body",
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
