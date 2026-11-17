import type { ReactNode } from "react";
import { Link as AriaLink, type LinkProps as AriaLinkProps } from "react-aria-components";
import { cn } from "../lib/cn";
import { interactive } from "./base";

/**
 * What every link is made of (ADR 0069): a real `<a>` (so new tab, copy address and middle click work), keyboard and press handling from React
 * Aria, and the looks all links share. The Face routes by the hash, so `href` is like `#/pages/ID`.
 */
export interface BaseLinkProps extends Omit<AriaLinkProps, "className" | "style" | "children"> { className?: string; children?: ReactNode }
export function BaseLink({ className, ...rest }: BaseLinkProps) {
  return <AriaLink className={cn(interactive, "data-[focus-visible]:outline-2 data-[focus-visible]:outline-brand", className)} {...rest} />;
}

/** A link in running text or a list. */
export function TextLink({ className, ...rest }: BaseLinkProps) {
  return <BaseLink className={cn("rounded-sm hoverable", className)} {...rest} />;
}
