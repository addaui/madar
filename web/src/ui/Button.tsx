import type { ComponentProps, MouseEvent, ReactNode } from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { tv, type VariantProps } from "tailwind-variants";
import { cn } from "../lib/cn";
import { interactive } from "./base";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";

/** What a press hands its handler: where it came from and which keys were held. */
export interface PressEvent {
  target: Element;
  pointerType: "mouse" | "pen" | "touch" | "keyboard" | "virtual";
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

function pressOf(e: MouseEvent<HTMLElement>): PressEvent {
  const kind = (e.nativeEvent as PointerEvent).pointerType;
  const pointerType = kind === "mouse" || kind === "pen" || kind === "touch" ? kind : e.detail === 0 ? "keyboard" : "virtual";
  return { target: e.currentTarget, pointerType, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey };
}

/**
 * What every button is made of (ADR 0086): Base UI's button, plus the looks that all buttons share. It never submits a form unless asked,
 * and while `isPending` it ignores presses. Variants below only add to it.
 */
export interface BaseButtonProps extends Omit<ComponentProps<"button">, "className" | "style" | "children" | "disabled"> {
  className?: string;
  children?: ReactNode;
  onPress?: (e: PressEvent) => void;
  isDisabled?: boolean;
  isPending?: boolean;
  /** The pointer (a mouse or a pen, never a touch) came over it or left it. */
  onHoverStart?: (e: PointerEvent) => void;
  onHoverEnd?: (e: PointerEvent) => void;
  /** Reachable by pointer only, not by Tab (a control whose action has a keyboard shortcut elsewhere). */
  excludeFromTabOrder?: boolean;
}
export function BaseButton({ className, onPress, isDisabled, isPending, type = "button", onHoverStart, onHoverEnd, excludeFromTabOrder, onClick, onPointerEnter, onPointerLeave, ...rest }: BaseButtonProps) {
  return (
    <ButtonPrimitive
      type={type}
      disabled={isDisabled}
      aria-disabled={isPending || undefined}
      data-pending={isPending ? "" : undefined}
      className={cn(interactive, className)}
      tabIndex={excludeFromTabOrder ? -1 : undefined}
      // what a parent adds (a tooltip listens for the pointer and the click) runs too, never instead
      onPointerEnter={(e) => { onPointerEnter?.(e); if (e.pointerType !== "touch") onHoverStart?.(e.nativeEvent); }}
      onPointerLeave={(e) => { onPointerLeave?.(e); if (e.pointerType !== "touch") onHoverEnd?.(e.nativeEvent); }}
      onClick={(e) => { onClick?.(e); if (isPending) { e.preventDefault(); return; } onPress?.(pressOf(e)); }}
      {...rest}
    />
  );
}

const button = tv({
  base: "inline-flex min-h-[var(--hit)] items-center gap-[7px] whitespace-nowrap border px-3.5 font-medium transition-[background-color,color,transform] duration-150 active:not-disabled:scale-[0.98] motion-reduce:active:scale-100",
  variants: {
    kind: {
      default: "rounded-btn border-line-strong bg-surface text-text hoverable",
      primary: "rounded-btn border-primary bg-primary text-primary-foreground hover:bg-[color-mix(in_srgb,var(--primary)_88%,var(--text))] active:bg-[color-mix(in_srgb,var(--primary)_80%,var(--text))]",
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
      {isPending ? <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" /> : icon && <Icon name={icon} />}
      {children && <span>{children}</span>}
    </BaseButton>
  );
}

const iconButton = tv({
  base: "inline-grid size-[var(--hit)] shrink-0 place-items-center rounded-sm border-0 bg-transparent text-muted-foreground transition-[background-color,color,transform] duration-150 hoverable hover:text-text active:not-disabled:scale-95 motion-reduce:active:scale-100 aria-expanded:bg-soft aria-expanded:text-brand aria-pressed:bg-soft aria-pressed:text-brand [@media(pointer:coarse)]:size-10",
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
