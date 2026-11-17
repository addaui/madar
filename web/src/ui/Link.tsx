import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { cn } from "../lib/cn";
import { interactive } from "./base";

/**
 * What every link is made of (ADR 0086): a real `<a>` (so new tab, copy address and middle click work) and the looks all links share.
 * The Face routes by the hash, so `href` is like `#/pages/ID`. `onPress` is called on a plain click (not on a click that opens a new tab).
 */
export interface BaseLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "style"> { onPress?: () => void }
export function BaseLink({ className, onPress, onClick, ...rest }: BaseLinkProps) {
  const click = (e: MouseEvent<HTMLAnchorElement>) => { onClick?.(e); if (onPress && !e.defaultPrevented && !(e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)) onPress(); };
  return <a className={cn(interactive, "focus-visible:outline-2 focus-visible:outline-brand", className)} onClick={click} {...rest} />;
}

/** A link in running text or a list. */
export function TextLink({ className, ...rest }: BaseLinkProps) {
  return <BaseLink className={cn("rounded-sm hoverable", className)} {...rest} />;
}
