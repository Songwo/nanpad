import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import "./controls.css";

const buttonVariants = cva(
  "ui-button inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        solid: "ui-button-solid",
        primary: "ui-button-solid",
        secondary: "ui-button-secondary",
        outline: "ui-button-outline",
        ghost: "ui-button-ghost",
        danger: "ui-button-danger",
        "danger-ghost": "ui-button-danger-ghost",
        luxury: "ui-button-solid",
      },
      size: {
        pill: "h-11 rounded-full px-5 text-body",
        sm: "h-8 rounded-sm px-3 text-meta",
        md: "h-11 rounded-sm px-4 text-body",
        lg: "h-12 rounded-sm px-6 text-body font-semibold",
        icon: "size-11 rounded-sm",
        "icon-sm": "size-8 rounded-sm",
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
  type,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      type={asChild ? type : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
