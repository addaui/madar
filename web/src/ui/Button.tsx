import type { ReactNode } from "react";
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from "react-aria-components";

export type { PressEvent } from "react-aria-components";
import { tv, type VariantProps } from "tailwind-variants";
import { cn } from "../lib/cn";
import { interactive } from "./base";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";

/** What every button is made of (ADR 0069): React Aria's button, plus the looks that all buttons share. Variants below only add to it. */
export interface BaseButtonProps extends Omit<AriaButtonProps, "className" | "style" | "children" | "onClick"> {
  className?: string;
  children?: ReactNode;
}
export function BaseButton({ className, ...rest }: BaseButtonProps) {
  return <AriaButton className={cn(interactive, className)} {...rest} />;
}

const button = tv({
  base: "inline-flex min-h-[var(--hit)] items-center gap-[7px] whitespace-nowrap border px-3.5 font-medium transition-colors duration-150",
  variants: {
    kind: {
      default: "rounded-btn border-line-strong bg-surface text-text hoverable",
      primary: "rounded-btn border-primary bg-primary text-on-primary hover:bg-[color-mix(in_srgb,var(--primary)_88%,var(--text))] active:bg-[color-mix(in_srgb,var(--primary)_80%,var(--text))]",
      ghost: "rounded-btn border-transparent bg-transparent text-muted-foreground hoverable hover:text-text",
      danger: "rounded-btn border-[color-mix(in_srgb,var(--danger)_40%,transparent)] text-danger hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]",
    },
    size: { md: "", sm: "min-h-[var(--hit-sm)] px-2.5 text-[13px]" },
  },
  defaultVariants: { kind: "default", size: "md" },
});

export type ButtonVariants = VariantProps<typeof button>;
export interface ButtonProps extends BaseButtonProps, ButtonVariants { icon?: string }

/** A text button, with an optional leading icon. While `isPending` it keeps its label, shows a spinner and ignores presses. */
export function Button({ kind, size, icon, className, children, isPending, ...rest }: ButtonProps) {
  return (
    <BaseButton className={cn(button({ kind, size }), className)} isPending={isPending} {...rest}>
      {isPending ? <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon && <Icon name={icon} />}
      {children && <span>{children}</span>}
    </BaseButton>
  );
}

const iconButton = tv({
  base: "inline-grid size-[var(--hit)] shrink-0 place-items-center rounded-sm border-0 bg-transparent text-muted-foreground transition-colors duration-150 hoverable hover:text-text aria-expanded:bg-soft aria-expanded:text-brand aria-pressed:bg-soft aria-pressed:text-brand [@media(pointer:coarse)]:size-10",
  variants: { size: { md: "", sm: "size-[var(--hit-sm)]" }, tone: { default: "", danger: "hover:text-danger" } },
  defaultVariants: { size: "md", tone: "default" },
});

export interface IconButtonProps extends Omit<BaseButtonProps, "children" | "aria-label">, VariantProps<typeof iconButton> { icon: string; label: string }

/** A button that is only an icon. `label` is its accessible name and its tooltip. */
export function IconButton({ icon, label, size, tone, className, ...rest }: IconButtonProps) {
  return (
    <Tooltip label={label}>
      <BaseButton aria-label={label} className={cn(iconButton({ size, tone }), className)} {...rest}>
        <Icon name={icon} />
      </BaseButton>
    </Tooltip>
  );
}
