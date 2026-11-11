import type { ComponentProps } from "react";
import { tv, type VariantProps } from "tailwind-variants";
import { cn } from "../lib/cn";
import { Icon } from "./Icon";

const button = tv({
  base: "inline-flex min-h-[34px] items-center gap-[7px] whitespace-nowrap border px-3.5 font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 [@media(pointer:coarse)]:min-h-10",
  variants: {
    kind: {
      default: "rounded-btn border-line-strong bg-surface text-text hover:bg-hover",
      primary: "rounded-btn border-primary bg-primary text-on-primary hover:bg-[color-mix(in_srgb,var(--primary)_88%,var(--text))]",
      ghost: "rounded-btn border-transparent bg-transparent text-muted hover:bg-hover hover:text-text",
      danger: "rounded-btn border-[color-mix(in_srgb,var(--danger)_40%,transparent)] text-danger hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]",
    },
    size: { md: "", sm: "min-h-7 px-2.5 text-[13px]" },
  },
  defaultVariants: { kind: "default", size: "md" },
});

type ButtonProps = ComponentProps<"button"> & VariantProps<typeof button> & { icon?: string };

/** A text button, with an optional leading icon. `type` defaults to "button" so it never submits a form by accident. */
export function Button({ kind, size, icon, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={cn(button({ kind, size }), className)} {...rest}>
      {icon && <Icon name={icon} />}
      {children && <span>{children}</span>}
    </button>
  );
}

const iconButton = tv({
  base: "inline-grid size-[34px] shrink-0 place-items-center rounded-[10px] border-0 bg-transparent text-muted transition-colors duration-150 hover:bg-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-45 aria-expanded:bg-soft aria-expanded:text-accent aria-pressed:bg-soft aria-pressed:text-accent [@media(pointer:coarse)]:size-10",
  variants: { size: { md: "", sm: "size-7" }, tone: { default: "", danger: "hover:text-danger" } },
  defaultVariants: { size: "md", tone: "default" },
});

type IconButtonProps = Omit<ComponentProps<"button">, "children"> & VariantProps<typeof iconButton> & { icon: string; label: string };

/** A button that is only an icon. `label` is its accessible name and its tooltip. */
export function IconButton({ icon, label, size, tone, className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button type={type} title={label} aria-label={label} className={cn(iconButton({ size, tone }), className)} {...rest}>
      <Icon name={icon} />
    </button>
  );
}
